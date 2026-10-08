"""Base interfaces for MCP servers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, List

from .types import MCPResourceDefinition, MCPToolCallResult, MCPToolDefinition


class MCPServer(ABC):
    """Abstract MCP server contract for in-process hub orchestration."""

    @abstractmethod
    async def list_tools(self) -> List[MCPToolDefinition]:
        raise NotImplementedError

    @abstractmethod
    async def call_tool(self, tool_name: str, args: Dict[str, Any]) -> MCPToolCallResult:
        raise NotImplementedError

    @abstractmethod
    async def list_resources(self) -> List[MCPResourceDefinition]:
        raise NotImplementedError

    @abstractmethod
    async def read_resource(self, uri: str) -> str:
        raise NotImplementedError

