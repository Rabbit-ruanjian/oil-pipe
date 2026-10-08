"""Graph RAG retriever."""

from __future__ import annotations

import json
from typing import List

from langchain_openai import ChatOpenAI
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate

from src.config import settings
from src.knowledge_graph import KnowledgeGraphBuilder
from src.utils import logger


class GraphRAGRetriever:
    """Retrieve structured context from knowledge graph."""

    def __init__(self, knowledge_graph: KnowledgeGraphBuilder):
        self.kg = knowledge_graph
        self._llm = None

    @property
    def llm(self) -> ChatOpenAI:
        if self._llm is None:
            self._llm = ChatOpenAI(
                api_key=settings.OPENAI_API_KEY,
                base_url=settings.OPENAI_API_BASE,
                model=settings.graph_query_model_name,
                temperature=0,
                max_tokens=300,
            )
        return self._llm

    def retrieve(self, query: str, top_k: int = 5) -> List[dict]:
        """Retrieve graph contexts for query."""

        if "故障" in query and ("原因" in query or "因果" in query):
            causes = self.kg.query_fault_causes(query)
            if causes:
                return [
                    {
                        "type": "graph",
                        "content": self._serialize_fault_causes(causes),
                        "entities": [query],
                        "relations": [],
                        "confidence": 0.9,
                    }
                ]

        entities = self._extract_entities(query)
        if not entities:
            entities = [query]

        contexts: List[dict] = []
        for entity in entities:
            matched_nodes = self._find_nodes(entity)
            for node_id in matched_nodes[:top_k]:
                subgraph = self.kg.get_subgraph_for_visualization(node_id, depth=2)
                serialized = self._serialize_subgraph(subgraph)
                if not serialized:
                    continue
                contexts.append(
                    {
                        "type": "graph",
                        "content": serialized,
                        "entities": [entity],
                        "relations": subgraph.get("edges", []),
                        "confidence": 0.85,
                    }
                )

        return contexts[:top_k]

    def _extract_entities(self, query: str) -> List[str]:
        """Extract domain entities from query with LLM + fallback."""

        prompt = ChatPromptTemplate.from_template(
            """
从以下查询中提取管道工程相关实体（设备、参数、故障、标准等）。
查询: {query}
仅输出 JSON 数组，如 ["实体1", "实体2"]。
""".strip()
        )
        chain = prompt | self.llm | StrOutputParser()

        try:
            text = chain.invoke({"query": query})
            start = text.find("[")
            end = text.rfind("]")
            if start == -1 or end == -1 or end <= start:
                raise ValueError("No JSON array found")
            values = json.loads(text[start : end + 1])
            return [str(item) for item in values if str(item).strip()]
        except Exception as exc:
            logger.debug(f"Graph entity extraction fallback: {exc}")
            return [part for part in query.replace("，", " ").replace(",", " ").split() if part]

    def _find_nodes(self, entity_name: str) -> List[str]:
        """Match graph nodes by text."""

        names = [entity_name]
        synonyms = self._expand_synonyms(entity_name)
        names.extend(synonyms)

        matched: List[str] = []
        seen = set()
        for name in names:
            for node_id in self.kg.match_nodes_by_text(name):
                if node_id in seen:
                    continue
                seen.add(node_id)
                matched.append(node_id)
        return matched

    @staticmethod
    def _serialize_subgraph(subgraph: dict) -> str:
        """Serialize graph payload to natural-language text."""

        nodes = subgraph.get("nodes", [])
        edges = subgraph.get("edges", [])
        if not nodes:
            return ""

        node_map = {node["id"]: node for node in nodes}
        lines = []

        for edge in edges:
            source = node_map.get(edge.get("source"), {}).get("name", edge.get("source"))
            target = node_map.get(edge.get("target"), {}).get("name", edge.get("target"))
            relation = edge.get("type", "关联")
            lines.append(f"{source} --{relation}--> {target}")

        if not lines:
            lines = [f"实体: {node.get('name', node.get('id'))}" for node in nodes[:6]]

        return "；".join(lines)

    @staticmethod
    def _expand_synonyms(entity_name: str) -> List[str]:
        mapping = {
            "出口压力": ["outlet_pressure", "末站压力", "pressure"],
            "流量": ["flow_rate", "throughput"],
            "粘度": ["viscosity"],
            "摩阻": ["friction_loss", "friction_factor"],
            "泵站": ["pump_station"],
            "泵": ["pump"],
            "故障": ["fault"],
        }

        results: List[str] = []
        for key, values in mapping.items():
            if key in entity_name:
                results.extend(values)
        return results

    @staticmethod
    def _serialize_fault_causes(causes: List[dict]) -> str:
        lines = []
        for item in causes[:5]:
            solutions = ",".join([solution.get("name", "") for solution in item.get("solutions", [])[:3]])
            lines.append(
                f"故障[{item.get('fault')}]可能原因[{item.get('cause')}]，概率{item.get('probability', 0):.2f}，建议[{solutions}]"
            )
        return "；".join(lines)
