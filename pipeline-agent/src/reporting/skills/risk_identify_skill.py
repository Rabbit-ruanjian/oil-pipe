from __future__ import annotations

from typing import Any

from src.models.schemas import ReportRiskItem

from .sensitivity_helpers import extract_sensitivity_insights, extract_sensitivity_risk_rules, format_number


def _build_risk_item(
    *,
    target: str,
    code: str,
    level: str,
    message: str,
    impact: str,
    suggestion: str,
) -> ReportRiskItem:
    return ReportRiskItem(
        target=target,
        riskType=code,
        level=level,
        reason=message,
        impact=impact,
        suggestion=suggestion,
        code=code,
        message=message,
    )


def _normalize_level(level: str) -> str:
    normalized = str(level or "").strip().lower()
    if normalized in {"high", "高"}:
        return "高"
    if normalized in {"low", "低"}:
        return "低"
    return "中"


def _build_rule_impact(code: str, insights: dict[str, Any], fallback_message: str) -> str:
    mapping = {
        "sensitivity_coefficient_high": "会放大结果波动，并提高关键指标对单一变量偏移的响应强度。",
        "sensitivity_coefficient_medium": "会持续影响结果稳定性，需要在运行窗口内保持跟踪。",
        "max_impact_high": "会使结果在局部区间内出现较大偏移，压缩安全裕度。",
        "max_impact_medium": "会使结果对变量波动更敏感，调度容错空间被进一步压缩。",
        "end_station_pressure_low": "会直接削弱末站压力保障能力，影响运行可行性判断。",
        "flow_regime_shift": "会改变流动状态判定，导致趋势解读和运行边界同时变化。",
        "pipeline_resistance_high": "会抬升沿程压损，并在高负荷区间进一步压缩末站压力裕度。",
        "pump_efficiency": "会抬高单位输量能耗，并削弱有效扬程利用率。",
        "pump_efficiency_low": "会抬高单位输量能耗，并削弱有效扬程利用率。",
    }
    if code in mapping:
        return mapping[code]
    if insights.get("topVariableName"):
        return f"会影响 {insights['topVariableName']} 相关结果的稳定性，并放大关键指标波动。"
    return fallback_message or "会对结果稳定性和运行边界判断带来额外扰动。"


def risk_identify_skill(ctx: dict[str, Any]) -> list[ReportRiskItem]:
    insights = extract_sensitivity_insights(ctx)
    items: list[ReportRiskItem] = []
    risk_rules = extract_sensitivity_risk_rules(ctx)

    if risk_rules:
        default_target = ""
        if insights:
            default_target = insights["topVariableName"] or insights["projectName"]
        for row in risk_rules[:6]:
            code = str(row.get("riskCode") or "unknown")
            message = str(row.get("message") or "当前结果已识别出需要重点复核的风险信号。")
            items.append(
                _build_risk_item(
                    target=str(row.get("targetName") or default_target or "-"),
                    code=code,
                    level=_normalize_level(str(row.get("level") or "")),
                    message=message,
                    impact=str(row.get("impact") or _build_rule_impact(code, insights, message)),
                    suggestion=str(row.get("suggestion") or "建议结合更多运行记录复核当前对象。"),
                )
            )

    if not items and insights:
        target_name = insights["topVariableName"] or insights["projectName"]
        sensitivity_coefficient = insights["sensitivityCoefficient"]
        max_impact_percent = insights["maxImpactPercent"]
        min_end_station_pressure = insights["minEndStationPressure"]

        if sensitivity_coefficient is not None and sensitivity_coefficient >= 0.8:
            items.append(
                _build_risk_item(
                    target=target_name,
                    code="sensitivity_coefficient_high",
                    level="高",
                    message=(
                        f"{target_name} 的敏感系数达到 {format_number(sensitivity_coefficient)}，"
                        "说明系统对该变量偏移的响应已经非常明显。"
                    ),
                    impact="会放大关键结果波动，并使局部工况下的运行边界更早暴露。",
                    suggestion="建议将该变量纳入重点监测清单，并优先校核关键工况切换时的运行边界。",
                )
            )
        elif sensitivity_coefficient is not None and sensitivity_coefficient >= 0.4:
            items.append(
                _build_risk_item(
                    target=target_name,
                    code="sensitivity_coefficient_medium",
                    level="中",
                    message=(
                        f"{target_name} 的敏感系数为 {format_number(sensitivity_coefficient)}，"
                        "已经对结果形成可感知影响。"
                    ),
                    impact="会持续影响结果稳定性，并缩小调度参数的安全余量。",
                    suggestion="建议在日常调度中持续跟踪该变量，并结合运行窗口校核控制阈值。",
                )
            )

        if max_impact_percent is not None and max_impact_percent >= 20:
            items.append(
                _build_risk_item(
                    target=target_name,
                    code="max_impact_high",
                    level="高",
                    message=(
                        f"最大影响幅度达到 {format_number(max_impact_percent, suffix='%')}，"
                        "说明系统结果在设定波动范围内已经出现明显偏移。"
                    ),
                    impact="会压缩运行安全裕度，并提高结果偏离基准工况的概率。",
                    suggestion="建议优先复核大幅波动区间的结果，并增加关键变量上下限校核。",
                )
            )
        elif max_impact_percent is not None and max_impact_percent >= 10:
            items.append(
                _build_risk_item(
                    target=target_name,
                    code="max_impact_medium",
                    level="中",
                    message=(
                        f"最大影响幅度达到 {format_number(max_impact_percent, suffix='%')}，"
                        "说明结果对该变量波动较为敏感。"
                    ),
                    impact="会使结果对参数扰动更敏感，降低运行窗口的容错空间。",
                    suggestion="建议结合典型工况复核该变量波动时的结果变化幅度。",
                )
            )

        if min_end_station_pressure is not None and min_end_station_pressure < 0:
            items.append(
                _build_risk_item(
                    target=insights["projectName"],
                    code="end_station_pressure_low",
                    level="高",
                    message="部分变化比例下末站进站压力低于 0，说明系统压力稳定性已经触及明显风险边界。",
                    impact="会直接削弱末站压力保障能力，并影响当前工况的可行性判断。",
                    suggestion="建议优先校核末站压力裕度，并复核目标输量与泵站组合。",
                )
            )

        if insights["flowRegimeChanged"]:
            items.append(
                _build_risk_item(
                    target=insights["projectName"],
                    code="flow_regime_shift",
                    level="中",
                    message="不同变化比例下流态发生切换，说明变量波动已经改变系统流动特征。",
                    impact="会改变趋势解读前提，并提高局部区间的运行不确定性。",
                    suggestion="建议补充流态临界区间校核，避免系统在波动中进入不稳定状态。",
                )
            )

        if insights["frictionTrendText"] == "整体上升":
            items.append(
                _build_risk_item(
                    target=insights["projectName"],
                    code="pipeline_resistance_high",
                    level="中",
                    message="摩阻损失随变量变化呈上升趋势，说明输送阻力对结果的抬升作用较强。",
                    impact="会提高沿程压损，并在高负荷区间进一步压缩末站压力裕度。",
                    suggestion="建议复核粗糙度、流量设定及沿程摩阻参数，必要时重新评估运行方案。",
                )
            )

    deduplicated: list[ReportRiskItem] = []
    seen_keys: set[tuple[str, str]] = set()
    for item in items:
        dedupe_key = (item.target, item.code or item.riskType)
        if dedupe_key in seen_keys:
            continue
        seen_keys.add(dedupe_key)
        deduplicated.append(item)

    return deduplicated[:6]
