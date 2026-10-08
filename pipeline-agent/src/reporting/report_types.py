from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ReportDataBundle:
    projects: list[dict[str, Any]] = field(default_factory=list)
    pipelines: list[dict[str, Any]] = field(default_factory=list)
    pump_stations: list[dict[str, Any]] = field(default_factory=list)
    oil_properties: list[dict[str, Any]] = field(default_factory=list)
    history_overview: dict[str, Any] = field(default_factory=dict)
    history_records: list[dict[str, Any]] = field(default_factory=list)
    time_series: dict[str, list[dict[str, Any]]] = field(default_factory=dict)


@dataclass
class MetricSnapshot:
    overview_metrics: dict[str, Any] = field(default_factory=dict)
    trend_metrics: dict[str, Any] = field(default_factory=dict)
    object_metrics: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    constraint_metrics: dict[str, Any] = field(default_factory=dict)
    data_quality: dict[str, Any] = field(default_factory=dict)


@dataclass
class TrendFinding:
    metric: str
    metric_label: str
    direction: str
    change_rate: float
    volatility: float
    summary: str
    evidence: list[str] = field(default_factory=list)


@dataclass
class IssueFinding:
    target: str
    level: str
    issue_type: str
    message: str
    evidence: dict[str, Any] = field(default_factory=dict)


@dataclass
class AnomalyFinding:
    target: str
    target_type: str
    metric: str
    value: float | None
    baseline: float | None
    severity: str
    summary: str
    evidence: list[str] = field(default_factory=list)


@dataclass
class CauseFinding:
    target: str
    metric: str
    primary_cause: str
    secondary_causes: list[str] = field(default_factory=list)
    evidence: list[str] = field(default_factory=list)
    confidence: float = 0.0


@dataclass
class ConstraintFinding:
    name: str
    severity: str
    summary: str
    evidence: list[str] = field(default_factory=list)


@dataclass
class RecommendationFinding:
    target: str
    priority: str
    reason: str
    action: str
    expected: str


@dataclass
class DecisionOption:
    name: str
    score: float
    feasible: bool
    reasons: list[str] = field(default_factory=list)
    pros: list[str] = field(default_factory=list)
    cons: list[str] = field(default_factory=list)
    violations: list[str] = field(default_factory=list)
    option_type: str = "single"


@dataclass
class DecisionResult:
    recommended_options: list[DecisionOption] = field(default_factory=list)
    fallback_options: list[DecisionOption] = field(default_factory=list)
    rejected_options: list[DecisionOption] = field(default_factory=list)
    summary: str = ""
    weights: dict[str, float] = field(default_factory=dict)


@dataclass
class DiagnosisResult:
    trends: list[TrendFinding] = field(default_factory=list)
    issues: list[IssueFinding] = field(default_factory=list)
    anomalies: list[AnomalyFinding] = field(default_factory=list)
    causes: list[CauseFinding] = field(default_factory=list)
    constraints: list[ConstraintFinding] = field(default_factory=list)
    recommendations: list[RecommendationFinding] = field(default_factory=list)
    risks: list[dict[str, Any]] = field(default_factory=list)
    confidence: dict[str, float] = field(default_factory=dict)


@dataclass
class OutlineSection:
    id: str
    title: str
    section_type: str
    reason: str
    priority: int


@dataclass
class OutlinePlan:
    title: str
    abstract: str
    sections: list[OutlineSection] = field(default_factory=list)
