"""
Self-RAG and CRAG helpers.
"""

from __future__ import annotations

import json
import re
from enum import Enum
from typing import List, Optional, Tuple

from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

from src.config import rag_config, settings
from src.models.enums import RetrievalQuality
from src.utils import logger

from .reranker import RerankResult

# P0-③ 可插拔开关（默认全关）：multi_query / decompose 的 LLM 调用超时上限（秒）。
_MULTI_QUERY_LLM_TIMEOUT_SECONDS = 20


def _default_llm_call(prompt: ChatPromptTemplate, values: dict, *, llm: ChatOpenAI, timeout: int) -> str:
    """可替换的 LLM 调用切点。

    统一走 src/llm/llm_client.get_llm_client().complete()（与 A 类入库
    knowledge_ingest.py 同一封装）：渲染 ChatPromptTemplate 为纯文本后调用，
    超时/网络/配置异常统一抛 LLMClientError，此处捕获后返回空串，触发上层
    既有降级（expand 返回 []、decompose 判为简单问题 complex=False），
    行为与改造前"LLM 失败/超时降级"完全一致。

    注意：参数 ``llm``（ChatOpenAI 实例）保留以维持签名与 pipeline 注入兼容，
    切点后不再实际使用；真实 LLM 走单例 get_llm_client()。
    """
    from src.llm import LLMClientError, get_llm_client

    # 渲染 ChatPromptTemplate（system+user）为纯文本：先 format 成 user 串，
    # system 若存在则透传给 complete() 的 system 参数。
    user_text = prompt.format(**values)
    system_text: Optional[str] = None
    if getattr(prompt, "prompt_type", None) is not None:
        # 仅当 template 含独立 system 消息时提取；普通单段 template 保持 system=None
        msgs = prompt.format_messages(**values)
        if len(msgs) > 1 and getattr(msgs[0], "type", None) == "system":
            system_text = str(getattr(msgs[0], "content", ""))
            user_text = str(getattr(msgs[-1], "content", user_text))
    try:
        return get_llm_client().complete(
            user_text,
            system=system_text,
            timeout=float(timeout),
        )
    except LLMClientError:
        logger.warning(
            "multi-query LLM 调用失败/超时，降级跳过该路（timeout=%ss）", timeout,
        )
        return ""


def _pluggable() -> dict:
    """读取 P0-③ 可插拔开关（对缺失属性做防御，保证旧配置也可用）。"""
    if hasattr(rag_config, "pluggable"):
        return rag_config.pluggable
    return {
        "multi_query": False,
        "decompose": False,
        "hitl_confidence_threshold": 0.5,
    }


class RetrievalDecision(Enum):
    """How a user query should be handled before retrieval."""

    RETRIEVE = "retrieve"
    DIRECT = "direct"
    SQL = "sql"
    CALCULATE = "calculate"


