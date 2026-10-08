from __future__ import annotations

from typing import Any

from .sensitivity_helpers import extract_sensitivity_insights, format_number, to_float


def ranking_insight_skill(ctx: dict[str, Any]) -> str:
    insights = extract_sensitivity_insights(ctx)
    ranking_rows = insights.get("rankingRows") or []
    if not insights or not ranking_rows:
        return ""

    top_name = insights["topVariableName"]
    top_rank = insights["topRankNumber"]
    top_coefficient = insights["sensitivityCoefficient"]
    second_row = ranking_rows[1] if len(ranking_rows) > 1 else None

    sentences = [
        (
            f"敏感系数排名显示，{top_name}位列第 {top_rank} 位，敏感系数为 {format_number(top_coefficient)}，"
            "是当前样本中最需要优先关注的变量。"
        )
    ]

    if second_row:
        second_name = str(second_row.get("variableName") or second_row.get("variableType") or "第二位变量")
        second_value = to_float(second_row.get("sensitivityCoefficient"))
        gap = None
        if top_coefficient is not None and second_value is not None:
            gap = top_coefficient - second_value
        if gap is not None and gap >= 0.2:
            sentences.append(
                f"它与第二位的 {second_name} 拉开了 {format_number(gap)} 的差值，头部影响较为集中。"
            )
        else:
            sentences.append(
                f"它与第二位的 {second_name} 差距不大，说明头部变量之间仍需联动关注。"
            )

    top_three = [
        str(item.get("variableName") or item.get("variableType") or "").strip()
        for item in ranking_rows[:3]
        if str(item.get("variableName") or item.get("variableType") or "").strip()
    ]
    if top_three:
        sentences.append(f"当前排名前列的变量为 {'、'.join(top_three)}。")

    return "".join(sentences)
