"""Tests for P0-③ B1 多路查询(expand) + B2 问题分解(decompose) 检索编排.

覆盖：
- B1 变体生成 + 去重合并
- B2 简单/复杂路由（mock LLM 返回）
- 开关关闭时主循环行为与改造前一致（回归）
- 降级兜底（LLM 失败/超时 → 回退单查询）

需要 env 变量以加载 src.config；在导入前用 os.environ 注入占位值。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# 注入 src.config 所需的最小合法 env（validator 拒绝占位值/弱值）
_ENV_REQUIRED = {
    "OPENAI_API_KEY": "sk-test-real-value",
    "EMBEDDING_API_KEY": "sk-test-real-value",
    "DB_PASSWORD": "root-test-abc",
    "JAVA_AUTH_PASSWORD": "admin-test-abc",
    "INTERNAL_API_KEY": "internal-token-test",
    "AUTH_REQUIRED_IN_PRODUCTION": "false",
}


@pytest.fixture(autouse=True)
def _ensure_config_env(monkeypatch):
    for key, value in _ENV_REQUIRED.items():
        monkeypatch.setenv(key, value)
    yield


# ---------------------------------------------------------------------------
# 直接构造 QueryRewriter / RAGPipeline 依赖（mock 掉 LLM 与检索器）
# ---------------------------------------------------------------------------


def _make_rewriter(fake_llm_call):
    from src.rag.self_rag import QueryRewriter

    return QueryRewriter(llm_call=fake_llm_call, llm_timeout=5)


def _make_retrieval_result(chunk_id: str, doc_id: str, content: str, score: float):
    from src.rag.hybrid_retriever import RetrievalResult

    return RetrievalResult(
        chunk_id=chunk_id,
        content=content,
        full_text=content,
        doc_id=doc_id,
        doc_title="t",
        source="s",
        category="c",
        score=score,
        match_type="hybrid",
    )


def _make_pipeline(fake_retriever, fake_llm_call, pluggable):
    """构造一个不触发真实 LLM / 向量库的 RAGPipeline。"""
    import src.rag.pipeline as pipeline_module

    pipeline_module.RAGPipeline._pluggable_features = lambda self: dict(pluggable)

    class FakeRewriter:
        def __init__(self, llm_call):
            from src.rag.self_rag import QueryRewriter

            self._qr = QueryRewriter(llm_call=llm_call, llm_timeout=5)

        def expand(self, query, n=3):
            return self._qr.expand(query, n=n)

        def decompose(self, query):
            return self._qr.decompose(query)

        def hyde(self, query):
            return self._qr.hyde(query)

    from src.rag.pipeline import RAGPipeline

    pipeline = RAGPipeline.__new__(RAGPipeline)
    pipeline.query_rewriter = FakeRewriter(fake_llm_call)
    pipeline.retriever = fake_retriever

    class FakeReranker:
        def rerank(self, query, results, top_k=None):
            ordered = sorted(results, key=lambda r: -r.score)
            return ordered[:top_k] if top_k else ordered

    pipeline.reranker = FakeReranker()
    return pipeline


def _make_fake_retriever(results_by_query):
    """results_by_query: {query: [RetrievalResult,...]}；记录调用。"""
    calls: list[str] = []

    class FakeRetriever:
        def retrieve(self, query, top_k=None, category_filter=None, use_hybrid=True):
            calls.append(query)
            return list(results_by_query.get(query, []))

        @property
        def call_log(self):
            return calls

    return FakeRetriever(), calls


def _fake_reranker():
    """与 _make_pipeline 里 FakeReranker 等价的独立 reranker（按分数降序取 top_k）。"""

    class _R:
        def rerank(self, query, results, top_k=None):
            ordered = sorted(results, key=lambda r: -r.score)
            return ordered[:top_k] if top_k else ordered

    return _R()


# ===========================================================================
# B1 多路查询：变体生成 + 去重
# ===========================================================================


def test_expand_returns_variants_and_dedups() -> None:
    """B1 expand：生成 n 个变体，去重 + 剔除与原问题相同者。"""

    def fake_llm(prompt, values, **_):
        # 模拟 LLM 输出 JSON 数组，含一个与原问题重复、一个空串
        original = values["query"]
        return '["变体A", "变体B", "%s", ""]' % original

    qr = _make_rewriter(fake_llm)
    variants = qr.expand("泵站压力为什么低", n=3)

    assert "变体A" in variants
    assert "变体B" in variants
    # 与原问题相同的被剔除，空串被过滤
    assert "泵站压力为什么低" not in variants
    assert "" not in variants
    assert len(variants) <= 3


def test_expand_degrades_to_empty_on_llm_failure() -> None:
    """B1 降级：LLM 抛异常 → 返回空列表，不阻断。"""

    def boom(_prompt, _values, **_):
        raise RuntimeError("llm down")

    qr = _make_rewriter(boom)
    assert qr.expand("泵站压力为什么低") == []


def test_expand_degrades_on_malformed_output() -> None:
    """B1 降级：LLM 输出非 JSON → 稳健解析兜底，不抛异常。"""
    qr = _make_rewriter(lambda p, v, **_: "这不是JSON 只有几行文字")
    result = qr.expand("泵站压力为什么低")
    # 兜底行解析返回非空或空均可，但绝不能抛异常
    assert isinstance(result, list)


# ===========================================================================
# B2 分解：简单/复杂路由（mock LLM）
# ===========================================================================


def test_decompose_complex_question_parses_sub_queries() -> None:
    """B2 decompose：复杂问题被拆成子问题。"""

    def fake_llm(prompt, values, **_):
        return '{"complex": true, "confidence": 0.9, "sub_queries": ["为什么低", "怎么修", "多少钱"]}'

    qr = _make_rewriter(fake_llm)
    result = qr.decompose("泵站压力为什么低、怎么修、大概多少钱")
    assert result["complex"] is True
    assert result["confidence"] == pytest.approx(0.9)
    assert result["sub_queries"] == ["为什么低", "怎么修", "多少钱"]


def test_decompose_simple_question_single_sub() -> None:
    """B2 decompose：简单问题 → complex=False，单子问题。"""

    def fake_llm(prompt, values, **_):
        return '{"complex": false, "confidence": 0.95, "sub_queries": ["泵站压力为什么低"]}'

    qr = _make_rewriter(fake_llm)
    result = qr.decompose("泵站压力为什么低")
    assert result["complex"] is False
    assert result["sub_queries"] == ["泵站压力为什么低"]


def test_decompose_degrades_to_simple_on_failure() -> None:
    """B2 降级：LLM 失败 → 判定为简单问题（complex=False），不阻断。"""

    def boom(_prompt, _values, **_):
        raise RuntimeError("timeout")

    qr = _make_rewriter(boom)
    result = qr.decompose("泵站压力为什么低")
    assert result["complex"] is False
    assert result["sub_queries"] == []


# ===========================================================================
# 检索编排：B1 多路 + 去重重排
# ===========================================================================


def test_multi_query_merges_and_dedups_candidates() -> None:
    """B1：开关开时对每个变体各检索一次，去重合并。"""
    qr_results = {
        "泵站压力低": [_make_retrieval_result("c1", "d1", "叶轮磨损", 0.9)],
        "变体A": [_make_retrieval_result("c1", "d1", "叶轮磨损", 0.8), _make_retrieval_result("c2", "d2", "管道结蜡", 0.7)],
    }
    fake_retriever, calls = _make_fake_retriever(qr_results)

    def fake_llm(prompt, values, **_):
        # expand 调用的 values 含 "n"；decompose 不含。用此区分。
        if "n" in values:
            return '["变体A"]'
        return "[]"

    pipeline = _make_pipeline(fake_retriever, fake_llm, {"multi_query": True, "decompose": False})
    pipeline.retriever = fake_retriever

    _candidates, reranked = pipeline._run_hybrid_route(
        query="泵站压力低", top_k=2, category_filter=None
    )

    # 原查询 + 变体都各检索了一次
    assert "泵站压力低" in calls
    assert "变体A" in calls
    # 去重后 c1 只出现一次
    chunk_ids = [r.chunk_id for r in reranked]
    assert chunk_ids.count("c1") == 1
    assert "c2" in chunk_ids


def test_multi_query_off_keeps_single_query_path() -> None:
    """回归：multi_query 关闭时只调一次检索（与改造前一致）。"""
    qr_results = {
        "泵站压力低": [_make_retrieval_result("c1", "d1", "叶轮磨损", 0.9)],
    }
    fake_retriever, calls = _make_fake_retriever(qr_results)

    # 关闭时 expand/decompose 不应被调用；给一个记录调用的 llm 兜底
    llm_calls: list[int] = []

    def fake_llm(prompt, values, **_):
        llm_calls.append(1)
        return "[]"

    pipeline = _make_pipeline(None, fake_llm, {"multi_query": False, "decompose": False})
    pipeline.retriever = fake_retriever

    _candidates, reranked = pipeline._run_hybrid_route(
        query="泵站压力低", top_k=2, category_filter=None
    )

    # 关闭时仅一次检索，且不走多路/分解 LLM
    assert calls == ["泵站压力低"]
    assert llm_calls == []
    assert [r.chunk_id for r in reranked] == ["c1"]


def test_decompose_on_complex_routes_through_sub_queries() -> None:
    """B2：decompose 开且判定复杂 → 每个子问题再 B1 扩召回，全部汇总去重。"""
    results = {
        "复合问题": [_make_retrieval_result("c0", "d0", "综合", 0.5)],
        "为什么低": [_make_retrieval_result("c1", "d1", "叶轮磨损", 0.9)],
        "怎么修": [_make_retrieval_result("c2", "d2", "换叶轮", 0.8)],
        "多少钱": [_make_retrieval_result("c3", "d3", "约500", 0.7)],
    }
    fake_retriever, calls = _make_fake_retriever(results)

    def fake_llm(prompt, values, **_):
        # decompose 的 values 只含 query（无 n）；expand 的 values 含 n。
        if "n" not in values:
            return '{"complex": true, "confidence": 0.9, "sub_queries": ["为什么低", "怎么修", "多少钱"]}'
        # 子问题 expand → 无额外变体
        return "[]"

    pipeline = _make_pipeline(None, fake_llm, {"multi_query": True, "decompose": True, "hitl_confidence_threshold": 0.5})
    pipeline.retriever = fake_retriever

    _candidates, reranked = pipeline._run_hybrid_route(
        query="复合问题", top_k=5, category_filter=None
    )

    # 每个子问题都各检索了一次
    assert "为什么低" in calls
    assert "怎么修" in calls
    assert "多少钱" in calls
    chunk_ids = {r.chunk_id for r in reranked}
    assert {"c1", "c2", "c3"} <= chunk_ids


# ===========================================================================
# C 规则：低置信度 → 触发 HITL（不阻断检索）
# ===========================================================================


def test_low_confidence_decompose_triggers_hitl_and_falls_back_to_expand() -> None:
    """判定复杂但置信度低于阈值 → 触发 HITL，且因未确认仍走 B1 扩召回（不阻断）。"""
    results = {
        "复合问题": [_make_retrieval_result("c0", "d0", "综合", 0.5)],
    }
    fake_retriever, calls = _make_fake_retriever(results)
    hitl_triggered: list[bool] = []

    def fake_llm(prompt, values, **_):
        if "n" not in values:  # decompose（values 无 n）
            # 复杂但置信度 0.3 < 阈值 0.5
            return '{"complex": true, "confidence": 0.3, "sub_queries": ["子问题A", "子问题B"]}'
        return "[]"

    pipeline = _make_pipeline(fake_retriever, fake_llm, {"multi_query": True, "decompose": True, "hitl_confidence_threshold": 0.5})

    def fake_hitl(query, decomposition, threshold):
        hitl_triggered.append(True)

    pipeline._trigger_low_confidence_hitl = fake_hitl
    _candidates, reranked = pipeline._run_hybrid_route(
        query="复合问题", top_k=3, category_filter=None
    )

    # HITL 被触发（低置信度兜底）
    assert hitl_triggered
    # 未获得用户确认前仍完成检索（不阻断）
    assert "复合问题" in calls
    assert reranked  # 有结果返回


# ===========================================================================
# 回归：开关全关时主循环关键路径调用次数（与改造前一致）
# ===========================================================================


def test_all_off_main_loop_equivalent_to_pre_change() -> None:
    """全关（multi_query/decompose False）时，_run_hybrid_route 与改造前逐字节等价：
    只调 retriever.retrieve 一次、rerank 一次、不调 expand/decompose。"""
    qr_results = {
        "泵站压力低": [
            _make_retrieval_result("c1", "d1", "叶轮磨损", 0.9),
            _make_retrieval_result("c2", "d2", "管道结蜡", 0.6),
        ],
    }
    fake_retriever, calls = _make_fake_retriever(qr_results)
    llm_calls: list[int] = []

    def fake_llm(prompt, values, **_):
        llm_calls.append(1)
        return "[]"

    pipeline = _make_pipeline(None, fake_llm, {"multi_query": False, "decompose": False})
    pipeline.retriever = fake_retriever

    candidates, reranked = pipeline._run_hybrid_route(
        query="泵站压力低", top_k=2, category_filter=None
    )

    # 单次检索、单次 rerank、零 LLM 调用（改造前行为）
    assert calls == ["泵站压力低"]
    assert llm_calls == []
    # 候选 == 检索器返回原样（未按多路重排）
    assert [c.chunk_id for c in candidates] == ["c1", "c2"]
    # rerank 保留最高分在前
    assert [r.chunk_id for r in reranked] == ["c1", "c2"]


# ===========================================================================
# B3 在线 HyDE：假想答案生成 + 并入候选 + 开关关回归
# ===========================================================================


def test_hyde_generates_hypothetical_answer() -> None:
    """B3 hyde：LLM 返回假想答案文本，原样返回（去空）。"""

    def fake_llm(prompt, values, **_):
        return "泵站出口压力低通常源于叶轮磨损或管道结蜡，应检查叶轮流道与清管记录。"

    qr = _make_rewriter(fake_llm)
    answer = qr.hyde("泵站压力为什么低")
    assert "叶轮磨损" in answer


def test_hyde_degrades_on_llm_failure() -> None:
    """B3 hyde：LLM 失败 → 返回空串，不阻断。"""

    def boom(_p, _v, **_):
        raise RuntimeError("llm down")

    qr = _make_rewriter(boom)
    assert qr.hyde("泵站压力低") == ""


def test_hyde_appended_to_multi_query_list() -> None:
    """B3 开 + B1：假想答案作为额外检索串并入候选列表，且与已有串去重。"""
    qr_results = {
        "泵站压力低": [_make_retrieval_result("c1", "d1", "叶轮磨损", 0.9)],
        "变体A": [_make_retrieval_result("c2", "d2", "结蜡", 0.7)],
        "假想答案串": [_make_retrieval_result("c3", "d3", "叶轮流道", 0.8)],
    }
    fake_retriever, calls = _make_fake_retriever(qr_results)

    def fake_llm(prompt, values, **_):
        # expand prompt 的 values 含 "n"；hyde/decompose 仅含 "query"
        if "n" in values:
            return '["变体A"]'
        return "假想答案串"

    import src.rag.pipeline as pipeline_module
    from src.rag.pipeline import RAGPipeline
    from src.rag.self_rag import QueryRewriter

    qr = QueryRewriter(llm_call=fake_llm, llm_timeout=5)
    pipeline = RAGPipeline.__new__(RAGPipeline)
    pipeline.query_rewriter = qr
    pipeline.retriever = fake_retriever
    pipeline_module.RAGPipeline._pluggable_features = lambda self: {
        "multi_query": True, "decompose": False, "hyde": True,
        "hitl_confidence_threshold": 0.5,
    }
    pipeline.reranker = _fake_reranker()

    candidates, _ = pipeline._run_hybrid_route(
        query="泵站压力低", top_k=3, category_filter=None
    )
    # hyde 开：检索调用应包含 base + 变体 + 假想答案 三路
    assert "泵站压力低" in calls
    assert "变体A" in calls
    assert "假想答案串" in calls


def test_hyde_off_keeps_list_unchanged() -> None:
    """B3 关（hyde=False）：查询串列表不含假想答案，仅 base + B1 变体。"""
    qr_results = {
        "泵站压力低": [_make_retrieval_result("c1", "d1", "叶轮磨损", 0.9)],
        "变体A": [_make_retrieval_result("c2", "d2", "结蜡", 0.7)],
        "假想答案串": [_make_retrieval_result("c3", "d3", "叶轮流道", 0.8)],
    }
    fake_retriever, calls = _make_fake_retriever(qr_results)

    def fake_llm(prompt, values, **_):
        if "n" in values:
            return '["变体A"]'
        return "假想答案串"

    import src.rag.pipeline as pipeline_module
    from src.rag.pipeline import RAGPipeline
    from src.rag.self_rag import QueryRewriter

    qr = QueryRewriter(llm_call=fake_llm, llm_timeout=5)
    pipeline = RAGPipeline.__new__(RAGPipeline)
    pipeline.query_rewriter = qr
    pipeline.retriever = fake_retriever
    pipeline_module.RAGPipeline._pluggable_features = lambda self: {
        "multi_query": True, "decompose": False, "hyde": False,
        "hitl_confidence_threshold": 0.5,
    }
    pipeline.reranker = _fake_reranker()

    pipeline._run_hybrid_route(query="泵站压力低", top_k=3, category_filter=None)
    # hyde 关：假想答案不作为检索串
    assert "假想答案串" not in calls
    assert "变体A" in calls
