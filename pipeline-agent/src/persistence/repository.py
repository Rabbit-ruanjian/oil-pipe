"""Persistence repository for Agent v4 tables."""

from __future__ import annotations

import json
from typing import Any, Optional

from sqlalchemy import text

from src.tools.database_tools import get_engine
from src.utils import logger


def _execute(sql: str, params: dict) -> None:
    engine = get_engine()
    try:
        with engine.begin() as conn:
            conn.execute(text(sql), params)
    except Exception as exc:
        logger.debug(f"Persistence skipped: {exc}")


def save_trace_start(trace_id: str, session_id: str, user_input: str) -> None:
    """Insert or reset one trace header row."""

    sql = """
    INSERT INTO t_agent_trace
        (trace_id, session_id, user_input, status, create_time)
    VALUES
        (:trace_id, :session_id, :user_input, 'running', NOW())
    ON DUPLICATE KEY UPDATE
        session_id = VALUES(session_id),
        user_input = VALUES(user_input),
        status = 'running',
        final_response = NULL,
        plan_json = NULL,
        total_duration_ms = NULL,
        llm_calls = 0,
        tool_calls = 0,
        total_tokens = 0
    """
    _execute(sql, {
        "trace_id": trace_id,
        "session_id": session_id,
        "user_input": user_input,
    })


def save_trace_end(
    trace_id: str,
    status: str,
    final_response: Optional[str],
    plan: Any,
    metrics: dict,
) -> None:
    """Update trace summary row when workflow ends."""

    sql = """
    UPDATE t_agent_trace
    SET
        final_response = :final_response,
        plan_json = CAST(:plan_json AS JSON),
        status = :status,
        total_duration_ms = :total_duration_ms,
        llm_calls = :llm_calls,
        tool_calls = :tool_calls,
        total_tokens = :total_tokens
    WHERE trace_id = :trace_id
    """

    _execute(sql, {
        "trace_id": trace_id,
        "final_response": final_response,
        "plan_json": json.dumps(plan if isinstance(plan, list) else [], ensure_ascii=False),
        "status": status,
        "total_duration_ms": int(metrics.get("total_duration_ms", 0) or 0),
        "llm_calls": int(metrics.get("llm_calls", 0) or 0),
        "tool_calls": int(metrics.get("tool_calls", 0) or 0),
        "total_tokens": int(metrics.get("total_tokens", 0) or 0),
    })


def save_trace_event(
    trace_id: str,
    event_type: str,
    step_number: Optional[int],
    agent: Optional[str],
    data: dict,
    duration_ms: Optional[int],
    token_count: Optional[int],
) -> None:
    """Persist one trace event row."""

    sql = """
    INSERT INTO t_agent_trace_event
        (trace_id, event_type, step_number, agent, data, duration_ms, token_count, create_time)
    VALUES
        (:trace_id, :event_type, :step_number, :agent, CAST(:data AS JSON), :duration_ms, :token_count, NOW())
    """

    _execute(sql, {
        "trace_id": trace_id,
        "event_type": event_type,
        "step_number": step_number,
        "agent": agent,
        "data": json.dumps(data or {}, ensure_ascii=False),
        "duration_ms": duration_ms,
        "token_count": token_count,
    })


def save_hitl_request(
    request_id: str,
    trace_id: str,
    session_id: str,
    hitl_type: str,
    request_data: dict,
) -> None:
    """Persist HITL pending request."""

    sql = """
    INSERT INTO t_hitl_record
        (request_id, trace_id, session_id, hitl_type, request_data, status, create_time)
    VALUES
        (:request_id, :trace_id, :session_id, :hitl_type, CAST(:request_data AS JSON), 'pending', NOW())
    ON DUPLICATE KEY UPDATE
        trace_id = VALUES(trace_id),
        session_id = VALUES(session_id),
        hitl_type = VALUES(hitl_type),
        request_data = VALUES(request_data),
        response_data = NULL,
        status = 'pending',
        response_time = NULL
    """

    _execute(sql, {
        "request_id": request_id,
        "trace_id": trace_id,
        "session_id": session_id,
        "hitl_type": hitl_type,
        "request_data": json.dumps(request_data or {}, ensure_ascii=False),
    })


