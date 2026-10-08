from __future__ import annotations

from typing import Any

from src.models.schemas import (
    DynamicReportRequest,
    DynamicReportSection,
    ReportBulletItem,
    ReportRiskItem,
    ReportSuggestionItem,
    ReportTableData,
)

from .labeling import analysis_object_label, optimization_goal_label, output_style_label, range_label
from .report_types import DecisionResult, DiagnosisResult, MetricSnapshot, OutlinePlan, ReportDataBundle


def _fmt_number(value: float | int | None, digits: int = 2, suffix: str = "") -> str:
    if value is None:
        return "-"
    if isinstance(value, int):
        return f"{value}{suffix}"
    return f"{value:.{digits}f}{suffix}"


def _extract_line(prefix: str, text: str | None) -> str | None:
    if not text:
        return None
    for line in text.splitlines():
        if line.startswith(prefix):
            return line.split("：", maxsplit=1)[-1].strip()
    return None


def _scope_rows(request: DynamicReportRequest, data: ReportDataBundle) -> list[list[str]]:
    projects = "、".join(str(item.get("name") or "-") for item in data.projects[:4]) if data.projects else "全部项目"
    if len(data.projects) > 4:
        projects = f"{projects} 等{len(data.projects)}个项目"
    pumps = "、".join(str(item.get("name") or "-") for item in data.pump_stations[:3]) if data.pump_stations else "全部泵站"
    if len(data.pump_stations) > 3:
        pumps = f"{pumps} 等{len(data.pump_stations)}座"
    oils = "、".join(str(item.get("name") or "-") for item in data.oil_properties[:2]) if data.oil_properties else "-"
    focuses = "、".join(request.focuses[:4]) if request.focuses else "-"

    data_source = _extract_line("数据来源", request.user_prompt) or "主数据 + 计算结果"
    external_enhance = _extract_line("外部知识增强", request.user_prompt) or "不启用"

    rows = [
        ["分析对象", analysis_object_label(request.analysis_object or "project")],
        ["时间范围", range_label(request)],
        ["项目范围", projects],
        ["管道范围", request.selected_pipeline_name or (str(data.pipelines[0].get("name")) if len(data.pipelines) == 1 else f"{len(data.pipelines)} 条")],
        ["泵站范围", pumps],
        ["油品", oils],
        ["分析重点", focuses],
        ["输出风格", output_style_label(request)],
        ["数据来源", data_source],
        ["外部知识增强", external_enhance],
    ]
    if request.target_throughput is not None:
        rows.append(["目标输量", f"{request.target_throughput:.2f} m3/h"])
    if request.min_pressure is not None:
        rows.append(["最低出口压力", f"{request.min_pressure:.2f} MPa"])
    if request.optimization_goal:
        rows.append(["优化目标", optimization_goal_label(request.optimization_goal)])
    rows.append(["泵站调整", "允许调整" if request.allow_pump_adjust else "禁止调整"])
    if request.remark:
        rows.append(["备注说明", request.remark.strip()])
    return rows


