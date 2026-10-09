"""
Knowledge Agent
负责知识库检索和问答
"""

from typing import Optional, Dict, Any, List

from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

from src.config import settings, rag_config
from src.skills import get_skill_runtime
from src.utils import logger
from src.rag import get_rag_pipeline, RAGResponse
from src.models.enums import RetrievalQuality
from src.rag.self_rag import RetrievalDecision

# LLM 自动路由（对话入口）：判定走 B4 图查询 / B1B2B3 检索。
# 可插拔：RAG_AUTO_ROUTE 开关关时 auto_route() 返回 None，调用方走原默认检索路径，逐字节不变。
_AUTO_ROUTE_SYSTEM = (
    "你是查询路由器。给定用户问题，输出严格 JSON {\"query_type\": str, \"reason\": str}。"
    "query_type 只能取三个值之一："
    "fault_cause（故障排查→B4 因果链图查询）、"
    "equipment_chain（设备/部件/规范组成关系→B4 一般图查询）、"
    "retrieve（概念、操作、知识检索→B1/B2/B3 多路检索）。"
    "判定准则：问题涉及'故障/异常/压力低/泄漏/原因/处置'且指向具体设备或现象 → fault_cause；"
    "问题问设备/部件/泵站的组成、安装、输送关系 → equipment_chain；"
    "其余（概念定义、操作规程、知识类）→ retrieve。"
)

# 对话路由 → /graph/query 的 query_type（P1 结构化入参）映射
_ROUTE_TO_GRAPH_QUERY_TYPE = {
    "fault_cause": "fault_cause",
    "equipment_chain": "equipment_chain",
    "retrieve": None,
}


