from __future__ import annotations

from typing import Any

from src.models.schemas import ReportRiskItem


def _normalize_level(level: str) -> str:
    normalized = str(level or "").strip().lower()
    if normalized in {"high", "高"}:
        return "高"
    if normalized in {"low", "低"}:
        return "低"
    return "中"


def risk_skill(ctx: dict[str, Any]) -> list[ReportRiskItem]:
    diagnosis = ctx.get("diagnosis", {})
    risk_flags = ctx.get("risk_flags", [])
    items: list[ReportRiskItem] = []

    for row in risk_flags:
        items.append(
            ReportRiskItem(
                target=str(row.get("targetName") or "-"),
                riskType=str(row.get("riskCode") or "unknown"),
                level=_normalize_level(str(row.get("level") or "")),
                reason=str(row.get("message") or "当前数据不足以支持进一步判断。"),
                suggestion=str(row.get("suggestion") or "建议结合约束条件复核当前对象。"),
            )
        )

    if items:
        return items[:6]

    for issue in diagnosis.get("issues", [])[:6]:
        evidence = issue.get("evidence") or {}
        evidence_text = f" 证据：{evidence}。" if evidence else ""
        items.append(
            ReportRiskItem(
                target=str(issue.get("target") or "-"),
                riskType=str(issue.get("issue_type") or "rule_issue"),
                level=_normalize_level(str(issue.get("level") or "")),
                reason=f"{str(issue.get('message') or '存在潜在规则风险。')}{evidence_text}",
                suggestion="建议复核相关参数与约束条件，必要时重新评估当前方案。",
            )
        )

    return items[:6]
