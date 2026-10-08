from __future__ import annotations

import json
from typing import Any

from src.models.schemas import DynamicReportRequest

from .labeling import analysis_object_label, optimization_goal_label, output_style_label, report_type_label
from .report_types import DecisionResult, DiagnosisResult, MetricSnapshot, ReportDataBundle


def _pick_data_source(user_prompt: str | None) -> str:
    if not user_prompt:
        return "主数据 + 计算结果"
    for line in user_prompt.splitlines():
        if "数据来源" in line:
            parts = line.split("：", maxsplit=1)
            if len(parts) == 2 and parts[1].strip():
                return parts[1].strip()
    return "主数据 + 计算结果"


def _pick_external_api(user_prompt: str | None) -> str:
    if not user_prompt:
        return "不启用"
    for line in user_prompt.splitlines():
        if "外部知识增强" in line:
            parts = line.split("：", maxsplit=1)
            if len(parts) == 2 and parts[1].strip():
                return parts[1].strip()
    return "不启用"


def _parse_json_record(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not isinstance(value, str) or not value.strip():
        return {}
    try:
        parsed = json.loads(value)
    except Exception:  # noqa: BLE001
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _unwrap_result_payload(payload: dict[str, Any]) -> dict[str, Any]:
    nested = payload.get("data")
    return nested if isinstance(nested, dict) else payload


def _looks_like_hydraulic_record(record: dict[str, Any]) -> bool:
    calc_type = str(record.get("calcType") or "")
    calc_type_name = str(record.get("calcTypeName") or "")
    type_text = f"{calc_type} {calc_type_name}".upper()
    return "HYDRAULIC" in type_text or "水力" in type_text


def _looks_like_sensitivity_record(record: dict[str, Any]) -> bool:
    calc_type = str(record.get("calcType") or "")
    calc_type_name = str(record.get("calcTypeName") or "")
    type_text = f"{calc_type} {calc_type_name}".upper()
    return "SENSITIVITY" in type_text or "敏感" in type_text


def _looks_like_optimization_record(record: dict[str, Any]) -> bool:
    calc_type = str(record.get("calcType") or "")
    calc_type_name = str(record.get("calcTypeName") or "")
    type_text = f"{calc_type} {calc_type_name}".upper()
    return "OPTIMIZATION" in type_text or "浼樺寲" in type_text


def _resolve_sensitivity_snapshot(
    request: DynamicReportRequest,
    history_records: list[dict[str, Any]],
) -> dict[str, Any]:
    provided_snapshot = request.sensitivity_snapshot if isinstance(request.sensitivity_snapshot, dict) else None
    if provided_snapshot:
        input_payload = provided_snapshot.get("input")
        output_payload = provided_snapshot.get("output")
        if isinstance(input_payload, dict) and isinstance(output_payload, dict):
            return {
                "projectName": provided_snapshot.get("projectName"),
                "generatedAt": provided_snapshot.get("generatedAt"),
                "input": input_payload,
                "output": output_payload,
            }

    sensitivity_records = [row for row in history_records if _looks_like_sensitivity_record(row)]
    if not sensitivity_records:
        return {}

    latest_record = sorted(sensitivity_records, key=lambda item: str(item.get("createTime") or ""), reverse=True)[0]
    input_payload = _parse_json_record(latest_record.get("inputParams"))
    output_payload = _unwrap_result_payload(_parse_json_record(latest_record.get("outputResult")))
    if not input_payload or not output_payload:
        return {}

    return {
        "projectName": str(latest_record.get("projectName") or ""),
        "generatedAt": str(latest_record.get("createTime") or ""),
        "input": input_payload,
        "output": output_payload,
    }


def _resolve_optimization_snapshot(
    request: DynamicReportRequest,
    history_records: list[dict[str, Any]],
) -> dict[str, Any]:
    provided_snapshot = request.optimization_snapshot if isinstance(request.optimization_snapshot, dict) else None
    if provided_snapshot:
        input_payload = provided_snapshot.get("input")
        output_payload = provided_snapshot.get("output")
        if isinstance(input_payload, dict) and isinstance(output_payload, dict):
            return {
                "projectName": provided_snapshot.get("projectName"),
                "generatedAt": provided_snapshot.get("generatedAt"),
                "input": input_payload,
                "output": output_payload,
            }

    optimization_records = [row for row in history_records if _looks_like_optimization_record(row)]
    if not optimization_records:
        return {}

    latest_record = sorted(optimization_records, key=lambda item: str(item.get("createTime") or ""), reverse=True)[0]
    input_payload = _parse_json_record(latest_record.get("inputParams"))
    output_payload = _unwrap_result_payload(_parse_json_record(latest_record.get("outputResult")))
    if not input_payload or not output_payload:
        return {}

    return {
        "projectName": str(latest_record.get("projectName") or ""),
        "generatedAt": str(latest_record.get("createTime") or ""),
        "input": input_payload,
        "output": output_payload,
    }


def _resolve_hydraulic_snapshot(
    request: DynamicReportRequest,
    history_records: list[dict[str, Any]],
) -> dict[str, Any]:
    provided_snapshot = request.hydraulic_snapshot if isinstance(request.hydraulic_snapshot, dict) else None
    if provided_snapshot:
        input_payload = provided_snapshot.get("input")
        output_payload = provided_snapshot.get("output")
        if isinstance(input_payload, dict) and isinstance(output_payload, dict):
            return {
                "projectName": provided_snapshot.get("projectName"),
                "generatedAt": provided_snapshot.get("generatedAt"),
                "input": input_payload,
                "output": output_payload,
            }

    hydraulic_records = [row for row in history_records if _looks_like_hydraulic_record(row)]
    if not hydraulic_records:
        return {}

    latest_record = sorted(hydraulic_records, key=lambda item: str(item.get("createTime") or ""), reverse=True)[0]
    input_payload = _parse_json_record(latest_record.get("inputParams"))
    output_payload = _unwrap_result_payload(_parse_json_record(latest_record.get("outputResult")))
    if not input_payload or not output_payload:
        return {}

    return {
        "projectName": str(latest_record.get("projectName") or ""),
        "generatedAt": str(latest_record.get("createTime") or ""),
        "input": input_payload,
        "output": output_payload,
    }


def build_report_context(
    request: DynamicReportRequest,
    data: ReportDataBundle,
    metrics: MetricSnapshot,
    diagnosis: DiagnosisResult,
    decision: DecisionResult,
) -> dict[str, Any]:
    project_names = [str(item.get("name") or "-") for item in data.projects]
    pipeline_name = request.selected_pipeline_name or (str(data.pipelines[0].get("name")) if data.pipelines else "-")
    pump_scope = "全部泵站" if not request.selected_pump_station_names else "指定泵站"
    oil_name = request.selected_oil_name or (str(data.oil_properties[0].get("name")) if data.oil_properties else "-")
    history_overview = data.history_overview or {}
    risk_flags = [
        {
            "targetName": str(item.get("target") or "-"),
            "riskCode": str(item.get("riskType") or "unknown"),
            "level": str(item.get("level") or "中"),
            "message": str(item.get("reason") or ""),
            "suggestion": str(item.get("suggestion") or ""),
        }
        for item in diagnosis.risks
    ]

    return {
        "project": {
            "projectCount": len(data.projects),
            "projectNames": project_names,
            "pipelineCount": len(data.pipelines),
            "pumpCount": len(data.pump_stations),
            "oilCount": len(data.oil_properties),
            "reportType": report_type_label(request),
        },
        "params": {
            "analysisObject": analysis_object_label(request.analysis_object),
            "pipelineName": pipeline_name,
            "pumpStationScope": pump_scope,
            "oilType": oil_name,
            "focusPoints": request.focuses or [],
            "targetThroughput": request.target_throughput,
            "minOutletPressure": request.min_pressure,
            "optimizationGoal": optimization_goal_label(request.optimization_goal),
            "allowCombination": bool(request.allow_pump_adjust),
            "dataSource": _pick_data_source(request.user_prompt),
            "externalApiEnhance": _pick_external_api(request.user_prompt),
        },
        "charts": {
            "historyDaily": metrics.trend_metrics.get("history_daily", []),
            "operationDaily": metrics.trend_metrics.get("operation_daily", []),
            "operationPoints": metrics.trend_metrics.get("operation_points", []),
        },
        "metrics": {
            **metrics.overview_metrics,
            **metrics.constraint_metrics,
            "constraintChecks": len(diagnosis.constraints),
        },
        "history": {
            "total": int(history_overview.get("totalCount") or metrics.overview_metrics.get("history_total_count") or 0),
            "success": int(history_overview.get("successCount") or metrics.overview_metrics.get("history_success_count") or 0),
            "failed": int(history_overview.get("failedCount") or metrics.overview_metrics.get("history_failed_count") or 0),
            "successRate": metrics.overview_metrics.get("success_rate"),
            "records": data.history_records,
        },
        "hydraulic_snapshot": _resolve_hydraulic_snapshot(request, data.history_records),
        "optimization_snapshot": _resolve_optimization_snapshot(request, data.history_records),
        "risk_flags": risk_flags,
        "pump_data": metrics.object_metrics.get("pump_stations", []),
        "sensitivity_snapshot": _resolve_sensitivity_snapshot(request, data.history_records),
        "report_meta": {
            "project_name": "、".join(project_names) if project_names else "-",
            "report_type": report_type_label(request),
            "focus_points": request.focuses or [],
            "output_style": output_style_label(request),
        },
        "scope": {
            "analysis_object": analysis_object_label(request.analysis_object),
            "pipeline_name": pipeline_name,
            "pump_station_scope": pump_scope,
            "oil_type": oil_name,
            "data_source": _pick_data_source(request.user_prompt),
        },
        "constraints": {
            "target_throughput": request.target_throughput,
            "min_outlet_pressure": request.min_pressure,
            "optimization_goal": optimization_goal_label(request.optimization_goal),
            "allow_combination": bool(request.allow_pump_adjust),
            "external_api_enhance": _pick_external_api(request.user_prompt),
        },
        "diagnosis": {
            "issues": [item.__dict__ for item in diagnosis.issues],
            "risks": diagnosis.risks,
            "causes": [item.__dict__ for item in diagnosis.causes],
            "constraints": [item.__dict__ for item in diagnosis.constraints],
            "recommendations": [item.__dict__ for item in diagnosis.recommendations],
        },
        "decision": {
            "recommended_options": [item.__dict__ for item in decision.recommended_options],
            "fallback_options": [item.__dict__ for item in decision.fallback_options],
            "rejected_options": [item.__dict__ for item in decision.rejected_options],
            "summary": decision.summary,
            "weights": decision.weights,
        },
        "object_profiles": metrics.object_metrics,
        "raw_metrics": metrics.overview_metrics,
    }
