from __future__ import annotations

import json
from typing import Any

from langchain_openai import ChatOpenAI

from src.config import settings
from src.models.schemas import DynamicReportAiAnalysis, ReportRiskItem, ReportSuggestionItem
from src.utils import logger

from .metric_skill import metric_skill
from .risk_skill import risk_skill
from .suggestion_skill import suggestion_skill
from .summary_skill import summary_skill


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


def _normalize_level(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"high", "h", "high_risk"}:
        return "\u9ad8"
    if normalized in {"low", "l"}:
        return "\u4f4e"
    return "\u4e2d"


def _normalize_priority(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"high", "p0", "p1"}:
        return "high"
    if normalized in {"low", "p3"}:
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


def _clean_headline(value: Any) -> str:
    text = str(value or "").strip()
    return text


def _merge_summary(headline: str, summary: list[str], fallback: list[str], limit: int = 4) -> list[str]:
    items: list[str] = []
    if headline:
        items.append(headline)
    for line in summary:
        text = str(line or "").strip()
        if text and text not in items:
            items.append(text)
        if len(items) >= limit:
            break
    if items:
        return items[:limit]
    return fallback


def _build_chart_facts(
    inlet_pressure: float | None,
    first_station_out_pressure: float | None,
    end_station_pressure: float | None,
    friction_head_loss: float | None,
    total_head: float | None,
    elevation_diff: float | None,
    friction_share: float | None,
    head_drop: float | None,
) -> list[str]:
    facts: list[str] = []

    if first_station_out_pressure is not None and end_station_pressure is not None:
        if head_drop is not None and head_drop > 0:
            if end_station_pressure > 0:
                if first_station_out_pressure and end_station_pressure / first_station_out_pressure <= 0.6:
                    facts.append("压头变化图显示：首站出站压头达到峰值后，末站进站压头虽保持为正，但沿程衰减较明显。")
                else:
                    facts.append("压头变化图显示：首站出站压头高于末站进站压头，沿程压头损失客观存在。")
            else:
                facts.append("压头变化图显示：末站进站压头偏低甚至接近零，末端压力保障能力需要重点复核。")
        elif inlet_pressure is not None and end_station_pressure >= inlet_pressure:
            facts.append("压头变化图显示：泵站扬程补偿后末站进站压头仍保持在较稳定区间。")

    if total_head is not None and friction_head_loss is not None and friction_share is not None:
        if friction_share >= 0.45:
            facts.append("扬程构成图显示：摩阻损失占总扬程比重偏高，输送阻力已成为当前工况的重要影响因素。")
        elif friction_share >= 0.25:
            facts.append("扬程构成图显示：总扬程中已有较明显比例用于覆盖沿程摩阻损失。")
        else:
            facts.append("扬程构成图显示：总扬程主要用于满足高程差与末端压力要求，摩阻损失占比相对可控。")

    if elevation_diff is not None and total_head is not None:
        if elevation_diff > 0 and total_head > elevation_diff:
            facts.append("从扬程构成看，系统除克服高程抬升外，还需承担额外摩阻与末端压力保障需求。")
        elif elevation_diff <= 0:
            facts.append("从高程条件看，沿线地形抬升不是主导矛盾，当前更应关注阻力损失与压力分配。")

    return facts[:4]


def _build_fallback(ctx: dict[str, Any]) -> DynamicReportAiAnalysis:
    return DynamicReportAiAnalysis(
        summary=summary_skill(ctx),
        metricAnalysis=metric_skill(ctx),
        riskJudgement=risk_skill(ctx),
        suggestions=suggestion_skill(ctx),
    )


