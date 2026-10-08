"""
Pydantic API and domain schemas.
"""

from datetime import datetime
from decimal import Decimal
from typing import Any, List, Literal, Optional

from pydantic import BaseModel, Field

from .enums import FlowRegime, IntentType, KnowledgeCategory


class ChatRequest(BaseModel):
    """Chat request payload."""

    message: str = Field(..., min_length=1, max_length=2000)
    session_id: Optional[str] = None
    stream: bool = False


class ChatResponse(BaseModel):
    """Chat response payload."""

    response: str
    session_id: str
    sources: List[dict] = Field(default_factory=list)
    intent: Optional[str] = None
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    execution_time_ms: int = 0
    trace_id: Optional[str] = None
    tool_calls: List[dict] = Field(default_factory=list)


class StreamChunk(BaseModel):
    """Streaming response chunk."""

    chunk: str
    done: bool = False
    sources: Optional[List[dict]] = None


class ProjectInfo(BaseModel):
    """Project information."""

    pro_id: int
    number: str
    name: str
    responsible: Optional[str] = None
    build_date: Optional[datetime] = None
    description: Optional[str] = None


class PipelineInfo(BaseModel):
    """Pipeline information."""

    id: int
    pro_id: int
    name: str
    length: Decimal
    diameter: Decimal
    thickness: Decimal
    roughness: Optional[Decimal] = None
    throughput: Optional[Decimal] = None
    start_altitude: Optional[Decimal] = None
    end_altitude: Optional[Decimal] = None
    work_time: Optional[Decimal] = None


class PumpStationInfo(BaseModel):
    """Pump station information."""

    id: int
    name: str
    pump_efficiency: Optional[Decimal] = None
    electric_efficiency: Optional[Decimal] = None
    displacement: Optional[Decimal] = None
    come_power: Optional[Decimal] = None
    zmi480_lift: Optional[Decimal] = None
    zmi375_lift: Optional[Decimal] = None


class OilPropertyInfo(BaseModel):
    """Oil property information."""

    id: int
    name: str
    density: Decimal
    viscosity: Decimal


class HydraulicInput(BaseModel):
    """Hydraulic calculation input."""

    flow_rate: Decimal = Field(..., gt=0)
    pipe_diameter: Decimal = Field(..., gt=0)
    pipe_length: Decimal = Field(..., gt=0)
    oil_density: Decimal = Field(..., gt=0)
    oil_viscosity: Decimal = Field(..., gt=0)
    roughness: Decimal = Decimal("0.03")
    start_elevation: Decimal = Decimal("0")
    end_elevation: Decimal = Decimal("0")


class HydraulicResult(BaseModel):
    """Hydraulic calculation result."""

    flow_velocity: Decimal
    reynolds_number: Decimal
    flow_regime: FlowRegime
    friction_factor: Decimal
    friction_head_loss: Decimal
    hydraulic_slope: Decimal
    elevation_head: Decimal
    total_head_loss: Decimal
    calculation_method: str


class OptimizationInput(BaseModel):
    """Optimization input."""

    pipeline_id: int
    target_flow: Decimal = Field(..., gt=0)
    min_end_pressure: Decimal = Decimal("0.3")


class PumpCombination(BaseModel):
    """Pump combination."""

    pump_type_1: str
    pump_count_1: int = Field(..., ge=0)
    pump_type_2: str
    pump_count_2: int = Field(..., ge=0)
    total_head: Decimal
    end_pressure: Decimal
    power_consumption: Decimal
    is_feasible: bool


class OptimizationResult(BaseModel):
    """Optimization result."""

    optimal_combination: PumpCombination
    all_combinations: List[PumpCombination]
    optimization_target: str
    constraints: dict


class KnowledgeChunk(BaseModel):
    """Knowledge chunk."""

    chunk_id: str
    content: str
    context: Optional[str] = None
    source_doc: str
    category: KnowledgeCategory
    hypothetical_questions: List[str] = Field(default_factory=list)
    metadata: dict = Field(default_factory=dict)


class SearchResult(BaseModel):
    """Knowledge search result."""

    chunk: KnowledgeChunk
    score: float = Field(..., ge=0.0, le=1.0)
    match_type: str


class RAGApiResponse(BaseModel):
    """RAG response."""

    answer: str
    sources: List[SearchResult]
    retrieval_quality: str
    should_fallback: bool = False


class ToolCall(BaseModel):
    """Tool execution record."""

    tool_name: str
    arguments: dict
    result: Any
    success: bool
    error_message: Optional[str] = None
    duration_ms: int


class AgentDecision(BaseModel):
    """Agent routing decision."""

    intent: IntentType
    reasoning: str
    sub_tasks: List[dict]
    confidence: float


class HITLConfirmRequest(BaseModel):
    """HITL confirmation request."""

    session_id: str
    response: Optional[dict] = None
    selected_option: Optional[str] = None
    comment: Optional[str] = None
    modified_data: Optional[dict] = None
    request_id: Optional[str] = None


class HITLConfirmResponse(BaseModel):
    """HITL confirmation response."""

    status: Literal["resumed"] = "resumed"
    result: dict = Field(default_factory=dict)


class TraceSummaryResponse(BaseModel):
    """Trace summary response."""

    trace_id: str
    metrics: dict = Field(default_factory=dict)
    event_count: int = 0
    timeline: List[dict] = Field(default_factory=list)


