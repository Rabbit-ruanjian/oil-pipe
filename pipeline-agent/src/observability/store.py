"""In-memory tracer store."""

from __future__ import annotations

from threading import Lock
from typing import Dict, List, Optional

from .tracer import AgentTracer


_TRACERS: Dict[str, AgentTracer] = {}
_LOCK = Lock()


def create_tracer(trace_id: str) -> AgentTracer:
    """Create and register tracer."""

    tracer = AgentTracer(trace_id=trace_id)
    with _LOCK:
        _TRACERS[trace_id] = tracer
    return tracer


def get_tracer(trace_id: str) -> Optional[AgentTracer]:
    """Get tracer by id."""

    with _LOCK:
        return _TRACERS.get(trace_id)


def pop_tracer(trace_id: str) -> Optional[AgentTracer]:
    """Remove tracer from store."""

    with _LOCK:
        return _TRACERS.pop(trace_id, None)


def list_trace_ids() -> List[str]:
    """List active trace ids."""

    with _LOCK:
        return list(_TRACERS.keys())


def get_trace_summary(trace_id: str) -> Optional[dict]:
    """Return summary for trace id."""

    tracer = get_tracer(trace_id)
    if tracer is None:
        return None
    return tracer.get_summary()
