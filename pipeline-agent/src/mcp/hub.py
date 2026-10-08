"""In-process MCP hub for server registration and tool dispatch."""

from __future__ import annotations

from typing import Any, Dict, List

from src.utils import logger

from .base import MCPServer
from .types import MCPResourceDefinition, MCPToolCallResult, MCPToolDefinition


class MCPHub:
    """Lightweight MCP hub used for incremental migration."""

    def __init__(self):
        self._servers: Dict[str, MCPServer] = {}

    async def register(self, name: str, server: MCPServer) -> None:
        self._servers[name] = server
        try:
            tools = await server.list_tools()
            logger.info("MCP server registered: {} (tools={})", name, len(tools))
        except Exception as exc:
            logger.warning("MCP server registered with tool introspection failure: {} ({})", name, exc)

    def has_server(self, name: str) -> bool:
        return name in self._servers

    def server_names(self) -> List[str]:
        return list(self._servers.keys())

    async def list_tools(self, server_name: str | None = None) -> List[MCPToolDefinition]:
        if server_name:
            server = self._servers.get(server_name)
            if server is None:
                return []
            return await server.list_tools()

        merged: List[MCPToolDefinition] = []
        for server in self._servers.values():
            merged.extend(await server.list_tools())
        return merged

    async def list_resources(self, server_name: str | None = None) -> List[MCPResourceDefinition]:
        if server_name:
            server = self._servers.get(server_name)
            if server is None:
                return []
            return await server.list_resources()

        merged: List[MCPResourceDefinition] = []
        for server in self._servers.values():
            merged.extend(await server.list_resources())
        return merged

    async def call_tool(self, server_name: str, tool_name: str, args: Dict[str, Any]) -> MCPToolCallResult:
        server = self._servers.get(server_name)
        if server is None:
            return MCPToolCallResult(ok=False, content=None, error=f"server not found: {server_name}")
        return await server.call_tool(tool_name, args)

    async def read_resource(self, server_name: str, uri: str) -> str:
        server = self._servers.get(server_name)
        if server is None:
            raise ValueError(f"server not found: {server_name}")
        return await server.read_resource(uri)


_mcp_hub: MCPHub | None = None


def get_mcp_hub() -> MCPHub:
    global _mcp_hub
    if _mcp_hub is None:
        _mcp_hub = MCPHub()
    return _mcp_hub

