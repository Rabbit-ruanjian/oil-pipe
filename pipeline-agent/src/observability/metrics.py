"""Trace metrics helpers."""

from typing import Dict


def default_metrics() -> Dict[str, int]:
    """Default metrics payload."""

    return {
        "total_duration_ms": 0,
        "llm_calls": 0,
        "tool_calls": 0,
        "total_tokens": 0,
        "steps_completed": 0,
        "steps_failed": 0,
        "retries": 0,
    }
