"""LangGraph nodes for plan-and-execute workflow."""

from __future__ import annotations

import json
import time
from typing import Any, Callable, Dict, List, Optional

from langchain_core.messages import AIMessage
from langgraph.types import interrupt

from src.agents import (
    get_calc_agent,
    get_data_agent,
    get_graph_agent,
    get_knowledge_agent,
    get_planner,
    get_reflexion_agent,
    get_supervisor,
)
from src.agents.result_contracts import is_error_result, result_to_data, result_to_text
from src.models.state import AgentState, PlanStep, ReflexionMemory
from src.observability import TraceEventType, emit_trace_event, get_tracer
from src.utils import generate_task_id, now_iso
from .hitl import HITLRequest, HITLResponse, HITLType, get_hitl_manager


def planner_node(state: AgentState) -> Dict[str, Any]:
    """Generate initial plan or replan after failure."""

    planner = get_planner()
    user_input = state.get("user_input", "")

    context = {
        "project_data": state.get("project_data"),
        "pipeline_data": state.get("pipeline_data"),
        "calculation_result": state.get("calculation_result"),
        "optimization_result": state.get("optimization_result"),
    }

    old_plan = state.get("plan", [])
    current_index = state.get("current_step_index", 0)
    completed = [step for step in old_plan if step.get("status") == "completed"]

    if state.get("needs_replan") and old_plan and current_index < len(old_plan):
        failed_step = old_plan[current_index]
        reflexion = ""
        memories = state.get("reflexion_memories", [])
        if memories:
            reflexion = memories[-1].get("revised_approach", "")

        result = planner.replan(
            user_input=user_input,
            completed_steps=completed,
            failed_step=failed_step,
            reflexion=reflexion,
        )
        event_type = TraceEventType.PLAN_UPDATED
    else:
        result = planner.create_plan(user_input, context=context)
        event_type = TraceEventType.PLAN_CREATED

    rebuilt_steps = _build_plan_steps(result.get("plan", []))

    # keep completed history when replan happens
    if completed and state.get("needs_replan"):
        offset = len(completed)
        for i, step in enumerate(rebuilt_steps, start=1):
            step["step_number"] = offset + i
        plan_steps = completed + rebuilt_steps
        next_index = len(completed)
    else:
        plan_steps = rebuilt_steps
        next_index = 0

    trace_id = state.get("trace_id", "")
    emit_trace_event(
        trace_id,
        event_type,
        {
            "plan": [
                {
                    "step_number": step["step_number"],
                    "description": step["description"],
                    "agent": step["agent"],
                    "status": step["status"],
                }
                for step in plan_steps
            ],
            "reasoning": result.get("reasoning", ""),
        },
    )

    return {
        "plan": plan_steps,
        "plan_reasoning": result.get("reasoning", ""),
        "current_step_index": next_index,
        "needs_replan": False,
        "replan_reason": None,
    }


def executor_node(state: AgentState) -> Dict[str, Any]:
    """Pick current step and route to mapped agent node."""

    plan = state.get("plan", [])
    index = state.get("current_step_index", 0)

    if index >= len(plan):
        return {"next_agent": None}

    step = plan[index]
    step["status"] = "in_progress"
    step["error"] = None

    emit_trace_event(
        state.get("trace_id", ""),
        TraceEventType.STEP_STARTED,
        {
            "description": step.get("description", ""),
            "retry_count": step.get("retry_count", 0),
        },
        step_number=step.get("step_number"),
        agent=step.get("agent"),
    )

    return {
        "plan": plan,
        "next_agent": step.get("agent"),
    }


def data_agent_node(state: AgentState) -> Dict[str, Any]:
    """Execute current step using data agent."""

    return _run_step_with_agent(
        state=state,
        agent_name="data_agent",
        skill_name="data-query",
        execute=lambda desc, _state: get_data_agent().execute(desc),
    )