class GraphQueryResponse(BaseModel):
    """Knowledge graph query response."""

    query: str
    result: dict = Field(default_factory=dict)


class ReportRiskItem(BaseModel):
    """Structured risk item used by the report center."""

    target: str
    riskType: str
    level: str
    reason: str
    impact: Optional[str] = None
    suggestion: str
    code: Optional[str] = None
    message: Optional[str] = None


class ReportSuggestionItem(BaseModel):
    """Structured recommendation item used by the report center."""

    target: str
    reason: str
    action: str
    expected: str
    priority: str
    text: Optional[str] = None


class ReportMetricItem(BaseModel):
    """Single KPI metric for report rendering."""

    label: str
    value: str
    note: Optional[str] = None


class ReportBulletItem(BaseModel):
    """Single bullet or action item in a dynamic section."""

    title: Optional[str] = None
    content: str


class ReportTableData(BaseModel):
    """Generic table block for dynamic sections."""

    columns: list[str] = Field(default_factory=list)
    rows: list[list[str]] = Field(default_factory=list)


class DynamicReportSection(BaseModel):
    """Dynamic report section returned to the frontend."""

    id: str
    kind: Literal["metrics", "bullets", "table", "markdown", "callout"]
    title: str
    summary: Optional[str] = None
    content: Optional[str] = None
    metrics: list[ReportMetricItem] = Field(default_factory=list)
    items: list[ReportBulletItem] = Field(default_factory=list)
    table: Optional[ReportTableData] = None


class SensitivityInsightBlock(BaseModel):
    """Single narrative block for the sensitivity smart report."""

    title: str
    content: str


class SensitivityReportAiInsights(BaseModel):
    """Structured insight blocks rendered next to sensitivity charts."""

    rankingInsight: Optional[SensitivityInsightBlock] = None
    trendInsight: Optional[SensitivityInsightBlock] = None
    impactInsight: Optional[SensitivityInsightBlock] = None
    tableConclusion: Optional[SensitivityInsightBlock] = None


class OptimizationInsightBlock(BaseModel):
    """Single narrative block for the optimization smart report."""

    title: str
    content: str


class OptimizationReportAiInsights(BaseModel):
    """Structured insight blocks rendered next to optimization charts."""

    schemeInsight: Optional[OptimizationInsightBlock] = None
    feasibilityInsight: Optional[OptimizationInsightBlock] = None
    economicInsight: Optional[OptimizationInsightBlock] = None


class DynamicReportAiAnalysis(BaseModel):
    """Skill-driven AI analysis blocks for the report page."""

    summary: list[str] = Field(default_factory=list)
    metricAnalysis: list[str] = Field(default_factory=list)
    schemeExplain: list[str] = Field(default_factory=list)
    comparison: list[str] = Field(default_factory=list)
    changeAnalysis: list[str] = Field(default_factory=list)
    riskJudgement: list[ReportRiskItem] = Field(default_factory=list)
    riskIdentify: list[ReportRiskItem] = Field(default_factory=list)
    suggestions: list[ReportSuggestionItem] = Field(default_factory=list)
    sensitivityInsights: Optional[SensitivityReportAiInsights] = None
    optimizationInsights: Optional[OptimizationReportAiInsights] = None


class DynamicReportRequest(BaseModel):
    """Report generation request from the report center."""

    selected_project_ids: list[int] = Field(default_factory=list)
    project_names: list[str] = Field(default_factory=list)
    selected_pipeline_id: Optional[int] = None
    selected_pipeline_name: Optional[str] = None
    selected_pump_station_ids: list[int] = Field(default_factory=list)
    selected_pump_station_names: list[str] = Field(default_factory=list)
    selected_oil_id: Optional[int] = None
    selected_oil_name: Optional[str] = None
    report_type: str = "AI_REPORT"
    report_type_label: Optional[str] = None
    range_preset: Optional[str] = None
    range_label: Optional[str] = None
    custom_start: Optional[str] = None
    custom_end: Optional[str] = None
    intelligence_level: str = "standard"
    output_format: str = "markdown"
    include_summary: bool = True
    include_risk: bool = True
    include_suggestions: bool = True
    include_conclusion: bool = True
    analysis_object: Optional[str] = None
    output_style: Optional[str] = None
    focuses: list[str] = Field(default_factory=list)
    target_throughput: Optional[float] = None
    min_pressure: Optional[float] = None
    optimization_goal: Optional[str] = None
    allow_pump_adjust: bool = True
    remark: Optional[str] = None
    user_prompt: Optional[str] = None
    hydraulic_snapshot: Optional[dict[str, Any]] = None
    optimization_snapshot: Optional[dict[str, Any]] = None
    sensitivity_snapshot: Optional[dict[str, Any]] = None


class DynamicReportResponse(BaseModel):
    """Dynamic report payload consumed by the frontend."""

    title: str
    abstract: str = ""
    source: Literal["ai", "rules", "hybrid"] = "hybrid"
    aiAnalysis: DynamicReportAiAnalysis = Field(default_factory=DynamicReportAiAnalysis)
    summary: list[str] = Field(default_factory=list)
    highlights: list[str] = Field(default_factory=list)
    risks: list[ReportRiskItem] = Field(default_factory=list)
    suggestions: list[ReportSuggestionItem] = Field(default_factory=list)
    conclusion: str = ""
    sections: list[DynamicReportSection] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    raw_text: str = ""
