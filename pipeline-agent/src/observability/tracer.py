"""Agent tracer implementation."""

from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncGenerator, Dict, List, Optional

from src.utils import now_iso

from .events import TraceEvent, TraceEventType
from .metrics import default_metrics
from src.persistence import save_trace_event


class AgentTracer:
    """Collect and stream workflow trace events."""

    def __init__(self, trace_id: str):
        self.trace_id = trace_id
        self.events: List[TraceEvent] = []
        self._queue: Optional[asyncio.Queue] = None
        self.metrics = default_metrics()

    def _ensure_queue(self) -> asyncio.Queue:
        if self._queue is None:
            self._queue = asyncio.Queue()
        return self._queue

    def emit(
        self,
        event_type: TraceEventType,
        data: Dict[str, Any],
        step_number: int | None = None,
        agent: str | None = None,
        duration_ms: int | None = None,
        token_count: int | None = None,
    ) -> None:
        """Append and enqueue one trace event."""

        event = TraceEvent(
            trace_id=self.trace_id,
            event_type=event_type,
            timestamp=now_iso(),
            data=data,
            step_number=step_number,
            agent=agent,
            duration_ms=duration_ms,
            token_count=token_count,
        )
        self.events.append(event)
        self._ensure_queue().put_nowait(event)
        self._update_metrics(event)
        save_trace_event(
            trace_id=event.trace_id,
            event_type=event.event_type.value,
            step_number=event.step_number,
            agent=event.agent,
            data=event.data,
            duration_ms=event.duration_ms,
            token_count=event.token_count,
        )

    async def event_stream(self) -> AsyncGenerator[dict, None]:
        """Yield SSE events with timeout protection."""

        queue = self._ensure_queue()
        timeout = 300  # 5 min total
        deadline = asyncio.get_event_loop().time() + timeout

        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                yield {"event": "error", "data": json.dumps({"error": "stream timeout"})}
                break

            try:
                event = await asyncio.wait_for(queue.get(), timeout=min(remaining, 60))
            except asyncio.TimeoutError:
                yield {"event": "heartbeat", "data": json.dumps({"ts": now_iso()})}
                continue

            payload = {
                "trace_id": event.trace_id,
                "timestamp": event.timestamp,
                "step_number": event.step_number,
                "agent": event.agent,
                "duration_ms": event.duration_ms,
                "token_count": event.token_count,
                **event.data,
            }
            yield {
                "event": event.event_type.value,
                "data": json.dumps(payload, ensure_ascii=False),
            }

            if event.event_type in (
                TraceEventType.WORKFLOW_COMPLETED,
                TraceEventType.WORKFLOW_ERROR,
            ):
                break

    def get_summary(self) -> dict:
        """Return trace summary for API query."""

        return {
            "trace_id": self.trace_id,
            "metrics": self.metrics,
            "event_count": len(self.events),
            "timeline": [
                {
                    "type": e.event_type.value,
                    "timestamp": e.timestamp,
                    "step": e.step_number,
                    "agent": e.agent,
                    "duration_ms": e.duration_ms,
                    "data": e.data,
                }
                for e in self.events
            ],
        }

    def _update_metrics(self, event: TraceEvent) -> None:
        if event.event_type == TraceEventType.STEP_COMPLETED:
            self.metrics["steps_completed"] += 1
        elif event.event_type == TraceEventType.STEP_FAILED:
            self.metrics["steps_failed"] += 1
        elif event.event_type == TraceEventType.TOOL_CALLED:
            self.metrics["tool_calls"] += 1
        elif event.event_type == TraceEventType.AGENT_THINKING:
            self.metrics["llm_calls"] += 1
        elif event.event_type == TraceEventType.REFLEXION:
            self.metrics["retries"] += 1

        if event.token_count:
            self.metrics["total_tokens"] += int(event.token_count)
        if event.duration_ms:
            self.metrics["total_duration_ms"] += int(event.duration_ms)