def calc_agent_node(state: AgentState) -> Dict[str, Any]:
    """Execute current step using calc agent."""

    def _execute(desc: str, current_state: AgentState) -> Any:
        pipeline_data = current_state.get("pipeline_data") or {}

        available: Dict[str, Any] = {}
        if isinstance(pipeline_data, dict):
            if "pipeline" in pipeline_data:
                available["pipeline"] = pipeline_data["pipeline"]
            elif "raw" not in pipeline_data:
                available["pipeline"] = pipeline_data

            if "oil" in pipeline_data:
                available["oil"] = pipeline_data["oil"]

            if "pump_station" in pipeline_data:
                available["pump_station"] = pipeline_data["pump_station"]

        available["project"] = current_state.get("project_data")

        return get_calc_agent().execute(desc, available_data=available)

    return _run_step_with_agent(
        state=state,
        agent_name="calc_agent",
        skill_name="hydraulic-calc",
        execute=_execute,
    )


def knowledge_agent_node(state: AgentState) -> Dict[str, Any]:
    """Execute current step using knowledge agent."""

    return _run_step_with_agent(
        state=state,
        agent_name="knowledge_agent",
        skill_name="knowledge-qa",
        execute=lambda desc, _state: get_knowledge_agent().execute(desc),
    )


def graph_agent_node(state: AgentState) -> Dict[str, Any]:
    """Execute current step using graph agent."""

    return _run_step_with_agent(
        state=state,
        agent_name="graph_agent",
        skill_name="graph-reasoning",
        execute=lambda desc, _state: get_graph_agent().execute(desc, summarize=True),
    )


def step_evaluator_node(state: AgentState) -> Dict[str, Any]:
    """Evaluate current step execution outcome."""

    plan = state.get("plan", [])
    index = state.get("current_step_index", 0)

    if index >= len(plan):
        return {}

    step = plan[index]
    status = step.get("status")

    if status == "completed":
        return {"error_message": None, "last_error_agent": None}

    if status == "failed":
        return {
            "error_message": step.get("error") or "step failed",
            "last_error_agent": step.get("agent"),
        }

    return {}


def reflexion_node(state: AgentState) -> Dict[str, Any]:
    """Analyze failed step and decide retry/replan strategy."""

    plan = state.get("plan", [])
    index = state.get("current_step_index", 0)
    if index >= len(plan):
        return {}

    step = plan[index]
    error = step.get("error") or state.get("error_message") or "unknown"

    reflexion = get_reflexion_agent().reflect(
        failed_step=step,
        error=error,
        context={
            "pipeline_data": state.get("pipeline_data"),
            "calc_result": state.get("calculation_result"),
            "knowledge_context": state.get("knowledge_context"),
        },
        history=state.get("reflexion_memories", []),
    )

    memory = ReflexionMemory(
        step_id=step.get("step_id", ""),
        failure_reason=reflexion.get("failure_reason", ""),
        lesson_learned=reflexion.get("lesson_learned", ""),
        revised_approach=reflexion.get("revised_approach", ""),
        timestamp=now_iso(),
    )

    memories = state.get("reflexion_memories", []) + [memory]

    emit_trace_event(
        state.get("trace_id", ""),
        TraceEventType.REFLEXION,
        {
            "failure_reason": reflexion.get("failure_reason", ""),
            "revised_approach": reflexion.get("revised_approach", ""),
            "should_retry": reflexion.get("should_retry", False),
            "should_replan": reflexion.get("should_replan", False),
        },
        step_number=step.get("step_number"),
        agent=step.get("agent"),
    )

    retry_count = int(step.get("retry_count", 0))
    max_retries = int(state.get("max_retries_per_step", 2))

    should_retry = bool(reflexion.get("should_retry")) and retry_count < max_retries
    should_replan = bool(reflexion.get("should_replan")) and not should_retry

    if should_retry:
        step["retry_count"] = retry_count + 1
        step["status"] = "pending"
        step["error"] = None
        return {
            "plan": plan,
            "reflexion_memories": memories,
            "needs_replan": False,
            "replan_reason": None,
            "error_message": None,
        }

    if should_replan:
        return {
            "reflexion_memories": memories,
            "needs_replan": True,
            "replan_reason": reflexion.get("revised_approach", ""),
        }

    # give up current step and move forward
    return {
        "plan": plan,
        "reflexion_memories": memories,
        "current_step_index": index + 1,
        "needs_replan": False,
        "replan_reason": None,
        "error_message": None,
    }


