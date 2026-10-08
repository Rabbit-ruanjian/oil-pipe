"""Agent module exports."""

from .prompts import (
    SUPERVISOR_SYSTEM_PROMPT,
    DATA_AGENT_SYSTEM_PROMPT,
    CALC_AGENT_SYSTEM_PROMPT,
    KNOWLEDGE_AGENT_SYSTEM_PROMPT,
    SYNTHESIS_PROMPT,
    PLANNER_SYSTEM_PROMPT,
    REFLEXION_PROMPT,
)


def get_supervisor():
    from .supervisor import get_supervisor as _get_supervisor

    return _get_supervisor()


def get_data_agent():
    from .data_agent import get_data_agent as _get_data_agent

    return _get_data_agent()


def get_calc_agent():
    from .calc_agent import get_calc_agent as _get_calc_agent

    return _get_calc_agent()


def get_knowledge_agent():
    from .knowledge_agent import get_knowledge_agent as _get_knowledge_agent

    return _get_knowledge_agent()


def get_planner():
    from .planner import get_planner as _get_planner

    return _get_planner()


def get_reflexion_agent():
    from .reflexion import get_reflexion_agent as _get_reflexion_agent

    return _get_reflexion_agent()


def get_graph_agent():
    from .graph_agent import get_graph_agent as _get_graph_agent

    return _get_graph_agent()


__all__ = [
    "SUPERVISOR_SYSTEM_PROMPT",
    "DATA_AGENT_SYSTEM_PROMPT",
    "CALC_AGENT_SYSTEM_PROMPT",
    "KNOWLEDGE_AGENT_SYSTEM_PROMPT",
    "SYNTHESIS_PROMPT",
    "PLANNER_SYSTEM_PROMPT",
    "REFLEXION_PROMPT",
    "get_supervisor",
    "get_data_agent",
    "get_calc_agent",
    "get_knowledge_agent",
    "get_planner",
    "get_reflexion_agent",
    "get_graph_agent",
]
