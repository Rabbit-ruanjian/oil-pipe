"""GraphRAG 2.1 结构加权 + N 跳预存（对标 ragflow 的 PageRank 融合与 n_hop_with_weight）。

ragflow 的图向量检索里，"结构信息"不是靠检索时现算 BFS，而是**离线预计算、
编码进向量**：
  - 实体分 = 相似度 × PageRank（核心实体更容易被语义命中顶上去）
  - 每个实体预存 N 跳邻居路径（n_hop_with_weight: path + weights），
    路径按 1/(2+跳数) 衰减——跳数越远贡献越小
本模块把这两个机制落地为纯算法（无 LLM，可单测），产物写进
`knowledge_base/.registry/graph_rank.json`，供边向量/社区向量的检索侧取用。

门控：与 RAG_GRAPH_EDGE_VECTORS 同门控（结构加权是边/实体向量检索的一部分，
关边向量腿时这些预存自然不被引用，不影响主链路）。
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Dict, List

from src.utils import logger

_RANK_PATH = Path("knowledge_base") / ".registry" / "graph_rank.json"


def compute_pagerank(graph, damping: float = 0.85, max_iter: int = 60) -> Dict[str, float]:
    """纯 Python PageRank（无 networkx 依赖，不引入额外包）。

    返回 {node_id: 归一化 PageRank（全体和=1）}。孤立节点给基线 1/n。
    """
    n = graph.number_of_nodes()
    if n == 0:
        return {}
    out: Dict[str, List[str]] = {node: [] for node in graph.nodes}
    for u, v in graph.edges():
        out[u].append(v)

    # 初始 1/n
    rank = {node: 1.0 / n for node in graph.nodes}
    for _ in range(max_iter):
        new_rank: Dict[str, float] = {node: (1 - damping) / n for node in graph.nodes}
        for u, neighbors in out.items():
            if not neighbors:
                # 出度为 0：把权重均分给全图（避免黑洞）
                share = rank[u] / n
                for node in new_rank:
                    new_rank[node] += share
                continue
            share = rank[u] / len(neighbors)
            for v in neighbors:
                new_rank[v] += damping * share
        # 收敛判定
        if sum(abs(new_rank[k] - rank[k]) for k in rank) < 1e-6:
            rank = new_rank
            break
        rank = new_rank
    return rank


def precompute_nhops(graph, max_hops: int = 3) -> Dict[str, List[Dict[str, Any]]]:
    """预存每个节点的 N 跳邻居路径 + 衰减权重（ragflow n_hop_with_weight 同款）。

    权重按 1/(2+跳数) 衰减：1 跳=1/3，2 跳=1/4，3 跳=1/5——跳数越远贡献越小。
    返回 {node_id: [{path, weights}]}，供检索侧"从命中实体展开因果链"时免现算 BFS。
    """
    nhops: Dict[str, List[Dict[str, Any]]] = {node: [] for node in graph.nodes}
    for start in graph.nodes:
        # 有界 BFS 收集 ≤ max_hops 的邻居及路径
        frontier: Dict[str, List[str]] = {start: [start]}
        seen: Dict[str, int] = {start: 0}
        for hop in range(1, max_hops + 1):
            next_frontier: Dict[str, List[str]] = {}
            for node, path in frontier.items():
                for nb in list(graph.successors(node)) + list(graph.predecessors(node)):
                    if nb in seen:
                        continue
                    seen[nb] = hop
                    next_frontier[nb] = path + [nb]
            for nb, path in next_frontier.items():
                w = 1.0 / (2.0 + hop)
                nhops[start].append({"path": path, "weights": [w] * (len(path) - 1)})
            if not next_frontier:
                break
    return {k: v for k, v in nhops.items() if v}


def build_graph_rank(graph) -> Dict[str, Any]:
    """PageRank + N 跳预存 → 落盘 graph_rank.json（带 revision）。"""
    pr = compute_pagerank(graph)
    # 归一化到 [0,1] 相对重要性（最大值=1.0，便于当"重要性权重"）
    pr_max = max(pr.values()) if pr else 1.0
    pr_norm = {k: v / pr_max for k, v in pr.items()}
    nhops = precompute_nhops(graph)
    payload = {
        "pagerank": pr_norm,
        "nhops": nhops,
        "node_count": graph.number_of_nodes(),
    }
    payload["revision"] = hashlib.md5(
        json.dumps(sorted(pr_norm.keys()), ensure_ascii=False).encode()
    ).hexdigest()[:16]
    try:
        _RANK_PATH.parent.mkdir(parents=True, exist_ok=True)
        _RANK_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info(
            "Graph rank persisted: nodes={}, top_pr={}",
            len(pr_norm),
            sorted(pr_norm.items(), key=lambda x: -x[1])[:3],
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("graph_rank 落盘失败（降级）: {}", exc)
    return payload


def load_graph_rank() -> Dict[str, Any]:
    if not _RANK_PATH.exists():
        return {}
    try:
        return json.loads(_RANK_PATH.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def entity_importance(node_id: str) -> float:
    """取某节点的 PageRank 重要性（0~1；无预存时返回基线 0.1）。"""
    data = load_graph_rank()
    pr = data.get("pagerank", {})
    return float(pr.get(node_id, 0.1))


def get_nhops(node_id: str) -> List[Dict[str, Any]]:
    """取某节点预存的 N 跳邻居路径（无则空）。"""
    data = load_graph_rank()
    return data.get("nhops", {}).get(node_id, [])