class KnowledgeAgent:
    SKILL_NAME = "knowledge-qa"

    """
    Knowledge Agent

    职责：
    1. 调用RAG Pipeline检索知识
    2. 基于检索结果回答问题
    3. 引用知识来源
    """

    def __init__(self):
        """初始化Knowledge Agent"""
        self._llm = None
        self._rag_pipeline = None
        self._skill_runtime = get_skill_runtime()

    @property
    def llm(self) -> ChatOpenAI:
        """获取LLM实例"""
        if self._llm is None:
            self._llm = ChatOpenAI(
                api_key=settings.OPENAI_API_KEY,
                base_url=settings.OPENAI_API_BASE,
                model=settings.final_synthesis_model_name,
                temperature=0.3,
                max_tokens=4096,
            )
        return self._llm

    @property
    def rag_pipeline(self):
        """获取RAG Pipeline"""
        if self._rag_pipeline is None:
            self._rag_pipeline = get_rag_pipeline()
        return self._rag_pipeline

    def execute(self, question: str, category: str = None) -> str:
        """
        执行知识问答

        Args:
            question: 用户问题
            category: 知识分类过滤

        Returns:
            回答
        """
        try:
            logger.info(f"Knowledge Agent执行: {question}")

            # 1. RAG检索
            rag_response = self.rag_pipeline.retrieve(
                query=question,
                category_filter=category,
                skip_self_rag=False,
            )

            # 2. 检查检索质量
            if rag_response.decision == RetrievalDecision.DIRECT:
                return self._answer_directly(question)

            if rag_response.decision == RetrievalDecision.CALCULATE:
                return (
                    "这个问题更适合走计算链路，建议改用 `hydraulic_calculation` 工具或计算工作流继续处理。"
                )

            if not self._has_usable_context(rag_response):
                return self._handle_no_knowledge(question)

            # 3. 基于检索结果生成回答
            answer = self._generate_answer(question, rag_response)

            logger.info(f"Knowledge Agent完成，来源数: {len(rag_response.sources)}")
            return answer

        except Exception as e:
            logger.error(f"Knowledge Agent执行失败: {e}")
            return f"知识检索失败: {str(e)}"

    @staticmethod
    def _has_usable_context(rag_response: RAGResponse) -> bool:
        """Treat strong retrieved evidence as usable even if CRAG marks quality low."""
        if not rag_response.context or not rag_response.sources:
            return False

        top_score = 0.0
        for src in rag_response.sources:
            try:
                top_score = max(top_score, float(src.get("score", 0.0) or 0.0))
            except (TypeError, ValueError):
                continue

        return top_score >= 0.45

    def _generate_answer(self, question: str, rag_response: RAGResponse) -> str:
        """
        基于RAG结果生成回答

        Args:
            question: 用户问题
            rag_response: RAG响应

        Returns:
            生成的回答
        """
        try:
            # 构建来源信息
            sources_text = []
            for src in rag_response.sources[:3]:
                sources_text.append(f"- {src.get('doc_title', '未知文档')}")
            sources_str = "\n".join(sources_text) if sources_text else "无明确来源"

            # 构建Prompt
            prompt = ChatPromptTemplate.from_messages([
                ("system", self._skill_runtime.get_prompt(self.SKILL_NAME, "system")),
                ("human", "{input}")
            ])

            chain = prompt | self.llm | StrOutputParser()
            task_input = self._skill_runtime.render_prompt(
                self.SKILL_NAME,
                "task",
                {
                    "question": question,
                    "context": rag_response.context,
                    "sources": sources_str,
                },
            )

            answer = chain.invoke({
                "input": task_input
            })

            # 添加引用说明
            if rag_response.sources:
                answer += "\n\n---\n**参考来源:**\n"
                for src in rag_response.sources[:3]:
                    answer += f"- [{src.get('doc_title', '未知')}] "
                    answer += f"相关度: {src.get('score', 0):.2f}\n"

            return answer

        except Exception as e:
            logger.error(f"回答生成失败: {e}")
            # 降级：直接返回检索内容
            return f"**检索到的相关内容:**\n\n{rag_response.context[:1000]}..."

    def _answer_directly(self, question: str) -> str:
        """Handle simple direct questions without pretending the knowledge base missed."""

        try:
            prompt = ChatPromptTemplate.from_messages([
                ("system", "你是管道工程领域的 AI 助手。请直接、简洁地回答用户问题。"),
                ("human", "{question}")
            ])
            chain = prompt | self.llm | StrOutputParser()
            return chain.invoke({"question": question})
        except Exception as e:
            logger.error(f"直接回答失败: {e}")
            return self._handle_no_knowledge(question)

    def _handle_no_knowledge(self, question: str) -> str:
        """
        处理知识库无相关内容的情况

        Args:
            question: 用户问题

        Returns:
            回复
        """
        try:
            # 尝试用LLM直接回答，但明确说明
            prompt = ChatPromptTemplate.from_messages([
                ("system", """你是管道工程领域的AI助手。
用户问了一个问题，但知识库中没有找到直接相关的内容。
请基于你的通用知识简短回答，但要明确告知用户这不是来自知识库的专业答案。"""),
                ("human", "{question}")
            ])

            chain = prompt | self.llm | StrOutputParser()
            base_answer = chain.invoke({"question": question})

            return (
                f"**注意：** 知识库中未找到与您问题直接相关的专业内容。\n\n"
                f"以下是基于通用知识的参考回答，仅供参考：\n\n{base_answer}\n\n"
                f"建议您查阅相关技术规范或咨询专业人员获取更准确的信息。"
            )

        except Exception as e:
            logger.error(f"降级回答失败: {e}")
            return "抱歉，知识库中未找到与您问题相关的内容。请尝试换一种方式提问。"

    def auto_route(self, question: str):
        """对话入口 LLM 自动路由（可插拔，RAG_AUTO_ROUTE 门控）。

        返回 {"route": "graph_fault"|"graph_general"|"retrieve", "reason": str}，
        或 None（开关关 / LLM 失败 → 调用方走默认检索路径，行为不变）。

        全部 LLM 调用走 src/llm.get_llm_client()（LLMClientError 降级），
        与 B1/B2/B3/B4/B5 切点统一。
        """
        try:
            if not rag_config.pluggable.get("auto_route", False):
                return None
        except Exception:  # noqa: BLE001
            return None

        from src.llm import get_llm_client, LLMClientError

        try:
            client = get_llm_client()
            raw = client.complete(
                f"用户问题: {question}\n请输出路由决策（严格 JSON）。",
                system=_AUTO_ROUTE_SYSTEM,
                timeout=30.0,
            )
            import json

            text = (raw or "").strip()
            if text.startswith("{"):
                end = text.rfind("}")
                if end != -1:
                    text = text[: end + 1]
            data = json.loads(text)
            if not isinstance(data, dict):
                return None
            qtype = str(data.get("query_type", "")).strip()
            if qtype not in _ROUTE_TO_GRAPH_QUERY_TYPE:
                return None
            return {
                "route": qtype,
                "reason": str(data.get("reason", ""))[:200],
                "graph_query_type": _ROUTE_TO_GRAPH_QUERY_TYPE[qtype],
            }
        except LLMClientError as exc:
            logger.warning(f"auto_route LLM 失败，走默认检索: {exc}")
            return None
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"auto_route 异常，走默认检索: {exc}")
            return None

    def auto_route_search(self, question: str, top_k: int = 5) -> Dict[str, Any]:
        """对话入口自动路由编排（RAG_AUTO_ROUTE 门控）。

        LLM 判定路由后执行对应链路：
          - fault_cause / equipment_chain → GraphAgent.execute(query, query_type=...)
          - retrieve → 本 agent 的 RAG 检索（B1/B2/B3 由 pipeline 开关门控）
        开关关 / LLM 失败 / 路由不可用 → route="default"，走默认 RAG 检索，行为不变。
        """
        decision = self.auto_route(question)
        if decision is None:
            route, reason, graph_type = "default", "开关关或 LLM 失败，走默认检索", None
        else:
            route, reason = decision["route"], decision.get("reason", "")
            graph_type = decision.get("graph_query_type")

        result: Dict[str, Any]
        if route in ("fault_cause", "equipment_chain") and graph_type:
            try:
                from src.agents.graph_agent import get_graph_agent

                graph_out = get_graph_agent().execute(question, query_type=graph_type)
                result = {"graph": graph_out}
            except Exception as exc:  # noqa: BLE001
                logger.warning(f"auto_route 图查询失败，降级检索: {exc}")
                result = {"graph": f"图查询失败: {exc}"}
        else:
            try:
                sources = self.search_knowledge(question, top_k=top_k)
                result = {"sources": sources}
            except Exception as exc:  # noqa: BLE001
                logger.warning(f"auto_route 检索失败: {exc}")
                result = {"sources": []}

        return {"route": route, "reason": reason, **result}

    def search_knowledge(self, query: str, top_k: int = 5) -> List[Dict]:
        """
        单纯的知识检索（不生成回答）

        Args:
            query: 查询
            top_k: 返回数量

        Returns:
            检索结果列表
        """
        try:
            rag_response = self.rag_pipeline.retrieve(
                query=query,
                top_k=top_k,
                skip_self_rag=False
            )

            return rag_response.sources

        except Exception as e:
            logger.error(f"知识检索失败: {e}")
            return []


# 全局实例
_knowledge_agent: Optional[KnowledgeAgent] = None


def get_knowledge_agent() -> KnowledgeAgent:
    """获取Knowledge Agent实例"""
    global _knowledge_agent
    if _knowledge_agent is None:
        _knowledge_agent = KnowledgeAgent()
    return _knowledge_agent
