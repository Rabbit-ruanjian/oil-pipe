"""
Plan-and-Execute 子图。
仅在 plan_complex_task 工具被调用时进入。
"""

from __future__ import annotations

import json
import time
from threading import Lock
from typing import Any, Dict, Optional

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph
from langgraph.types import Command

from src.models.state import AgentState, create_initial_state
from src.observability import create_tracer
from src.utils import generate_session_id, generate_trace_id, logger

from .edges import route_after_hitl, route_after_reflexion, route_after_step, route_to_agent
from .nodes import (
    calc_agent_node,
    data_agent_node,
    executor_node,
    graph_agent_node,
    hitl_check_node,
    knowledge_agent_node,
    planner_node,
    reflexion_node,
    step_evaluator_node,
    synthesizer_node,
)


def _create_plan_execute_subgraph():
    """构建 Plan-and-Execute 子图。"""

    graph = StateGraph(AgentState)

    graph.add_node("planner", planner_node)
    graph.add_node("executor", executor_node)
    graph.add_node("data_agent", data_agent_node)
    graph.add_node("calc_agent", calc_agent_node)
    graph.add_node("knowledge_agent", knowledge_agent_node)
    graph.add_node("graph_agent", graph_agent_node)
    graph.add_node("step_evaluator", step_evaluator_node)
    graph.add_node("reflexion", reflexion_node)
    graph.add_node("hitl_check", hitl_check_node)
    graph.add_node("synthesizer", synthesizer_node)

    graph.set_entry_point("planner")
    graph.add_edge("planner", "executor")

    graph.add_conditional_edges(
      "executor",
      route_to_agent,
      {
        "data_agent": "data_agent",
        "calc_agent": "calc_agent",
        "knowledge_agent": "knowledge_agent",
        "graph_agent": "graph_agent",
        "synthesizer": "synthesizer",
      },
    )

    for node in ["data_agent", "calc_agent", "knowledge_agent", "graph_agent"]:
        graph.add_edge(node, "step_evaluator")

    graph.add_conditional_edges(
        "step_evaluator",
        route_after_step,
        {"reflexion": "reflexion", "hitl_check": "hitl_check", "synthesizer": "synthesizer"},
    )

    graph.add_conditional_edges(
        "reflexion",
        route_after_reflexion,
        {"executor": "executor", "planner": "planner", "synthesizer": "synthesizer"},
    )

    graph.add_conditional_edges(
        "hitl_check",
        route_after_hitl,
        {"executor": "executor", "planner": "planner", "synthesizer": "synthesizer"},
    )

    graph.add_edge("synthesizer", END)
    return graph.compile(checkpointer=MemorySaver())


_subgraph_app = None
_pending_subgraph_runs: Dict[str, Dict[str, Any]] = {}
_pending_lock = Lock()
_PENDING_TTL_SECONDS = 1800


def _get_subgraph():
    global _subgraph_app
    if _subgraph_app is None:
        _subgraph_app = _create_plan_execute_subgraph()
    return _subgraph_app


def _cleanup_pending_runs(now: float):
    expired = [
        request_id
        for request_id, info in _pending_subgraph_runs.items()
        if now - float(info.get("updated_at", 0.0)) > _PENDING_TTL_SECONDS
    ]
    for request_id in expired:
        _pending_subgraph_runs.pop(request_id, None)


def _cache_pending_run(request_id: str, app, config: dict):
    if not request_id:
        return
    with _pending_lock:
        now = time.time()
        _cleanup_pending_runs(now)
        _pending_subgraph_runs[request_id] = {
            "app": app,
            "config": config,
            "updated_at": now,
        }


def _take_pending_run(request_id: str) -> Optional[Dict[str, Any]]:
    if not request_id:
        return None
    with _pending_lock:
        now = time.time()
        _cleanup_pending_runs(now)
        return _pending_subgraph_runs.pop(request_id, None)


def run_plan_execute(task_description: str) -> str:
    """Plan-and-Execute 子图入口。"""

    session_id = generate_session_id()
    trace_id = generate_trace_id()
    create_tracer(trace_id)

    initial_state = create_initial_state(
        user_input=task_description,
        session_id=session_id,
        max_iterations=10,
        max_retries_per_step=2,
        trace_id=trace_id,
    )

    config = {"configurable": {"thread_id": session_id}}
    app = _get_subgraph()

    try:
        result = app.invoke(initial_state, config=config)

        state_snapshot = app.get_state(config)
        if state_snapshot and state_snapshot.next:
            hitl_data = _extract_interrupt_value(app, config)
            if hitl_data:
                request_id = str(hitl_data.get("request_id", "")).strip()
                if request_id:
                    _cache_pending_run(request_id, app, config)
                return f"[HITL_WAITING]{json.dumps(hitl_data, ensure_ascii=False)}"

        final_response = result.get("final_response", "")
        if final_response:
            return final_response
        return "复杂任务执行完成，但未生成最终回复。"

    except Exception as exc:  # noqa: BLE001
        logger.error("Plan-Execute subgraph failed: %s", exc)
        return f"复杂任务执行失败: {exc}"


def resume_plan_execute(request_id: str, user_choice: dict) -> Dict[str, Any]:
    """根据 request_id 恢复被中断的 Plan-and-Execute 子图。"""

    pending = _take_pending_run(request_id)
    if not pending:
        return {
            "status": "not_found",
            "error": f"未找到 request_id={request_id} 对应的待恢复子图状态，可能已过期。",
        }

    app = pending["app"]
    config = pending["config"]

    try:
        result = app.invoke(Command(resume=user_choice), config=config)

        state_snapshot = app.get_state(config)
        if state_snapshot and state_snapshot.next:
            hitl_data = _extract_interrupt_value(app, config)
            if hitl_data:
                next_request_id = str(hitl_data.get("request_id", "")).strip()
                if next_request_id:
                    _cache_pending_run(next_request_id, app, config)
                return {"status": "hitl_waiting", "hitl_data": hitl_data}

        final_response = result.get("final_response", "")
        if not final_response:
            final_response = "复杂任务执行完成，但未生成最终回复。"
        return {"status": "completed", "response": final_response}

    except Exception as exc:  # noqa: BLE001
        logger.error("Plan-Execute resume failed: %s", exc)
        return {"status": "error", "error": str(exc)}


def _extract_interrupt_value(app, config: dict):
    """从子图状态快照中提取 interrupt() 传入的 HITL 请求数据。"""

    try:
        state_snapshot = app.get_state(config)
        if not state_snapshot or not state_snapshot.next:
            return None
        for task in getattr(state_snapshot, "tasks", []):
            for intr in getattr(task, "interrupts", []):
                value = getattr(intr, "value", None)
                if value is not None:
                    return value
    except Exception as exc:  # noqa: BLE001
        logger.debug("Failed to extract interrupt value: %s", exc)
    return None