def hitl_check_node(state: AgentState) -> Dict[str, Any]:
    """Pause for human confirmation on risky/ambiguous decisions."""

    plan = state.get("plan", [])
    index = state.get("current_step_index", 0)

    if index >= len(plan):
        return {}

    current_step = plan[index]

    schemes = _extract_schemes(current_step.get("result"))
    if current_step.get("agent") == "calc_agent" and schemes:
        has_risk = any(float(item.get("end_pressure", 1)) < 0.1 for item in schemes)
        if len(schemes) > 1 or has_risk:
            request_id = generate_task_id()
            hitl_request = {
                "request_id": request_id,
                "type": "scheme_selection",
                "title": "请选择优化方案",
                "description": "系统计算出多个方案，请确认后继续。",
                "options": [
                    {
                        "id": f"scheme_{i}",
                        "label": item.get("config") or f"方案{i + 1}",
                        "energy": item.get("energy_consumption"),
                        "end_pressure": item.get("end_pressure"),
                        "saving_rate": item.get("saving_rate", 0),
                        "risk_level": "high" if float(item.get("end_pressure", 1)) < 0.1 else "normal",
                    }
                    for i, item in enumerate(schemes)
                ],
                "data": {"schemes_detail": schemes},
            }
            manager = get_hitl_manager()
            manager.create_request(
                session_id=state.get("session_id", ""),
                trace_id=state.get("trace_id", ""),
                request=HITLRequest(
                    request_id=request_id,
                    type=HITLType.SCHEME_SELECTION,
                    title=hitl_request["title"],
                    description=hitl_request["description"],
                    options=hitl_request["options"],
                    data=hitl_request["data"],
                    timeout_seconds=300,
                ),
            )

            emit_trace_event(
                state.get("trace_id", ""),
                TraceEventType.HITL_WAITING,
                hitl_request,
                step_number=current_step.get("step_number"),
                agent=current_step.get("agent"),
            )

            user_choice = interrupt(hitl_request)
            user_choice["request_id"] = request_id
            selected_option = str(user_choice.get("selected_option", "scheme_0"))
            selected_index = 0
            if "_" in selected_option:
                try:
                    selected_index = int(selected_option.split("_")[-1])
                except Exception:
                    selected_index = 0
            selected_scheme = schemes[selected_index] if selected_index < len(schemes) else schemes[0]

            emit_trace_event(
                state.get("trace_id", ""),
                TraceEventType.HITL_RESUMED,
                {
                    "selected_option": selected_option,
                    "comment": user_choice.get("comment"),
                },
                step_number=current_step.get("step_number"),
                agent=current_step.get("agent"),
            )
            manager.submit_response(
                session_id=state.get("session_id", ""),
                response=HITLResponse(
                    request_id=request_id,
                    selected_option=selected_option,
                    modified_data=user_choice.get("modified_data"),
                    comment=user_choice.get("comment"),
                ),
            )

            return {
                "hitl_pending": False,
                "hitl_request": hitl_request,
                "hitl_response": user_choice,
                "optimization_result": selected_scheme,
                "current_step_index": index + 1,
            }

    # default continue to next step
    return {
        "hitl_pending": False,
        "hitl_request": None,
        "current_step_index": index + 1,
    }


def synthesizer_node(state: AgentState) -> Dict[str, Any]:
    """Synthesize all completed step results as final response (streaming)."""

    completed_steps = [
        {
            "agent": step.get("agent"),
            "task": step.get("description"),
            "result": result_to_text(step.get("result")),
        }
        for step in state.get("plan", [])
        if step.get("status") == "completed"
    ]

    trace_id = state.get("trace_id", "")

    if not completed_steps and state.get("final_response"):
        final_response = state.get("final_response", "")
        # 直接回复也发一个 response_chunk，让前端能流式展示
        emit_trace_event(
            trace_id,
            TraceEventType.RESPONSE_CHUNK,
            {"chunk": final_response},
        )
    elif not completed_steps:
        final_response = "抱歉，未能获得有效执行结果。"
        emit_trace_event(
            trace_id,
            TraceEventType.RESPONSE_CHUNK,
            {"chunk": final_response},
        )
    else:
        def on_chunk(chunk: str) -> None:
            emit_trace_event(
                trace_id,
                TraceEventType.RESPONSE_CHUNK,
                {"chunk": chunk},
            )

        final_response = get_supervisor().synthesize_response_stream(
            user_input=state.get("user_input", ""),
            completed_tasks=completed_steps,
            intent=state.get("intent", "complex") or "complex",
            on_chunk=on_chunk,
        )

    messages = state.get("messages", []) + [AIMessage(content=final_response)]

    tracer = get_tracer(state.get("trace_id", ""))
    metrics = tracer.metrics if tracer else {}
    emit_trace_event(
        state.get("trace_id", ""),
        TraceEventType.WORKFLOW_COMPLETED,
        {
            "final_response_preview": final_response[:200],
            "metrics": metrics,
        },
    )

    return {
        "final_response": final_response,
        "messages": messages,
        "confidence_score": 0.85,
    }


