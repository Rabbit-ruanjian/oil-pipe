from __future__ import annotations

import json
from typing import Any

from langchain_openai import ChatOpenAI

from src.config import settings
from src.models.schemas import DynamicReportRequest
from src.utils import logger


def explain_report(payload: dict[str, Any], request: DynamicReportRequest) -> dict[str, Any]:
    try:
        llm = ChatOpenAI(
            api_key=settings.OPENAI_API_KEY,
            base_url=settings.OPENAI_API_BASE,
            model=settings.LLM_MODEL,
            temperature=0.1,
            max_tokens=min(settings.LLM_MAX_TOKENS, 1800),
            streaming=False,
        )
        prompt = "\n".join(
            [
                "你是工业输油业务的报告撰写助手。",
                "你只能基于输入中的 facts 和 outline 写内容，不允许编造任何数值、对象、时间点、原因或结论。",
                "如果证据不足，必须明确写出“数据不足，无法下结论”。",
                "你只能输出 JSON，字段仅允许包含 title、abstract、summary、highlights、conclusion、section_summaries。",
                "summary 和 highlights 必须是字符串数组。",
                "section_summaries 必须是对象，key 为 section id，value 为一句中文摘要。",
                json.dumps(payload, ensure_ascii=False),
            ]
        )
        response = llm.invoke(prompt)
        text = getattr(response, "content", "") if response is not None else ""
        cleaned = str(text).replace("```json", "").replace("```", "").strip()
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            cleaned = cleaned[start : end + 1]
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, dict) else {}
    except Exception as exc:  # noqa: BLE001
        logger.warning("LLM explanation skipped for dynamic report: %s", exc)
        return {}