def save_hitl_response(request_id: str, response_data: dict, status: str = "responded") -> None:
    """Persist HITL response/timeout."""

    sql = """
    UPDATE t_hitl_record
    SET
        response_data = CAST(:response_data AS JSON),
        status = :status,
        response_time = NOW()
    WHERE request_id = :request_id
    """

    _execute(sql, {
        "request_id": request_id,
        "response_data": json.dumps(response_data or {}, ensure_ascii=False),
        "status": status,
    })


def upsert_kg_node(node_id: str, node_type: str, name: str, description: str, properties: dict) -> None:
    """Upsert one KG node row."""

    sql = """
    INSERT INTO t_kg_node
        (node_id, node_type, name, description, properties, create_time, update_time)
    VALUES
        (:node_id, :node_type, :name, :description, CAST(:properties AS JSON), NOW(), NOW())
    ON DUPLICATE KEY UPDATE
        node_type = VALUES(node_type),
        name = VALUES(name),
        description = VALUES(description),
        properties = VALUES(properties),
        update_time = NOW()
    """

    _execute(sql, {
        "node_id": node_id,
        "node_type": node_type,
        "name": name,
        "description": description,
        "properties": json.dumps(properties or {}, ensure_ascii=False),
    })


def upsert_kg_edge(
    source_id: str,
    target_id: str,
    edge_type: str,
    weight: float,
    properties: dict,
) -> None:
    """Upsert one KG edge row."""

    sql = """
    INSERT INTO t_kg_edge
        (source_id, target_id, edge_type, weight, properties, create_time)
    VALUES
        (:source_id, :target_id, :edge_type, :weight, CAST(:properties AS JSON), NOW())
    """

    _execute(sql, {
        "source_id": source_id,
        "target_id": target_id,
        "edge_type": edge_type,
        "weight": float(weight),
        "properties": json.dumps(properties or {}, ensure_ascii=False),
    })


def load_trace_summary(trace_id: str) -> Optional[dict]:
    """Load trace summary from database tables."""

    engine = get_engine()
    try:
        with engine.connect() as conn:
            header_sql = text(
                """
                SELECT trace_id, session_id, user_input, final_response, plan_json,
                       status, total_duration_ms, llm_calls, tool_calls, total_tokens
                FROM t_agent_trace
                WHERE trace_id = :trace_id
                """
            )
            header = conn.execute(header_sql, {"trace_id": trace_id}).mappings().first()
            if header is None:
                return None

            event_sql = text(
                """
                SELECT event_type, step_number, agent, data, duration_ms, token_count, create_time
                FROM t_agent_trace_event
                WHERE trace_id = :trace_id
                ORDER BY id ASC
                """
            )
            events = conn.execute(event_sql, {"trace_id": trace_id}).mappings().all()

        timeline = []
        for event in events:
            data_raw = event.get("data")
            data = data_raw if isinstance(data_raw, dict) else {}
            timeline.append(
                {
                    "type": event.get("event_type"),
                    "timestamp": str(event.get("create_time")),
                    "step": event.get("step_number"),
                    "agent": event.get("agent"),
                    "duration_ms": event.get("duration_ms"),
                    "data": data,
                }
            )

        return {
            "trace_id": header.get("trace_id"),
            "session_id": header.get("session_id"),
            "user_input": header.get("user_input"),
            "final_response": header.get("final_response"),
            "status": header.get("status"),
            "plan": header.get("plan_json") if isinstance(header.get("plan_json"), list) else [],
            "metrics": {
                "total_duration_ms": int(header.get("total_duration_ms") or 0),
                "llm_calls": int(header.get("llm_calls") or 0),
                "tool_calls": int(header.get("tool_calls") or 0),
                "total_tokens": int(header.get("total_tokens") or 0),
            },
            "event_count": len(timeline),
            "timeline": timeline,
        }
    except Exception as exc:
        logger.debug(f"load_trace_summary skipped: {exc}")
        return None
