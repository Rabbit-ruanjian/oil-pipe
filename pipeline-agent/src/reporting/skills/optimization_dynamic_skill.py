from __future__ import annotations

import json
from typing import Any

from langchain_openai import ChatOpenAI

from src.config import settings
from src.models.schemas import (
    DynamicReportAiAnalysis,
    OptimizationInsightBlock,
    OptimizationReportAiInsights,
    ReportRiskItem,
    ReportSuggestionItem,
)
from src.utils import logger


def _as_record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _pick_number(record: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        value = record.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str) and value.strip():
            try:
                return float(value)
            except ValueError:
                continue
    return None


def _pick_bool(record: dict[str, Any], *keys: str) -> bool | None:
    for key in keys:
        value = record.get(key)
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"true", "1", "yes", "y", "可行"}:
                return True
            if normalized in {"false", "0", "no", "n", "不可行"}:
                return False
    return None


def _pick_text(record: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _round_number(value: float | None, digits: int = 3) -> float | None:
    if value is None:
        return None
    return round(value, digits)


def _format_count(value: float | int | None) -> str:
    if value is None:
        return "-"
    numeric = float(value)
    if numeric.is_integer():
        return str(int(numeric))
    return str(round(numeric, 2))


def _format_metric(value: float | None, unit: str, digits: int = 3) -> str:
    if value is None:
        return "当前数据不足以支持进一步判断"
    rounded = round(value, digits)
    if float(rounded).is_integer():
        return f"{int(rounded)} {unit}".strip()
    return f"{rounded} {unit}".strip()


def _normalize_level(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"高", "high", "h", "high_risk", "严重"}:
        return "高"
    if normalized in {"低", "low", "l"}:
        return "低"
    return "中"


def _normalize_priority(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"high", "高", "p0", "p1"}:
        return "high"
    if normalized in {"low", "低", "p3"}:
        return "low"
    return "medium"


def _clean_lines(value: Any, limit: int = 4) -> list[str]:
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for row in value:
        text = str(row or "").strip()
        if text:
            items.append(text)
        if len(items) >= limit:
            break
    return items


def _extract_json_object(text: str) -> dict[str, Any]:
    cleaned = str(text or "").replace("```json", "").replace("```", "").strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        cleaned = cleaned[start : end + 1]
    parsed = json.loads(cleaned)
    return parsed if isinstance(parsed, dict) else {}


def _build_scheme_name(record: dict[str, Any]) -> str:
    explicit_name = _pick_text(record, "name", "schemeName", "combinationName", "label")
    if explicit_name:
        return explicit_name

    parts: list[str] = []
    pump_type_1 = _pick_text(record, "pump_type_1", "pumpType1")
    pump_count_1 = _pick_number(record, "pump_count_1", "pumpCount1")
    if pump_type_1 and pump_count_1 not in (None, 0):
        parts.append(f"{pump_type_1}{_format_count(pump_count_1)}台")

    pump_type_2 = _pick_text(record, "pump_type_2", "pumpType2")
    pump_count_2 = _pick_number(record, "pump_count_2", "pumpCount2")
    if pump_type_2 and pump_count_2 not in (None, 0):
        parts.append(f"{pump_type_2}{_format_count(pump_count_2)}台")

    if not parts:
        pump480_num = _pick_number(record, "pump480Num")
        if pump480_num not in (None, 0):
            parts.append(f"480泵{_format_count(pump480_num)}台")
        pump375_num = _pick_number(record, "pump375Num")
        if pump375_num not in (None, 0):
            parts.append(f"375泵{_format_count(pump375_num)}台")

    if parts:
        return " + ".join(parts)
    return _pick_text(record, "description", "recommendation", "remark")


def _extract_candidate_rows(output_payload: dict[str, Any]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    optimal_row = _as_record(output_payload.get("optimal_combination") or output_payload.get("optimalCombination"))
    if optimal_row:
        candidates.append(optimal_row)

    for key in ("all_combinations", "allCombinations", "allSchemes", "schemes"):
        items = output_payload.get(key)
        if isinstance(items, list):
            candidates.extend(item for item in items if isinstance(item, dict))
            break

    deduped: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    for row in candidates:
        identity = (
            _build_scheme_name(row),
            _pick_number(row, "total_head", "totalHead", "head"),
            _pick_number(row, "end_pressure", "endPressure", "endStationInPressure"),
            _pick_number(row, "power_consumption", "powerConsumption", "totalEnergyConsumption"),
            _pick_bool(row, "is_feasible", "isFeasible", "feasible"),
        )
        if identity in seen:
            continue
        seen.add(identity)
        deduped.append(row)
    return deduped


def _build_candidate_summary(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": _build_scheme_name(record),
        "totalHead": _round_number(_pick_number(record, "total_head", "totalHead", "head"), 3),
        "endPressure": _round_number(
            _pick_number(record, "end_pressure", "endPressure", "endStationInPressure", "endStationPressure"),
            3,
        ),
        "powerConsumption": _round_number(
            _pick_number(record, "power_consumption", "powerConsumption", "totalEnergyConsumption", "energyConsumption"),
            3,
        ),
        "totalCost": _round_number(_pick_number(record, "total_cost", "totalCost", "annualCost"), 3),
        "isFeasible": _pick_bool(record, "is_feasible", "isFeasible", "feasible"),
    }


def _coerce_scheme_counts(
    candidate_summaries: list[dict[str, Any]],
    recommended_count: int,
    fallback_count: int,
    rejected_count: int,
) -> tuple[int, int, int]:
    if candidate_summaries:
        evaluated_count = len(candidate_summaries)
        feasible_count = sum(1 for item in candidate_summaries if item.get("isFeasible") is True)
        infeasible_count = sum(1 for item in candidate_summaries if item.get("isFeasible") is False)
        return evaluated_count, feasible_count, infeasible_count

    evaluated_count = recommended_count + fallback_count + rejected_count
    feasible_count = recommended_count + fallback_count
    infeasible_count = rejected_count
    return evaluated_count, feasible_count, infeasible_count


def _build_fact_pack(ctx: dict[str, Any]) -> dict[str, Any]:
    snapshot = _as_record(ctx.get("optimization_snapshot"))
    input_payload = _as_record(snapshot.get("input"))
    output_payload = _as_record(snapshot.get("output"))
    params = _as_record(ctx.get("params"))
    decision = _as_record(ctx.get("decision"))
    diagnosis = _as_record(ctx.get("diagnosis"))
    risk_flags = [row for row in _as_list(ctx.get("risk_flags")) if isinstance(row, dict)]

    recommended_row = _as_record(output_payload.get("optimal_combination") or output_payload.get("optimalCombination"))
    recommended_name = _build_scheme_name(recommended_row) or _build_scheme_name(output_payload) or "当前数据不足以支持进一步判断"

    total_head = _pick_number(output_payload, "totalHead", "total_head")
    total_pressure_drop = _pick_number(output_payload, "totalPressureDrop", "pressureDrop", "total_pressure_drop")
    end_station_pressure = _pick_number(output_payload, "endStationInPressure", "terminalInPressure", "endPressure")
    total_energy_consumption = _pick_number(
        output_payload,
        "totalEnergyConsumption",
        "annualEnergyConsumption",
        "energyConsumption",
        "power_consumption",
    )
    total_cost = _pick_number(output_payload, "totalCost", "annualCost", "total_cost")
    feasible = _pick_bool(output_payload, "isFeasible", "feasible")
    recommendation_text = _pick_text(output_payload, "description", "recommendation", "remark")

    min_end_pressure = _pick_number(input_payload, "minEndPressure", "minPressure", "minimumPressure")
    pressure_margin = None
    if end_station_pressure is not None and min_end_pressure is not None:
        pressure_margin = end_station_pressure - min_end_pressure

    candidate_rows = _extract_candidate_rows(output_payload)
    candidate_summaries = [_build_candidate_summary(row) for row in candidate_rows[:6]]

    recommended_options = [row for row in _as_list(decision.get("recommended_options")) if isinstance(row, dict)]
    fallback_options = [row for row in _as_list(decision.get("fallback_options")) if isinstance(row, dict)]
    rejected_options = [row for row in _as_list(decision.get("rejected_options")) if isinstance(row, dict)]

    evaluated_count, feasible_count, infeasible_count = _coerce_scheme_counts(
        candidate_summaries,
        len(recommended_options),
        len(fallback_options),
        len(rejected_options),
    )

    return {
        "reportType": "optimization",
        "projectName": snapshot.get("projectName") or _as_record(ctx.get("report_meta")).get("project_name") or "-",
        "generatedAt": snapshot.get("generatedAt"),
        "currentCondition": {
            "targetFlow": _round_number(_pick_number(input_payload, "targetFlow", "flowRate"), 3),
            "density": _round_number(_pick_number(input_payload, "density"), 3),
            "diameter": _round_number(_pick_number(input_payload, "diameter"), 3),
            "inletPressure": _round_number(_pick_number(input_payload, "inletPressure"), 3),
            "minEndPressure": _round_number(min_end_pressure, 3),
            "optimizationGoal": params.get("optimizationGoal"),
        },
        "recommendedScheme": {
            "name": recommended_name,
            "totalHead": _round_number(total_head, 3),
            "totalPressureDrop": _round_number(total_pressure_drop, 3),
            "endStationInPressure": _round_number(end_station_pressure, 3),
            "totalEnergyConsumption": _round_number(total_energy_consumption, 3),
            "totalCost": _round_number(total_cost, 3),
            "feasible": feasible,
            "recommendationText": recommendation_text,
            "pressureMargin": _round_number(pressure_margin, 3),
        },
        "schemeOverview": {
            "evaluatedCount": evaluated_count,
            "feasibleCount": feasible_count,
            "infeasibleCount": infeasible_count,
        },
        "candidateSchemes": candidate_summaries,
        "riskItems": risk_flags[:4],
        "constraintChecks": [row for row in _as_list(diagnosis.get("constraints")) if isinstance(row, dict)][:4],
        "recommendationHints": [row for row in _as_list(diagnosis.get("recommendations")) if isinstance(row, dict)][:4],
        "decisionSummary": str(decision.get("summary") or "").strip(),
    }


def _build_fallback_summary(fact_pack: dict[str, Any]) -> list[str]:
    overview = _as_record(fact_pack.get("schemeOverview"))
    recommended = _as_record(fact_pack.get("recommendedScheme"))
    items = [
        f"本次共评估 {int(overview.get('evaluatedCount') or 0)} 种泵组组合，其中 {int(overview.get('feasibleCount') or 0)} 种满足当前运行约束。",
        f"推荐方案为“{recommended.get('name') or '当前数据不足以支持进一步判断'}”，当前判定为{'可行' if recommended.get('feasible') is True else '不可行' if recommended.get('feasible') is False else '当前数据不足以支持进一步判断'}。",
        f"推荐方案总扬程 {_format_metric(recommended.get('totalHead'), 'm')}，总压降 {_format_metric(recommended.get('totalPressureDrop'), 'm')}，末站进站压头 {_format_metric(recommended.get('endStationInPressure'), 'm')}。",
    ]
    if recommended.get("totalEnergyConsumption") is not None or recommended.get("totalCost") is not None:
        items.append(
            f"对应年能耗 {_format_metric(recommended.get('totalEnergyConsumption'), 'kWh')}，总成本 {_format_metric(recommended.get('totalCost'), '元')}。"
        )
    return items[:4]


def _build_fallback_scheme_explain(fact_pack: dict[str, Any]) -> list[str]:
    recommended = _as_record(fact_pack.get("recommendedScheme"))
    current_condition = _as_record(fact_pack.get("currentCondition"))
    name = str(recommended.get("name") or "当前方案").strip() or "当前方案"
    explanation = str(recommended.get("recommendationText") or "").strip()
    pressure_margin = recommended.get("pressureMargin")

    items = [
        f"当前推荐“{name}”作为优先运行方案，主要因为它在当前工况下同时覆盖了扬程需求和末站压力保障要求。",
    ]
    if explanation:
        items.append(f"结果说明显示：{explanation}")
    if pressure_margin is not None:
        if pressure_margin >= 0:
            items.append(
                f"按当前约束计算，末站进站压头相对最低要求形成了 {_format_metric(pressure_margin, 'm')} 的压力裕度，更有利于稳定运行。"
            )
        else:
            items.append(
                f"虽然当前结果给出了推荐组合，但末站进站压头相对最低要求仍存在 {_format_metric(abs(float(pressure_margin)), 'm')} 的缺口，需要结合现场工况复核。"
            )
    elif current_condition.get("minEndPressure") is not None and recommended.get("endStationInPressure") is not None:
        items.append(
            f"从末站进站压头 {_format_metric(recommended.get('endStationInPressure'), 'm')} 看，当前方案对末端压力约束具备一定支撑。"
        )
    if recommended.get("totalEnergyConsumption") is not None or recommended.get("totalCost") is not None:
        items.append("结合能耗与成本结果，该方案更偏向在运行可行性与经济性之间取得平衡。")
    return items[:4]


def _build_fallback_comparison(fact_pack: dict[str, Any]) -> list[str]:
    overview = _as_record(fact_pack.get("schemeOverview"))
    recommended = _as_record(fact_pack.get("recommendedScheme"))
    candidates = [row for row in _as_list(fact_pack.get("candidateSchemes")) if isinstance(row, dict)]
    recommended_name = str(recommended.get("name") or "").strip()
    alternative = next((row for row in candidates if str(row.get("name") or "").strip() and row.get("name") != recommended_name), None)

    items = [
        f"候选方案中共有 {int(overview.get('feasibleCount') or 0)} 种可行、{int(overview.get('infeasibleCount') or 0)} 种不可行，方案差异主要受当前运行约束影响。",
    ]

    if alternative:
        reasons: list[str] = []
        recommended_energy = recommended.get("totalEnergyConsumption")
        alternative_energy = alternative.get("powerConsumption")
        if isinstance(recommended_energy, (int, float)) and isinstance(alternative_energy, (int, float)) and recommended_energy < alternative_energy:
            reasons.append("能耗更低")

        recommended_cost = recommended.get("totalCost")
        alternative_cost = alternative.get("totalCost")
        if isinstance(recommended_cost, (int, float)) and isinstance(alternative_cost, (int, float)) and recommended_cost < alternative_cost:
            reasons.append("成本更优")

        recommended_pressure = recommended.get("endStationInPressure")
        alternative_pressure = alternative.get("endPressure")
        if isinstance(recommended_pressure, (int, float)) and isinstance(alternative_pressure, (int, float)) and recommended_pressure > alternative_pressure:
            reasons.append("末站压力保障更强")

        if reasons:
            items.append(f"与备选方案“{alternative.get('name')}”相比，推荐方案在{'、'.join(reasons)}方面表现更优。")
        else:
            items.append(f"与备选方案“{alternative.get('name')}”相比，推荐方案在可行性、压头保障和经济性之间更均衡。")
    else:
        items.append("当前输出未提供足够完整的候选方案明细，暂无法展开逐项排序对比。")

    if int(overview.get("infeasibleCount") or 0) > 0:
        items.append("未被采纳的方案通常意味着在当前约束下存在可行性不足、压头保障偏弱或运行经济性不佳的问题。")
    return items[:4]


def _build_fallback_optimization_insights(fact_pack: dict[str, Any]) -> OptimizationReportAiInsights:
    recommended = _as_record(fact_pack.get("recommendedScheme"))
    overview = _as_record(fact_pack.get("schemeOverview"))
    scheme_name = str(recommended.get("name") or "当前推荐方案").strip() or "当前推荐方案"
    feasible = recommended.get("feasible")
    total_head = recommended.get("totalHead")
    total_pressure_drop = recommended.get("totalPressureDrop")
    end_pressure = recommended.get("endStationInPressure")
    total_energy = recommended.get("totalEnergyConsumption")
    total_cost = recommended.get("totalCost")
    pressure_margin = recommended.get("pressureMargin")
    recommendation_text = str(recommended.get("recommendationText") or "").strip()
    evaluated_count = int(overview.get("evaluatedCount") or 0)
    feasible_count = int(overview.get("feasibleCount") or 0)

    scheme_parts = [f"当前推荐泵组为“{scheme_name}”，是本轮方案评估后优先保留的组合。"]
    if evaluated_count:
        scheme_parts.append(f"本轮共评估 {evaluated_count} 个方案，其中 {feasible_count} 个满足当前约束。")
    if recommendation_text:
        scheme_parts.append(f"推荐说明为：{recommendation_text}")
    else:
        scheme_parts.append("该组合被优先推荐，主要因为它在供压能力、运行稳定性和经济性之间更均衡。")

    feasibility_parts = [
        f"当前方案总扬程为 {_format_metric(total_head, 'm')}，总压降为 {_format_metric(total_pressure_drop, 'm')}，末站进站压头为 {_format_metric(end_pressure, 'm')}。"
    ]
    if feasible is False:
        feasibility_parts.append("结果显示该方案仍未完全满足当前工况约束，需要继续复核泵组组合与压力边界。")
    elif pressure_margin is not None:
        if float(pressure_margin) >= 0:
            feasibility_parts.append(f"末站压力相对最低要求形成了 {_format_metric(float(pressure_margin), 'm')} 的裕度，具备基本水力可行性。")
        else:
            feasibility_parts.append(f"末站压力相对最低要求仍存在 {_format_metric(abs(float(pressure_margin)), 'm')} 的缺口，水力可行性需要进一步校核。")
    else:
        feasibility_parts.append("从当前结果看，方案能够提供基本输送能力，但仍需结合现场工况持续校核。")

    economic_parts = [f"当前方案年能耗为 {_format_metric(total_energy, 'kWh')}，总成本为 {_format_metric(total_cost, '元')}。"]
    if isinstance(total_energy, (int, float)) and total_energy >= 1000000:
        economic_parts.append("年能耗水平偏高，后续应继续关注泵组效率与运行时长安排。")
    elif isinstance(total_cost, (int, float)) and total_cost >= 800000:
        economic_parts.append("总成本压力较大，说明当前方案虽然可用，但仍有进一步优化经济性的空间。")
    else:
        economic_parts.append("从当前结果看，该方案在满足运行要求的同时具备一定经济性。")

    return OptimizationReportAiInsights(
        schemeInsight=OptimizationInsightBlock(title="方案解读", content=" ".join(scheme_parts)),
        feasibilityInsight=OptimizationInsightBlock(title="水力可行性解读", content=" ".join(feasibility_parts)),
        economicInsight=OptimizationInsightBlock(title="经济性解读", content=" ".join(economic_parts)),
    )


def _build_fallback_risks(fact_pack: dict[str, Any]) -> list[ReportRiskItem]:
    risk_rows = [row for row in _as_list(fact_pack.get("riskItems")) if isinstance(row, dict)]
    if risk_rows:
        items: list[ReportRiskItem] = []
        for row in risk_rows[:4]:
            reason = str(row.get("message") or row.get("reason") or "").strip()
            if not reason:
                continue
            risk_type = str(row.get("riskCode") or row.get("riskType") or "optimization_risk").strip() or "optimization_risk"
            items.append(
                ReportRiskItem(
                    target=str(row.get("targetName") or row.get("target") or "当前方案").strip() or "当前方案",
                    riskType=risk_type,
                    level=_normalize_level(row.get("level")),
                    reason=reason,
                    suggestion=str(row.get("suggestion") or "建议结合当前工况与泵组组合复核。").strip() or "建议结合当前工况与泵组组合复核。",
                    code=str(row.get("riskCode") or risk_type).strip() or None,
                    message=str(row.get("message") or reason).strip() or None,
                )
            )
        if items:
            return items

    recommended = _as_record(fact_pack.get("recommendedScheme"))
    project_name = str(fact_pack.get("projectName") or "当前项目").strip() or "当前项目"
    items: list[ReportRiskItem] = []

    if recommended.get("feasible") is False:
        items.append(
            ReportRiskItem(
                target=project_name,
                riskType="scheme_feasibility",
                level="高",
                reason="当前推荐组合未完全满足运行约束，说明现有泵组配置仍存在可行性不足风险。",
                suggestion="建议优先复核末站压力约束、目标输量与泵组组合条件。",
                code="scheme_feasibility",
                message="当前推荐组合未完全满足运行约束。",
            )
        )

    pressure_margin = recommended.get("pressureMargin")
    end_station_pressure = recommended.get("endStationInPressure")
    if isinstance(pressure_margin, (int, float)) and pressure_margin < 0:
        items.append(
            ReportRiskItem(
                target=project_name,
                riskType="end_station_pressure_low",
                level="高",
                reason="末站进站压头低于当前最低要求，后续在工况波动下可能出现末端压力不足。",
                suggestion="建议复核扬程配置与泵组切换策略，优先补足末端压力裕度。",
                code="end_station_pressure_low",
                message="末站进站压头低于当前最低要求。",
            )
        )
    elif isinstance(end_station_pressure, (int, float)) and end_station_pressure < 10:
        items.append(
            ReportRiskItem(
                target=project_name,
                riskType="pressure_margin_limited",
                level="中",
                reason="末站进站压头偏低，当前方案对流量波动的缓冲空间有限。",
                suggestion="建议持续监测末站进站压头变化，必要时提前切换泵组组合。",
                code="pressure_margin_limited",
                message="末站进站压头偏低。",
            )
        )

    total_energy = recommended.get("totalEnergyConsumption")
    total_cost = recommended.get("totalCost")
    if isinstance(total_energy, (int, float)) and total_energy >= 1000000:
        items.append(
            ReportRiskItem(
                target=project_name,
                riskType="energy_cost_high",
                level="中",
                reason="当前推荐方案年能耗偏高，长期运行可能放大单位输量能耗压力。",
                suggestion="建议对比其他可行组合的能耗差异，并复核泵组效率表现。",
                code="energy_cost_high",
                message="当前推荐方案年能耗偏高。",
            )
        )
    elif isinstance(total_cost, (int, float)) and total_cost >= 800000:
        items.append(
            ReportRiskItem(
                target=project_name,
                riskType="economic_pressure",
                level="中",
                reason="当前总成本偏高，说明方案虽可能满足技术约束，但运行经济压力较大。",
                suggestion="建议结合不同组合的成本差异重新评估优先运行策略。",
                code="economic_pressure",
                message="当前总成本偏高。",
            )
        )

    return items[:4]


def _build_fallback_suggestions(fact_pack: dict[str, Any], risk_items: list[ReportRiskItem]) -> list[ReportSuggestionItem]:
    project_name = str(fact_pack.get("projectName") or "当前项目").strip() or "当前项目"
    suggestions: list[ReportSuggestionItem] = []

    for risk in risk_items[:4]:
        if risk.code == "end_station_pressure_low" or risk.code == "pressure_margin_limited":
            suggestions.append(
                ReportSuggestionItem(
                    target=risk.target,
                    reason=risk.reason,
                    action="优先复核末站压力约束与泵组切换策略，必要时提高当前方案的压力裕度。",
                    expected="降低末端压力不足风险并提升工况波动下的运行稳定性。",
                    priority="high",
                    text="优先复核末站压力约束与泵组切换策略。",
                )
            )
        elif risk.code == "energy_cost_high" or risk.code == "economic_pressure":
            suggestions.append(
                ReportSuggestionItem(
                    target=risk.target,
                    reason=risk.reason,
                    action="对比其他可行组合的能耗与成本结果，优先保留经济性更优的运行方案。",
                    expected="降低单位输量能耗并缓解长期运行成本压力。",
                    priority="medium",
                    text="对比其他可行组合的能耗与成本结果。",
                )
            )
        elif risk.code == "scheme_feasibility":
            suggestions.append(
                ReportSuggestionItem(
                    target=risk.target,
                    reason=risk.reason,
                    action="先复核约束条件与目标工况，再重新评估泵组组合和扬程配置。",
                    expected="缩小不可行方案范围，尽快形成可执行的推荐组合。",
                    priority="high",
                    text="先复核约束条件与目标工况。",
                )
            )

    if suggestions:
        return suggestions[:4]

    recommended = _as_record(fact_pack.get("recommendedScheme"))
    suggestions.append(
        ReportSuggestionItem(
            target=project_name,
            reason="当前推荐方案是基于现有工况返回的最优组合，需要结合现场波动持续校核。",
            action="建议优先采用当前推荐组合运行，并持续监测末站进站压头、总扬程和能耗变化。",
            expected="在保持方案可行性的同时及时识别后续工况偏移带来的风险。",
            priority="medium",
            text="优先采用当前推荐组合运行并持续监测关键指标。",
        )
    )

    if recommended.get("feasible") is True:
        suggestions.append(
            ReportSuggestionItem(
                target=project_name,
                reason="当前方案已经满足基本约束，但后续流量或油品条件变化仍可能影响最优组合。",
                action="当目标输量或边界条件变化时，重新对比候选泵组组合，避免扬程冗余或压力不足。",
                expected="保持运行组合与实际工况匹配，减少无效能耗。",
                priority="medium",
                text="工况变化时重新对比候选泵组组合。",
            )
        )

    return suggestions[:4]


def _build_fallback(ctx: dict[str, Any]) -> DynamicReportAiAnalysis:
    fact_pack = _build_fact_pack(ctx)
    risk_items = _build_fallback_risks(fact_pack)
    return DynamicReportAiAnalysis(
        summary=_build_fallback_summary(fact_pack),
        schemeExplain=_build_fallback_scheme_explain(fact_pack),
        comparison=_build_fallback_comparison(fact_pack),
        riskJudgement=risk_items,
        suggestions=_build_fallback_suggestions(fact_pack, risk_items),
        optimizationInsights=_build_fallback_optimization_insights(fact_pack),
    )


def _coerce_risks(value: Any, fallback: list[ReportRiskItem]) -> list[ReportRiskItem]:
    if not isinstance(value, list):
        return fallback

    items: list[ReportRiskItem] = []
    for row in value[:4]:
        if not isinstance(row, dict):
            continue
        target = str(row.get("target") or row.get("name") or row.get("targetName") or "-").strip() or "-"
        risk_type = str(row.get("riskType") or row.get("code") or row.get("type") or "optimization_risk").strip()
        reason = str(row.get("reason") or row.get("message") or "").strip()
        suggestion = str(row.get("suggestion") or row.get("action") or "建议结合当前工况进一步复核。").strip()
        if not reason:
            continue
        items.append(
            ReportRiskItem(
                target=target,
                riskType=risk_type or "optimization_risk",
                level=_normalize_level(row.get("level")),
                reason=reason,
                impact=str(row.get("impact") or "").strip() or None,
                suggestion=suggestion or "建议结合当前工况进一步复核。",
                code=str(row.get("code") or risk_type or "").strip() or None,
                message=str(row.get("message") or reason).strip() or None,
            )
        )

    return items or fallback


def _coerce_suggestions(value: Any, fallback: list[ReportSuggestionItem]) -> list[ReportSuggestionItem]:
    if not isinstance(value, list):
        return fallback

    items: list[ReportSuggestionItem] = []
    for row in value[:4]:
        if not isinstance(row, dict):
            continue
        target = str(row.get("target") or row.get("name") or "-").strip() or "-"
        reason = str(row.get("reason") or "").strip()
        action = str(row.get("action") or row.get("text") or "").strip()
        expected = str(row.get("expected") or "").strip()
        if not action:
            continue
        items.append(
            ReportSuggestionItem(
                target=target,
                reason=reason or "基于当前泵站优化结果与风险判断生成。",
                action=action,
                expected=expected or "用于降低当前工况下的运行不确定性。",
                priority=_normalize_priority(row.get("priority")),
                text=str(row.get("text") or action).strip() or None,
            )
        )

    return items or fallback


def build_optimization_report_ai_sections(ctx: dict[str, Any]) -> DynamicReportAiAnalysis:
    fallback = _build_fallback(ctx)
    fact_pack = _build_fact_pack(ctx)
    recommended_scheme = _as_record(fact_pack.get("recommendedScheme"))
    if not recommended_scheme:
        return fallback

    try:
        llm = ChatOpenAI(
            api_key=settings.OPENAI_API_KEY,
            base_url=settings.OPENAI_API_BASE,
            model=settings.LLM_MODEL,
            temperature=0.25,
            max_tokens=min(settings.LLM_MAX_TOKENS, 1500),
            streaming=False,
        )
        prompt = "\n".join(
            [
                "You are a senior pipeline pump-station optimization analyst.",
                "Write all narrative text in Simplified Chinese.",
                "Generate only the AI analysis blocks for a single-project optimization report page.",
                "Use only the supplied facts. Do not invent missing schemes, metrics, risks, conclusions or recommendations.",
                "Keep the output structure fixed, but make the content specific to the current optimization result.",
                "If candidate-scheme details are insufficient, state that directly instead of guessing.",
                "Return JSON only with this schema:",
                '{"summary":["..."],"optimizationInsights":{"schemeInsight":{"title":"方案解读","content":"..."},"feasibilityInsight":{"title":"水力可行性解读","content":"..."},"economicInsight":{"title":"经济性解读","content":"..."}},"riskJudgement":[{"target":"...","riskType":"...","level":"high|medium|low","reason":"...","impact":"...","suggestion":"..."}],"suggestions":[{"target":"...","reason":"...","action":"...","expected":"...","priority":"high|medium|low"}]}',
                "Rules:",
                "- summary: 2 to 4 concise bullets about evaluated scheme count, feasible count, recommended scheme and key metrics.",
                "- schemeInsight.content: explain why this pump-group combination is recommended under the current condition.",
                "- feasibilityInsight.content: explain why the scheme is hydraulically feasible or where the feasibility boundary still exists, focusing on total head, pressure drop and end-station pressure.",
                "- economicInsight.content: explain the scheme's energy and cost performance, and whether the current result is economically balanced.",
                "- riskJudgement: prioritize supplied rule risks, feasibility constraints, pressure risks, high energy cost or economic pressure; do not create more than 4 items.",
                "- Each riskJudgement item should include target, level, reason, impact and suggestion whenever evidence exists.",
                "- suggestions: give concrete operating checks or optimization actions that directly follow from the current risks and comparison; do not create more than 4 items.",
                "- If there is no clear risk, return empty arrays for riskJudgement and suggestions.",
                json.dumps({"facts": fact_pack}, ensure_ascii=False),
            ]
        )
        response = llm.invoke(prompt)
        parsed = _extract_json_object(getattr(response, "content", ""))
    except Exception as exc:  # noqa: BLE001
        logger.warning("Optimization dynamic AI analysis fell back to template output: %s", exc)
        return fallback

    summary = _clean_lines(parsed.get("summary"), 4) or fallback.summary
    scheme_explain = _clean_lines(parsed.get("schemeExplain"), 4) or fallback.schemeExplain
    comparison = _clean_lines(parsed.get("comparison"), 4) or fallback.comparison
    risk_judgement = _coerce_risks(parsed.get("riskJudgement"), fallback.riskJudgement)
    suggestions = _coerce_suggestions(parsed.get("suggestions"), fallback.suggestions)
    raw_optimization_insights = _as_record(parsed.get("optimizationInsights"))

    scheme_insight_raw = _as_record(raw_optimization_insights.get("schemeInsight") or parsed.get("schemeInsight"))
    feasibility_insight_raw = _as_record(
        raw_optimization_insights.get("feasibilityInsight") or parsed.get("feasibilityInsight")
    )
    economic_insight_raw = _as_record(raw_optimization_insights.get("economicInsight") or parsed.get("economicInsight"))

    fallback_optimization_insights = fallback.optimizationInsights or _build_fallback_optimization_insights(fact_pack)
    optimization_insights = OptimizationReportAiInsights(
        schemeInsight=OptimizationInsightBlock(
            title=str(scheme_insight_raw.get("title") or fallback_optimization_insights.schemeInsight.title),
            content=str(scheme_insight_raw.get("content") or fallback_optimization_insights.schemeInsight.content),
        ),
        feasibilityInsight=OptimizationInsightBlock(
            title=str(feasibility_insight_raw.get("title") or fallback_optimization_insights.feasibilityInsight.title),
            content=str(
                feasibility_insight_raw.get("content") or fallback_optimization_insights.feasibilityInsight.content
            ),
        ),
        economicInsight=OptimizationInsightBlock(
            title=str(economic_insight_raw.get("title") or fallback_optimization_insights.economicInsight.title),
            content=str(economic_insight_raw.get("content") or fallback_optimization_insights.economicInsight.content),
        ),
    )

    return DynamicReportAiAnalysis(
        summary=summary,
        schemeExplain=scheme_explain,
        comparison=comparison,
        riskJudgement=risk_judgement,
        suggestions=suggestions,
        optimizationInsights=optimization_insights,
    )


__all__ = ["build_optimization_report_ai_sections"]
