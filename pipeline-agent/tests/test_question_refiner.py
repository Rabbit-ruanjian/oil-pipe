"""Tests for B5 在线 HyPE 完善问题 (QuestionRefiner)."""

from __future__ import annotations

import json
import os
import sys
import types
from unittest.mock import MagicMock, patch

# Required env vars for Settings validation (must be set before any src.* import)
os.environ.setdefault("OPENAI_API_KEY", "sk-test-key")
os.environ.setdefault("EMBEDDING_API_KEY", "sk-test-embedding-key")
os.environ.setdefault("DB_PASSWORD", "test-db-password")
os.environ.setdefault("JAVA_AUTH_PASSWORD", "test-java-auth-password")
os.environ.setdefault("AUTH_REQUIRED_IN_PRODUCTION", "false")

import pytest

from src.rag.question_refiner import (
    CompletenessResult,
    QuestionRefiner,
    RefineOutcome,
    get_question_refiner,
    register_question_refine_hook,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _complete_result(confidence: float = 0.9) -> CompletenessResult:
    return CompletenessResult(
        is_complete=True,
        confidence=confidence,
        missing_info=[],
        clarifying_question="",
    )


def _incomplete_result(missing: list[str] | None = None) -> CompletenessResult:
    return CompletenessResult(
        is_complete=False,
        confidence=0.9,
        missing_info=missing or ["缺少项目名"],
        clarifying_question="请问是哪个项目？",
    )


def _patch_refiner_enabled(enabled: bool = True):
    """Context manager patching _question_refine_enabled."""
    return patch("src.rag.question_refiner._question_refine_enabled", return_value=enabled)


def _make_hitl_module_stub(wait_response: dict | None) -> MagicMock:
    """
    Create a mock module for src.workflows.hitl with HITLRequest/HITLType stubs.
    wait_response: dict returned by wait_for_response, or None for timeout.
    """
    async def _fake_wait(session_id, request_id, timeout=300):
        return wait_response

    mock_manager = MagicMock()
    mock_manager.create_request.return_value = "mock_request_id"
    mock_manager.wait_for_response = _fake_wait

    mock_mod = MagicMock()
    # Stub HITLRequest dataclass
    mock_mod.HITLRequest = lambda **kwargs: MagicMock(**kwargs)
    mock_mod.HITLType = MagicMock()
    mock_mod.HITLType.PARAMETER_CONFIRM = "parameter_confirm"
    mock_mod.get_hitl_manager.return_value = mock_manager

    return mock_mod, mock_manager


# ---------------------------------------------------------------------------
# CompletenessResult.from_llm_json tests
# ---------------------------------------------------------------------------

def test_completeness_result_from_valid_json() -> None:
    raw = json.dumps({
        "is_complete": True,
        "confidence": 0.9,
        "missing_info": [],
        "clarifying_question": "",
    })
    result = CompletenessResult.from_llm_json(raw)
    assert result.is_complete is True
    assert result.confidence == 0.9
    assert result.missing_info == []


def test_completeness_result_from_invalid_json_triggers_hitl() -> None:
    """Invalid JSON → is_complete=False, confidence=0.0 → Rule C triggers HITL."""
    result = CompletenessResult.from_llm_json("not valid json")
    assert result.is_complete is False
    assert result.confidence == 0.0
    assert result.clarifying_question != ""


def test_completeness_result_missing_fields() -> None:
    result = CompletenessResult.from_llm_json(json.dumps({"is_complete": False}))
    assert result.is_complete is False
    assert result.confidence == 0.0
    assert result.missing_info == []


# ---------------------------------------------------------------------------
# QuestionRefiner.refine() — switch off
# ---------------------------------------------------------------------------

def test_refine_switch_off_returns_skipped() -> None:
    refiner = QuestionRefiner()
    with _patch_refiner_enabled(enabled=False):
        outcome = refiner.refine("泵站压力为什么低？")
    assert outcome.status == "skipped"
    assert outcome.refined_query is None
    assert "未启用" in outcome.reason


# ---------------------------------------------------------------------------
# QuestionRefiner.refine() — complete question → rewrite + retrievable
# ---------------------------------------------------------------------------

def test_refine_complete_question_gives_retrievable() -> None:
    refiner = QuestionRefiner()
    with _patch_refiner_enabled(True), \
         patch("src.rag.question_refiner._hitl_confidence_threshold", return_value=0.5), \
         patch("src.rag.question_refiner._max_refine_rounds", return_value=2), \
         patch.object(refiner, "_judge_completeness", return_value=_complete_result(0.9)), \
         patch("src.rag.question_refiner.get_query_rewriter") as mock_rw:

        mock_rw.return_value.rewrite.return_value = "泵站出口压力持续下降原因及解决方案"
        outcome = refiner.refine("泵站压力为什么低？")

    assert outcome.status == "retrievable"
    assert outcome.refined_query == "泵站出口压力持续下降原因及解决方案"
    assert outcome.rounds_used == 1


# ---------------------------------------------------------------------------
# QuestionRefiner.refine() — incomplete → HITL → complete
# ---------------------------------------------------------------------------

def test_refine_incomplete_triggers_hitl_then_retrievable() -> None:
    refiner = QuestionRefiner()
    judge_calls = [
        _incomplete_result(missing=["缺少具体数值范围"]),
        _complete_result(0.85),
    ]
    hitl_resp = {"comment": "1号泵站，压力低于0.1MPa"}
    mock_hitl_mod, mock_mgr = _make_hitl_module_stub(hitl_resp)

    with _patch_refiner_enabled(True), \
         patch("src.rag.question_refiner._hitl_confidence_threshold", return_value=0.5), \
         patch("src.rag.question_refiner._max_refine_rounds", return_value=3), \
         patch.object(refiner, "_judge_completeness", side_effect=judge_calls), \
         patch("src.rag.question_refiner.get_query_rewriter") as mock_rw, \
         patch("src.rag.question_refiner._load_hitl_module", return_value=mock_hitl_mod), \
         patch("src.rag.question_refiner._get_hitl_manager", return_value=mock_mgr):

        mock_rw.return_value.rewrite.return_value = "1号泵站出口压力低的原因及解决办法"
        outcome = refiner.refine("泵站压力为什么低？")

    assert outcome.status == "retrievable"
    assert outcome.rounds_used == 2
    assert len(outcome.hitl_questions) == 1


# ---------------------------------------------------------------------------
# QuestionRefiner.refine() — low confidence → Rule C → HITL
# ---------------------------------------------------------------------------

def test_refine_low_confidence_triggers_hitl_rule_c() -> None:
    refiner = QuestionRefiner()
    # LLM says "complete" but confidence 0.4 < threshold 0.7 → Rule C triggers HITL
    judge_calls = [
        CompletenessResult(is_complete=True, confidence=0.4, missing_info=[], clarifying_question="请详细描述"),
        _complete_result(0.9),
    ]
    hitl_resp = {"comment": "ZMI480泵组在冬季的能耗表现"}
    mock_hitl_mod, mock_mgr = _make_hitl_module_stub(hitl_resp)

    with _patch_refiner_enabled(True), \
         patch("src.rag.question_refiner._hitl_confidence_threshold", return_value=0.7), \
         patch("src.rag.question_refiner._max_refine_rounds", return_value=3), \
         patch.object(refiner, "_judge_completeness", side_effect=judge_calls), \
         patch("src.rag.question_refiner.get_query_rewriter") as mock_rw, \
         patch("src.rag.question_refiner._load_hitl_module", return_value=mock_hitl_mod), \
         patch("src.rag.question_refiner._get_hitl_manager", return_value=mock_mgr):

        mock_rw.return_value.rewrite.return_value = "ZMI480泵组冬季能耗表现"
        outcome = refiner.refine("ZMI480泵组能耗怎么样")

    # Round 1: confidence 0.4 < 0.7 → HITL triggered (Rule C)
    # Round 2: complete with high confidence → retrievable
    assert outcome.status == "retrievable"
    assert outcome.rounds_used == 2
    assert len(outcome.hitl_questions) == 1


# ---------------------------------------------------------------------------
# QuestionRefiner.refine() — HITL timeout → skipped (no block)
# ---------------------------------------------------------------------------

def test_refine_hitl_timeout_degrades_without_blocking() -> None:
    refiner = QuestionRefiner()
    mock_hitl_mod, mock_mgr = _make_hitl_module_stub(None)  # None = timeout

    with _patch_refiner_enabled(True), \
         patch("src.rag.question_refiner._hitl_confidence_threshold", return_value=0.5), \
         patch("src.rag.question_refiner._max_refine_rounds", return_value=2), \
         patch.object(refiner, "_judge_completeness", return_value=_incomplete_result()), \
         patch("src.rag.question_refiner._load_hitl_module", return_value=mock_hitl_mod), \
         patch("src.rag.question_refiner._get_hitl_manager", return_value=mock_mgr):

        outcome = refiner.refine("压力多少？")

    assert outcome.status == "skipped"
    assert "HITL 超时" in outcome.reason or "超时" in outcome.reason
    assert outcome.refined_query is None


# ---------------------------------------------------------------------------
# QuestionRefiner.refine() — rounds exhausted → use merged query
# ---------------------------------------------------------------------------

def test_refine_rounds_exhausted_uses_merged_query() -> None:
    refiner = QuestionRefiner()
    hitl_responses = [
        {"comment": "ZMI375泵型"},
        {"comment": "运行工况为冬季"},
    ]
    call_count = {"n": 0}

    async def _fake_wait_multi(session_id, request_id, timeout=300):
        idx = call_count["n"] % len(hitl_responses)
        call_count["n"] += 1
        return hitl_responses[idx]

    mock_mgr = MagicMock()
    mock_mgr.create_request.return_value = "mock_req"
    mock_mgr.wait_for_response = _fake_wait_multi

    mock_hitl_mod = MagicMock()
    mock_hitl_mod.HITLRequest = lambda **kwargs: MagicMock(**kwargs)
    mock_hitl_mod.HITLType = MagicMock()
    mock_hitl_mod.HITLType.PARAMETER_CONFIRM = "parameter_confirm"

    with _patch_refiner_enabled(True), \
         patch("src.rag.question_refiner._hitl_confidence_threshold", return_value=0.5), \
         patch("src.rag.question_refiner._max_refine_rounds", return_value=2), \
         patch.object(refiner, "_judge_completeness", return_value=_incomplete_result()), \
         patch("src.rag.question_refiner._load_hitl_module", return_value=mock_hitl_mod), \
         patch("src.rag.question_refiner._get_hitl_manager", return_value=mock_mgr):

        outcome = refiner.refine("能耗是多少？")

    # Both rounds answered but LLM still says incomplete → exhausted
    assert outcome.status == "exhausted"
    assert outcome.rounds_used == 2
    assert outcome.refined_query is not None
    assert "能耗" in outcome.refined_query


# ---------------------------------------------------------------------------
# QuestionRefiner.refine() — LLM exception → Rule C degraded HITL
# ---------------------------------------------------------------------------

def test_refine_llm_judge_exception_degrades_to_hitl() -> None:
    refiner = QuestionRefiner()
    hitl_resp = {"comment": "补充：1号泵站"}
    mock_hitl_mod, mock_mgr = _make_hitl_module_stub(hitl_resp)

    with _patch_refiner_enabled(True), \
         patch("src.rag.question_refiner._hitl_confidence_threshold", return_value=0.5), \
         patch("src.rag.question_refiner._max_refine_rounds", return_value=2), \
         patch.object(refiner, "_judge_completeness", side_effect=RuntimeError("LLM down")), \
         patch("src.rag.question_refiner._load_hitl_module", return_value=mock_hitl_mod), \
         patch("src.rag.question_refiner._get_hitl_manager", return_value=mock_mgr):

        outcome = refiner.refine("泵")

    # _judge_completeness catches RuntimeError → low-confidence result → HITL triggered.
    # Both rounds: LLM keeps failing → exhausted
    assert outcome.status in ("skipped", "exhausted")


# ---------------------------------------------------------------------------
# PreRetrievalHook protocol: __call__ tests
# ---------------------------------------------------------------------------

def test_refiner_callable_switch_off_returns_original() -> None:
    refiner = QuestionRefiner()
    with _patch_refiner_enabled(False):
        result = refiner(query="某问题", decision=None, top_k=5)
    assert result == "某问题"


def test_refiner_callable_complete_returns_rewritten() -> None:
    refiner = QuestionRefiner()
    with _patch_refiner_enabled(True), \
         patch("src.rag.question_refiner._hitl_confidence_threshold", return_value=0.5), \
         patch("src.rag.question_refiner._max_refine_rounds", return_value=1), \
         patch.object(refiner, "_judge_completeness", return_value=_complete_result(0.9)), \
         patch("src.rag.question_refiner.get_query_rewriter") as mock_rw:

        mock_rw.return_value.rewrite.return_value = "改写后的问题"
        result = refiner(query="原问题", decision=None, top_k=5)

    assert result == "改写后的问题"


def test_refiner_callable_exception_degrades_to_original() -> None:
    """Exception inside the hook → return original query (degraded, no block)."""
    refiner = QuestionRefiner()
    with _patch_refiner_enabled(True), \
         patch.object(refiner, "_refine_loop", side_effect=RuntimeError("boom")):
        result = refiner(query="原问题", decision=None, top_k=5)
    assert result == "原问题"


# ---------------------------------------------------------------------------
# register_question_refine_hook test
# ---------------------------------------------------------------------------

def test_register_question_refine_hook_registers_in_hooks_module() -> None:
    from src.rag import hooks as hooks_module

    hooks_module.clear_hooks()
    try:
        register_question_refine_hook()
        assert len(hooks_module._retrieval_hooks) >= 1
    finally:
        hooks_module.clear_hooks()


# ---------------------------------------------------------------------------
# get_question_refiner singleton
# ---------------------------------------------------------------------------

def test_get_question_refiner_returns_singleton() -> None:
    a = get_question_refiner()
    b = get_question_refiner()
    assert a is b
    assert isinstance(a, QuestionRefiner)
