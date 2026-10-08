from __future__ import annotations

from typing import Any

from .sensitivity_helpers import extract_sensitivity_insights, format_number, to_float


def impact_insight_skill(ctx: dict[str, Any]) -> str:
    insights = extract_sensitivity_insights(ctx)
    impact_rows = insights.get("impactRows") or []
    if not insights or not impact_rows:
        return ""

    top_row = impact_rows[0]
    top_name = str(top_row.get("variableName") or top_row.get("variableType") or insights["topVariableName"])
    top_impact = to_float(top_row.get("maxImpactPercent"))
    second_row = impact_rows[1] if len(impact_rows) > 1 else None

    sentences = [
        f"最大影响幅度图显示，{top_name} 对结果的放大效应最明显，最大影响幅度达到 {format_number(top_impact, suffix='%')}。"
    ]

    if second_row:
        second_name = str(second_row.get("variableName") or second_row.get("variableType") or "第二位变量")
        second_impact = to_float(second_row.get("maxImpactPercent"))
        gap = None
        if top_impact is not None and second_impact is not None:
            gap = top_impact - second_impact
        if gap is not None and gap >= 5:
            sentences.append(f"它与第二位的 {second_name} 拉开了 {format_number(gap, suffix='%')} 的影响差距。")
        else:
            sentences.append(f"它与第二位的 {second_name} 影响幅度接近，说明结果对多项变量都较为敏感。")

    sentences.append(f"结合当前样本，系统对 {top_name} 的结果响应属于{insights['impactLevel']}影响。")
    return "".join(sentences)