def build_sections(
    request: DynamicReportRequest,
    data: ReportDataBundle,
    metrics: MetricSnapshot,
    diagnosis: DiagnosisResult,
    decision: DecisionResult,
    outline: OutlinePlan,
) -> list[DynamicReportSection]:
    overview = metrics.overview_metrics
    section_map: dict[str, DynamicReportSection] = {}

    section_map["executive-summary"] = DynamicReportSection(
        id="executive-summary",
        kind="bullets",
        title="执行摘要",
        summary="先给出规模、核心发现与决策结论。",
        items=[
            ReportBulletItem(content=f"本次报告覆盖 {overview['project_count']} 个项目、{overview['pipeline_count']} 条管道、{overview['pump_station_count']} 座泵站。"),
            ReportBulletItem(content=f"历史计算总量 {overview['history_total_count']} 次，成功率 {_fmt_number(overview.get('success_rate'), digits=1, suffix='%')}。"),
            ReportBulletItem(content=f"规则诊断识别 {len(diagnosis.issues)} 条问题，约束冲突 {len(diagnosis.constraints)} 项。"),
            ReportBulletItem(content=decision.summary or "当前推荐基于主数据与计算结果生成。"),
        ],
    )

    section_map["data-quality"] = DynamicReportSection(
        id="data-quality",
        kind="bullets",
        title="数据质量与结论边界",
        summary="说明本次结论可支撑到什么程度。",
        items=[
            ReportBulletItem(content=f"主数据完整度：项目={metrics.data_quality.get('has_projects')}，管道={metrics.data_quality.get('has_pipelines')}，历史样本={metrics.data_quality.get('has_histories')}。"),
            ReportBulletItem(content="当前版本基于静态参数与计算结果，不等同于全量实时监测。"),
        ],
    )

    section_map["scope-context"] = DynamicReportSection(
        id="scope-context",
        kind="table",
        title="分析范围与约束条件",
        summary="结构化展示范围与约束，确保结论边界清晰。",
        table=ReportTableData(columns=["项目", "内容"], rows=_scope_rows(request, data)),
    )

    section_map["trend-analysis"] = DynamicReportSection(
        id="trend-analysis",
        kind="bullets",
        title="趋势分析",
        summary="趋势结论基于已有计算记录，样本不足时将不输出。",
        items=[
            ReportBulletItem(title=item.metric_label, content=f"{item.summary}；证据：{'；'.join(item.evidence)}")
            for item in diagnosis.trends
        ]
        or [ReportBulletItem(content="当前样本不足，未形成可靠趋势判断。")],
    )

    section_map["issue-diagnosis"] = DynamicReportSection(
        id="issue-diagnosis",
        kind="bullets",
        title="规则诊断结果",
        summary="基于主数据与计算结果的规则诊断。",
        items=[
            ReportBulletItem(
                title=f"{item.level.upper()} | {item.target}",
                content=f"{item.message}；证据：{item.evidence}",
            )
            for item in diagnosis.issues
        ]
        or [ReportBulletItem(content="当前未识别出明显的规则问题。")],
    )

    section_map["anomaly-analysis"] = DynamicReportSection(
        id="anomaly-analysis",
        kind="bullets",
        title="异常分析",
        summary="定位异常对象与异常指标。",
        items=[
            ReportBulletItem(
                title=f"{item.severity.upper()} | {item.target}",
                content=f"{item.summary}；证据：{'；'.join(item.evidence)}",
            )
            for item in diagnosis.anomalies
        ]
        or [ReportBulletItem(content="当前样本中未发现明显异常对象。")],
    )

    section_map["cause-analysis"] = DynamicReportSection(
        id="cause-analysis",
        kind="bullets",
        title="原因归因",
        summary="先做规则归因，再交由语言层解释。",
        items=[
            ReportBulletItem(
                title=f"{item.target} | 置信度 {item.confidence:.0%}",
                content=f"主因：{item.primary_cause}。次因：{'、'.join(item.secondary_causes) if item.secondary_causes else '无'}。证据：{'；'.join(item.evidence)}",
            )
            for item in diagnosis.causes
        ]
        or [ReportBulletItem(content="当前异常不足以形成稳定的原因链。")],
    )

    section_map["constraint-evaluation"] = DynamicReportSection(
        id="constraint-evaluation",
        kind="bullets",
        title="约束冲突与可行性评估",
        summary="评估目标输量、压力与运行限制是否冲突。",
        items=[
            ReportBulletItem(title=item.name, content=f"{item.summary}；证据：{'；'.join(item.evidence)}")
            for item in diagnosis.constraints
        ]
        or [ReportBulletItem(content="当前未识别出明显的目标与约束冲突。")],
    )

    decision_rows: list[list[str]] = []
    for item in decision.recommended_options:
        decision_rows.append(["推荐", item.name, f"{item.score:.1f}", "是", "；".join(item.reasons), "；".join(item.cons) or "-"])
    for item in decision.fallback_options:
        decision_rows.append(["备选", item.name, f"{item.score:.1f}", "是", "；".join(item.reasons), "；".join(item.cons) or "-"])
    for item in decision.rejected_options:
        decision_rows.append(["不推荐", item.name, f"{item.score:.1f}", "否", "；".join(item.reasons) or "-", "；".join(item.violations) or "-"])

    section_map["decision-recommendation"] = DynamicReportSection(
        id="decision-recommendation",
        kind="table",
        title="推荐方案与决策依据",
        summary=decision.summary or "根据评分与约束筛选输出推荐方案。",
        table=ReportTableData(
            columns=["类别", "对象/方案", "评分", "可行性", "主要依据", "不足"],
            rows=decision_rows or [["-", "暂无推荐", "-", "-", "-", "-"]],
        ),
    )

    object_rows: list[list[str]] = []
    for row in metrics.object_metrics.get("pump_stations", [])[:6]:
        object_rows.append(
            [
                row["name"],
                _fmt_number(row.get("pump_efficiency")),
                _fmt_number(row.get("electric_efficiency")),
                _fmt_number(row.get("displacement")),
                _fmt_number(row.get("come_power")),
            ]
        )
    section_map["object-snapshot"] = DynamicReportSection(
        id="object-snapshot",
        kind="table",
        title="对象画像",
        summary="展开对象级指标，支撑方案对比。",
        table=ReportTableData(
            columns=["对象", "泵效", "电机效率", "排量", "功率"],
            rows=object_rows,
        ),
    )

    section_map["risk-section"] = DynamicReportSection(
        id="risk-section",
        kind="bullets",
        title="主要风险",
        summary="风险由规则问题与约束冲突共同归纳。",
        items=[
            ReportBulletItem(
                title=f"{item['level']}风险 | {item['target']}",
                content=f"{item['reason']}；建议：{item['suggestion']}",
            )
            for item in diagnosis.risks
        ]
        or [ReportBulletItem(content="当前没有需要优先升级的高风险项。")],
    )

    section_map["action-plan"] = DynamicReportSection(
        id="action-plan",
        kind="bullets",
        title="优化建议",
        summary="建议需绑定对象、原因与预期收益。",
        items=[
            ReportBulletItem(
                title=f"{item.priority}优先级 | {item.target}",
                content=f"{item.reason}；动作：{item.action}；预期：{item.expected}",
            )
            for item in diagnosis.recommendations
        ]
        or [ReportBulletItem(content="当前没有足够证据输出明确动作建议。")],
    )

    section_map["conclusion"] = DynamicReportSection(
        id="conclusion",
        kind="callout",
        title="报告结论",
        content=(
            f"当前报告基于主数据、计算记录与规则诊断生成。"
            f"本次识别 {len(diagnosis.issues)} 条规则问题、{len(diagnosis.constraints)} 项约束校核结果，"
            f"推荐方案数量 {len(decision.recommended_options)}。"
        ),
    )

    return [section_map[item.id] for item in outline.sections if item.id in section_map]


