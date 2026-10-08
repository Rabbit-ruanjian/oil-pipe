"""Conditional edges for plan-and-execute workflow."""

from __future__ import annotations

from typing import Literal

from src.models.state import AgentState


def route_to_agent(
    state: AgentState,
) -> Literal[
    "data_agent",
    "calc_agent",
    "knowledge_agent",
    "graph_agent",
    "synthesizer",
]:
    """Route executor to target agent for current step."""

    plan = state.get("plan", [])
    index = state.get("current_step_index", 0)

    if index >= len(plan):
        return "synthesizer"

    step = plan[index]
    agent = step.get("agent")

    if agent == "data_agent":
        return "data_agent"
    if agent == "calc_agent":
        return "calc_agent"
    if agent == "knowledge_agent":
        return "knowledge_agent"
    if agent == "graph_agent":
        return "graph_agent"

    return "synthesizer"


def route_after_step(state: AgentState) -> Literal["reflexion", "hitl_check", "synthesizer"]:
    """Route after one step execution."""

    plan = state.get("plan", [])
    index = state.get("current_step_index", 0)

    if index >= len(plan):
        return "synthesizer"

    step = plan[index]
    if step.get("status") == "failed":
        return "reflexion"

    return "hitl_check"


def route_after_reflexion(state: AgentState) -> Literal["executor", "planner", "synthesizer"]:
    """Route after reflexion decision."""

    if state.get("needs_replan"):
        return "planner"

    plan = state.get("plan", [])
    index = state.get("current_step_index", 0)

    if index >= len(plan):
        return "synthesizer"

    return "executor"


def route_after_hitl(state: AgentState) -> Literal["executor", "planner", "synthesizer"]:
    """Route after HITL confirmation gate."""

    if state.get("needs_replan"):
        return "planner"

    index = state.get("current_step_index", 0)
    if index >= len(state.get("plan", [])):
        return "synthesizer"

    return "executor"
