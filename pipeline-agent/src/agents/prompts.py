"""Compatibility prompt exports backed by file-based skill definitions."""

from __future__ import annotations

from src.skills import get_prompt


_PROMPT_SPECS = {
    "SUPERVISOR_SYSTEM_PROMPT": ("supervisor", "system"),
    "SUPERVISOR_TASK_PROMPT": ("supervisor", "task"),
    "INTENT_CLASSIFICATION_PROMPT": ("supervisor", "intent_classification"),
    "SYNTHESIS_PROMPT": ("supervisor", "synthesis"),
    "DATA_AGENT_SYSTEM_PROMPT": ("data-query", "system"),
    "DATA_AGENT_TASK_PROMPT": ("data-query", "task"),
    "CALC_AGENT_SYSTEM_PROMPT": ("hydraulic-calc", "system"),
    "CALC_AGENT_TASK_PROMPT": ("hydraulic-calc", "task"),
    "KNOWLEDGE_AGENT_SYSTEM_PROMPT": ("knowledge-qa", "system"),
    "KNOWLEDGE_AGENT_TASK_PROMPT": ("knowledge-qa", "task"),
    "PLANNER_SYSTEM_PROMPT": ("planner", "system"),
    "PLANNER_TASK_PROMPT": ("planner", "task"),
    "PLANNER_REPLAN_PROMPT": ("planner", "replan"),
    "REFLEXION_PROMPT": ("reflexion", "prompt"),
    "ERROR_RECOVERY_PROMPT": ("error-recovery", "prompt"),
    "REACT_SYSTEM_PROMPT": ("chat-orchestrator", "system"),
    "FINAL_SYNTHESIS_PROMPT": ("final-synthesis", "system"),
}

__all__ = list(_PROMPT_SPECS.keys())


def __getattr__(name: str) -> str:
    spec = _PROMPT_SPECS.get(name)
    if spec is None:
        raise AttributeError(name)
    return get_prompt(*spec)