def build_risk_items(diagnosis: DiagnosisResult) -> list[ReportRiskItem]:
    return [
        ReportRiskItem(
            target=item["target"],
            riskType=item["riskType"],
            level=item["level"],
            reason=item["reason"],
            suggestion=item["suggestion"],
        )
        for item in diagnosis.risks[:6]
    ]


def build_suggestion_items(diagnosis: DiagnosisResult) -> list[ReportSuggestionItem]:
    return [
        ReportSuggestionItem(
            target=item.target,
            reason=item.reason,
            action=item.action,
            expected=item.expected,
            priority=item.priority,
        )
        for item in diagnosis.recommendations[:6]
    ]


def build_highlights(diagnosis: DiagnosisResult, metrics: MetricSnapshot, decision: DecisionResult) -> list[str]:
    highlights = [
        f"历史计算成功率 {_fmt_number(metrics.overview_metrics.get('success_rate'), digits=1, suffix='%')}",
        f"平均泵效 {_fmt_number(metrics.overview_metrics.get('avg_pump_efficiency'))}",
    ]
    if decision.recommended_options:
        highlights.append(f"推荐方案：{decision.recommended_options[0].name}（评分 {decision.recommended_options[0].score:.1f}）")
    if diagnosis.issues:
        highlights.append(diagnosis.issues[0].message)
    return highlights[:6]


def build_summary(diagnosis: DiagnosisResult, metrics: MetricSnapshot, decision: DecisionResult) -> list[str]:
    overview = metrics.overview_metrics
    return [
        f"本次报告覆盖 {overview['project_count']} 个项目、{overview['pipeline_count']} 条管道、{overview['pump_station_count']} 座泵站。",
        f"历史样本共 {overview['history_total_count']} 次，成功 {overview['history_success_count']} 次，失败 {overview['history_failed_count']} 次。",
        f"已识别 {len(diagnosis.issues)} 条规则问题，约束校核 {len(diagnosis.constraints)} 项。",
        decision.summary or "当前推荐基于主数据与计算结果生成。",
    ]


def build_raw_text(
    outline: OutlinePlan,
    diagnosis: DiagnosisResult,
    metrics: MetricSnapshot,
    decision: DecisionResult,
    sections: list[DynamicReportSection],
) -> str:
    rows = [
        f"# {outline.title}",
        outline.abstract,
        "\n## 重点摘要",
        "\n".join(build_summary(diagnosis, metrics, decision)),
    ]
    for section in sections:
        rows.append(f"\n## {section.title}")
        if section.summary:
            rows.append(section.summary)
    return "\n".join(rows)
