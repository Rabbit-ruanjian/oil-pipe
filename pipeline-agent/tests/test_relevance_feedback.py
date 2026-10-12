"""ENRICH 相关性反馈（Relevance Feedback / Rocchio）单测。

覆盖：反馈存储（record/load/clear + 过期裁剪 + 正负互斥）
     + TF-IDF Rocchio 重排（正反馈拉正、无反馈 no-op、降级不抛）
     + pipeline 门控（开关关 / 无反馈记录 → sources 原样，逐字节一致）
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import pytest

# 把反馈存储目录指到临时目录，避免污染真实 knowledge_base
_tmp = Path(tempfile.mkdtemp(prefix="rfb_"))
os.environ["_RF_DIR"] = str(_tmp)

import src.rag.relevance_feedback as rf  # noqa: E402


@pytest.fixture(autouse=True)
def _isolate_feedback(tmp_path, monkeypatch):
    """每个用例独立反馈存储目录。"""
    base = tmp_path / "fb"
    monkeypatch.setattr(rf, "_FEEDBACK_DIR", base)
    yield


# ---------------------------------------------------------------------------
# 反馈存储
# ---------------------------------------------------------------------------

def test_record_and_load():
    rf.record_feedback("泵站出口压力下降", ["d1", "d2"], ["d3"])
    fb = rf.load_feedback("泵站出口压力下降")
    assert "d1" in fb["relevant"]
    assert "d3" in fb["irrelevant"]


def test_load_absent_query():
    fb = rf.load_feedback("从没反馈过的 query")
    assert fb == {"relevant": [], "irrelevant": []}


def test_pos_neg_mutex_prefer_negative():
    # 同 doc 既标正又标负 → 以负为准（irrelevant 优先排除）
    rf.record_feedback("q", ["d1"], None)
    rf.record_feedback("q", None, ["d1"])
    fb = rf.load_feedback("q")
    assert "d1" not in fb["relevant"]
    assert "d1" in fb["irrelevant"]


def test_clear():
    rf.record_feedback("q", ["d1"])
    assert rf.clear_feedback("q") >= 1
    assert rf.load_feedback("q")["relevant"] == []


def test_empty_feedback_rejected_semantics():
    # record 允许只传一边；load 后另一边为空
    rf.record_feedback("q", ["d1"])
    fb = rf.load_feedback("q")
    assert fb["relevant"] == ["d1"]
    assert fb["irrelevant"] == []


# ---------------------------------------------------------------------------
# Rocchio 重排
# ---------------------------------------------------------------------------

def _cand(doc_id: str, text: str) -> dict:
    return {"doc_id": doc_id, "doc_title": doc_id, "content": text, "score": 0.5}


def test_roccio_noop_when_no_relevant():
    cands = [_cand("a", "泵站出口压力低处置"), _cand("b", "雷诺数计算")]
    out = rf.rocchio_rerank("泵站出口压力低处置", cands, relevant_texts=[])
    assert out is cands  # 原对象，no-op


def test_roccio_noop_when_no_candidates():
    out = rf.rocchio_rerank("q", [], relevant_texts=["某文档"])
    assert out == []


def test_roccio_pulls_relevant_up():
    # 候选里 b 与"相关文档"词面更贴近 → 增强后 b 应排到 a 前
    cands = [
        _cand("a", "管道能耗优化案例 水力坡降 摩阻损失 总扬程 站数优化 泵组匹配 计算 工况 能耗 对比"),
        _cand("b", "泵站出口压力低处置方案 更换叶轮 清洗过滤器 入口堵塞 振动 降负荷 运行 检查 维护 步骤"),
        _cand("c", "月日测试文档 测试内容 录入 演示 样例 占位 数据 验证 字段 结构 检查"),
    ]
    # 正反馈文档词面强烈贴近 b（出口压力/叶轮/过滤器/降负荷），远离 a（能耗/水力坡降）
    relevant = [
        "当泵站出口压力低时，处置方案包括更换叶轮、清洗过滤器、检查入口堵塞，必要时降负荷运行并定期检查维护。"
    ]
    out = rf.rocchio_rerank("泵站出口压力低处置", cands, relevant_texts=relevant, beta=0.5)
    assert out[0]["doc_id"] == "b"
    assert "feedback_score" in out[0]


def test_roccio_no_exception_degraded():
    # 空文本 / 异常输入不应抛
    out = rf.rocchio_rerank("q", [_cand("a", "x")], relevant_texts=["  "], beta=0.5)
    assert out == [_cand("a", "x")] or out[0].get("doc_id") == "a"


def test_enhance_query_text_includes_relevant_terms():
    out = rf.enhance_query_text(
        "泵站出口压力低处置",
        relevant_texts=["更换叶轮 清洗过滤器 降负荷运行 定期检查维护 入口堵塞"],
    )
    # 原词保留
    assert "泵站出口压力低处置" in out
    # 相关文档里的新 2-gram 子串被补进增强串（分词是 2-gram，不会出完整词）
    assert ("叶轮" in out) or ("过滤器" in out) or ("降负荷" in out)
    # 且增强串确实比原 query 长（加了新词）
    assert len(out) > len("泵站出口压力低处置")


# ---------------------------------------------------------------------------
# pipeline 门控（开关关 / 无反馈 → sources 原样，逐字节一致）
# ---------------------------------------------------------------------------

def test_pipeline_no_feedback_keeps_sources(tmp_path, monkeypatch):
    """无反馈记录时，_apply_relevance_feedback 原样返回 sources（no-op）。"""
    from src.rag.pipeline import RAGPipeline

    pipeline = RAGPipeline.__new__(RAGPipeline)  # 不跑 __init__，避免拉整个服务
    sources = [
        {"doc_id": "a", "content_preview": "A", "score": 0.9},
        {"doc_id": "b", "content_preview": "B", "score": 0.4},
    ]
    out, applied, meta = pipeline._apply_relevance_feedback("从没反馈的 query", sources)
    assert out is sources
    assert applied is False
    assert "无正反馈记录" in meta.get("reason", "")


def test_pipeline_with_feedback_reorders(tmp_path, monkeypatch):
    """有反馈记录时，_apply_relevance_feedback 对 sources 做 Rocchio 重排。"""
    from src.rag.pipeline import RAGPipeline

    pipeline = RAGPipeline.__new__(RAGPipeline)
    # 造一个 retriever，带 BM25 语料映射（doc -> chunk 正文）
    class _FakeRetriever:
        _index_to_chunk = {
            0: {"doc_id": "a", "full_text": "泵站出口压力低处置方案 更换叶轮"},
            1: {"doc_id": "b", "full_text": "月日测试文档 测试内容"},
        }

    pipeline.retriever = _FakeRetriever()
    # 反馈：b 相关、a 不相关 → 期望 b 被拉前
    monkeypatch.setattr(
        rf, "_FEEDBACK_DIR", tmp_path / "fb2"
    )
    rf.record_feedback("泵站出口压力低处置", ["b"], ["a"])

    # a 与反馈词面无关（能耗类），b 与相关反馈强贴近（出口压力/叶轮）
    pipeline.retriever._index_to_chunk = {
        0: {"doc_id": "a", "full_text": "管道能耗优化案例 水力坡降 摩阻损失 总扬程 站数 泵组匹配 工况 对比"},
        1: {"doc_id": "b", "full_text": "泵站出口压力低处置方案 更换叶轮 清洗过滤器 入口堵塞 降负荷 检查维护"},
    }
    sources = [
        {"doc_id": "a", "content_preview": "A", "score": 0.9},
        {"doc_id": "b", "content_preview": "B", "score": 0.4},
    ]
    out, applied, meta = pipeline._apply_relevance_feedback("泵站出口压力低处置", sources)
    assert applied is True
    assert out[0]["doc_id"] == "b"


# ---------------------------------------------------------------------------
# 配置门控
# ---------------------------------------------------------------------------

def test_pluggable_contains_relevance_feedback():
    from src.config import get_rag_config

    flags = get_rag_config().pluggable
    assert "relevance_feedback" in flags
    assert flags["relevance_feedback"] is False  # 默认关
