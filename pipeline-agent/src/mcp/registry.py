"""Builtin MCP server registration helpers."""

from __future__ import annotations

import asyncio
from threading import Thread
from typing import Callable, Iterable

from src.tool_search import sync_tool_registry_from_mcp
from src.utils import logger

from .calculation_server import CalculationMCPServer
from .database_server import DatabaseMCPServer
from .hub import get_mcp_hub
from .knowledge_server import KnowledgeMCPServer


BUILTIN_MCP_SERVERS: tuple[tuple[str, Callable[[], object]], ...] = (
    ("database-mcp", DatabaseMCPServer),
    ("calculation-mcp", CalculationMCPServer),
    ("knowledge-mcp", KnowledgeMCPServer),
)


async def ensure_builtin_mcp_servers_async(
    server_names: Iterable[str] | None = None,
) -> list[str]:
    """Ensure builtin MCP servers are registered and synced into tool search."""

    hub = get_mcp_hub()
    requested = {name for name in server_names or []}
    ready: list[str] = []

    for server_name, factory in BUILTIN_MCP_SERVERS:
        if requested and server_name not in requested:
            continue
        if not hub.has_server(server_name):
            await hub.register(server_name, factory())
        tool_defs = await hub.list_tools(server_name)
        sync_tool_registry_from_mcp(server_name, tool_defs)
        ready.append(server_name)

    return ready


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


def ensure_builtin_mcp_servers_sync(
    server_names: Iterable[str] | None = None,
) -> list[str]:
    """Sync wrapper for builtin MCP registration."""

    try:
        return list(
            _run_async_sync(lambda: ensure_builtin_mcp_servers_async(server_names=server_names)) or []
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Builtin MCP registration failed: {}", exc)
        return []
