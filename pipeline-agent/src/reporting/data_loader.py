from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any

from src.models.schemas import DynamicReportRequest
from src.tools.database_tools import execute_query
from src.tools.java_service_tools import get_java_client
from src.utils import logger

from .report_types import ReportDataBundle


def _filter_by_ids_or_names(
    rows: list[dict[str, Any]],
    *,
    id_key: str,
    name_key: str,
    ids: list[int] | None = None,
    names: list[str] | None = None,
) -> list[dict[str, Any]]:
    selected_ids = {item for item in (ids or []) if item is not None}
    selected_names = {str(item).strip() for item in (names or []) if str(item).strip()}
    if selected_ids:
        rows = [row for row in rows if row.get(id_key) in selected_ids]
    if selected_names:
        rows = [row for row in rows if str(row.get(name_key) or "").strip() in selected_names]
    return rows


def _load_projects(request: DynamicReportRequest) -> list[dict[str, Any]]:
    rows = execute_query(
        """
        SELECT pro_id, number, name, responsible, build_date
        FROM t_project
        ORDER BY pro_id ASC
        """
    )
    selected_ids = set(request.selected_project_ids)
    selected_names = {name.strip() for name in request.project_names if name.strip()}
    if selected_ids:
        rows = [row for row in rows if row.get("pro_id") in selected_ids]
    elif selected_names:
        rows = [row for row in rows if str(row.get("name") or "").strip() in selected_names]
    return rows


def _load_pipelines(project_ids: list[int]) -> list[dict[str, Any]]:
    rows = execute_query(
        """
        SELECT id, pro_id, name, length, diameter, roughness, throughput, work_time
        FROM t_pipeline
        ORDER BY pro_id ASC, id ASC
        """
    )
    if not project_ids:
        return rows
    selected = set(project_ids)
    return [row for row in rows if row.get("pro_id") in selected]


def _load_pump_stations() -> list[dict[str, Any]]:
    return execute_query(
        """
        SELECT id, name, pump_efficiency, electric_efficiency, displacement, come_power
        FROM t_pump_station
        ORDER BY id ASC
        """
    )


def _load_oil_properties() -> list[dict[str, Any]]:
    return execute_query(
        """
        SELECT id, name, density, viscosity
        FROM t_oil_property
        ORDER BY id ASC
        """
    )


def _fetch_recent_histories(limit: int = 180) -> list[dict[str, Any]]:
    client = get_java_client()
    page = client.call_api(
        "/calculation/history/page",
        method="GET",
        params={"pageNum": 1, "pageSize": limit},
    )
    data = page.get("data", {}) if isinstance(page, dict) else {}
    return data.get("list") or []


def _fetch_overview() -> dict[str, Any]:
    client = get_java_client()
    overview = client.call_api("/calculation/statistics/overview", method="GET")
    return overview.get("data", {}) if isinstance(overview, dict) else {}


def _safe_history_data() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    try:
        return _fetch_overview(), _fetch_recent_histories()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to load history snapshot for report: %s", exc)
        return {}, []


