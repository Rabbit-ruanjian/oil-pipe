"""Knowledge graph agent with optional skill-backed summarization."""

from __future__ import annotations

import json
from typing import Any, Optional

from src.skills import get_skill_runtime
from src.utils import logger


class GraphAgent:
    """Execute graph queries and optionally summarize them with a skill."""

    SKILL_NAME = "graph-reasoning"

    def __init__(self) -> None:
        self._graph = None
        self._llm: Any = None
        self._skill_runtime = get_skill_runtime()

    def _get_graph(self):
        if self._graph is None:
            try:
                from src.knowledge_graph import get_knowledge_graph_builder

                self._graph = get_knowledge_graph_builder()
            except Exception as exc:  # noqa: BLE001
                logger.error("Failed to load knowledge graph: {}", exc)
                self._graph = None
        return self._graph

    def _get_llm(self):
        if self._llm is None:
            from langchain_openai import ChatOpenAI

            from src.config import settings

            self._llm = ChatOpenAI(
                api_key=settings.OPENAI_API_KEY,
                base_url=settings.OPENAI_API_BASE,
                model=settings.final_synthesis_model_name,
                temperature=0.2,
                max_tokens=2048,
            )
        return self._llm

    def execute(
        self,
        query: str,
        query_type: Optional[str] = None,
        summarize: bool = False,
    ) -> Any:
        """Run one graph query.

        Raw graph results remain the default contract for legacy tool and API
        callers. Natural-language summarization is opt-in.
        """

        graph = self._get_graph()
        if graph is None:
            # dict 返回，避免 GraphQueryResponse.result: dict 校验 500
            return {"message": "知识图谱服务不可用，请稍后重试。"}

        try:
            # P0-③ B4：graph_traversal_llm 开关开 → LLM 决策遍历；关 → 现有固定路径
            result = self._maybe_graph_traversal(query, query_type)
            if result is None:
                if query_type == "fault_cause":
                    result = graph.query_fault_causes(query)
                elif query_type == "standards":
                    result = graph.find_related_standards(query)
                elif query_type == "equipment_chain":
                    result = graph.query_equipment_chain(query)
                else:
                    if hasattr(graph, "query_fuzzy"):
                        result = graph.query_fuzzy(query)
                    else:
                        node_ids = graph.match_nodes_by_text(query)
                        if not node_ids:
                            result = {"message": f"未找到与 '{query}' 相关的知识图谱信息。"}
                        else:
                            result = graph.get_subgraph_for_visualization(node_ids[0], depth=2)

            if not result:
                # 统一返回 dict（GraphQueryResponse.result: dict）；此前返回 str
                # 导致 Pydantic 校验 500。
                return {"message": f"未找到与 '{query}' 相关的知识图谱信息。"}

            result = self._attach_semantic_hits(result, query)

            if summarize:
                return self._summarize_result(
                    query=query,
                    query_type=query_type or "general",
                    result=result,
                )

            return self._format_raw_result(result=result, query_type=query_type)
        except Exception as exc:  # noqa: BLE001
            logger.error("GraphAgent execute failed: {}", exc)
            # dict 返回，避免 GraphQueryResponse.result: dict 校验 500
            return {"message": f"知识图谱查询失败: {exc}"}

    def _maybe_graph_traversal(
        self, query: str, query_type: Optional[str]
    ) -> Optional[Any]:
        """P0-③ B4：graph_traversal_llm 开时走 LLM-in-the-loop 有界遍历。

        开关关 / LLM 失败 / 图谱不可用 → 返回 None，调用方走原有固定路径，
        保证逐字节不变。
        """
        try:
            from src.knowledge_graph.graph_traversal import GraphTraversalPlanner
        except Exception as exc:  # noqa: BLE001
            logger.debug("graph_traversal planner unavailable: {}", exc)
            return None

        planner = GraphTraversalPlanner()
        if not planner.enabled():
            return None

        graph = self._get_graph()
        if graph is None:
            return None

        node_ids = graph.match_nodes_by_text(query) or []
        # 图谱有故障因果数据（fault/case/cause/solution 前缀节点）时才给 cause/solution
        # 概念边；否则（纯文档图 references/contains）让 planner 默认计划兜底，避免
        # 概念边与实际边类型错位导致遍历空转（reached={} 只到起点）。
        # 注意：fault_cause 查询可能匹配到 ent:: 文档实体（如"压力低"→ent 节点），
        # 此时按 query_type 显式声明优先，仍走因果边。
        causal_nodes = [n for n in node_ids if n.startswith(("fault", "case", "cause", "sol"))]
        # 起点选择：fault_cause 查询优先因果节点（fault/case/cause/sol 前缀）；
        # 没有因果节点时退回匹配到的文档实体（ent/sec），让 B4 有界 BFS 能展开 references。
        if query_type in ("fault_cause", "equipment_chain") and causal_nodes:
            node_ids = causal_nodes
        edge_types: list[str]
        if query_type in ("fault_cause", "equipment_chain") or causal_nodes:
            edge_types = ["cause", "solution"]
        else:
            edge_types = ["references", "contains"]
        plan = planner.plan(query=query, node_ids=node_ids, edge_types=edge_types)
        if plan is None:
            return None
        return planner.traverse(graph, query=query, plan=plan)

    @staticmethod
    def _attach_semantic_hits(result: dict, query: str) -> dict:
        """给图查询结果挂"语义命中"（边向量 + 社区向量，对标 ragflow relation 检索）。

        命中信息展示在本轮 query 与因果边的语义相似度上，前端图谱页据此
        高亮/标注；门控关 / 无向量 / embedding 失败 → 空列表，不阻断。
        """
        if not isinstance(result, dict):
            return result
        edge_hits: list = []
        community_hits: list = []
        try:
            from src.rag.edge_vector_store import edge_search
            from src.knowledge_graph.community import community_search

            edge_hits = [
                {
                    "description": hit.get("description", ""),
                    "edge_type": hit.get("edge_type", ""),
                    "score": hit.get("score", 0.0),
                }
                for hit in edge_search(query, top_k=3)
            ]
            community_hits = [
                {
                    "community_id": hit.get("community_id", ""),
                    "summary": str(hit.get("summary", ""))[:120],
                    "score": hit.get("score", 0.0),
                }
                for hit in community_search(query, top_k=2)
            ]
        except Exception as exc:  # noqa: BLE001
            logger.debug("attach semantic hits failed (no-op): {}", exc)
        result["edge_hits"] = edge_hits
        result["community_hits"] = community_hits
        return result

    @staticmethod
    def _format_raw_result(*, result: Any, query_type: Optional[str]) -> Any:
        if query_type is None:
            if isinstance(result, dict):
                return result
            return {"result": result}

        if isinstance(result, str):
            try:
                parsed = json.loads(result)
            except (json.JSONDecodeError, ValueError):
                parsed = None
            if isinstance(parsed, dict):
                return parsed
            return {"message": result}

        if isinstance(result, dict):
            return result
        if isinstance(result, list):
            return {"items": result}
        return {"value": str(result)}

    def _summarize_result(self, *, query: str, query_type: str, result: Any) -> str:
        result_text = (
            json.dumps(result, ensure_ascii=False, indent=2)
            if isinstance(result, (dict, list))
            else str(result)
        )
        prompt_input = self._skill_runtime.render_prompt(
            self.SKILL_NAME,
            "task",
            {
                "query": query,
                "query_type": query_type,
                "graph_result": result_text,
            },
        )

        try:
            from langchain_core.output_parsers import StrOutputParser
            from langchain_core.prompts import ChatPromptTemplate

            prompt = ChatPromptTemplate.from_messages(
                [
                    ("system", self._skill_runtime.get_prompt(self.SKILL_NAME, "system")),
                    ("human", "{input}"),
                ]
            )
            chain = prompt | self._get_llm() | StrOutputParser()
            return chain.invoke({"input": prompt_input}).strip() or result_text
        except ModuleNotFoundError as exc:
            logger.warning("GraphAgent summarize skipped because LLM stack is unavailable: {}", exc)
            return result_text
        except Exception as exc:  # noqa: BLE001
            logger.warning("GraphAgent summarize fallback triggered: {}", exc)
            return result_text


_graph_agent: Optional[GraphAgent] = None


def get_graph_agent() -> GraphAgent:
    global _graph_agent
    if _graph_agent is None:
        _graph_agent = GraphAgent()
    return _graph_agent
