from __future__ import annotations

from statistics import mean
from typing import Any

from src.models.schemas import DynamicReportRequest

from .report_types import MetricSnapshot, ReportDataBundle


def _to_float(value: Any) -> float | None:
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


def _avg(values: list[float | None]) -> float | None:
    actual = [value for value in values if value is not None]
    return mean(actual) if actual else None


def _normalize_efficiency(value: float | None) -> float | None:
    if value is None:
        return None
    if value > 1:
        return value / 100.0
    return value


def build_metric_snapshot(data: ReportDataBundle, request: DynamicReportRequest) -> MetricSnapshot:
    throughput_values = [_to_float(item.get("throughput")) for item in data.pipelines]
    length_values = [_to_float(item.get("length")) for item in data.pipelines]
    diameter_values = [_to_float(item.get("diameter")) for item in data.pipelines]
    roughness_values = [_to_float(item.get("roughness")) for item in data.pipelines]
    density_values = [_to_float(item.get("density")) for item in data.oil_properties]
    viscosity_values = [_to_float(item.get("viscosity")) for item in data.oil_properties]
    pump_eff_values = [_normalize_efficiency(_to_float(item.get("pump_efficiency"))) for item in data.pump_stations]
    electric_eff_values = [_normalize_efficiency(_to_float(item.get("electric_efficiency"))) for item in data.pump_stations]

    total_throughput = sum(value for value in throughput_values if value is not None)
    avg_pump_eff = _avg(pump_eff_values)
    avg_electric_eff = _avg(electric_eff_values)
    avg_density = _avg(density_values)
    avg_viscosity = _avg(viscosity_values)
    avg_length = _avg(length_values)
    avg_diameter = _avg(diameter_values)
    avg_roughness = _avg(roughness_values)

    overview = data.history_overview or {}
    total_count = int(overview.get("totalCount") or 0)
    success_count = int(overview.get("successCount") or 0)
    failed_count = int(overview.get("failedCount") or 0)
    success_rate = _to_float(overview.get("successRate"))

    operation_daily = data.time_series.get("operation_daily", [])
    operation_points = data.time_series.get("operation_points", [])

    flow_series = [_to_float(item.get("flow_rate")) for item in operation_daily]
    energy_series = [_to_float(item.get("energy_consumption")) for item in operation_daily]
    pressure_series = [_to_float(item.get("end_station_pressure")) for item in operation_daily]
    duration_series = [_to_float(item.get("avg_duration_ms")) for item in operation_daily]

    avg_flow_rate = _avg(flow_series)
    avg_energy_consumption = _avg(energy_series)
    avg_end_station_pressure = _avg(pressure_series)
    avg_calc_duration_ms = _avg(duration_series)

    latest_end_station_pressure = None
    for row in reversed(operation_daily):
        value = _to_float(row.get("end_station_pressure"))
        if value is not None:
            latest_end_station_pressure = value
            break

    min_pressure_gap = None
    if request.min_pressure is not None and latest_end_station_pressure is not None:
        min_pressure_gap = latest_end_station_pressure - request.min_pressure

    target_flow_gap = None
    if request.target_throughput is not None and avg_flow_rate is not None:
        target_flow_gap = avg_flow_rate - request.target_throughput

    pump_rows = [
        {
            "name": str(row.get("name") or "-"),
            "pump_efficiency": _normalize_efficiency(_to_float(row.get("pump_efficiency"))),
            "electric_efficiency": _normalize_efficiency(_to_float(row.get("electric_efficiency"))),
            "displacement": _to_float(row.get("displacement")),
            "come_power": _to_float(row.get("come_power")),
        }
        for row in data.pump_stations
    ]

    pipeline_rows = [
        {
            "name": str(row.get("name") or "-"),
            "length": _to_float(row.get("length")),
            "diameter": _to_float(row.get("diameter")),
            "throughput": _to_float(row.get("throughput")),
            "roughness": _to_float(row.get("roughness")),
        }
        for row in data.pipelines
    ]

    return MetricSnapshot(
        overview_metrics={
            "project_count": len(data.projects),
            "pipeline_count": len(data.pipelines),
            "pump_station_count": len(data.pump_stations),
            "oil_property_count": len(data.oil_properties),
            "history_total_count": total_count,
            "history_success_count": success_count,
            "history_failed_count": failed_count,
            "success_rate": success_rate,
            "total_throughput": total_throughput,
            "avg_pipeline_length": avg_length,
            "avg_pipeline_diameter": avg_diameter,
            "avg_roughness": avg_roughness,
            "avg_density": avg_density,
            "avg_viscosity": avg_viscosity,
            "avg_pump_efficiency": avg_pump_eff,
            "avg_electric_efficiency": avg_electric_eff,
            "avg_flow_rate": avg_flow_rate,
            "avg_energy_consumption": avg_energy_consumption,
            "avg_end_station_pressure": avg_end_station_pressure,
            "latest_end_station_pressure": latest_end_station_pressure,
            "avg_calc_duration_ms": avg_calc_duration_ms,
        },
        trend_metrics={
            "history_daily": data.time_series.get("history_daily", []),
            "operation_daily": operation_daily,
            "operation_points": operation_points,
        },
        object_metrics={
            "pump_stations": pump_rows,
            "pipelines": pipeline_rows,
        },
        constraint_metrics={
            "target_throughput": request.target_throughput,
            "min_pressure": request.min_pressure,
            "target_flow_gap": target_flow_gap,
            "min_pressure_gap": min_pressure_gap,
            "allow_pump_adjust": request.allow_pump_adjust,
            "optimization_goal": request.optimization_goal,
        },
        data_quality={
            "has_projects": bool(data.projects),
            "has_pipelines": bool(data.pipelines),
            "has_histories": bool(data.history_records),
            "series_points": len(data.time_series.get("history_daily", [])),
            "operation_points": len(operation_points),
            "usable_for_trend": len(operation_daily) >= 7,
            "usable_for_correlation": len(
                [
                    item
                    for item in operation_points
                    if (
                        _to_float(item.get("flow_rate")) is not None
                        or _to_float(item.get("energy_consumption")) is not None
                        or _to_float(item.get("pump_efficiency")) is not None
                        or _to_float(item.get("end_station_pressure")) is not None
                    )
                ]
            )
            >= 7,
        },
    )
