from __future__ import annotations

from typing import Any

from src.models.schemas import DynamicReportAiAnalysis

from .change_analysis_skill import change_analysis_skill
from .hydraulic_dynamic_skill import build_hydraulic_report_ai_sections
from .metric_skill import metric_skill
from .operation_suggestion_skill import operation_suggestion_skill
from .optimization_dynamic_skill import build_optimization_report_ai_sections
from .risk_identify_skill import risk_identify_skill
from .risk_skill import risk_skill
from .sensitivity_insight_skill import build_sensitivity_insight_blocks
from .sensitivity_summary_skill import sensitivity_summary_skill
from .suggestion_skill import suggestion_skill
from .summary_skill import summary_skill


def build_report_ai_sections(ctx: dict[str, Any]) -> DynamicReportAiAnalysis:
    return build_hydraulic_report_ai_sections(ctx)


def build_sensitivity_report_ai_sections(ctx: dict[str, Any]) -> DynamicReportAiAnalysis:
    insight_blocks = build_sensitivity_insight_blocks(ctx)
    return DynamicReportAiAnalysis(
        summary=sensitivity_summary_skill(ctx),
        changeAnalysis=change_analysis_skill(ctx),
        riskIdentify=risk_identify_skill(ctx),
        suggestions=operation_suggestion_skill(ctx),
        sensitivityInsights=insight_blocks,
    )


__all__ = ["build_report_ai_sections", "build_sensitivity_report_ai_sections", "build_optimization_report_ai_sections"]
