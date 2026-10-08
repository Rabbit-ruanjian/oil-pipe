"""Shared helpers for normalizing agent outputs across workflow and MCP."""

from __future__ import annotations

import json
from typing import Any


RESULT_CONTRACT_VERSION = 1
LEGACY_RESPONSE_FORMAT = "legacy"
CONTRACT_RESPONSE_FORMAT = "contract"


def is_result_contract(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and value.get("version") == RESULT_CONTRACT_VERSION
        and isinstance(value.get("agent"), str)
        and isinstance(value.get("kind"), str)
    )


def extract_structured_content(value: Any) -> Any | None:
    if is_result_contract(value):
        data = value.get("data")
        if data is not None:
            return data
        text = value.get("text")
        if isinstance(text, str):
            return _parse_json_candidate(text)
        return None

    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        return _parse_json_candidate(value.strip())
    return None


def result_to_text(value: Any) -> str:
    if value is None:
        return ""
    if is_result_contract(value):
        text = value.get("text")
        if isinstance(text, str):
            return text
        data = value.get("data")
        if data is not None:
            return _safe_json_dumps(data)
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (dict, list)):
        return _safe_json_dumps(value)
    return str(value)


def result_to_data(value: Any) -> dict:
    if is_result_contract(value):
        data = value.get("data")
        if isinstance(data, dict):
            if "data" in data and data.get("success") is True:
                return data["data"] if isinstance(data["data"], dict) else data
            return data
        if isinstance(data, list):
            return {"items": data}
        return {"raw": result_to_text(value)}

    structured = extract_structured_content(value)
    if isinstance(structured, dict):
        if "data" in structured and structured.get("success") is True:
            return structured["data"] if isinstance(structured["data"], dict) else structured
        return structured
    if isinstance(structured, list):
        return {"items": structured}
    return {"raw": value}


def is_error_result(value: Any) -> bool:
    if is_result_contract(value):
        return not bool(value.get("success", True)) or value.get("kind") == "error"

    if isinstance(value, dict):
        if value.get("success") is False:
            return True
        error = value.get("error")
        if isinstance(error, str) and error.strip():
            return True
        message = value.get("message")
        if isinstance(message, str) and _looks_like_error_text(message):
            return True
        return False

    if isinstance(value, str):
        return _looks_like_error_text(value)

    return False


def build_result_contract(agent_name: str, value: Any) -> dict:
    if is_result_contract(value):
        return value

    structured = extract_structured_content(value)
    kind = "error" if is_error_result(value) else "data" if structured is not None else "text"

    return {
        "version": RESULT_CONTRACT_VERSION,
        "agent": agent_name,
        "kind": kind,
        "success": kind != "error",
        "text": result_to_text(value),
        "data": structured,
    }


def wants_contract(args: dict[str, Any]) -> bool:
    response_format = str(args.get("response_format", LEGACY_RESPONSE_FORMAT)).strip().lower()
    return response_format == CONTRACT_RESPONSE_FORMAT


def _parse_json_candidate(text: str) -> Any | None:
    if not text:
        return None

    parsed = _try_json_loads(text)
    if parsed is not None:
        return parsed

    for left, right in (("{", "}"), ("[", "]")):
        start = text.find(left)
        end = text.rfind(right)
        if start != -1 and end > start:
            parsed = _try_json_loads(text[start : end + 1])
            if parsed is not None:
                return parsed

    return None


def _try_json_loads(text: str) -> Any | None:
    try:
        return json.loads(text)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None


def _safe_json_dumps(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, default=str)
    except Exception:
        return str(value)


def _looks_like_error_text(text: str) -> bool:
    normalized = text.strip()
    if not normalized:
        return False
    if len(normalized) > 200:
        return False

    lower = normalized.lower()
    error_prefixes = (
        "\u9519\u8bef:",
        "\u5931\u8d25:",
        "\u5f02\u5e38:",
        "\u8c03\u7528\u5931\u8d25",
        "\u67e5\u8be2\u5931\u8d25",
        "\u8ba1\u7b97\u5931\u8d25",
        "\u77e5\u8bc6\u68c0\u7d22\u5931\u8d25",
        "error:",
        "failed:",
        "exception:",
    )
    return any(lower.startswith(prefix) for prefix in error_prefixes)
