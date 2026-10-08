"""Tool search package exports and singleton factory."""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional

from src.tools.agent_tools import TOOL_REGISTRY

from .engine import ToolSearchEngine

_tool_search_engine: Optional[ToolSearchEngine] = None


def get_tool_search_engine() -> ToolSearchEngine:
    global _tool_search_engine
    if _tool_search_engine is None:
        _tool_search_engine = ToolSearchEngine(TOOL_REGISTRY)
    return _tool_search_engine


def rebuild_tool_search_engine() -> ToolSearchEngine:
    """Force-recreate search engine after registry update."""
    global _tool_search_engine
    _tool_search_engine = ToolSearchEngine(TOOL_REGISTRY)
    return _tool_search_engine


def sync_tool_registry_from_mcp(server_name: str, tool_defs: Iterable[Any]) -> None:
    """
    Merge MCP tool metadata into TOOL_REGISTRY and rebuild index.

    Existing local metadata takes priority; MCP data complements description/examples.
    """
    updated = False
    for tool_def in tool_defs:
        name = str(getattr(tool_def, "name", "")).strip()
        if not name:
            continue

        existing: Dict[str, Any] = TOOL_REGISTRY.get(name, {})
        description = str(getattr(tool_def, "description", "")).strip()
        input_examples = getattr(tool_def, "input_examples", [])

        merged_examples: List[Dict[str, Any]] = []
        for item in existing.get("input_examples", []):
            if isinstance(item, dict):
                merged_examples.append(item)
        if isinstance(input_examples, list):
            for item in input_examples:
                if isinstance(item, dict) and item not in merged_examples:
                    merged_examples.append(item)

        merged = {
            "description": existing.get("description") or description or name,
            "keywords": existing.get("keywords") or [name, server_name, "mcp"],
            "category": existing.get("category") or "mcp",
            "defer_loading": existing.get("defer_loading", True),
            "usage_frequency": existing.get("usage_frequency", 0.2),
            "input_examples": merged_examples,
            "source": existing.get("source") or f"mcp:{server_name}",
        }
        if TOOL_REGISTRY.get(name) != merged:
            TOOL_REGISTRY[name] = merged
            updated = True

    if updated:
        rebuild_tool_search_engine()


__all__ = [
    "ToolSearchEngine",
    "get_tool_search_engine",
    "rebuild_tool_search_engine",
    "sync_tool_registry_from_mcp",
]
