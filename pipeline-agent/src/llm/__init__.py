# Unified LLM client module for pipeline-agent.
#
# Follows the existing project convention (langchain_openai.ChatOpenAI).
# Exposes LLMClient with complete() and chat() for all new pluggable
# pre-execution hooks and future enrichment features (B1/B2/B3/B4/B5).

from .llm_client import LLMClient, LLMClientError, get_llm_client

__all__ = ["LLMClient", "LLMClientError", "get_llm_client"]
