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
            return "知识图谱服务不可用，请稍后重试。"

        try:
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
                return f"未找到与 '{query}' 相关的知识图谱信息。"

            if summarize:
                return self._summarize_result(
                    query=query,
                    query_type=query_type or "general",
                    result=result,
                )

            return self._format_raw_result(result=result, query_type=query_type)
        except Exception as exc:  # noqa: BLE001
            logger.error("GraphAgent execute failed: {}", exc)
            return f"知识图谱查询失败: {exc}"

    @staticmethod
    def _format_raw_result(*, result: Any, query_type: Optional[str]) -> Any:
        if query_type is None:
            if isinstance(result, dict):
                return result
            return {"result": result}

        if isinstance(result, (dict, list)):
            return json.dumps(result, ensure_ascii=False)
        return str(result)

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
