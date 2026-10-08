from __future__ import annotations

from typing import Any

from .sensitivity_helpers import extract_sensitivity_insights, extract_sensitivity_risk_rules, format_number


def sensitivity_summary_skill(ctx: dict[str, Any]) -> list[str]:
    project = ctx.get("project", {}) if isinstance(ctx.get("project"), dict) else {}
    insights = extract_sensitivity_insights(ctx)
    risk_rules = extract_sensitivity_risk_rules(ctx)
    project_count = int(project.get("projectCount") or 0)

    if not insights:
        return []

    items = [
        (
            f"本次敏感性分析围绕 {insights['projectName']} 展开，敏感变量类型为 {insights['variableTypeText']}，"
            f"基准工况为 {insights['baseCondition']}，基准结果判定为 {insights['baseResultStatus']}。"
        ),
        (
            f"当前最敏感变量为 {insights['topVariableName']}，敏感系数为 {format_number(insights['sensitivityCoefficient'])}，"
            f"最大影响幅度为 {format_number(insights['maxImpactPercent'], suffix='%')}。"
        ),
        (
            f"系统整体风险等级评估为 {insights['riskLevel']}，"
            f"已识别 {len(risk_rules)} 条重点风险信息，涉及 {project_count or 1} 个项目样本。"
        ),
    ]

    return [item for item in items if item.strip()]
