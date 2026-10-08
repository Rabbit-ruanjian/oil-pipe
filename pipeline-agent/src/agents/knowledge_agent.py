"""
Knowledge Agent
负责知识库检索和问答
"""

from typing import Optional, Dict, Any, List

from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

from src.config import settings
from src.skills import get_skill_runtime
from src.utils import logger
from src.rag import get_rag_pipeline, RAGResponse
from src.models.enums import RetrievalQuality
from src.rag.self_rag import RetrievalDecision


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
