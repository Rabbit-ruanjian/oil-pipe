from __future__ import annotations

from typing import Any

from src.models.schemas import ReportSuggestionItem


def _priority_from_level(level: str) -> str:
    normalized = str(level or "").strip().lower()
    if normalized in {"high", "高"}:
        return "high"
    if normalized in {"low", "低"}:
        return "low"
    return "medium"


def suggestion_skill(ctx: dict[str, Any]) -> list[ReportSuggestionItem]:
    diagnosis = ctx.get("diagnosis", {})
    risk_flags = ctx.get("risk_flags", [])
    items: list[ReportSuggestionItem] = []

    for row in diagnosis.get("recommendations", [])[:6]:
        items.append(
            ReportSuggestionItem(
                target=str(row.get("target") or "-"),
                reason=str(row.get("reason") or "基于当前诊断结果生成。"),
                action=str(row.get("action") or "建议复核当前运行方案。"),
                expected=str(row.get("expected") or "降低风险并提升运行稳定性。"),
                priority=str(row.get("priority") or "medium"),
            )
        )

    if items:
        return items[:6]

    for row in risk_flags[:6]:
        risk_code = str(row.get("riskCode") or "")
        action = "建议复核相关参数和运行约束。"
        expected = "降低当前风险并提高结论稳定性。"

        if risk_code == "pump_efficiency_low":
            action = "优先复核低效率泵组运行组合，并评估停启优化空间。"
            expected = "降低单位输量能耗并改善扬程利用率。"
        elif risk_code == "pipeline_resistance_high":
            action = "建议复核管道粗糙度、输量设置及沿程摩阻参数。"
            expected = "降低压降并改善末端压力表现。"
        elif risk_code in {"min_pressure_unmet", "constraint"}:
            action = "建议优先处理压力约束缺口，并重新评估方案可行性。"
            expected = "恢复压力边界并降低方案失效风险。"

        items.append(
            ReportSuggestionItem(
                target=str(row.get("targetName") or "-"),
                reason=str(row.get("message") or "存在待处理风险。"),
                action=action,
                expected=expected,
                priority=_priority_from_level(str(row.get("level") or "")),
            )
        )

    return items[:6]
