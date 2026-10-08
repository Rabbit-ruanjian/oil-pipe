from __future__ import annotations

from typing import Any

from .sensitivity_helpers import extract_sensitivity_insights, format_number, get_change_label


def trend_insight_skill(ctx: dict[str, Any]) -> str:
    insights = extract_sensitivity_insights(ctx)
    point_rows = insights.get("pointRows") or []
    if not insights or not point_rows:
        return ""

    top_variable_name = insights["topVariableName"]
    min_pressure_point = insights.get("minPressurePoint") or {}
    max_friction_point = insights.get("maxFrictionPoint") or {}

    sentences = [
        (
            f"随着 {top_variable_name} 在测试区间内变化，末站进站压力{insights['pressureTrendText']}，"
            f"摩阻损失{insights['frictionTrendText']}。"
        )
    ]

    if min_pressure_point:
        sentences.append(
            (
                f"其中末站进站压力最低出现在 {get_change_label(min_pressure_point)} 附近，"
                f"对应压力为 {format_number(min_pressure_point.get('endStationPressure'))}。"
            )
        )

    if max_friction_point:
        sentences.append(
            (
                f"摩阻损失峰值出现在 {get_change_label(max_friction_point)} 附近，"
                f"对应数值为 {format_number(max_friction_point.get('frictionHeadLoss'))}。"
            )
        )

    if insights["flowRegimeChanged"]:
        sentences.append("趋势中同时出现了流态切换，说明变化过程并非简单线性响应，应重点关注临界区间。")
    else:
        sentences.append("各变化比例下流态保持一致，说明当前测试区间内系统流动形态整体稳定。")

    return "".join(sentences)