def _build_fact_pack(ctx: dict[str, Any]) -> dict[str, Any]:
    snapshot = _as_record(ctx.get("hydraulic_snapshot"))
    input_payload = _as_record(snapshot.get("input"))
    output_payload = _as_record(snapshot.get("output"))
    metrics = _as_record(ctx.get("metrics"))
    history = _as_record(ctx.get("history"))
    params = _as_record(ctx.get("params"))
    diagnosis = _as_record(ctx.get("diagnosis"))
    decision = _as_record(ctx.get("decision"))
    risk_flags = [row for row in _as_list(ctx.get("risk_flags")) if isinstance(row, dict)]

    inlet_pressure = _pick_number(input_payload, "inletPressure")
    first_station_out_pressure = _pick_number(output_payload, "firstStationOutPressure")
    end_station_pressure = _pick_number(output_payload, "endStationInPressure", "endStationPressure")
    friction_head_loss = _pick_number(output_payload, "frictionHeadLoss")
    total_head = _pick_number(output_payload, "totalHead")
    reynolds_number = _pick_number(output_payload, "reynoldsNumber")
    hydraulic_slope = _pick_number(output_payload, "hydraulicSlope")
    start_altitude = _pick_number(input_payload, "startAltitude")
    end_altitude = _pick_number(input_payload, "endAltitude")
    elevation_diff = None
    if start_altitude is not None and end_altitude is not None:
        elevation_diff = end_altitude - start_altitude

    friction_share = None
    if friction_head_loss is not None and total_head not in (None, 0):
        friction_share = friction_head_loss / total_head

    head_drop = None
    if first_station_out_pressure is not None and end_station_pressure is not None:
        head_drop = first_station_out_pressure - end_station_pressure

    chart_facts = _build_chart_facts(
        inlet_pressure=inlet_pressure,
        first_station_out_pressure=first_station_out_pressure,
        end_station_pressure=end_station_pressure,
        friction_head_loss=friction_head_loss,
        total_head=total_head,
        elevation_diff=elevation_diff,
        friction_share=friction_share,
        head_drop=head_drop,
    )

    return {
        "reportType": "hydraulic",
        "projectName": snapshot.get("projectName") or _as_record(ctx.get("report_meta")).get("project_name") or "-",
        "generatedAt": snapshot.get("generatedAt"),
        "focusPoints": _as_list(params.get("focusPoints")),
        "inputParameters": {
            "flowRate": _round_number(_pick_number(input_payload, "flowRate"), 3),
            "density": _round_number(_pick_number(input_payload, "density"), 3),
            "viscosity": _round_number(_pick_number(input_payload, "viscosity"), 3),
            "length": _round_number(_pick_number(input_payload, "length"), 3),
            "diameter": _round_number(_pick_number(input_payload, "diameter"), 3),
            "roughness": _round_number(_pick_number(input_payload, "roughness"), 4),
            "startAltitude": _round_number(start_altitude, 3),
            "endAltitude": _round_number(end_altitude, 3),
            "inletPressure": _round_number(inlet_pressure, 3),
            "pump480Num": _round_number(_pick_number(input_payload, "pump480Num"), 0),
            "pump375Num": _round_number(_pick_number(input_payload, "pump375Num"), 0),
            "pump480Head": _round_number(_pick_number(input_payload, "pump480Head"), 3),
            "pump375Head": _round_number(_pick_number(input_payload, "pump375Head"), 3),
        },
        "resultMetrics": {
            "reynoldsNumber": _round_number(reynolds_number, 3),
            "flowRegime": _pick_text(output_payload, "flowRegime"),
            "frictionHeadLoss": _round_number(friction_head_loss, 3),
            "hydraulicSlope": _round_number(hydraulic_slope, 4),
            "totalHead": _round_number(total_head, 3),
            "firstStationOutPressure": _round_number(first_station_out_pressure, 3),
            "endStationInPressure": _round_number(end_station_pressure, 3),
        },
        "derivedFacts": {
            "elevationDifference": _round_number(elevation_diff, 3),
            "frictionShareOfTotalHead": _round_number(friction_share, 4),
            "headDropFromFirstToEnd": _round_number(head_drop, 3),
        },
        "historyOverview": {
            "total": int(history.get("total") or 0),
            "success": int(history.get("success") or 0),
            "failed": int(history.get("failed") or 0),
            "successRate": _round_number(_pick_number(history, "successRate"), 2),
        },
        "systemMetrics": {
            "avgPumpEfficiency": _round_number(_pick_number(metrics, "avg_pump_efficiency"), 4),
            "avgViscosity": _round_number(_pick_number(metrics, "avg_viscosity"), 3),
            "latestEndStationPressure": _round_number(_pick_number(metrics, "latest_end_station_pressure"), 3),
            "minPressureGap": _round_number(_pick_number(metrics, "min_pressure_gap"), 3),
            "targetFlowGap": _round_number(_pick_number(metrics, "target_flow_gap"), 3),
        },
        "riskItems": risk_flags[:4],
        "constraintChecks": [row for row in _as_list(diagnosis.get("constraints")) if isinstance(row, dict)][:4],
        "recommendationHints": [row for row in _as_list(diagnosis.get("recommendations")) if isinstance(row, dict)][:4],
        "decisionSummary": str(decision.get("summary") or "").strip(),
        "chartFacts": chart_facts,
    }


