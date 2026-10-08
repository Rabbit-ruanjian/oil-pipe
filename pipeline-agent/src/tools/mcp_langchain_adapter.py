"""Adapters that expose MCP tools as LangChain tools."""

from __future__ import annotations

import asyncio
from threading import Thread
from typing import Any, Dict, Iterable, List, Tuple

from langchain_core.tools import StructuredTool
from pydantic import Field, create_model

from src.mcp import ensure_builtin_mcp_servers_sync, get_mcp_hub
from src.utils import logger


_MCP_LANGCHAIN_CACHE: Dict[Tuple[Tuple[str, ...], Tuple[str, ...]], List[StructuredTool]] = {}


def _run_async_sync(coro_factory):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro_factory())

    result: list[object] = []
    error: list[BaseException] = []

    def runner():
        try:
            result.append(asyncio.run(coro_factory()))
        except BaseException as exc:  # noqa: BLE001
            error.append(exc)

    thread = Thread(target=runner, daemon=True)
    thread.start()
    thread.join()

    if error:
        raise error[0]
    return result[0] if result else None


def _json_type_to_python(schema: Dict[str, Any]) -> type:
    json_type = schema.get("type")
    if json_type == "integer":
        return int
    if json_type == "number":
        return float
    if json_type == "boolean":
        return bool
    if json_type == "array":
        return list
    if json_type == "object":
        return dict
    return str


def _build_args_schema(model_name: str, input_schema: Dict[str, Any]):
    properties = dict(input_schema.get("properties", {}) or {})
    required = set(input_schema.get("required", []) or [])
    fields = {}
    for field_name, schema in properties.items():
        annotation = _json_type_to_python(schema)
        description = str(schema.get("description", "") or "")
        if field_name in required:
            fields[field_name] = (annotation, Field(..., description=description))
        else:
            default = schema.get("default", None)
            fields[field_name] = (annotation | None, Field(default=default, description=description))
    return create_model(model_name, **fields)


def _create_mcp_tool(server_name: str, tool_def) -> StructuredTool:
    args_schema = _build_args_schema(
        f"MCP_{server_name.replace('-', '_')}_{tool_def.name}",
        tool_def.input_schema or {"type": "object"},
    )

    def _call_tool(**kwargs):
        hub = get_mcp_hub()

        async def _invoke():
            return await hub.call_tool(server_name, tool_def.name, kwargs)

        result = _run_async_sync(_invoke)
        if result.ok:
            return result.content
        return f"MCP tool failed ({server_name}.{tool_def.name}): {result.error or 'unknown error'}"

    return StructuredTool.from_function(
        func=_call_tool,
        name=tool_def.name,
        description=tool_def.description or f"MCP tool {server_name}.{tool_def.name}",
        args_schema=args_schema,
    )


def get_mcp_langchain_tools(
    server_names: Iterable[str],
    exclude_tools: Iterable[str] | None = None,
    include_tools: Iterable[str] | None = None,
) -> List[StructuredTool]:
    """Return LangChain tools backed by MCP servers."""

    normalized = tuple(sorted(str(name).strip() for name in server_names if str(name).strip()))
    if not normalized:
        return []
    excluded = tuple(sorted(str(name).strip() for name in (exclude_tools or []) if str(name).strip()))
    included = tuple(sorted(str(name).strip() for name in (include_tools or []) if str(name).strip()))
    cache_key = (normalized, excluded + ("__INCLUDE__",) + included)

    cached = _MCP_LANGCHAIN_CACHE.get(cache_key)
    if cached is not None:
        return cached

    ensure_builtin_mcp_servers_sync(server_names=normalized)
    hub = get_mcp_hub()
    tools: List[StructuredTool] = []

    for server_name in normalized:
        async def _list():
            return await hub.list_tools(server_name)

        try:
            tool_defs = _run_async_sync(_list) or []
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to list MCP tools for {}: {}", server_name, exc)
            continue

        for tool_def in tool_defs:
            if included and tool_def.name not in included:
                continue
            if tool_def.name in excluded:
                continue
            tools.append(_create_mcp_tool(server_name, tool_def))

    if not tools:
        raise RuntimeError(f"No MCP tools available for servers: {', '.join(normalized)}")

    _MCP_LANGCHAIN_CACHE[cache_key] = tools
    return tools
