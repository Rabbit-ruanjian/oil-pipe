"""GraphRAG 2.1 边描述向量（对标 ragflow 的 relation 向量检索）。

ragflow 的图检索里，实体和"边（relation）"都是带向量的可检索文档——
query 向量可以同时命中"实体"和"边描述"。我们的图之前只有实体名词面
回查一条腿，边（caused_by/solved_by 语义）没向量化。本模块补上：

  1. 渲染边描述：遍历图边，按边类型生成自然语言（含因果链上下文），
     如 "故障「机封泄漏」的可能原因：冲洗液不足；处置：恢复冲洗液通路"
  2. 向量化：本地 384 维 embedding → Milvus 独立 collection
     `pipeline_knowledge_graph_edges`（不碰 chunk / community collection）
  3. 检索：query 向量 vs 边描述向量 COSINE top-k，命中边带回
     from_entity / to_entity / edge_type / doc_ids（供回查文档）

门控 `RAG_GRAPH_EDGE_VECTORS`（默认开，与 RAG_GRAPH_COMMUNITY 同款
P0-③ 可插拔）：关 / 无边 / embedding 失败 → no-op 返回 []，不阻断。

纯算法 + 本地向量，无 LLM，可复现可单测。
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Set, Tuple

from src.utils import logger


# 边类型 → 中文语义（渲染边描述用）
_EDGE_TYPE_ZH: Dict[str, str] = {
    "caused_by": "由…导致",
    "solved_by": "可通过…处置",
    "references": "涉及",
    "contains": "包含",
    "installed": "安装",
    "transports": "输送",
    "affects": "影响",
    "specifies": "规定",
}


def _edge_description(graph, source_id: str, target_id: str, edge: Dict[str, Any]) -> str:
    """把一条边渲染成检索友好的自然语言（含因果链上下文）。

    对 caused_by/solved_by 边，把整条 fault→cause→solution 链串起来，
    使"怎么处置机封泄漏"这类 query 能向量命中"机封泄漏…更换动环端面"整句。
    """
    s_name = str(graph.nodes[source_id].get("name") or source_id)
    t_name = str(graph.nodes[target_id].get("name") or target_id)
    etype = str(edge.get("type", ""))
    base = f"{s_name} --{etype}--> {t_name}"

    if etype == "caused_by":
        # 找 fault→cause→solution 整链
        sols = [
            str(graph.nodes[s].get("name") or s)
            for s in graph.successors(target_id)
            if str(graph.get_edge_data(target_id, s, default={}).get("type", "")) == "solved_by"
        ]
        if sols:
            base += f"；处置：{'、'.join(list(dict.fromkeys(sols))[:3])}"
    elif etype == "solved_by":
        faults = [
            str(graph.nodes[f].get("name") or f)
            for f in graph.predecessors(source_id)
            if str(graph.get_edge_data(f, source_id, default={}).get("type", "")) == "caused_by"
        ]
        if faults:
            base = f"故障「{'、'.join(list(dict.fromkeys(faults))[:2])}」的处置：{t_name}"
    elif etype in ("shared_cause", "shared_solution", "related_fault"):
        # 跨故障共享关系：把 shared_cause/shared_solution/note 串进描述，
        # 使"哪些故障共享结蜡根因"这类 query 能命中这条边
        props = edge.get("properties") or {}
        detail = str(
            props.get("shared_cause")
            or props.get("shared_solution")
            or props.get("note")
            or ""
        ).strip()
        label = {"shared_cause": "共享根因", "shared_solution": "共享处置", "related_fault": "强相关"}[etype]
        if detail:
            base += f"；{label}：{detail}"
    return base


def _edge_doc_ids(graph, source_id: str, target_id: str) -> List[str]:
    """边端点节点上的 source_doc_id/doc_id 集合（供边命中后回查文档）。"""
    docs: Set[str] = set()
    for nid in (source_id, target_id):
        attrs = graph.nodes.get(nid, {})
        for key in ("source_doc_id", "doc_id"):
            v = attrs.get(key)
            if v:
                docs.add(str(v))
        for v in (attrs.get("properties") or {}).values():
            if isinstance(v, str) and v.endswith(".md"):
                docs.add(v)
    return sorted(docs)


def build_edge_descriptions(graph) -> List[Dict[str, Any]]:
    """遍历图全部边 → 边描述记录列表（去重同 from/to/type）。

    记录字段：edge_key / description / source / target / edge_type /
    doc_ids / weight / pagerank（端点重要性）。

    结构信息编码进向量（对标 ragflow）：description 里追加"端点 PageRank
    权重 + N 跳邻居链"，使向量能感知"这条边连的是核心实体还是外围、
    离它几步还有哪些因果概念"。无 graph_rank 预存时只附 PageRank 基线，
    不阻断。
    """
    from src.knowledge_graph.graph_rank import entity_importance, get_nhops

    # 只对"有检索语义"的边做向量化：caused_by/solved_by（因果链）、
    # affects/transports/contains/installed（设备链路）。
    # references（document→concept 引用边，万条级）没有因果语义，向量化它们
    # 既无检索价值又拖垮性能（千节点图全量算 12k 条本地 embedding 要几分钟）。
    # 这是"边向量层"的正确粒度——对标 ragflow 的 relation 向量（只关语义关系）。
    semantic_types = {
        "caused_by",
        "solved_by",
        "affects",
        "transports",
        "contains",
        "installed",
        "specifies",
        # 跨故障共享关系（G-E7 报告核心价值）：共享根因/共享处置/强相关
        "shared_cause",
        "shared_solution",
        "related_fault",
    }

    # rank 数据读一次（避免每条边都读全 JSON 文件）
    rank_data = _load_rank_once()

    seen: Set[Tuple[str, str, str]] = set()
    out: List[Dict[str, Any]] = []
    for u, v, data in graph.edges(data=True):
        etype = str(data.get("type", ""))
        if etype not in semantic_types:
            continue
        key = (u, v, etype)
        if key in seen:
            continue
        seen.add(key)
        pr_u = round(_importance_from(rank_data, u), 3)
        pr_v = round(_importance_from(rank_data, v), 3)

        # N 跳邻居链：从两端点取预存路径，拼成"关联概念"追加进描述
        nhop_terms: List[str] = []
        for nid in (u, v):
            for nh in _nhops_from(rank_data, nid)[:2]:
                for name in _node_names(graph, nid, nh["path"]):
                    if name and name not in nhop_terms:
                        nhop_terms.append(name)
        base_desc = _edge_description(graph, u, v, data)
        desc = base_desc
        if nhop_terms:
            desc += f"；关联概念：{'、'.join(nhop_terms[:6])}"

        out.append(
            {
                "edge_key": f"{u}->{v}:{etype}",
                "source": u,
                "target": v,
                "edge_type": etype,
                "description": desc,
                "doc_ids": _edge_doc_ids(graph, u, v),
                "weight": float(data.get("weight", 1.0)),
                "pagerank": min(pr_u, pr_v),  # 取端点较小者（短板决定重要性）
            }
        )
    return out


def _node_names(graph, start_id: str, path: List[str]) -> List[str]:
    """把 N 跳路径里的节点（除起点外）取名字。"""
    names: List[str] = []
    for nid in path[1:]:
        names.append(str(graph.nodes.get(nid, {}).get("name") or nid))
    return names


def _load_rank_once() -> Dict[str, Any]:
    """graph_rank 数据读一次（build_edge_descriptions 里缓存，避免每条边读全 JSON）。"""
    from src.knowledge_graph.graph_rank import load_graph_rank

    return load_graph_rank()


def _importance_from(rank_data: Dict[str, Any], node_id: str) -> float:
    """从已读入的 rank_data 取节点重要性（0~1，无预存基线 0.1）。"""
    pr = rank_data.get("pagerank", {})
    return float(pr.get(node_id, 0.1))


def _nhops_from(rank_data: Dict[str, Any], node_id: str) -> List[Dict[str, Any]]:
    """从已读入的 rank_data 取节点 N 跳预存路径。"""
    return rank_data.get("nhops", {}).get(node_id, [])


def enabled() -> bool:
    """门控：RAG_GRAPH_EDGE_VECTORS（默认开，进 pluggable）。"""
    try:
        from src.rag.pipeline import get_rag_config

        return bool(get_rag_config().pluggable.get("graph_edge_vectors", True))
    except Exception:  # noqa: BLE001
        return True


def upsert_edge_vectors(records: List[Dict[str, Any]]) -> int:
    """边描述 → 本地 384 维 → Milvus 边 collection + 落盘 JSON。

    与社区层同款策略：embedding 失败 → 该条向量留空降级，文本仍落盘；
    Milvus 失败 → 只落盘不阻断。返回 upsert 条数。
    """
    import hashlib
    from pathlib import Path

    if not records:
        return 0

    vectors: Dict[str, Optional[List[float]]] = {}
    try:
        from src.rag.embeddings import get_embeddings

        emb = get_embeddings()
        pairs = []
        for r in records:
            vec = emb.embed_query(r["description"])
            vectors[r["edge_key"]] = [float(x) for x in vec]
            pairs.append((r, vec))
        if pairs:
            _write_edge_collection(pairs)
    except Exception as exc:  # noqa: BLE001
        logger.warning("边描述向量化失败（降级：仅落盘文本）: {}", exc)

    payload = {
        "revision": hashlib.md5(
            json.dumps(
                [r["edge_key"] for r in records], ensure_ascii=False
            ).encode()
        ).hexdigest()[:16],
        "edges": [
            {
                **r,
                "summary_vector": vectors.get(r["edge_key"]),
            }
            for r in records
        ],
    }
    try:
        path = Path("knowledge_base") / ".registry" / "graph_edges.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as exc:  # noqa: BLE001
        logger.warning("边描述落盘失败（降级跳过）: {}", exc)

    logger.info("Graph edge vectors built: count={}", len(records))
    return len(records)


def _write_edge_collection(pairs: List[Tuple[Dict[str, Any], Any]]) -> None:
    try:
        from src.rag.edge_collection import get_edge_collection

        store = get_edge_collection()
        store.upsert_all(pairs)
    except Exception as exc:  # noqa: BLE001
        logger.warning("边向量 collection 写入失败（降级）: {}", exc)


def edge_search(query: str, top_k: int = 3, min_score: float = 0.30) -> List[Dict[str, Any]]:
    """query 向量 vs 边描述向量 COSINE 粗筛 top-k 边。

    门控关 / 无向量 / embedding 失败 → 返回 []（no-op 不阻断）。
    返回：[{edge_key, description, edge_type, source, target, doc_ids, score}]。
    """
    if not enabled():
        return []
    try:
        from src.rag.embeddings import get_embeddings

        vec = get_embeddings().embed_query(query)
        return _score_against_vec(query, vec, top_k, min_score)
    except Exception as exc:  # noqa: BLE001
        logger.warning("边向量检索失败（降级 no-op）: {}", exc)
        return []


def _score_against_vec(
    query: str, vec: List[float], top_k: int, min_score: float
) -> List[Dict[str, Any]]:
    import math

    q = [float(x) for x in vec]
    q_norm = math.sqrt(sum(x * x for x in q))
    if q_norm <= 0:
        return []

    rows: List[Dict[str, Any]] = []
    for r in _load_edge_records():
        v = r.get("summary_vector")
        if not v:
            continue
        dv = [float(x) for x in v]
        d_norm = math.sqrt(sum(x * x for x in dv))
        if d_norm <= 0:
            continue
        score = sum(a * b for a, b in zip(q, dv)) / (q_norm * d_norm)
        if score < min_score:
            continue
        rows.append(
            {
                "edge_key": r["edge_key"],
                "description": r["description"],
                "edge_type": r["edge_type"],
                "source": r["source"],
                "target": r["target"],
                "doc_ids": r.get("doc_ids", []),
                "score": round(score, 3),
            }
        )
    rows.sort(key=lambda x: x["score"], reverse=True)
    return rows[:top_k]


def _load_edge_records() -> List[Dict[str, Any]]:
    from pathlib import Path

    path = Path("knowledge_base") / ".registry" / "graph_edges.json"
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data.get("edges", [])
    except Exception:  # noqa: BLE001
        return []