class SelfRAG:
    """Decide whether to retrieve and assess retrieval quality."""

    GRAPH_ROUTE_MARKERS = [
        "原因",
        "因果",
        "关系",
        "关联",
        "依赖",
        "链路",
        "影响",
        "故障",
        "标准",
        "规范",
        "相关节点",
    ]
    DATABASE_ROUTE_MARKERS = [
        "数据库",
        "sql",
        "表里",
        "表中",
        "字段",
        "项目",
        "项目代号",
        "负责人",
        "上线日期",
        "首发日期",
        "泵站数据",
        "管道参数",
        "统计",
        "列表",
        "多少条",
    ]

    DECISION_PROMPT = """你是一个检索路由器，需要判断用户问题最适合哪种处理方式。

用户问题: {query}

可选类型:
1. retrieve - 需要检索知识库或已录入文档来回答
2. direct - 可直接回答的闲聊或常识性简单问题
3. sql - 需要查询结构化业务数据库的数据问题
4. calculate - 需要执行计算、分析或优化的问题

只输出一个类型名: retrieve/direct/sql/calculate
"""

    QUALITY_PROMPT = """请评估以下检索结果与用户问题的相关性。

用户问题: {query}

检索结果:
{context}

请只输出一个结果:
- high
- medium
- low
"""

    def __init__(self) -> None:
        self.enabled = rag_config.features["self_rag"]
        self._llm: Optional[ChatOpenAI] = None

    @property
    def llm(self) -> ChatOpenAI:
        if self._llm is None:
            self._llm = ChatOpenAI(
                api_key=settings.OPENAI_API_KEY,
                base_url=settings.OPENAI_API_BASE,
                model=settings.router_model_name,
                temperature=0,
                max_tokens=256,
            )
        return self._llm

    @staticmethod
    def _match_any(query: str, patterns: List[str]) -> bool:
        lowered = query.lower()
        return any(pattern.lower() in lowered for pattern in patterns)

    @classmethod
    def _heuristic_decision(cls, query: str) -> Optional[Tuple[RetrievalDecision, str]]:
        text = (query or "").strip()
        if not text:
            return None

        calc_markers = [
            "\u8ba1\u7b97",
            "\u6d4b\u7b97",
            "\u538b\u964d",
            "\u626c\u7a0b",
            "\u96f7\u8bfa",
            "\u96f7\u8bfa\u6570",
            "\u6469\u963b",
            "\u6c34\u529b",
            "\u4f18\u5316\u65b9\u6848",
            "\u6cf5\u7ec4\u4f18\u5316",
            "\u80fd\u8017\u5206\u6790",
            "\u654f\u611f\u6027",
        ]
        sql_markers = [
            "\u6570\u636e\u5e93",
            "sql",
            "\u8868\u91cc",
            "\u8868\u4e2d",
            "\u5b57\u6bb5",
            "\u9879\u76ee\u5217\u8868",
            "\u9879\u76ee\u6570\u636e",
            "\u7ba1\u9053\u53c2\u6570",
            "\u6cf5\u7ad9\u6570\u636e",
            "\u6cb9\u54c1\u6570\u636e",
            "\u67e5\u5e93",
        ]
        knowledge_markers = [
            "\u77e5\u8bc6\u5e93",
            "\u6587\u6863",
            "\u624b\u518c",
            "\u89c4\u5219",
            "\u89c4\u8303",
            "faq",
            "\u9879\u76ee\u4ee3\u53f7",
            "\u4e0a\u7ebf\u65e5\u671f",
            "\u9996\u6b21\u4e0a\u7ebf",
            "\u503c\u73ed\u53e3\u4ee4",
            "\u57f9\u8bad\u73af\u5883",
            "\u4e3b\u9898\u540d\u79f0",
            "\u5237\u65b0\u5468\u671f",
            "\u9608\u503c",
            "\u652f\u6301\u7535\u8bdd",
            "\u8bd5\u8fd0\u884c",
            "\u544a\u8b66",
            "\u670d\u52a1\u65f6\u95f4",
            "\u662f\u5426\u652f\u6301",
            "\u4e0a\u9650",
            "\u4fdd\u7559\u591a\u4e45",
            "\u591a\u957f\u65f6\u95f4",
        ]

        if cls._match_any(text, calc_markers):
            return RetrievalDecision.CALCULATE, "命中计算类关键词，优先走计算链路"

        if cls._match_any(text, sql_markers):
            return RetrievalDecision.SQL, "命中数据库类关键词，优先走结构化数据查询"

        exact_fact_pattern = re.compile(
            r".+\u7684.+(\u662f\u4ec0\u4e48|\u662f\u591a\u5c11|\u591a\u5c11|\u591a\u4e45|\u4ec0\u4e48\u65f6\u5019|\u4f55\u65f6|\u80fd\u5426|\u662f\u5426|\u53eb\u4ec0\u4e48|\u662f\u54ea\u4e00\u4e2a|\u662f\u54ea\u79cd|\u4e0a\u9650\u662f\u591a\u5c11)",
            re.IGNORECASE,
        )
        if cls._match_any(text, knowledge_markers) or exact_fact_pattern.search(text):
            return RetrievalDecision.RETRIEVE, "命中文档事实问答特征，优先检索知识库"

        return None

    def should_retrieve(self, query: str) -> Tuple[RetrievalDecision, str]:
        if not self.enabled:
            return RetrievalDecision.RETRIEVE, "Self-RAG 未启用，默认检索"

        heuristic = self._heuristic_decision(query)
        if heuristic is not None:
            return heuristic

        try:
            prompt = ChatPromptTemplate.from_template(self.DECISION_PROMPT)
            chain = prompt | self.llm | StrOutputParser()
            decision_text = chain.invoke({"query": query}).strip().lower()

            if "direct" in decision_text:
                return RetrievalDecision.DIRECT, "简单问题，无需检索"
            if "sql" in decision_text:
                return RetrievalDecision.SQL, "数据查询，转 SQL/数据链路"
            if "calculate" in decision_text:
                return RetrievalDecision.CALCULATE, "计算需求，转计算链路"
            return RetrievalDecision.RETRIEVE, "专业问题，需要检索知识库"
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"Self-RAG 决策失败: {exc}")
            return RetrievalDecision.RETRIEVE, "决策失败，默认检索"

    def evaluate_retrieval_quality(
        self,
        query: str,
        results: List[RerankResult],
    ) -> Tuple[RetrievalQuality, str]:
        if not results:
            return RetrievalQuality.LOW, "无检索结果"

        if not rag_config.features["crag"]:
            avg_score = sum(r.final_score for r in results) / len(results)
            if avg_score >= 0.7:
                return RetrievalQuality.HIGH, f"平均分数 {avg_score:.2f}"
            if avg_score >= 0.4:
                return RetrievalQuality.MEDIUM, f"平均分数 {avg_score:.2f}"
            return RetrievalQuality.LOW, f"平均分数 {avg_score:.2f}"

        try:
            context = "\n\n".join(f"[{idx}] {item.content[:300]}..." for idx, item in enumerate(results[:5], 1))
            prompt = ChatPromptTemplate.from_template(self.QUALITY_PROMPT)
            chain = prompt | self.llm | StrOutputParser()
            quality_text = chain.invoke({"query": query, "context": context}).strip().lower()

            if "high" in quality_text:
                return RetrievalQuality.HIGH, "检索结果高度相关"
            if "medium" in quality_text:
                return RetrievalQuality.MEDIUM, "检索结果部分相关"
            return RetrievalQuality.LOW, "检索结果相关性较低"
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"CRAG 评估失败: {exc}")
            avg_score = sum(r.final_score for r in results) / len(results)
            if avg_score >= 0.5:
                return RetrievalQuality.MEDIUM, "评估失败，按分数判定为中等"
            return RetrievalQuality.LOW, "评估失败，按分数判定为较低"

    def detect_route_hints(self, query: str) -> dict:
        """Return lightweight routing hints for the agentic retrieval loop."""

        text = (query or "").strip()
        lowered = text.lower()
        graph_hint = self._match_any(text, self.GRAPH_ROUTE_MARKERS)
        database_hint = self._match_any(text, self.DATABASE_ROUTE_MARKERS)
        exact_fact = bool(
            re.search(
                r".+(是什么|是多少|多少条|谁负责|什么时候|何时|上线日期|项目代号|编号|列表)",
                text,
                re.IGNORECASE,
            )
        )
        return {
            "graph": graph_hint,
            "database": database_hint or exact_fact,
            "multi_hop": graph_hint and any(marker in text for marker in ["原因", "因果", "影响", "依赖", "链路"]),
            "exact_fact": exact_fact,
            "raw_query": lowered,
        }

    def plan_routes(self, query: str, decision: RetrievalDecision) -> List[dict]:
        """Plan an ordered list of retrieval routes for a query."""

        hints = self.detect_route_hints(query)
        routes: List[dict] = []

        def add_route(name: str, reason: str) -> None:
            if any(route["route"] == name for route in routes):
                return
            routes.append({"route": name, "reason": reason})

        if decision == RetrievalDecision.SQL:
            add_route("database", "Self-RAG 判定为结构化数据查询")
            add_route("hybrid", "数据库结果可继续用知识库补充上下文")
        else:
            add_route("hybrid", "知识问答默认先走混合检索")
            if hints["graph"]:
                add_route("graph", "问题包含因果/关系/规范等图谱信号")
            if hints["database"]:
                add_route("database", "问题包含项目/字段/列表等结构化数据线索")

        if not routes:
            add_route("hybrid", "默认路由")
        return routes

    def refine_context(self, query: str, results: List[RerankResult]) -> str:
        del query
        if not results:
            return ""
        return "\n\n---\n\n".join(item.full_text or item.content for item in results)


