"""Tests for P0-③ pre-execution hook infrastructure.

Imports src.rag.hooks directly (via importlib) to avoid the full
src.rag/__init__ → src.utils → src.config chain that requires env vars.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from unittest.mock import patch

import pytest


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Load hooks module in isolation to bypass src.rag/__init__.py's heavy import chain
import importlib.util

_spec = importlib.util.spec_from_file_location(
    "src.rag.hooks",
    ROOT / "src" / "rag" / "hooks.py",
)
hooks_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hooks_module)

clear_hooks = hooks_module.clear_hooks
register_pre_ingestion_hook = hooks_module.register_pre_ingestion_hook
register_pre_retrieval_hook = hooks_module.register_pre_retrieval_hook
run_pre_ingestion_hooks = hooks_module.run_pre_ingestion_hooks
run_pre_retrieval_hooks = hooks_module.run_pre_retrieval_hooks


@pytest.fixture(autouse=True)
def _clean_hooks():
    """Ensure a clean hooks registry for every test."""
    clear_hooks()
    yield
    clear_hooks()


# ---------------------------------------------------------------------------
# no-op 行为（无注册 hook 时）
# ---------------------------------------------------------------------------

def test_run_pre_ingestion_hooks_no_op_when_no_hooks() -> None:
    """未注册任何 hook 时，run_pre_ingestion_hooks 返回空列表（no-op）。"""
    result = run_pre_ingestion_hooks(
        document=object(),
        pipeline=object(),
        registry=object(),
        root_path="/tmp/kb",
    )
    assert result == []


def test_run_pre_retrieval_hooks_no_op_when_no_hooks() -> None:
    """未注册任何 hook 时，run_pre_retrieval_hooks 原样返回 query（no-op）。"""
    original_query = "泵站出口压力持续下降"
    result = run_pre_retrieval_hooks(
        query=original_query,
        decision="retrieve",
        top_k=5,
        category_filter=None,
    )
    assert result == original_query


# ---------------------------------------------------------------------------
# 降级兜底（hook 抛异常时不阻断主链路）
# ---------------------------------------------------------------------------

def test_run_pre_ingestion_hooks_degrades_on_exception() -> None:
    """hook 内部抛异常时，run_pre_ingestion_hooks 捕获并跳过，不抛出。"""
    calls: list[str] = []

    def failing_hook(*, document, pipeline, registry, root_path):
        raise RuntimeError("模拟 LLM 超时")

    def ok_hook(*, document, pipeline, registry, root_path):
        calls.append("ok_hook")
        return {"extracted": True}

    register_pre_ingestion_hook(failing_hook, name="failing_hook")
    register_pre_ingestion_hook(ok_hook, name="ok_hook")

    result = run_pre_ingestion_hooks(
        document=object(),
        pipeline=object(),
        registry=object(),
        root_path="/tmp/kb",
    )

    # failing hook 被跳过，ok hook 正常执行
    assert "ok_hook" in calls
    assert result == [{"extracted": True}]
    assert len(result) == 1  # 只有 ok_hook 的结果


def test_run_pre_retrieval_hooks_degrades_on_exception() -> None:
    """hook 内部抛异常时，run_pre_retrieval_hooks 捕获并跳过，query 不变。"""
    original_query = "泵站压力为什么低"

    def failing_hook(*, query, decision, top_k, category_filter=None):
        raise TimeoutError("模拟 HITL 反问超时")

    register_pre_retrieval_hook(failing_hook, name="failing_hook")

    result = run_pre_retrieval_hooks(
        query=original_query,
        decision="retrieve",
        top_k=5,
        category_filter=None,
    )

    # 降级：query 保持不变
    assert result == original_query


def test_run_pre_retrieval_hooks_modifies_query_when_hook_succeeds() -> None:
    """hook 正常执行时，query 被修改并传递给后续 hook。"""

    def expand_hook(*, query, decision, top_k, category_filter=None):
        return f"{query}（扩展变体）"

    register_pre_retrieval_hook(expand_hook, name="expand_hook")

    result = run_pre_retrieval_hooks(
        query="泵组优化",
        decision="retrieve",
        top_k=3,
    )
    assert result == "泵组优化（扩展变体）"


def test_ingestion_hook_returns_none_is_filtered() -> None:
    """入库 hook 返回 None 时被过滤掉，不出现在结果列表中。"""

    def none_hook(*, document, pipeline, registry, root_path):
        return None

    register_pre_ingestion_hook(none_hook, name="none_hook")

    result = run_pre_ingestion_hooks(
        document=object(),
        pipeline=object(),
        registry=object(),
        root_path="/tmp/kb",
    )
    assert result == []
