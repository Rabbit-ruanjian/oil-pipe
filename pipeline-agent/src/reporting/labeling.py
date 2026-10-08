from __future__ import annotations

from src.models.schemas import DynamicReportRequest


def range_label(request: DynamicReportRequest) -> str:
    if request.range_label:
        return request.range_label
    if request.custom_start and request.custom_end:
        return f"{request.custom_start} 至 {request.custom_end}"
    mapping = {
        "today": "今日",
        "7d": "近7天",
        "30d": "近30天",
        "90d": "近90天",
        "year": "本年度",
        "all": "全量历史",
        "custom": "自定义",
    }
    return mapping.get(request.range_preset or "", request.range_preset or "默认范围")


def report_type_label(request: DynamicReportRequest) -> str:
    if request.report_type_label:
        return request.report_type_label
    mapping = {
        "AI_REPORT": "智能分析报告",
        "RISK_REVIEW": "风险复盘报告",
        "ENERGY_DIAGNOSIS": "能耗诊断报告",
        "OPERATION_BRIEF": "运行简报",
        "overview": "参数评估报告",
        "energy": "能耗分析报告",
        "pump": "泵站优选报告",
        "sensitivity": "水力分析解读报告",
        "diagnosis": "优化建议报告",
        "comparison": "方案对比报告",
    }
    return mapping.get(request.report_type, request.report_type)


def output_style_key(request: DynamicReportRequest) -> str:
    value = (request.output_style or "professional").strip().lower()
    if value in {"simple", "professional", "presentation"}:
        return value
    return "professional"


def output_style_label(request: DynamicReportRequest) -> str:
    mapping = {
        "simple": "简明版",
        "professional": "专业版",
        "presentation": "管理版",
    }
    return mapping.get(output_style_key(request), "专业版")


def analysis_object_label(value: str | None) -> str:
    mapping = {
        "project": "项目",
        "single_project": "单项目",
        "pipeline": "管道",
        "pumpStation": "泵站",
        "pump_station": "泵站",
        "scheme": "方案",
    }
    return mapping.get(value or "", value or "-")


def optimization_goal_label(value: str | None) -> str:
    mapping = {
        "energy": "能耗优先",
        "cost": "输量优先",
        "safety": "压力优先",
        "balanced": "综合最优",
    }
    return mapping.get(value or "", value or "-")


def style_title(base_title: str, request: DynamicReportRequest) -> str:
    suffix = output_style_label(request)
    return base_title if base_title.endswith(suffix) else f"{base_title} {suffix}"