class QueryRewriter:
    """Rewrite user queries into retrieval-friendly wording."""

    REWRITE_PROMPT = """请将用户问题改写成更适合知识库检索的形式。

原始问题: {query}

要求:
1. 保持原意不变
2. 优先保留实体名和关键字段名
3. 去掉口语化赘词
4. 直接输出改写后的问题
"""

    EXPAND_PROMPT = """你是检索增强助手。请把下面这个问题改写成 {n} 个"语义相近、但措辞/角度不同"的检索变体，用于扩大召回。

原始问题: {query}

要求:
1. 每个变体必须与原问题指向同一件事，只换问法/角度/同义实体，不得改变语义
2. 各变体之间尽量不重复、覆盖不同关键词
3. 保留关键实体名与字段名
4. 严格按 JSON 数组输出 {n} 个字符串，不要任何解释文字
示例输出: ["变体一", "变体二", "变体三"]
"""

    DECOMPOSE_PROMPT = """你是检索增强助手。请判断用户问题是否为"复合问题"，并给出拆解结果。

用户问题: {query}

要求:
1. 若问题是复合的（包含多个相互独立或递进的子问题），把它拆成子问题列表；例如"泵站压力为什么低、怎么修、大概多少钱"应拆成 3 个子问题。
2. 若问题是单一维度的简单问题，子问题列表只含 1 条（即原问题本身）。
3. 同时给出你判断"这是简单问题还是复杂问题"的置信度（0.0~1.0）。
4. 严格按 JSON 对象输出，格式：
{{"complex": true/false, "confidence": 0.85, "sub_queries": ["子问题一", "子问题二"]}}
"""

    HYDE_PROMPT = """你是检索增强助手（HyDE）。请针对下面的问题，写一段"假想参考答案"，用于作为检索串去召回相关文档片段。

问题: {query}

要求:
1. 直接输出假想答案本身（2-4 句），不要解释、不要标题、不要 JSON。
2. 答案要包含该问题最可能涉及的关键实体、术语、数值或操作要点，使其向量化后能命中相关文档。
3. 若问题很专业，用领域术语作答；保持与问题同一语境。
"""

    def __init__(self, llm_call=_default_llm_call, llm_timeout: int = _MULTI_QUERY_LLM_TIMEOUT_SECONDS) -> None:
        self._llm: Optional[ChatOpenAI] = None
        self._llm_call = llm_call
        self._llm_timeout = llm_timeout

    @property
    def llm(self) -> ChatOpenAI:
        if self._llm is None:
            self._llm = ChatOpenAI(
                api_key=settings.OPENAI_API_KEY,
                base_url=settings.OPENAI_API_BASE,
                model=settings.router_model_name,
                temperature=0.3,
                max_tokens=512,
            )
        return self._llm

    def rewrite(self, query: str) -> str:
        try:
            prompt = ChatPromptTemplate.from_template(self.REWRITE_PROMPT)
            chain = prompt | self.llm | StrOutputParser()
            rewritten = chain.invoke({"query": query}).strip()
            logger.debug(f"查询改写: '{query}' -> '{rewritten}'")
            return rewritten or query
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"查询改写失败: {exc}")
            return query

    def expand(self, query: str, n: int = 3) -> List[str]:
        """把 1 个问题扩成 n 个语义相近的检索变体（不同措辞/角度）——B1 多路查询。

        失败/超时自动降级：返回空列表，由调用方回退到单查询路径。
        """
        n = max(1, int(n or 1))
        prompt = ChatPromptTemplate.from_template(self.EXPAND_PROMPT)
        try:
            raw = self._llm_call(prompt, {"query": query, "n": n}, llm=self.llm, timeout=self._llm_timeout)
            variants = self._parse_string_list(raw)
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"多路查询扩展失败，降级为单查询: {exc}")
            return []
        # 去重 + 过滤空串 + 剔除与原问题完全相同的，保留顺序
        seen = set()
        result: List[str] = []
        base = query.strip()
        for item in variants:
            text = (item or "").strip()
            if not text or text == base or text in seen:
                continue
            seen.add(text)
            result.append(text)
        return result[:n]

    def decompose(self, query: str) -> dict:
        """把复合问题拆成相互独立/递进的子问题——B2 分解。

        返回 {"complex": bool, "confidence": float, "sub_queries": [str, ...]}。
        失败/超时自动降级：判定为简单问题（complex=False），不阻断主流程。
        """
        prompt = ChatPromptTemplate.from_template(self.DECOMPOSE_PROMPT)
        try:
            raw = self._llm_call(prompt, {"query": query}, llm=self.llm, timeout=self._llm_timeout)
            parsed = self._parse_json_object(raw)
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"问题分解失败，降级为简单问题路径: {exc}")
            parsed = None
        if not parsed:
            return {"complex": False, "confidence": 0.0, "sub_queries": []}
        sub_queries = [s for s in self._parse_string_list(parsed.get("sub_queries")) if s]
        confidence = self._coerce_confidence(parsed.get("confidence"))
        complex_flag = bool(parsed.get("complex"))
        # 无子问题时视为简单
        if not sub_queries:
            complex_flag = False
        return {"complex": complex_flag, "confidence": confidence, "sub_queries": sub_queries}

    def hyde(self, query: str) -> str:
        """生成假想答案（B3 在线 HyDE）——检索时先 LLM 写一段假想答案，

        用它作为额外检索串去召回（向量化的假想答案比原始短问题更易命中
        含答案细节的文档片段）。失败/超时自动降级：返回空串，调用方回退
        到不含 HyDE 串的路径，不阻断主流程。
        """
        prompt = ChatPromptTemplate.from_template(self.HYDE_PROMPT)
        try:
            raw = self._llm_call(
                prompt, {"query": query}, llm=self.llm, timeout=self._llm_timeout
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"HyDE 假想答案生成失败，降级跳过 HyDE 串: {exc}")
            return ""
        return (raw or "").strip()

    @staticmethod
    def _parse_string_list(raw) -> List[str]:
        """从 LLM 输出里稳健地解析出字符串列表（容忍前后夹带的解释文字）。

        raw 可能是已解析的 list（decompose 复用）或原始文本（expand）。
        """
        if isinstance(raw, list):
            return [str(item).strip() for item in raw if str(item).strip()]
        text = (raw or "").strip()
        if not text:
            return []
        try:
            candidate = text
            if candidate.startswith("["):
                end = candidate.rfind("]")
                if end != -1:
                    candidate = candidate[: end + 1]
            data = json.loads(candidate)
            if isinstance(data, list):
                return [str(item).strip() for item in data if str(item).strip()]
        except (json.JSONDecodeError, ValueError):
            pass
        # 兜底：逐行/逐条抽取引号内文本
        found = re.findall(r"[\"\u201c]([^\"\u201d]+)[\"\u201d]", text)
        if found:
            return [item.strip() for item in found if item.strip()]
        lines = [line.strip(" \t-•\n") for line in text.splitlines()]
        return [line for line in lines if line]

    @staticmethod
    def _parse_json_object(raw: str) -> Optional[dict]:
        text = (raw or "").strip()
        if not text:
            return None
        try:
            candidate = text
            if candidate.startswith("{"):
                end = candidate.rfind("}")
                if end != -1:
                    candidate = candidate[: end + 1]
            data = json.loads(candidate)
            if isinstance(data, dict):
                return data
        except (json.JSONDecodeError, ValueError):
            pass
        return None

    @staticmethod
    def _coerce_confidence(value) -> float:
        try:
            conf = float(value)
        except (TypeError, ValueError):
            return 0.0
        if conf < 0:
            return 0.0
        if conf > 1:
            return 1.0
        return conf


_self_rag: Optional[SelfRAG] = None
_query_rewriter: Optional[QueryRewriter] = None


def get_self_rag() -> SelfRAG:
    global _self_rag
    if _self_rag is None:
        _self_rag = SelfRAG()
    return _self_rag


def get_query_rewriter() -> QueryRewriter:
    global _query_rewriter
    if _query_rewriter is None:
        _query_rewriter = QueryRewriter()
    return _query_rewriter
