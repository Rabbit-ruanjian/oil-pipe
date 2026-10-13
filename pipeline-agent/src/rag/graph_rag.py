"""Graph RAG retriever.

纯向量驱动（GraphRAG local search）：
- 边描述向量（edge_search）→ "因果边（相似度 X）：..." + 命中边 source/target
  种子节点的轻量 1-hop 邻域（GraphRAG 局部搜索的邻域扩展）；
- 社区摘要向量（community_search）→ "社区摘要（相似度 X）：..."（行上带
  source_docs/chunk_ids，调用方可据此再取原文 chunk）。

2026-10 按用户要求断掉了"文本图"检索路：不再做 LLM 实体抽取、
match_nodes_by_text 名字匹配、从实体起点的深度 2 BFS。向量腿全空 → 返回 []
（no-op 降级，与开关关 / 无向量行为一致，不回退文本匹配）。
"""

from __future__ import annotations

from typing import Dict, List, Set

from src.knowledge_graph import KnowledgeGraphBuilder
from src.knowledge_graph.community import community_search
from src.rag.edge_vector_store import edge_search
from src.utils import logger

# 单条查询最多扩展的向量种子节点数（边命中 source/target 去重后取前 N 个做 1-hop）
_MAX_EXPANDED_SEEDS = 3


class GraphRAGRetriever:
    """Retrieve structured context from knowledge graph (vector-driven)."""

    def __init__(self, knowledge_graph: KnowledgeGraphBuilder):
        self.kg = knowledge_graph

    def retrieve(self, query: str, top_k: int = 5) -> List[dict]:
        """Retrieve graph contexts for query.

        纯向量驱动，无文本匹配回退：
        1. 边向量命中（edge_search）→ graph_edge 上下文 + 命中边种子节点的
           轻量 1-hop 邻域（GraphRAG local search 的邻域扩展）；
        2. 社区摘要向量命中（community_search）→ graph_community 上下文。

        两条腿都为空（开关关 / 无向量 / embedding 失败）→ 返回 []。
        """

        edge_hits = edge_search(query, top_k=min(top_k, 3))
        community_hits = community_search(query, top_k=min(top_k, 3))
        if not edge_hits and not community_hits:
            logger.debug("graph_rag: 无向量命中 query={}", query)
            return []

        contexts: List[dict] = []
        seen_seeds: Set[str] = set()
        expanded_seeds = 0

        for hit in edge_hits:
            contexts.append(
                {
                    "type": "graph_edge",
                    "content": f"因果边（相似度 {hit['score']}）：{hit['description']}",
                    "entities": [hit.get("source"), hit.get("target")],
                    "relations": [
                        {
                            "source": hit.get("source"),
                            "target": hit.get("target"),
                            "type": hit.get("edge_type"),
                        }
                    ],
                    "confidence": min(0.99, hit.get("score", 0.4)),
                    "edge": hit,
                }
            )
            # 向量命中边 → source/target 种子节点轻量 1-hop 邻域（取代原实体 BFS）
            for seed in (hit.get("source"), hit.get("target")):
                if not seed or seed in seen_seeds or expanded_seeds >= _MAX_EXPANDED_SEEDS:
                    continue
                seen_seeds.add(seed)
                expanded = self._expand_seed(hit, seed)
                if expanded:
                    contexts.append(expanded)
                    expanded_seeds += 1

        for hit in community_hits:
            contexts.append(
                {
                    "type": "graph_community",
                    "content": f"社区摘要（相似度 {hit['score']}）：{hit['summary']}",
                    "entities": [hit.get("community_id")],
                    "relations": [],
                    "confidence": min(0.99, hit.get("score", 0.5)),
                    "community": hit,
                }
            )

        return contexts[: max(top_k, 3)]

    def _expand_seed(self, hit: Dict, seed: str) -> Dict | None:
        """种子节点 1-hop 邻域 → graph 上下文；图谱不可用 / 邻域为空 → None。"""

        try:
            subgraph = self.kg.get_subgraph_for_visualization(seed, depth=1)
            serialized = self._serialize_subgraph(subgraph)
        except Exception as exc:  # noqa: BLE001
            logger.debug("graph_rag 种子邻域展开失败 seed={}: {}", seed, exc)
            return None
        if not serialized:
            return None
        return {
            "type": "graph",
            "content": f"向量命中节点 {seed} 邻域（1-hop）：{serialized}",
            "entities": [seed],
            "relations": subgraph.get("edges", []),
            "confidence": min(0.95, hit.get("score", 0.4)),
            "seed_node": seed,
        }

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