def _coerce_risks(value: Any, fallback: list[ReportRiskItem]) -> list[ReportRiskItem]:
    if not isinstance(value, list):
        return fallback

    items: list[ReportRiskItem] = []
    for row in value[:4]:
        if not isinstance(row, dict):
            continue
        target = str(row.get("target") or row.get("name") or "-").strip() or "-"
        risk_type = str(row.get("riskType") or row.get("code") or row.get("type") or "hydraulic_risk").strip()
        reason = str(row.get("reason") or row.get("judgement") or row.get("message") or "").strip()
        suggestion = str(
            row.get("suggestion")
            or row.get("action")
            or "\u5efa\u8bae\u7ed3\u5408\u5f53\u524d\u5de5\u51b5\u590d\u6838\u3002"
        ).strip()
        if not reason:
            continue
        items.append(
            ReportRiskItem(
                target=target,
                riskType=risk_type or "hydraulic_risk",
                level=_normalize_level(row.get("level") or row.get("priority")),
                reason=reason,
                suggestion=suggestion or "\u5efa\u8bae\u7ed3\u5408\u5f53\u524d\u5de5\u51b5\u590d\u6838\u3002",
                code=str(row.get("code") or risk_type or "").strip() or None,
                message=str(row.get("judgement") or row.get("message") or reason).strip() or None,
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
        action = str(row.get("action") or row.get("advice") or row.get("text") or "").strip()
        expected = str(row.get("expected") or "").strip()
        if not action:
            continue
        items.append(
            ReportSuggestionItem(
                target=target,
                reason=reason or "\u57fa\u4e8e\u5f53\u524d\u6c34\u529b\u7ed3\u679c\u4e0e\u98ce\u9669\u5224\u65ad\u751f\u6210\u3002",
                action=action,
                expected=expected or "\u7528\u4e8e\u964d\u4f4e\u5f53\u524d\u5de5\u51b5\u4e0b\u7684\u8fd0\u884c\u4e0d\u786e\u5b9a\u6027\u3002",
                priority=_normalize_priority(row.get("priority")),
                text=str(row.get("text") or row.get("advice") or action).strip() or None,
            )
        )

    return items or fallback


def build_hydraulic_report_ai_sections(ctx: dict[str, Any]) -> DynamicReportAiAnalysis:
    fallback = _build_fallback(ctx)
    fact_pack = _build_fact_pack(ctx)
    if not _as_record(fact_pack.get("resultMetrics")):
        return fallback

    try:
        llm = ChatOpenAI(
            api_key=settings.OPENAI_API_KEY,
            base_url=settings.OPENAI_API_BASE,
            model=settings.LLM_MODEL,
            temperature=0.2,
            max_tokens=min(settings.LLM_MAX_TOKENS, 1400),
            streaming=False,
        )
        prompt = "\n".join(
            [
                "你是一名管道输送与泵站运行分析专家，擅长基于真实计算结果、图表事实和规则识别结果，生成专业、可信、面向工程决策的水力分析报告。",
                "你的任务不是简单复述数据，而是基于输入事实做出有依据的分析判断。",
                "请严格遵守以下规则：",
                "1. 只能依据输入中提供的真实结果、图表事实、规则识别结果和方案信息进行分析，不得编造未提供的数据、结论或背景。",
                "2. 不要把报告写成固定模板填空，也不要机械重复无分析价值的统计句式。",
                "3. 优先提炼本次最值得关注的核心问题，再围绕该问题展开解释。",
                "4. 必须体现图表洞察，说明压头变化图、扬程构成图等图表反映出的运行状态。",
                "5. 必须对风险进行主次判断，而不是仅仅罗列风险项。",
                "6. 建议部分必须包含建议做什么、为什么这样做、预期会带来什么改善。",
                "7. 语言要专业、清晰、自然，风格接近工程分析报告。",
                "8. 若输入事实不足以支持某个判断，应明确说明“基于现有结果可初步判断”，不得强行下结论。",
                "9. 输出必须是合法 JSON，不要输出 markdown，不要加解释，不要出现多余前后缀。",
                "输出目标：",
                '{"headlineConclusion":"一句话核心结论","summary":["..."],"chartInsights":["..."],"riskPriorities":[{"target":"...","judgement":"...","reason":"...","level":"high|medium|low"}],"suggestions":[{"target":"...","advice":"...","reason":"...","expected":"...","priority":"high|medium|low"}]}',
                "补充要求：",
                "- headlineConclusion 只写 1 句话，直接指出当前最值得关注的核心问题或核心判断。",
                "- summary 写 2 到 4 条结果摘要，围绕当前工况、关键指标和结论展开。",
                "- chartInsights 写 2 到 4 条图表洞察，重点解释压头变化和扬程构成反映出的运行状态。",
                "- riskPriorities 最多 4 项，按优先级给出风险判断；若风险不明显，可返回空数组。",
                "- suggestions 最多 4 项，每项都要包含 advice、reason、expected；若依据不足，可返回空数组。",
                json.dumps({"facts": fact_pack}, ensure_ascii=False),
            ]
        )
        response = llm.invoke(prompt)
        parsed = _extract_json_object(getattr(response, "content", ""))
    except Exception as exc:  # noqa: BLE001
        logger.warning("Hydraulic dynamic AI analysis fell back to template output: %s", exc)
        return fallback

    headline = _clean_headline(parsed.get("headlineConclusion"))
    summary_lines = _clean_lines(parsed.get("summary"), 4)
    chart_insights = _clean_lines(parsed.get("chartInsights"), 4) or _clean_lines(parsed.get("metricAnalysis"), 4)
    summary = _merge_summary(headline, summary_lines, fallback.summary)
    metric_analysis = chart_insights or fallback.metricAnalysis
    risk_judgement = _coerce_risks(parsed.get("riskPriorities") or parsed.get("riskJudgement"), fallback.riskJudgement)
    suggestions = _coerce_suggestions(parsed.get("suggestions"), fallback.suggestions)

    return DynamicReportAiAnalysis(
        summary=summary,
        metricAnalysis=metric_analysis,
        riskJudgement=risk_judgement,
        suggestions=suggestions,
    )


__all__ = ["build_hydraulic_report_ai_sections"]
