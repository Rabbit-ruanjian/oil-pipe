from __future__ import annotations

from typing import Any

from .sensitivity_helpers import extract_sensitivity_insights, get_row_span_text, to_float


def interval_conclusion_skill(ctx: dict[str, Any]) -> str:
    insights = extract_sensitivity_insights(ctx)
    point_rows = insights.get("pointRows") or []
    if not insights or not point_rows:
        return ""

    negative_rows = [row for row in point_rows if (to_float(row.get("changePercent")) or 0) < 0]
    positive_rows = [row for row in point_rows if (to_float(row.get("changePercent")) or 0) > 0]

    sentences: list[str] = []

    if negative_rows:
        sentences.append(
            (
                f"在负向变化区间内，末站进站压力大致位于 {get_row_span_text(negative_rows, 'endStationPressure')}，"
                f"摩阻损失位于 {get_row_span_text(negative_rows, 'frictionHeadLoss')}。"
            )
        )

    if positive_rows:
        sentences.append(
            (
                f"在正向变化区间内，末站进站压力大致位于 {get_row_span_text(positive_rows, 'endStationPressure')}，"
                f"摩阻损失位于 {get_row_span_text(positive_rows, 'frictionHeadLoss')}。"
            )
        )

    if insights["flowRegimeChanged"] and insights.get("flowRegimeSegments"):
        sentences.append(f"流态分布显示：{'；'.join(insights['flowRegimeSegments'])}，临界切换区间应作为重点复核对象。")
    else:
        regime = str(point_rows[0].get("flowRegime") or "").strip() or "-"
        sentences.append(f"各变化比例下流态均保持为 {regime}，当前区间内流态未出现明显切换。")

    if insights["minEndStationPressure"] is not None and insights["minEndStationPressure"] < 0:
        sentences.append("表格结果已出现末站压力为负的情形，说明部分变化区间存在明显运行边界风险。")
    else:
        sentences.append("从区间表格看，当前测试范围内尚未触发明显的末站压力失稳边界。")

    return "".join(sentences)
