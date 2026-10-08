# Unified LLM client for pipeline-agent.
#
# Follows the existing project convention:
#   - Uses langchain_openai.ChatOpenAI with settings.OPENAI_API_KEY
#     and settings.OPENAI_API_BASE (reused from src.config, no new keys).
#   - Synchronous API: complete() and chat() for use in pre-execution hooks
#     and any new enrichment features (B1/B2/B3/B4/B5).
#   - LLMClientError is raised on timeout or network failure so that
#     callers (hooks) can catch and degrade gracefully without blocking
#     the main RAG/ingestion pipeline.
#
# Singleton: get_llm_client() returns the shared LLMClient instance,
# matching the get_rag_pipeline() / get_self_rag() patterns used elsewhere.

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from langchain_openai import ChatOpenAI

from src.config import settings

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_SECONDS = 30.0


class LLMClientError(Exception):
    """Raised when an LLM call fails (timeout, network, API error).

    Pre-execution hooks should catch this and degrade gracefully.
    """


class LLMClient:
    """Thin synchronous wrapper over ChatOpenAI for pipeline-agent LLM calls.

    All new pre-execution hooks and enrichment features (B1–B5) use this
    class instead of constructing ChatOpenAI directly, ensuring:
      - consistent timeout handling
      - a single error type (LLMClientError) to catch in hook fallback
      - easy future migration to a different provider

    Config:
      Reads OPENAI_API_KEY, OPENAI_API_BASE, LLM_MODEL, LLM_TEMPERATURE,
      LLM_MAX_TOKENS from src.config.settings — no new env vars.
    """

    def __init__(
        self,
        model: Optional[str] = None,
        temperature: float = 0.0,
        max_tokens: int = 4096,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self._model = model or settings.LLM_MODEL
        self._temperature = temperature
        self._max_tokens = max_tokens
        self._timeout_seconds = timeout_seconds
        self._llm: Optional[ChatOpenAI] = None

    # ------------------------------------------------------------------
    # LLM instance (lazy init, same pattern as SelfRAG.llm / QueryRewriter.llm)
    # ------------------------------------------------------------------

    @property
    def _client(self) -> ChatOpenAI:
        if self._llm is None:
            self._llm = ChatOpenAI(
                api_key=settings.OPENAI_API_KEY,
                base_url=settings.OPENAI_API_BASE,
                model=self._model,
                temperature=self._temperature,
                max_tokens=self._max_tokens,
                timeout=self._timeout_seconds,
                max_retries=1,
            )
        return self._llm

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def complete(
        self,
        prompt: str,
        *,
        system: Optional[str] = None,
        temperature: Optional[float] = None,
        timeout: Optional[float] = None,
    ) -> str:
        """Send a single-turn prompt and return the plain-text response.

        Args:
            prompt: User message content.
            system: Optional system message.
            temperature: Override temperature for this call only.
            timeout: Override timeout (seconds) for this call only.

        Raises:
            LLMClientError: On timeout, network failure, or API error.
        """
        messages: List[Dict[str, Any]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        return self.chat(messages, temperature=temperature, timeout=timeout)

    def chat(
        self,
        messages: List[Dict[str, Any]],
        *,
        temperature: Optional[float] = None,
        timeout: Optional[float] = None,
    ) -> str:
        """Send a multi-turn chat and return the plain-text response.

        Args:
            messages: List of message dicts with "role" and "content" keys.
            temperature: Override temperature for this call only.
            timeout: Override timeout (seconds) for this call only.

        Raises:
            LLMClientError: On timeout, network failure, or API error.
        """
        client = self._client
        if temperature is not None:
            # Create a fresh ChatOpenAI with the overridden temperature
            client = ChatOpenAI(
                api_key=settings.OPENAI_API_KEY,
                base_url=settings.OPENAI_API_BASE,
                model=self._model,
                temperature=temperature,
                max_tokens=self._max_tokens,
                timeout=timeout if timeout is not None else self._timeout_seconds,
                max_retries=1,
            )
        else:
            client = client.bind(timeout=timeout if timeout is not None else self._timeout_seconds)

        try:
            response = client.invoke(messages)
        except TimeoutError as exc:
            raise LLMClientError(f"LLM call timed out after {timeout or self._timeout_seconds}s") from exc
        except Exception as exc:
            raise LLMClientError(f"LLM call failed: {exc}") from exc

        content: Any = getattr(response, "content", "")
        return str(content).strip()


# ---------------------------------------------------------------------------
# Module-level singleton (matches get_rag_pipeline / get_self_rag pattern)
# ---------------------------------------------------------------------------

_llm_client: Optional[LLMClient] = None


def get_llm_client() -> LLMClient:
    """Return the shared LLMClient singleton.

    Callers that need a non-default model should construct LLMClient directly.
    """
    global _llm_client
    if _llm_client is None:
        _llm_client = LLMClient()
    return _llm_client
