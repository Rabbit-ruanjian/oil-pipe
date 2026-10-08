from __future__ import annotations

from src.models.schemas import DynamicReportRequest

from .labeling import output_style_key, output_style_label, report_type_label, style_title
from .report_types import DecisionResult, DiagnosisResult, MetricSnapshot, OutlinePlan, OutlineSection


def plan_outline(
    request: DynamicReportRequest,
    metrics: MetricSnapshot,
    diagnosis: DiagnosisResult,
    decision: DecisionResult,
    title_prefix: str,
) -> OutlinePlan:
    sections: list[OutlineSection] = [
        OutlineSection("executive-summary", "执行摘要", "bullets", "所有报告都需要先说明范围、结论与重点。", 1),
    ]

    if not metrics.data_quality.get("has_histories") or not metrics.data_quality.get("has_pipelines"):
        sections.append(
            OutlineSection("data-quality", "数据质量与结论边界", "bullets", "主数据或历史样本不足时需说明结论边界。", 2)
        )

    sections.append(
        OutlineSection("scope-context", "分析范围与约束条件", "table", "明确分析对象、范围与约束口径。", 3)
    )

    if diagnosis.trends and metrics.data_quality.get("usable_for_trend"):
        sections.append(OutlineSection("trend-analysis", "趋势分析", "bullets", "样本满足趋势分析条件。", 4))

    if diagnosis.issues:
        sections.append(OutlineSection("issue-diagnosis", "规则诊断结果", "bullets", "展示基于主数据与计算结果的规则诊断。", 5))

    if diagnosis.anomalies:
        sections.append(OutlineSection("anomaly-analysis", "异常分析", "bullets", "存在异常对象或异常指标。", 6))

    if diagnosis.causes:
        sections.append(OutlineSection("cause-analysis", "原因归因", "bullets", "异常已形成可解释的原因链。", 7))

    if diagnosis.constraints:
        sections.append(
            OutlineSection("constraint-evaluation", "约束冲突与可行性评估", "bullets", "目标与约束存在校核结果。", 8)
        )

    if decision.recommended_options or decision.fallback_options:
        sections.append(
            OutlineSection("decision-recommendation", "推荐方案与决策依据", "table", "基于评分与约束筛选输出推荐结果。", 9)
        )

    sections.append(OutlineSection("object-snapshot", "对象画像", "table", "展示关键对象的指标画像。", 10))

    if request.include_risk and diagnosis.risks:
        sections.append(OutlineSection("risk-section", "主要风险", "bullets", "将诊断结果转换为风险视角。", 11))

    if request.include_suggestions and diagnosis.recommendations:
        sections.append(OutlineSection("action-plan", "优化建议", "bullets", "将诊断结论转为可执行动作。", 12))

    if request.include_conclusion:
        sections.append(OutlineSection("conclusion", "报告结论", "callout", "输出最终结论与后续建议。", 13))

    style_key = output_style_key(request)
    if style_key == "simple":
        allowed = {
            "executive-summary",
            "issue-diagnosis",
            "constraint-evaluation",
            "decision-recommendation",
            "action-plan",
            "conclusion",
        }
        sections = [item for item in sections if item.id in allowed]
    elif style_key == "presentation":
        ordered = [
            "executive-summary",
            "issue-diagnosis",
            "decision-recommendation",
            "risk-section",
            "action-plan",
            "conclusion",
        ]
        mapping = {item.id: item for item in sections}
        sections = [mapping[item_id] for item_id in ordered if item_id in mapping]

    report_name = style_title(f"{title_prefix} {report_type_label(request)}", request)
    abstract = f"报告按{output_style_label(request)}生成，基于主数据、计算结果与规则诊断输出推荐与建议。"
    return OutlinePlan(title=report_name, abstract=abstract, sections=sections)
