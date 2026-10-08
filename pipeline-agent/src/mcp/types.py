"""Core MCP data structures used by local MCP hub/server skeleton."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class MCPToolDefinition:
    """Metadata for a callable MCP tool."""

    name: str
    description: str
    input_schema: Dict[str, Any] = field(default_factory=dict)
    input_examples: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class MCPResourceDefinition:
    """Metadata for an MCP resource endpoint."""

    uri: str
    description: str
    mime_type: str = "text/plain"


@dataclass
class MCPToolCallResult:
    """Standard MCP tool call result wrapper."""

    ok: bool
    content: Any
    error: Optional[str] = None

