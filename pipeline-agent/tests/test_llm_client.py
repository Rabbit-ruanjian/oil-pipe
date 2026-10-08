"""Tests for src.llm.llm_client.LLMClient.

Uses unittest.mock to stub ChatOpenAI so no real API calls are made.
Env vars are set before import to satisfy the src.config.Settings validator.
Tests cover:
  - complete() happy path
  - chat() happy path
  - timeout / exception → LLMClientError raised (degradation path)
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

# Set required env vars BEFORE importing src modules
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("OPENAI_API_KEY", "sk-test-key")
os.environ.setdefault("EMBEDDING_API_KEY", "sk-test-key")
os.environ.setdefault("DB_PASSWORD", "test-password")
os.environ.setdefault("JAVA_AUTH_PASSWORD", "test-password")
os.environ.setdefault("INTERNAL_API_KEY", "test-internal-key")

from src.llm.llm_client import LLMClient, LLMClientError  # noqa: E402


def _make_fake_response(content: str) -> MagicMock:
    resp = MagicMock()
    resp.content = content
    return resp


def _mock_client() -> MagicMock:
    """Return a ChatOpenAI mock whose invoke() returns a configurable response."""
    mock = MagicMock()
    mock.bind.return_value = mock  # client.bind() returns itself
    return mock


# ---------------------------------------------------------------------------
# Happy-path tests
# ---------------------------------------------------------------------------

def test_complete_returns_plain_text() -> None:
    fake_resp = _make_fake_response("泵组优化方案")
    client = LLMClient(model="test-model")
    fake_llm = _mock_client()
    fake_llm.invoke.return_value = fake_resp

    with patch.object(client, "_llm", fake_llm):
        result = client.complete("请分析泵组", system="你是管道专家")
        assert result == "泵组优化方案"


def test_chat_returns_plain_text() -> None:
    fake_resp = _make_fake_response("检索结果相关")
    client = LLMClient(model="test-model")
    fake_llm = _mock_client()
    fake_llm.invoke.return_value = fake_resp

    with patch.object(client, "_llm", fake_llm):
        result = client.chat(
            [
                {"role": "user", "content": "什么是达西公式?"},
                {"role": "assistant", "content": "这是一个水力公式。"},
                {"role": "user", "content": "再举一个例子"},
            ]
        )
        assert result == "检索结果相关"


# ---------------------------------------------------------------------------
# Error / timeout tests → LLMClientError
# ---------------------------------------------------------------------------

def test_complete_raises_llm_client_error_on_timeout() -> None:
    client = LLMClient(model="test-model", timeout_seconds=0.001)
    fake_llm = _mock_client()

    def raise_timeout(msgs: Any) -> Any:
        raise TimeoutError("simulated network timeout")

    fake_llm.invoke.side_effect = raise_timeout

    with patch.object(client, "_llm", fake_llm):
        with pytest.raises(LLMClientError, match="timed out"):
            client.complete("测试超时")


def test_chat_raises_llm_client_error_on_api_error() -> None:
    client = LLMClient(model="test-model")
    fake_llm = _mock_client()

    def raise_api_error(msgs: Any) -> Any:
        raise ConnectionError("simulated connection refused")

    fake_llm.invoke.side_effect = raise_api_error

    with patch.object(client, "_llm", fake_llm):
        with pytest.raises(LLMClientError, match="failed"):
            client.chat([{"role": "user", "content": "测试API错误"}])


def test_llm_client_error_is_catchable_by_pre_execution_hook() -> None:
    """确认 LLMClientError 是普通 Exception 的子类，hook 可以 catch Exception 兜底。"""
    assert issubclass(LLMClientError, Exception)
