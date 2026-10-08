"""Observability exports."""

from .events import TraceEventType, TraceEvent
from .tracer import AgentTracer
from .store import (
    create_tracer,
    get_tracer,
    pop_tracer,
    list_trace_ids,
    get_trace_summary,
)


def emit_trace_event(
    trace_id: str,
    event_type: TraceEventType,
    data: dict,
    step_number: int | None = None,
    agent: str | None = None,
    duration_ms: int | None = None,
    token_count: int | None = None,
) -> None:
    """Emit a trace event when tracer exists."""

    tracer = get_tracer(trace_id)
    if tracer is None:
        return

    tracer.emit(
        event_type=event_type,
        data=data,
        step_number=step_number,
        agent=agent,
        duration_ms=duration_ms,
        token_count=token_count,
    )


__all__ = [
    "TraceEventType",
    "TraceEvent",
    "AgentTracer",
    "create_tracer",
    "get_tracer",
    "pop_tracer",
    "list_trace_ids",
    "get_trace_summary",
    "emit_trace_event",
]
