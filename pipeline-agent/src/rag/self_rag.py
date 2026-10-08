"""
Self-RAG and CRAG helpers.
"""

from __future__ import annotations

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

    def __init__(self) -> None:
        self._llm: Optional[ChatOpenAI] = None

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
