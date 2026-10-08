from __future__ import annotations

from typing import Any


def as_record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def as_record_array(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def to_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            return float(value)
        except ValueError:
            return None
    return None


def format_number(value: Any, digits: int = 2, suffix: str = "") -> str:
    numeric = to_float(value)
    if numeric is None:
        return "-"
    text = f"{numeric:.{digits}f}".rstrip("0").rstrip(".")
    return f"{text}{suffix}"


def format_signed_percent(value: Any, digits: int = 0) -> str:
    numeric = to_float(value)
    if numeric is None:
        return "-"
    sign = "+" if numeric > 0 else ""
    text = f"{numeric:.{digits}f}".rstrip("0").rstrip(".")
    return f"{sign}{text}%"


def pick_first_value(sources: list[dict[str, Any] | None], keys: list[str]) -> Any:
    for source in sources:
        if not isinstance(source, dict):
            continue
        for key in keys:
            value = source.get(key)
            if value is not None and str(value).strip() != "":
                return value
    return None


def classify_sensitivity_impact_level(value: float | None) -> str:
    if value is None:
        return "数据不足"
    if value >= 0.8:
        return "较强"
    if value >= 0.4:
        return "中等"
    return "较弱"


def evaluate_sensitivity_risk_level(
    sensitivity_coefficient: float | None,
    max_impact_percent: float | None,
    min_end_station_pressure: float | None,
    flow_regime_changed: bool,
) -> str:
    if (
        (sensitivity_coefficient is not None and sensitivity_coefficient >= 0.8)
        or (max_impact_percent is not None and max_impact_percent >= 20)
        or (min_end_station_pressure is not None and min_end_station_pressure < 0)
        or flow_regime_changed
    ):
        return "高风险"
    if (
        (sensitivity_coefficient is not None and sensitivity_coefficient >= 0.4)
        or (max_impact_percent is not None and max_impact_percent >= 10)
    ):
        return "中风险"
    return "可控"


def build_sensitivity_base_condition(input_payload: dict[str, Any], input_base: dict[str, Any] | None) -> str:
    sources = [input_base, input_payload]
    parts: list[str] = []

    flow_rate = pick_first_value(sources, ["flowRate", "throughput", "flow"])
    density = pick_first_value(sources, ["density"])
    diameter = pick_first_value(sources, ["diameter"])

    if to_float(flow_rate) is not None:
        parts.append(f"流量 {format_number(flow_rate)} m³/h")
    if to_float(density) is not None:
        parts.append(f"密度 {format_number(density)} kg/m³")
    if to_float(diameter) is not None:
        parts.append(f"管径 {format_number(diameter)} mm")

    return "，".join(parts) if parts else "当前数据不足以支持进一步判断"


def build_sensitive_variable_display(input_payload: dict[str, Any], input_base: dict[str, Any] | None) -> str:
    direct_value = pick_first_value(
        [input_payload, input_base],
        ["sensitiveVariableType", "sensitivityVariableType", "variableType"],
    )
    if direct_value is not None and str(direct_value).strip():
        return str(direct_value).strip()

    variables = as_record_array(input_payload.get("variables"))
    names = [
        str(item.get("variableName") or item.get("variableType") or "").strip()
        for item in variables
        if str(item.get("variableName") or item.get("variableType") or "").strip()
    ]
    return "、".join(names) if names else "-"


def sort_sensitivity_ranking_rows(output_payload: dict[str, Any]) -> list[dict[str, Any]]:
    rows = as_record_array(output_payload.get("sensitivityRanking"))

    def _sort_key(item: dict[str, Any]) -> tuple[float, float]:
        rank_value = to_float(item.get("rank"))
        score_value = to_float(item.get("sensitivityCoefficient"))
        if rank_value is not None:
            return (0.0, rank_value)
        return (1.0, -(score_value if score_value is not None else float("-inf")))

    return sorted(rows, key=_sort_key)


def sort_sensitivity_impact_rows(output_payload: dict[str, Any]) -> list[dict[str, Any]]:
    return sorted(
        as_record_array(output_payload.get("variableResults")),
        key=lambda item: -(to_float(item.get("maxImpactPercent")) or float("-inf")),
    )


def get_sensitivity_primary_variable_result(output_payload: dict[str, Any]) -> dict[str, Any]:
    variable_results = as_record_array(output_payload.get("variableResults"))
    if not variable_results:
        return {}

    ranking_rows = sort_sensitivity_ranking_rows(output_payload)
    top_rank = ranking_rows[0] if ranking_rows else {}
    top_variable_type = str(top_rank.get("variableType") or "").strip()
    if top_variable_type:
        for item in variable_results:
            if str(item.get("variableType") or "").strip() == top_variable_type:
                return item
    return variable_results[0]


def normalize_sensitivity_risk_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for row in rows:
        risk_code = str(
            pick_first_value([row], ["code", "riskCode", "riskType", "issueType", "metric"]) or "unknown"
        ).strip()
        target_name = str(
            pick_first_value([row], ["targetName", "target", "variableName", "variableType"]) or ""
        ).strip()
        level = str(pick_first_value([row], ["level", "riskLevel", "severity"]) or "").strip()
        message = str(
            pick_first_value([row], ["message", "reason", "description", "text", "title"]) or ""
        ).strip()
        suggestion = str(pick_first_value([row], ["suggestion", "action", "advice"]) or "").strip()
        impact = str(pick_first_value([row], ["impact", "effect", "resultImpact"]) or "").strip()
        if not risk_code and not message:
            continue
        normalized.append(
            {
                "targetName": target_name,
                "riskCode": risk_code or "unknown",
                "level": level,
                "message": message,
                "suggestion": suggestion,
                "impact": impact,
            }
        )
    return normalized


def extract_sensitivity_risk_rules(ctx: dict[str, Any]) -> list[dict[str, Any]]:
    snapshot = as_record(ctx.get("sensitivity_snapshot"))
    output_payload = as_record(snapshot.get("output"))

    for key in ("riskRules", "riskIdentify", "riskItems", "risks"):
        rows = normalize_sensitivity_risk_rows(as_record_array(output_payload.get(key)))
        if rows:
            return rows

    return normalize_sensitivity_risk_rows(as_record_array(ctx.get("risk_flags")))


def resolve_trend_label(first_value: float | None, last_value: float | None) -> str:
    if first_value is None or last_value is None:
        return "数据不足"
    if last_value > first_value:
        return "整体上升"
    if last_value < first_value:
        return "整体下降"
    return "变化不明显"


def get_change_label(row: dict[str, Any]) -> str:
    return format_signed_percent(row.get("changePercent"))


def get_row_span_text(rows: list[dict[str, Any]], key: str, suffix: str = "") -> str:
    values = [to_float(item.get(key)) for item in rows]
    valid_values = [value for value in values if value is not None]
    if not valid_values:
        return "-"
    minimum = min(valid_values)
    maximum = max(valid_values)
    if minimum == maximum:
        return format_number(minimum, suffix=suffix)
    return f"{format_number(minimum, suffix=suffix)} ~ {format_number(maximum, suffix=suffix)}"


def build_regime_segments(rows: list[dict[str, Any]]) -> list[str]:
    if not rows:
        return []

    segments: list[str] = []
    current_regime = str(rows[0].get("flowRegime") or "").strip() or "-"
    start_label = get_change_label(rows[0])
    end_label = start_label

    for row in rows[1:]:
        regime = str(row.get("flowRegime") or "").strip() or "-"
        label = get_change_label(row)
        if regime == current_regime:
            end_label = label
            continue
        segments.append(f"{start_label} 至 {end_label} 为 {current_regime}")
        current_regime = regime
        start_label = label
        end_label = label

    segments.append(f"{start_label} 至 {end_label} 为 {current_regime}")
    return segments


def pick_extreme_point(
    rows: list[dict[str, Any]],
    key: str,
    mode: str,
) -> dict[str, Any]:
    valid_rows = [row for row in rows if to_float(row.get(key)) is not None]
    if not valid_rows:
        return {}
    if mode == "max":
        return max(valid_rows, key=lambda item: to_float(item.get(key)) or float("-inf"))
    return min(valid_rows, key=lambda item: to_float(item.get(key)) or float("inf"))


def extract_sensitivity_insights(ctx: dict[str, Any]) -> dict[str, Any]:
    snapshot = as_record(ctx.get("sensitivity_snapshot"))
    input_payload = as_record(snapshot.get("input"))
    output_payload = as_record(snapshot.get("output"))
    if not input_payload or not output_payload:
        return {}

    input_base = as_record(input_payload.get("baseParams"))
    base_result = as_record(output_payload.get("baseResult")) or output_payload
    variable_results = as_record_array(output_payload.get("variableResults"))
    ranking_rows = sort_sensitivity_ranking_rows(output_payload)
    impact_rows = sort_sensitivity_impact_rows(output_payload)
    primary_variable_result = get_sensitivity_primary_variable_result(output_payload)
    top_rank = ranking_rows[0] if ranking_rows else {}

    top_variable_name = str(
        top_rank.get("variableName")
        or primary_variable_result.get("variableName")
        or primary_variable_result.get("variableType")
        or build_sensitive_variable_display(input_payload, input_base)
    ).strip() or "-"
    top_rank_number = int(to_float(top_rank.get("rank")) or 1)
    sensitivity_coefficient = to_float(
        top_rank.get("sensitivityCoefficient") or primary_variable_result.get("sensitivityCoefficient")
    )

    max_impact_percent = to_float(primary_variable_result.get("maxImpactPercent"))
    if max_impact_percent is None:
        impact_values = [to_float(item.get("maxImpactPercent")) for item in variable_results]
        valid_impacts = [value for value in impact_values if value is not None]
        max_impact_percent = max(valid_impacts) if valid_impacts else None

    point_rows = sorted(
        as_record_array(primary_variable_result.get("dataPoints")),
        key=lambda item: to_float(item.get("changePercent")) or 0.0,
    )
    first_point = point_rows[0] if point_rows else {}
    last_point = point_rows[-1] if point_rows else {}
    flow_regimes = {
        str(item.get("flowRegime") or "").strip()
        for item in point_rows
        if str(item.get("flowRegime") or "").strip()
    }
    flow_regime_changed = len(flow_regimes) > 1

    end_station_pressures = [to_float(item.get("endStationPressure")) for item in point_rows]
    valid_pressures = [value for value in end_station_pressures if value is not None]
    min_end_station_pressure = min(valid_pressures) if valid_pressures else None

    base_end_station_pressure = to_float(
        pick_first_value([base_result], ["endStationInPressure", "endStationPressure", "terminalInPressure"])
    )
    if base_end_station_pressure is None:
        base_result_status = "数据不足"
    elif base_end_station_pressure >= 0:
        base_result_status = "正常"
    else:
        base_result_status = "存在压力风险"

    pressure_trend_text = resolve_trend_label(
        to_float(first_point.get("endStationPressure")),
        to_float(last_point.get("endStationPressure")),
    )
    friction_trend_text = resolve_trend_label(
        to_float(first_point.get("frictionHeadLoss")),
        to_float(last_point.get("frictionHeadLoss")),
    )

    project = as_record(ctx.get("project"))
    project_names = project.get("projectNames") or []
    project_name = str(snapshot.get("projectName") or (project_names[0] if project_names else "当前项目"))

    return {
        "projectName": project_name,
        "generatedAt": snapshot.get("generatedAt"),
        "inputPayload": input_payload,
        "inputBase": input_base,
        "outputPayload": output_payload,
        "baseResult": base_result,
        "baseCondition": build_sensitivity_base_condition(input_payload, input_base),
        "variableTypeText": build_sensitive_variable_display(input_payload, input_base),
        "baseResultStatus": base_result_status,
        "topVariableName": top_variable_name,
        "topRankNumber": top_rank_number,
        "sensitivityCoefficient": sensitivity_coefficient,
        "maxImpactPercent": max_impact_percent,
        "variableResults": variable_results,
        "rankingRows": ranking_rows,
        "impactRows": impact_rows,
        "primaryVariableResult": primary_variable_result,
        "pointRows": point_rows,
        "firstPoint": first_point,
        "lastPoint": last_point,
        "pressureTrendText": pressure_trend_text,
        "frictionTrendText": friction_trend_text,
        "flowRegimeChanged": flow_regime_changed,
        "flowRegimeSegments": build_regime_segments(point_rows),
        "minEndStationPressure": min_end_station_pressure,
        "impactLevel": classify_sensitivity_impact_level(sensitivity_coefficient),
        "riskLevel": evaluate_sensitivity_risk_level(
            sensitivity_coefficient,
            max_impact_percent,
            min_end_station_pressure,
            flow_regime_changed,
        ),
        "minPressurePoint": pick_extreme_point(point_rows, "endStationPressure", "min"),
        "maxPressurePoint": pick_extreme_point(point_rows, "endStationPressure", "max"),
        "maxFrictionPoint": pick_extreme_point(point_rows, "frictionHeadLoss", "max"),
        "minFrictionPoint": pick_extreme_point(point_rows, "frictionHeadLoss", "min"),
    }
