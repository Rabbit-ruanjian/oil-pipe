"""Event processor that maps workflow stream items to v2 stream protocol."""

from __future__ import annotations

import json
import time
from typing import Any, Dict, List

from .protocol import StreamEventType


class StreamEventProcessor:
    """Convert workflow stream items into unified SSE event packets."""

    def __init__(self, trace_id: str):
        self.trace_id = trace_id
        self.sequence = 0

    def _build_packet(self, event: StreamEventType, data: Dict[str, Any]) -> Dict[str, str]:
        self.sequence += 1
        payload = {
            **data,
            "timestamp": time.time(),
            "sequence": self.sequence,
            "trace_id": self.trace_id,
        }
        return {
            "event": event.value,
            "data": json.dumps(payload, ensure_ascii=False),
        }

    def trace_init(self, session_id: str) -> Dict[str, str]:
        return self._build_packet(
            StreamEventType.TRACE_INIT,
            {
                "session_id": session_id,
                "message": "stream initialized",
            },
        )

    def map_workflow_item(self, item: Dict[str, Any]) -> List[Dict[str, str]]:
        """Map one workflow astream item into one or more stream packets."""
        item_type = item.get("type")

        if item_type == "token":
            return [
                self._build_packet(
                    StreamEventType.CONTENT_DELTA,
                    {"content": str(item.get("content", ""))},
                )
            ]

        if item_type == "tool_search":
            return [
                self._build_packet(
                    StreamEventType.TOOL_SEARCH,
                    {
                        "query": str(item.get("query", "")),
                        "selected_tools": item.get("selected_tools", []),
                        "selected_scores": item.get("selected_scores", []),
                        "total_tools": int(item.get("total_tools", 0)),
                        "duration_ms": float(item.get("duration_ms", 0.0)),
                        "mode": str(item.get("mode", "hybrid")),
                        "filters": item.get("filters", {}),
                    },
                )
            ]

        if item_type == "tool_start":
            return [
                self._build_packet(
                    StreamEventType.TOOL_USE_START,
                    {
                        "tool_id": str(item.get("call_id", "")),
                        "name": str(item.get("tool", "")),
                        "input": item.get("input", {}),
                    },
                )
            ]

        if item_type == "tool_end":
            tool_id = str(item.get("call_id", ""))
            return [
                self._build_packet(
                    StreamEventType.TOOL_RESULT,
                    {
                        "tool_id": tool_id,
                        "name": str(item.get("tool", "")),
                        "output": str(item.get("output", "")),
                    },
                ),
                self._build_packet(
                    StreamEventType.TOOL_USE_DONE,
                    {
                        "tool_id": tool_id,
                        "name": str(item.get("tool", "")),
                    },
                ),
            ]

        if item_type == "hitl_waiting":
            data = item.get("data", {})
            if not isinstance(data, dict):
                data = {"raw": data}
            return [self._build_packet(StreamEventType.HITL_REQUEST, data)]

        if item_type == "done":
            response = item.get("response", {})
            if not isinstance(response, dict):
                response = {"response": str(response)}
            return [
                self._build_packet(
                    StreamEventType.CONTENT_DONE,
                    {
                        "response": str(response.get("response", "")),
                        "intent": str(response.get("intent", "")),
                        "session_id": str(response.get("session_id", "")),
                        "tool_calls": response.get("tool_calls", []),
                    },
                ),
                self._build_packet(StreamEventType.DONE, {"status": "completed"}),
            ]

        if item_type == "error":
            return [
                self._build_packet(
                    StreamEventType.ERROR,
                    {"error": str(item.get("error", "unknown error"))},
                )
            ]

        return []