def _parse_json_record(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not isinstance(value, str) or not value.strip():
        return {}
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


def _pick_number(record: dict[str, Any], keys: list[str]) -> float | None:
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


def _pick_string(record: dict[str, Any], keys: list[str]) -> str:
    for key in keys:
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _normalize_efficiency(value: float | None) -> float | None:
    if value is None:
        return None
    if value > 1:
        return value / 100.0
    return value


def _range_days(request: DynamicReportRequest) -> int:
    mapping = {
        "today": 1,
        "7d": 7,
        "30d": 30,
        "90d": 90,
        "year": 90,
        "all": 90,
        "custom": 30,
    }
    return mapping.get(request.range_preset or "", 30)


def _match_project(row: dict[str, Any], request: DynamicReportRequest) -> bool:
    if not request.project_names and not request.selected_project_ids:
        return True
    project_name = str(row.get("projectName") or "").strip()
    project_id = row.get("projectId")
    if request.project_names and project_name in set(request.project_names):
        return True
    if request.selected_project_ids and project_id in set(request.selected_project_ids):
        return True
    return False


def _build_time_series(records: list[dict[str, Any]], days: int) -> dict[str, list[dict[str, Any]]]:
    end = datetime.now()
    start = end - timedelta(days=max(days - 1, 0))
    day_keys = [(start + timedelta(days=index)).strftime("%Y-%m-%d") for index in range(days)]

    history_buckets: dict[str, dict[str, Any]] = {
        key: {
            "timestamp": key,
            "total": 0,
            "success": 0,
            "failed": 0,
            "durations": [],
        }
        for key in day_keys
    }
    operation_buckets: dict[str, dict[str, Any]] = {
        key: {
            "timestamp": key,
            "flow_rate": [],
            "energy_consumption": [],
            "pump_efficiency": [],
            "end_station_pressure": [],
            "calc_duration_ms": [],
            "success_rate": [],
        }
        for key in day_keys
    }
    operation_points: list[dict[str, Any]] = []

    for row in records:
        time_text = str(row.get("createTime") or "")
        day_key = time_text[:10]
        if day_key not in history_buckets:
            continue

        input_params = _parse_json_record(row.get("inputParams"))
        output_result = _parse_json_record(row.get("outputResult"))

        history_bucket = history_buckets[day_key]
        history_bucket["total"] += 1
        status_name = str(row.get("statusName") or "")
        if "成功" in status_name:
            history_bucket["success"] += 1
        elif "失败" in status_name:
            history_bucket["failed"] += 1

        duration = row.get("calcDuration")
        if isinstance(duration, (int, float)):
            history_bucket["durations"].append(float(duration))

        flow_rate = _pick_number(input_params, ["flowRate", "throughput", "flow"])
        if flow_rate is None:
            flow_rate = _pick_number(output_result, ["flowRate", "throughput", "flow"])

        energy_consumption = _pick_number(
            output_result,
            ["totalEnergyConsumption", "annualEnergyConsumption", "energyConsumption"],
        )
        pump_efficiency = _normalize_efficiency(
            _pick_number(output_result, ["pumpEfficiency", "efficiency"])
            or _pick_number(input_params, ["pumpEfficiency", "efficiency"])
        )
        end_station_pressure = _pick_number(
            output_result,
            ["endStationInPressure", "terminalInPressure", "pressure"],
        )

        operation_bucket = operation_buckets[day_key]
        if flow_rate is not None:
            operation_bucket["flow_rate"].append(flow_rate)
        if energy_consumption is not None:
            operation_bucket["energy_consumption"].append(energy_consumption)
        if pump_efficiency is not None:
            operation_bucket["pump_efficiency"].append(pump_efficiency)
        if end_station_pressure is not None:
            operation_bucket["end_station_pressure"].append(end_station_pressure)
        if isinstance(duration, (int, float)):
            operation_bucket["calc_duration_ms"].append(float(duration))

        total = history_bucket["total"]
        success = history_bucket["success"]
        operation_bucket["success_rate"] = [(success / total * 100.0)] if total else []

        operation_points.append(
            {
                "timestamp": time_text or day_key,
                "day": day_key,
                "history_id": row.get("id"),
                "project_name": str(row.get("projectName") or ""),
                "calc_type": str(row.get("calcType") or ""),
                "status_name": status_name,
                "flow_rate": flow_rate,
                "energy_consumption": energy_consumption,
                "pump_efficiency": pump_efficiency,
                "end_station_pressure": end_station_pressure,
                "calc_duration_ms": float(duration) if isinstance(duration, (int, float)) else None,
                "sensitive_variable_type": _pick_string(
                    input_params,
                    ["sensitiveVariableType", "sensitivityVariableType", "variableType"],
                ),
            }
        )

    history_daily: list[dict[str, Any]] = []
    for item in history_buckets.values():
        durations = item.pop("durations")
        total = item["total"]
        success = item["success"]
        item["avg_duration_ms"] = sum(durations) / len(durations) if durations else 0.0
        item["success_rate"] = (success / total * 100.0) if total else 0.0
        history_daily.append(item)

    operation_daily: list[dict[str, Any]] = []
    for item in operation_buckets.values():
        operation_daily.append(
            {
                "timestamp": item["timestamp"],
                "flow_rate": sum(item["flow_rate"]) / len(item["flow_rate"]) if item["flow_rate"] else None,
                "energy_consumption": sum(item["energy_consumption"]) / len(item["energy_consumption"]) if item["energy_consumption"] else None,
                "pump_efficiency": sum(item["pump_efficiency"]) / len(item["pump_efficiency"]) if item["pump_efficiency"] else None,
                "end_station_pressure": sum(item["end_station_pressure"]) / len(item["end_station_pressure"]) if item["end_station_pressure"] else None,
                "avg_duration_ms": sum(item["calc_duration_ms"]) / len(item["calc_duration_ms"]) if item["calc_duration_ms"] else None,
                "success_rate": item["success_rate"][0] if item["success_rate"] else None,
            }
        )

    return {
        "history_daily": history_daily,
        "operation_daily": operation_daily,
        "operation_points": operation_points,
    }


def load_report_data(request: DynamicReportRequest) -> ReportDataBundle:
    projects = _load_projects(request)
    project_ids = [int(item.get("pro_id")) for item in projects if item.get("pro_id") is not None]
    pipelines = _load_pipelines(project_ids)
    if request.selected_pipeline_id is not None:
        pipelines = [item for item in pipelines if item.get("id") == request.selected_pipeline_id]
    elif request.selected_pipeline_name:
        pipelines = [item for item in pipelines if str(item.get("name") or "").strip() == request.selected_pipeline_name.strip()]

    pump_stations = _filter_by_ids_or_names(
        _load_pump_stations(),
        id_key="id",
        name_key="name",
        ids=request.selected_pump_station_ids,
        names=request.selected_pump_station_names,
    )
    oil_properties = _filter_by_ids_or_names(
        _load_oil_properties(),
        id_key="id",
        name_key="name",
        ids=[request.selected_oil_id] if request.selected_oil_id is not None else [],
        names=[request.selected_oil_name] if request.selected_oil_name else [],
    )

    overview, histories = _safe_history_data()
    filtered_histories = [row for row in histories if _match_project(row, request)]

    return ReportDataBundle(
        projects=projects,
        pipelines=pipelines,
        pump_stations=pump_stations,
        oil_properties=oil_properties,
        history_overview=overview,
        history_records=filtered_histories,
        time_series=_build_time_series(filtered_histories, _range_days(request)),
    )
