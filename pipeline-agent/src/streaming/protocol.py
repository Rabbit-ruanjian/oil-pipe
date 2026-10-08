"""Unified streaming event protocol for v2 chat endpoints."""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict

from pydantic import BaseModel


class StreamEventType(str, Enum):
    """Unified event names for multi-channel streaming."""

    TRACE_INIT = "trace_init"

    THINKING_DELTA = "thinking_delta"
    THINKING_DONE = "thinking_done"

    CONTENT_DELTA = "content_delta"
    CONTENT_DONE = "content_done"

    TOOL_SEARCH = "tool_search"
    TOOL_USE_START = "tool_use_start"
    TOOL_USE_DELTA = "tool_use_delta"
    TOOL_RESULT = "tool_result"
    TOOL_USE_DONE = "tool_use_done"

    ARTIFACT_CREATE = "artifact_create"
    ARTIFACT_DELTA = "artifact_delta"
    ARTIFACT_DONE = "artifact_done"

    HITL_REQUEST = "hitl_request"
    ERROR = "error"
    DONE = "done"


class StreamEvent(BaseModel):
    """Canonical stream event payload."""

    event: StreamEventType
    data: Dict[str, Any]
    timestamp: float
    sequence: int
    trace_id: str
