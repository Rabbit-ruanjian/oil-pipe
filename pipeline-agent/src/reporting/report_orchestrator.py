from __future__ import annotations

from src.models.schemas import DynamicReportAiAnalysis, DynamicReportRequest, DynamicReportResponse

from .data_loader import load_report_data
from .decision_engine import DecisionEngine
from .diagnosis_engine import DiagnosisEngine
from .labeling import output_style_key, range_label, report_type_label
from .llm_writer import explain_report
from .metric_engine import build_metric_snapshot
from .outline_planner import plan_outline
from .report_context_builder import build_report_context
from .section_generator import (
    build_highlights,
    build_raw_text,
    build_risk_items,
    build_sections,
    build_suggestion_items,
    build_summary,
)
from .skills import build_optimization_report_ai_sections, build_report_ai_sections, build_sensitivity_report_ai_sections


def _title_prefix(projects: list[dict]) -> str:
    names = [str(item.get("name") or "-") for item in projects]
    if not names:
        return "全局"
    if len(names) <= 3:
        return "、".join(names)
    return f"{'、'.join(names[:3])} 等{len(names)}个项目"


def _is_hydraulic_report(request: DynamicReportRequest) -> bool:
    prompt = str(request.user_prompt or "")
    focuses = {str(item).strip() for item in request.focuses}
    hydraulic_focuses = {"雷诺数", "流态", "摩阻损失", "水力坡降", "总扬程", "末站进站压头"}
    return "水力" in prompt or bool(hydraulic_focuses & focuses)


def _is_sensitivity_report(request: DynamicReportRequest) -> bool:
    if request.sensitivity_snapshot:
        return True
    prompt = str(request.user_prompt or "")
    focuses = {str(item).strip() for item in request.focuses}
    sensitivity_focuses = {"基准结果", "敏感系数", "最大影响幅度", "排名", "压力变化趋势", "摩阻损失变化趋势", "流态变化"}
    return "敏感性" in prompt or bool(sensitivity_focuses & focuses)


def _is_optimization_report(request: DynamicReportRequest) -> bool:
    return bool(request.optimization_snapshot)


def generate_report(request: DynamicReportRequest) -> DynamicReportResponse:
    data = load_report_data(request)
    metrics = build_metric_snapshot(data, request)
    diagnosis = DiagnosisEngine().run(data, metrics, request)
    decision = DecisionEngine().run(data, metrics, diagnosis, request)
    outline = plan_outline(request, metrics, diagnosis, decision, _title_prefix(data.projects))
    sections = build_sections(request, data, metrics, diagnosis, decision, outline)
    scope_rows = next((section.table.rows for section in sections if section.id == "scope-context" and section.table), [])

    summary = build_summary(diagnosis, metrics, decision)
    highlights = build_highlights(diagnosis, metrics, decision)
    conclusion = sections[-1].content if sections and sections[-1].id == "conclusion" else ""
    risks = build_risk_items(diagnosis)
    suggestions = build_suggestion_items(diagnosis)
    report_context = build_report_context(request, data, metrics, diagnosis, decision)

    llm_input = {
        "report_context": report_context,
        "facts": {
            "overview_metrics": metrics.overview_metrics,
            "trends": [item.__dict__ for item in diagnosis.trends],
            "issues": [item.__dict__ for item in diagnosis.issues],
            "anomalies": [item.__dict__ for item in diagnosis.anomalies],
            "causes": [item.__dict__ for item in diagnosis.causes],
            "constraints": [item.__dict__ for item in diagnosis.constraints],
            "recommendations": [item.__dict__ for item in diagnosis.recommendations],
            "decision": {
                "recommended_options": [item.__dict__ for item in decision.recommended_options],
                "fallback_options": [item.__dict__ for item in decision.fallback_options],
                "rejected_options": [item.__dict__ for item in decision.rejected_options],
                "summary": decision.summary,
                "weights": decision.weights,
            },
        },
        "outline": [item.__dict__ for item in outline.sections],
        "draft": {
            "title": outline.title,
            "abstract": outline.abstract,
            "summary": summary,
            "highlights": highlights,
            "conclusion": conclusion,
        },
    }
    polished = explain_report(llm_input, request)
    section_summaries = polished.get("section_summaries") if isinstance(polished.get("section_summaries"), dict) else {}
    if section_summaries:
        sections = [
            section.model_copy(
                update={
                    "summary": str(section_summaries.get(section.id) or section.summary or "").strip() or section.summary
                }
            )
            for section in sections
        ]

    final_title = str(polished.get("title") or outline.title).strip()
    final_abstract = str(polished.get("abstract") or outline.abstract).strip()
    final_summary = [str(item).strip() for item in polished.get("summary") or summary if str(item).strip()]
    final_highlights = [str(item).strip() for item in polished.get("highlights") or highlights if str(item).strip()]
    final_conclusion = str(polished.get("conclusion") or conclusion).strip()

    if _is_sensitivity_report(request):
        ai_analysis = build_sensitivity_report_ai_sections(report_context)
    elif _is_optimization_report(request):
        ai_analysis = build_optimization_report_ai_sections(report_context)
    elif _is_hydraulic_report(request):
        ai_analysis = build_report_ai_sections(report_context)
    else:
        ai_analysis = DynamicReportAiAnalysis()

    ai_summary = ai_analysis.summary
    ai_highlights = ai_analysis.schemeExplain or ai_analysis.comparison or ai_analysis.metricAnalysis or ai_analysis.changeAnalysis
    ai_risks = ai_analysis.riskJudgement or ai_analysis.riskIdentify

    return DynamicReportResponse(
        title=final_title,
        abstract=final_abstract,
        source="hybrid" if polished else "rules",
        aiAnalysis=ai_analysis,
        summary=ai_summary if ai_summary else final_summary,
        highlights=ai_highlights if ai_highlights else final_highlights,
        risks=ai_risks if ai_risks else risks,
        suggestions=ai_analysis.suggestions if ai_analysis.suggestions else suggestions,
        conclusion=final_conclusion,
        sections=sections,
        metadata={
            "request": request.model_dump(),
            "range_label": range_label(request),
            "report_type_label": report_type_label(request),
            "output_style": output_style_key(request),
            "selected_project_count": len(data.projects),
            "pipeline_count": len(data.pipelines),
            "pump_station_count": len(data.pump_stations),
            "oil_property_count": len(data.oil_properties),
            "history_total_count": metrics.overview_metrics.get("history_total_count"),
            "confidence": diagnosis.confidence,
            "scope_rows": scope_rows,
            "outline": [item.__dict__ for item in outline.sections],
            "decision_summary": decision.summary,
        },
        raw_text=build_raw_text(outline, diagnosis, metrics, decision, sections),
    )
