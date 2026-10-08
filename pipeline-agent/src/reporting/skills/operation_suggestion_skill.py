from __future__ import annotations

from typing import Any

from src.models.schemas import ReportSuggestionItem

from .risk_identify_skill import risk_identify_skill
from .sensitivity_helpers import extract_sensitivity_insights


def _build_suggestion(
    *,
    target: str,
    priority: str,
    text: str,
    reason: str,
    expected: str,
) -> ReportSuggestionItem:
    return ReportSuggestionItem(
        target=target,
        priority=priority,
        reason=reason,
        action=text,
        text=text,
        expected=expected,
    )


def operation_suggestion_skill(ctx: dict[str, Any]) -> list[ReportSuggestionItem]:
    insights = extract_sensitivity_insights(ctx)
    risk_items = risk_identify_skill(ctx)
    suggestions: list[ReportSuggestionItem] = []

    for risk in risk_items:
        code = risk.code or risk.riskType
        target = risk.target or insights.get("projectName") or "当前对象"

        if code == "sensitivity_coefficient_high":
            suggestions.append(
                _build_suggestion(
                    target=target,
                    priority="high",
                    text=f"建议将 {target} 作为运行控制中的重点监测对象，并优先保证该变量稳定。",
                    reason="敏感系数偏高，系统对该变量变化的响应已经十分明显。",
                    expected="有助于降低结果波动并提高运行边界的稳定性。",
                )
            )
        elif code == "max_impact_high":
            suggestions.append(
                _build_suggestion(
                    target=target,
                    priority="high",
                    text="建议优先复核大幅波动区间的计算结果，并增加关键变量上下限校核。",
                    reason="最大影响幅度较大，系统结果在设定波动范围内变化明显。",
                    expected="有助于降低大幅偏移导致的运行风险。",
                )
            )
        elif code in {"end_station_pressure_low", "end_station_pressure_jump"}:
            suggestions.append(
                _build_suggestion(
                    target=target,
                    priority="high",
                    text="建议复核目标输量与泵站组合，必要时提升末站压力裕度。",
                    reason="末站压力已经接近或低于安全边界，需要优先校核压力保障能力。",
                    expected="有助于提升压力可行性并降低运行风险。",
                )
            )
        elif code in {"pump_efficiency", "pump_efficiency_low"}:
            suggestions.append(
                _build_suggestion(
                    target=target,
                    priority="high",
                    text="建议优先复核低效率泵组运行组合，并评估低负荷泵组停启策略。",
                    reason="泵效偏低会提高单位输量能耗，并削弱扬程利用效率。",
                    expected="有助于降低单位能耗并改善运行经济性。",
                )
            )
        elif code == "flow_regime_shift":
            suggestions.append(
                _build_suggestion(
                    target=target,
                    priority="medium",
                    text="建议补充流态临界区间校核，并评估波动工况下的调度保护策略。",
                    reason="流态发生切换，系统可能进入新的运行状态。",
                    expected="有助于避免运行波动触发不稳定流动特征。",
                )
            )
        elif code == "pipeline_resistance_high":
            suggestions.append(
                _build_suggestion(
                    target=target,
                    priority="medium",
                    text="建议复核粗糙度、流量设定及沿程摩阻参数，必要时重新评估运行方案。",
                    reason="摩阻损失随变量变化持续上升，输送阻力影响较强。",
                    expected="有助于改善输送稳定性并降低压损增长风险。",
                )
            )
        elif code == "sensitivity_coefficient_medium":
            suggestions.append(
                _build_suggestion(
                    target=target,
                    priority="medium",
                    text=f"建议持续跟踪 {target} 的波动范围，并结合典型工况复核控制阈值。",
                    reason="该变量已经对系统结果产生可感知影响。",
                    expected="有助于提前识别异常波动并降低后续放大风险。",
                )
            )
        elif code == "max_impact_medium":
            suggestions.append(
                _build_suggestion(
                    target=target,
                    priority="medium",
                    text="建议针对典型变化比例补充结果复核，确认系统对变量波动的容忍区间。",
                    reason="最大影响幅度已经达到中等水平。",
                    expected="有助于明确运行边界并提升调度可控性。",
                )
            )

    if not suggestions and insights:
        suggestions.append(
            _build_suggestion(
                target=insights["topVariableName"] or insights["projectName"],
                priority="medium",
                text=(
                    f"建议持续跟踪 {insights['topVariableName']} 在不同变化比例下对压力和摩阻损失的影响，"
                    "并结合实际工况复核控制策略。"
                ),
                reason="当前敏感性分析已识别关键变量，但尚未出现明确高风险告警。",
                expected="有助于维持系统运行边界稳定，避免关键变量波动放大。",
            )
        )

    deduplicated: list[ReportSuggestionItem] = []
    seen_keys: set[tuple[str, str]] = set()
    for item in suggestions:
        dedupe_key = (item.target, item.action)
        if dedupe_key in seen_keys:
            continue
        seen_keys.add(dedupe_key)
        deduplicated.append(item)

    return deduplicated[:6]
