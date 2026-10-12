"""GraphRAG 社区层（GraphRAG 2.0）单测。

覆盖：社区切分（弱连通分量 + 大类退化）/ 规则摘要 /
     upsert_community_vectors（Milvus/embedding 降级不抛）/
     community_search（门控关 → []、有向量 COSINE 粗筛、无 → []）。
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import networkx as nx
import pytest


def _make_builder(communities_expected_size: int = 2) -> object:
    """造一个最小 KnowledgeGraphBuilder（不连 Milvus、不同步 DB）。"""
    import src.knowledge_graph.builder as B

    g = nx.DiGraph()
    # 分量 1：fault -> cause -> solution 因果链
    g.add_node("f1", type="fault", name="泵站出口压力下降")
    g.add_node("c1", type="cause", name="叶轮磨损")
    g.add_node("s1", type="solution", name="更换叶轮")
    g.add_edge("f1", "c1", type="caused_by", weight=0.8)
    g.add_edge("c1", "s1", type="solved_by", weight=1.0)
    # 分量 2：pipeline -> station -> pump 设备链
    g.add_node("p1", type="pipeline", name="长庆原油管道")
    g.add_node("ps1", type="pump_station", name="首站")
    g.add_node("pu1", type="pump", name="ZMI480")
    g.add_edge("p1", "ps1", type="contains", weight=1.0)
    g.add_edge("ps1", "pu1", type="installed", weight=1.0)
    # 一个悬空 standard 节点（自己一个分量）
    g.add_node("st1", type="standard", name="GB/T 14162")

    g_b = B.KnowledgeGraphBuilder.__new__(B.KnowledgeGraphBuilder)
    g_b.graph = g
    g_b._built = True
    g_b._data_dir = ""
    g_b._document_graph_path = ""
    g_b._document_graph_revision = ""
    return g_b


@pytest.fixture(autouse=True)
def _tmp_community_store(tmp_path, monkeypatch):
    """把社区落盘指到临时目录，避免污染真实 .registry。"""
    import src.knowledge_graph.community as cm

    monkeypatch.setattr(cm, "_REG_DIR", tmp_path / ".registry")
    monkeypatch.setattr(cm, "_community_store_path", lambda: tmp_path / ".registry" / "communities.json")
    yield


def test_build_communities_counts_and_members():
    from src.knowledge_graph.community import build_communities

    builder = _make_builder()
    communities = build_communities(builder)
    # 3 个弱连通分量：fault 链 / 设备链 / 悬空 standard
    assert len(communities) == 3
    ids = {frozenset(c.member_nodes) for c in communities}
    assert frozenset({"f1", "c1", "s1"}) in ids
    assert frozenset({"p1", "ps1", "pu1"}) in ids
    assert frozenset({"st1"}) in ids


def test_summarize_community_includes_causal_chain():
    from src.knowledge_graph.community import build_communities

    builder = _make_builder()
    communities = build_communities(builder)
    fault_comm = [c for c in communities if "f1" in c.member_nodes][0]
    s = fault_comm.summary_text
    assert "泵站出口压力下降" in s
    assert "叶轮磨损" in s
    assert "更换叶轮" in s
    assert "因果链" in s


def test_upsert_degrades_no_exception(monkeypatch):
    """embedding/Milvus 全挂时 upsert 只落盘文本，不抛。"""
    import src.knowledge_graph.community as cm
    from src.knowledge_graph.community import build_communities, upsert_community_vectors

    builder = _make_builder()
    communities = build_communities(builder)

    # 模拟 get_embeddings 抛（无本地模型场景）
    monkeypatch.setattr(cm, "_write_community_collection", lambda _pairs: None)
    monkeypatch.setattr(cm, "_doc_to_chunk_map", lambda: {})
    monkeypatch.setattr(
        cm, "load_communities", lambda: [
            cm.Community.from_json(c.to_json()) for c in communities
        ]
    )
    n = upsert_community_vectors(communities)
    assert n == len(communities)
    # 落盘存在
    store = cm._load_community_store()
    assert store.get("revision")
    assert len(store["communities"]) == len(communities)


def test_community_search_disabled_returns_empty(monkeypatch):
    import src.knowledge_graph.community as cm
    from src.knowledge_graph.community import community_search

    monkeypatch.setattr(cm, "enabled", lambda: False)
    assert community_search("泵站出口压力下降") == []


def test_community_search_no_communities_returns_empty(tmp_path, monkeypatch):
    import src.knowledge_graph.community as cm
    from src.knowledge_graph.community import community_search

    monkeypatch.setattr(cm, "enabled", lambda: True)
    monkeypatch.setattr(cm, "load_communities", lambda: [])
    assert community_search("泵站出口压力下降") == []


def test_community_search_cosine_ranks_correctly(monkeypatch, tmp_path):
    import math
    import src.knowledge_graph.community as cm
    from src.knowledge_graph.community import community_search

    # 两个社区，向量方向不同；query 更接近 A → A 应排前
    va = [1.0, 0.0, 0.0]
    vb = [0.0, 1.0, 0.0]
    qv = [0.9, 0.1, 0.0]  # 与 A 余弦高
    comms = [
        cm.Community(id="c0001", member_nodes=["x"], relations=[], summary_text="A 摘要", source_docs=["d1"], summary_vector=va),
        cm.Community(id="c0002", member_nodes=["y"], relations=[], summary_text="B 摘要", source_docs=["d2"], summary_vector=vb),
    ]
    monkeypatch.setattr(cm, "enabled", lambda: True)
    monkeypatch.setattr(cm, "load_communities", lambda: comms)

    class _Emb:
        def embed_query(self, q):
            return qv

    # community_search 内联 `from src.rag.embeddings import get_embeddings`，
    # 所以 patch 的是 embeddings 模块上的 get_embeddings（不是 community 上的）
    import src.rag.embeddings as emb_mod

    monkeypatch.setattr(emb_mod, "get_embeddings", lambda: _Emb())

    out = community_search("泵站出口压力下降", top_k=2, min_score=0.0)
    assert len(out) == 2
    assert out[0]["community_id"] == "c0001"  # 更接近 A
    assert out[0]["score"] > out[1]["score"]
    assert "d1" in out[0]["source_docs"]


def test_pluggable_contains_graph_community():
    from src.config import get_rag_config

    flags = get_rag_config().pluggable
    assert "graph_community" in flags
    assert flags["graph_community"] is True  # 默认开
