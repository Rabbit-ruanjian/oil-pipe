"""GraphRAG 社区层（GraphRAG 2.0 的"社区摘要→向量"腿）。

在现有图 RAG（离散步搜 + 子图概念回查 BM25）之上补一条"摘要语义"腿：
  1) 社区发现：按弱连通分量切分（分量 >50 节点时退化为按 NodeType 切分），
     得到与图语义对齐的"概念簇"；
  2) 规则摘要：每个社区生成可解释的 summary_text（实体名按 NodeType 分组、
     因果链串起来、top-k 度数概念）；
  3) 摘要向量化：summary_text 过本地 embedding（384 维 MiniLM），落盘
     knowledge_base/.registry/communities.json + 写入 Milvus 社区 collection；
  4) 检索时粗筛：query 向量 vs 社区摘要向量 COSINE 粗筛 top-k 社区，
     命中社区带回 source_docs / chunk_ids。

纯算法无 LLM，保证可复现、可单测；失败全部自动降级（不阻断主链路）。
开关：RAG_GRAPH_COMMUNITY（默认 True，关时全部 no-op，行为与现状一致）。
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from src.utils import logger

_REG_DIR = Path("knowledge_base") / ".registry"
_COMMUNITY_FILE = "communities.json"
_MAX_NODES_PER_COMMUNITY = 50
_TOP_CONCEPTS = 12


@dataclass
class Community:
    """一个概念簇 + 摘要文本 + 向量 + 源文档/分块映射。"""

    id: str
    member_nodes: List[str]
    relations: List[Dict[str, str]]
    summary_text: str
    source_docs: List[str] = field(default_factory=list)
    chunk_ids: List[str] = field(default_factory=list)
    summary_vector: Optional[List[float]] = None

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "member_nodes": self.member_nodes,
            "relations": self.relations,
            "summary_text": self.summary_text,
            "source_docs": self.source_docs,
            "chunk_ids": self.chunk_ids,
            "summary_vector": self.summary_vector,
        }

    @classmethod
    def from_json(cls, data: dict, vector: Optional[List[float]] = None) -> "Community":
        return cls(
            id=str(data.get("id", "")),
            member_nodes=list(data.get("member_nodes") or []),
            relations=list(data.get("relations") or []),
            summary_text=str(data.get("summary_text") or ""),
            source_docs=list(data.get("source_docs") or []),
            chunk_ids=list(data.get("chunk_ids") or []),
            # 向量优先取 JSON 内嵌的（upsert 时已写回），外部传入兜底
            summary_vector=data.get("summary_vector", vector),
        )


# ---------------------------------------------------------------------------
# 社区切分
# ---------------------------------------------------------------------------


def _split_community(builder: Any, component: set, graph) -> List[set]:
    """一个弱连通分量切成若干社区。

    - 分量 ≤ _MAX_NODES_PER_COMMUNITY：整体当一个社区（语义清晰，不切碎）
    - 超过时退化为按 NodeType 大类切分：
        fault 系（fault/cause/solution/parameter）
        equipment 系（pipeline/pump_station/pump/oil_property）
        standard 系（standard）
        其它（document/section/concept）
      这样 50 节点的大分量也不会让单个社区摘要被淹没。
    """

    if len(component) <= _MAX_NODES_PER_COMMUNITY:
        return [component]

    groups: Dict[str, set] = {}
    for node in component:
        ntype = str(graph.nodes[node].get("type", "other"))
        key = _node_type_group(ntype)
        groups.setdefault(key, set()).add(node)
    # 保证组间不重（同一节点不会同时属于两个组，key 互斥）
    return [v for v in groups.values() if v]


def _node_type_group(ntype: str) -> str:
    if ntype in {"fault", "cause", "solution", "parameter"}:
        return "fault"
    if ntype in {"pipeline", "pump_station", "pump", "oil_property"}:
        return "equipment"
    if ntype == "standard":
        return "standard"
    return "document"


def build_communities(builder: Any) -> List[Community]:
    """从 builder 图谱切社区 + 生成规则摘要。

    Args:
      builder: KnowledgeGraphBuilder（持有 networkx DiGraph `builder.graph`）
    """

    import networkx as nx

    graph = builder.graph
    if graph is None or graph.number_of_nodes() == 0:
        return []

    undirected = graph.to_undirected()
    components: List[set] = []
    for comp in nx.connected_components(undirected):
        for sub in _split_community(builder, set(comp), graph):
            components.append(sub)

    communities: List[Community] = []
    for i, comp in enumerate(sorted(components, key=lambda c: -len(c))):
        node_ids = sorted(comp)
        relations: List[Dict[str, str]] = []
        for u, v in sorted(graph.edges(comp)):
            etype = str(graph.get_edge_data(u, v, default={}).get("type", ""))
            relations.append({"src": u, "dst": v, "type": etype})
        summary = _summarize_community(graph, node_ids)
        source_docs = _collect_source_docs(graph, node_ids)
        communities.append(
            Community(
                id=f"c{i + 1:04d}",
                member_nodes=node_ids,
                relations=relations,
                summary_text=summary,
                source_docs=sorted(source_docs),
            )
        )
    return communities


def _summarize_community(graph, node_ids: List[str]) -> str:
    """规则摘要：实体名按 NodeType 分组 + 因果链串 + top-k 度数概念。"""

    by_type: Dict[str, List[str]] = {}
    names: Dict[str, str] = {}
    for node in node_ids:
        attrs = graph.nodes[node]
        ntype = str(attrs.get("type", "other"))
        name = str(attrs.get("name") or node)
        names[node] = name
        by_type.setdefault(ntype, []).append(name)

    def _fmt_node_group(label: str, key: str) -> str:
        items = by_type.get(key, [])
        if not items:
            return ""
        return f"{label}（{'、'.join(list(dict.fromkeys(items))[:6])}）"

    parts: List[str] = []
    for label, key in [
        ("设备", "equipment"),
        ("故障因果", "fault_chain"),
        ("参数", "parameter"),
        ("标准", "standard"),
        ("概念", "concept"),
        ("章节", "section"),
    ]:
        if key == "equipment":
            joined = "、".join(
                list(dict.fromkeys(
                    by_type.get("pipeline", [])
                    + by_type.get("pump_station", [])
                    + by_type.get("pump", [])
                    + by_type.get("oil_property", [])
                ))[:6]
            )
            if joined:
                parts.append(f"设备（{joined}）")
        elif key == "fault_chain":
            # 串因果链：fault --caused_by--> cause --solved_by--> solution
            chains: List[str] = []
            for fault in by_type.get("fault", []):
                for u, v in graph.edges:
                    if u in [k for k, val in names.items() if val == fault]:
                        pass
            # 简化：按节点名找 fault->cause->solution 路径
            fault_nodes = [n for n in node_ids if str(graph.nodes[n].get("type")) == "fault"]
            cause_nodes = [n for n in node_ids if str(graph.nodes[n].get("type")) == "cause"]
            sol_nodes = [n for n in node_ids if str(graph.nodes[n].get("type")) == "solution"]
            for f in fault_nodes[:2]:
                f_name = names.get(f, f)
                reached_causes: List[str] = []
                reached_sols: List[str] = []
                for c in cause_nodes:
                    if graph.has_edge(f, c):
                        reached_causes.append(names.get(c, c))
                    for s in sol_nodes:
                        if graph.has_edge(c, s):
                            reached_sols.append(names.get(s, s))
                if reached_causes:
                    tail = ["解法:" + "、".join(list(dict.fromkeys(reached_sols))[:3])] if reached_sols else []
                    seg = "→".join([f_name] + reached_causes + tail)
                    chains.append(seg)
            if chains:
                parts.append("因果链（" + "；".join(chains) + "）")
        else:
            joined = "、".join(list(dict.fromkeys(by_type.get(key, [])))[:6])
            if joined:
                parts.append(f"{label}（{joined}）")

    # top-k 度数概念（排除已列出的）
    deg = {n: graph.degree(n) for n in node_ids}
    top_concepts = sorted(
        [n for n in node_ids if str(graph.nodes[n].get("type")) == "concept"],
        key=lambda n: -deg.get(n, 0),
    )
    listed_names = {p.split("（", 1)[-1].rstrip("）") for p in parts}
    extra = []
    for n in top_concepts:
        nm = names.get(n, n)
        if nm not in " ".join(listed_names) and len(extra) < _TOP_CONCEPTS:
            extra.append(nm)
    if extra:
        parts.append("涉及概念：" + "、".join(dict.fromkeys(extra)))

    header = f"社区：{len(node_ids)} 个实体"
    body = "，".join(parts) if parts else "（未分类实体）"
    return f"{header} — {body}"


def _collect_source_docs(graph, node_ids: List[str]) -> set:
    docs: set = set()
    for n in node_ids:
        attrs = graph.nodes[n]
        for key in ("source_doc_id", "doc_id"):
            v = attrs.get(key)
            if v:
                docs.add(str(v))
        props = attrs.get("properties")
        if isinstance(props, dict):
            for key in ("source_doc_id", "doc_id"):
                v = props.get(key)
                if v:
                    docs.add(str(v))
    return docs


# ---------------------------------------------------------------------------
# 摘要向量化 + 落盘
# ---------------------------------------------------------------------------


def _community_store_path() -> Path:
    _REG_DIR.mkdir(parents=True, exist_ok=True)
    return _REG_DIR / _COMMUNITY_FILE


def _write_community_store(communities: List[Community], revision: str) -> None:
    path = _community_store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    store = {
        "revision": revision,
        "updated_at": _utcnow_iso(),
        "communities": [c.to_json() for c in communities],
    }
    path.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_community_store() -> dict:
    path = _community_store_path()
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def _utcnow_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def revision() -> str:
    """社区存储 revision（供 pipeline 失效检测，同 sparse_state 机制）。"""
    store = _load_community_store()
    return str(store.get("revision", ""))


def enabled() -> bool:
    try:
        from src.config import get_rag_config

        return bool(get_rag_config().pluggable.get("graph_community", True))
    except Exception:  # noqa: BLE001
        return True


def _doc_to_chunk_map() -> Dict[str, List[str]]:
    """doc_id -> chunk_id 列表（读 Milvus 当前 chunk collection，降级空 dict）。"""
    try:
        from src.rag.vector_store import get_vector_store

        vs = get_vector_store()
        vs.connect()
        chunks = vs.list_chunks(batch_size=2000)
        m: Dict[str, List[str]] = {}
        for c in chunks:
            m.setdefault(str(c.get("doc_id") or ""), []).append(str(c.get("chunk_id")))
        return m
    except Exception:  # noqa: BLE001
        return {}


def upsert_community_vectors(communities: List[Community]) -> int:
    """把社区的摘要向量写入 Milvus 社区 collection + 落盘 JSON。

    返回写入条数；Milvus/embedding 失败时只落盘摘要文本，向量留空（降级）。
    """
    if not communities:
        return 0

    # 摘要向量（本地 embedding；失败 → 向量 None，Milvus 跳过该条）
    vectors: Dict[str, Optional[List[float]]] = {}
    try:
        from src.rag.embeddings import get_embeddings

        emb = get_embeddings()
        pairs = []
        for c in communities:
            if not c.summary_text:
                vectors[c.id] = None
                continue
            vec = emb.embed_query(c.summary_text)
            vectors[c.id] = [float(x) for x in vec]  # numpy float32 → 原生 float，可 JSON 序列化
            pairs.append((c, vec))
        if pairs:
            _write_community_collection(pairs)
    except Exception as exc:  # noqa: BLE001
        logger.warning("社区摘要向量化失败（降级：仅落盘文本）: {}", exc)

    # doc -> chunk 映射（Milvus 失败时空 dict，降级不影响文本落盘）
    doc2chunk = _doc_to_chunk_map()
    for c in communities:
        c.chunk_ids = []
        for d in c.source_docs:
            c.chunk_ids.extend(doc2chunk.get(d, []))
        c.summary_vector = vectors.get(c.id)

    rev = _make_revision(communities)
    _write_community_store(communities, rev)
    logger.info("Communities built & persisted: count={}, revision={}", len(communities), rev)
    return len(communities)


def _write_community_collection(pairs: List[Any]) -> None:
    """写 Milvus 社区 collection（recreate；不碰 chunk collection）。"""
    try:
        from src.rag.community_vector_store import get_community_vector_store

        csv = get_community_vector_store()
        rows = [
            {
                "community_id": c.id,
                "summary": c.summary_text,
                "node_ids": json.dumps(c.member_nodes, ensure_ascii=False),
                "doc_ids": json.dumps(c.source_docs, ensure_ascii=False),
                "chunk_ids": json.dumps(c.chunk_ids, ensure_ascii=False),
                "embedding": vec,
            }
            for c, vec in pairs
            if vec
        ]
        if rows:
            csv.upsert_all(rows)
    except Exception as exc:  # noqa: BLE001
        logger.warning("社区向量 Milvus 写入失败（降级跳过）: {}", exc)


def _make_revision(communities: List[Community]) -> str:
    digest = hashlib.md5()
    for c in communities:
        digest.update(c.id.encode())
        digest.update(json.dumps(c.member_nodes, ensure_ascii=False).encode())
        digest.update(c.summary_text.encode())
    return digest.hexdigest()


# ---------------------------------------------------------------------------
# 检索侧：社区摘要向量粗筛
# ---------------------------------------------------------------------------


def load_communities() -> List[Community]:
    """从落盘 JSON 读社区（带向量时一并加载，供离线检索用）。"""
    store = _load_community_store()
    out: List[Community] = []
    for c in store.get("communities", []):
        out.append(Community.from_json(c))
    return out


def community_search(
    query: str,
    top_k: int = 3,
    min_score: float = 0.35,
) -> List[Dict[str, Any]]:
    """query 向量 vs 社区摘要向量 COSINE 粗筛。

    返回 top-k 社区命中：[{"community_id","summary","score","source_docs","chunk_ids"},...]
    开关关 / 无社区 / embedding 失败 → 返回 []（no-op，不阻断）。
    """
    if not enabled():
        return []
    communities = load_communities()
    if not communities:
        return []
    try:
        from src.rag.embeddings import get_embeddings

        qvec = get_embeddings().embed_query(query)
    except Exception as exc:  # noqa: BLE001
        logger.warning("community_search embedding 失败: {}", exc)
        return []

    import math

    scored: List[Dict[str, Any]] = []
    for c in communities:
        if not c.summary_vector or len(c.summary_vector) != len(qvec):
            continue
        dot = sum(a * b for a, b in zip(c.summary_vector, qvec))
        na = math.sqrt(sum(a * a for a in c.summary_vector)) or 1.0
        nb = math.sqrt(sum(b * b for b in qvec)) or 1.0
        cos = dot / (na * nb)
        if cos >= min_score:
            scored.append(
                {
                    "community_id": c.id,
                    "summary": c.summary_text,
                    "score": round(cos, 4),
                    "source_docs": c.source_docs,
                    "chunk_ids": c.chunk_ids,
                }
            )
    scored.sort(key=lambda x: -x["score"])
    return scored[:top_k]