def _build_plan_steps(raw_steps: List[dict]) -> List[PlanStep]:
    steps: List[PlanStep] = []

    for index, step in enumerate(raw_steps, start=1):
        depends_raw = step.get("depends_on", [])
        depends = [str(item) for item in depends_raw] if isinstance(depends_raw, list) else []

        steps.append(
            PlanStep(
                step_id=generate_task_id(),
                step_number=int(step.get("step_number") or index),
                description=str(step.get("description") or f"执行步骤{index}"),
                agent=str(step.get("agent") or "knowledge_agent"),
                expected_output=str(step.get("expected_output") or ""),
                depends_on=depends,
                status="pending",
                result=None,
                error=None,
                duration_ms=None,
                retry_count=0,
            )
        )

    return steps


def _run_step_with_agent(
    state: AgentState,
    agent_name: str,
    skill_name: Optional[str],
    execute: Callable[[str, AgentState], Any],
) -> Dict[str, Any]:
    plan = state.get("plan", [])
    index = state.get("current_step_index", 0)

    if index >= len(plan):
        return {}

    step = plan[index]
    step_number = step.get("step_number")
    trace_id = state.get("trace_id", "")
    description = step.get("description", "")

    start_time = time.perf_counter()

    emit_trace_event(
        trace_id,
        TraceEventType.AGENT_THINKING,
        {"description": description},
        step_number=step_number,
        agent=agent_name,
    )
    emit_trace_event(
        trace_id,
        TraceEventType.TOOL_CALLED,
        {"tool": f"skill.{skill_name or agent_name}", "task": description},
        step_number=step_number,
        agent=agent_name,
    )

    try:
        result = execute(description, state)
        duration = int((time.perf_counter() - start_time) * 1000)

        if is_error_result(result):
            raise RuntimeError(result_to_text(result))

        step["status"] = "completed"
        step["result"] = result
        step["duration_ms"] = duration
        step["error"] = None

        emit_trace_event(
            trace_id,
            TraceEventType.STEP_COMPLETED,
            {"result_preview": result_to_text(result)[:300]},
            step_number=step_number,
            agent=agent_name,
            duration_ms=duration,
        )
        emit_trace_event(
            trace_id,
            TraceEventType.TOOL_RESULT,
            {"tool": f"skill.{skill_name or agent_name}", "result_preview": result_to_text(result)[:200]},
            step_number=step_number,
            agent=agent_name,
        )

        update: Dict[str, Any] = {
            "plan": plan,
            "error_message": None,
            "last_error_agent": None,
        }

        if agent_name == "data_agent":
            parsed = result_to_data(result)
            update["pipeline_data"] = parsed
            if isinstance(parsed, dict) and "oil" in parsed:
                update["oil_property_data"] = parsed["oil"]
        elif agent_name == "calc_agent":
            update["calculation_result"] = result_to_data(result)
        elif agent_name == "knowledge_agent":
            update["knowledge_context"] = result_to_text(result)

        return update

    except Exception as exc:
        duration = int((time.perf_counter() - start_time) * 1000)

        step["status"] = "failed"
        step["error"] = str(exc)
        step["duration_ms"] = duration

        emit_trace_event(
            trace_id,
            TraceEventType.STEP_FAILED,
            {"error": str(exc)},
            step_number=step_number,
            agent=agent_name,
            duration_ms=duration,
        )

        return {
            "plan": plan,
            "error_message": str(exc),
            "error_count": state.get("error_count", 0) + 1,
            "last_error_agent": agent_name,
        }

def _extract_schemes(value: Any) -> List[dict]:
    if value is None:
        return []

    data: Any = result_to_data(value)

    if isinstance(data, dict):
        for key in ["schemes", "allSchemes", "all_combinations", "allCombinations"]:
            items = data.get(key)
            if isinstance(items, list):
                return [item for item in items if isinstance(item, dict)]

    return []
