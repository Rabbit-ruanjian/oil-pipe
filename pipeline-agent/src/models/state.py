"""Unified workflow state for pipeline-agent v4.0."""

from typing import TypedDict, Annotated, List, Optional, Any

from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage

from src.utils import generate_trace_id


class SubTask(TypedDict):
    """Legacy sub-task definition kept for compatibility."""

    id: str
    agent: str
    task: str
    depends_on: List[str]
    status: str
    result: Optional[Any]


class KnowledgeSource(TypedDict):
    """Knowledge citation source."""

    doc_name: str
    chunk_id: str
    content: str
    score: float
    category: str


class ExecutionStep(TypedDict):
    """Execution trace step."""

    step: int
    agent: str
    action: str
    input: Any
    output: Any
    duration_ms: int


class PlanStep(TypedDict):
    """Plan-and-Execute step."""

    step_id: str
    step_number: int
    description: str
    agent: str
    expected_output: str
    depends_on: List[str]
    status: str
    result: Optional[Any]
    error: Optional[str]
    duration_ms: Optional[int]
    retry_count: int


class ReflexionMemory(TypedDict):
    """Reflexion memory item."""

    step_id: str
    failure_reason: str
    lesson_learned: str
    revised_approach: str
    timestamp: str


class AgentState(TypedDict):
    """Unified Agent state - v4.0."""

    # ===== Messaging =====
    messages: Annotated[List[BaseMessage], add_messages]
    user_input: str

    # ===== Plan-and-Execute =====
    plan: List[PlanStep]
    current_step_index: int
    plan_reasoning: Optional[str]
    needs_replan: bool
    replan_reason: Optional[str]

    # ===== Reflexion =====
    reflexion_memories: List[ReflexionMemory]
    max_retries_per_step: int

    # ===== Human-in-the-Loop =====
    hitl_pending: bool
    hitl_request: Optional[dict]
    hitl_response: Optional[dict]

    # ===== Observability =====
    trace_id: str
    token_usage: dict
    total_llm_calls: int
    total_tool_calls: int

    # ===== Legacy fields kept for compatibility =====
    intent: Optional[str]
    intent_confidence: float
    sub_tasks: List[SubTask]
    current_task_index: int
    completed_tasks: List[SubTask]
    project_data: Optional[dict]
    pipeline_data: Optional[dict]
    pump_station_data: Optional[dict]
    oil_property_data: Optional[dict]
    calculation_result: Optional[dict]
    optimization_result: Optional[dict]
    knowledge_context: Optional[str]
    knowledge_sources: List[KnowledgeSource]
    retrieval_quality: Optional[str]
    next_agent: Optional[str]
    should_retrieve: bool
    should_calculate: bool
    iteration: int
    max_iterations: int
    error_message: Optional[str]
    error_count: int
    last_error_agent: Optional[str]
    session_id: str
    chat_history_summary: Optional[str]
    final_response: Optional[str]
    confidence_score: float
    execution_trace: List[ExecutionStep]


def create_initial_state(
    user_input: str,
    session_id: str,
    max_iterations: int = 10,
    max_retries_per_step: int = 2,
    trace_id: Optional[str] = None,
) -> AgentState:
    """Create initial workflow state."""

    return AgentState(
        messages=[],
        user_input=user_input,
        plan=[],
        current_step_index=0,
        plan_reasoning=None,
        needs_replan=False,
        replan_reason=None,
        reflexion_memories=[],
        max_retries_per_step=max_retries_per_step,
        hitl_pending=False,
        hitl_request=None,
        hitl_response=None,
        trace_id=trace_id or generate_trace_id(),
        token_usage={"prompt": 0, "completion": 0, "total": 0},
        total_llm_calls=0,
        total_tool_calls=0,
        intent=None,
        intent_confidence=0.0,
        sub_tasks=[],
        current_task_index=0,
        completed_tasks=[],
        project_data=None,
        pipeline_data=None,
        pump_station_data=None,
        oil_property_data=None,
        calculation_result=None,
        optimization_result=None,
        knowledge_context=None,
        knowledge_sources=[],
        retrieval_quality=None,
        next_agent=None,
        should_retrieve=False,
        should_calculate=False,
        iteration=0,
        max_iterations=max_iterations,
        error_message=None,
        error_count=0,
        last_error_agent=None,
        session_id=session_id,
        chat_history_summary=None,
        final_response=None,
        confidence_score=0.0,
        execution_trace=[],
    )
