"""SSE trace event definitions."""

from dataclasses import dataclass
from enum import Enum
from typing import Optional


class TraceEventType(str, Enum):
    # Plan
    PLAN_CREATED = "plan_created"
    PLAN_UPDATED = "plan_updated"

    # Step execution
    STEP_STARTED = "step_started"
    STEP_COMPLETED = "step_completed"
    STEP_FAILED = "step_failed"

    # Agent internals
    AGENT_THINKING = "agent_thinking"
    TOOL_CALLED = "tool_called"
    TOOL_RESULT = "tool_result"
    LLM_STREAMING = "llm_streaming"

    # Special
    HITL_WAITING = "hitl_waiting"
    HITL_RESUMED = "hitl_resumed"
    REFLEXION = "reflexion"
    REPLAN = "replan"
    RESPONSE_CHUNK = "response_chunk"

    # Final
    WORKFLOW_COMPLETED = "completed"
    WORKFLOW_ERROR = "error"


@dataclass
class TraceEvent:
    """Trace event payload."""

    trace_id: str
    event_type: TraceEventType
    timestamp: str
    data: dict
    step_number: Optional[int] = None
    agent: Optional[str] = None
    duration_ms: Optional[int] = None
    token_count: Optional[int] = None
