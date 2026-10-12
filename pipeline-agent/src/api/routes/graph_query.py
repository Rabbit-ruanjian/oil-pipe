"""Knowledge graph query routes."""

from __future__ import annotations

from typing import Any, Optional

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from src.agents import get_graph_agent
from src.models.schemas import GraphQueryResponse

router = APIRouter(prefix="/graph", tags=["Graph"])


def _json_sanitize(obj: Any) -> Any:
    """把 numpy 标量/数组递归转成 JSON 可序列化的 Python 原生类型。

    GraphAgent 结果里混有 numpy.float32（社区/边向量分数、PageRank），
    直接进 JSONResponse 会抛 "Unable to serialize unknown type"。
    """
    if isinstance(obj, dict):
        return {k: _json_sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [_json_sanitize(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, np.generic):
        return obj.item()
    return obj


@router.get("/query", response_model=GraphQueryResponse)
async def query_graph(
    query: str = Query(..., min_length=1, max_length=500),
    query_type: Optional[str] = Query(
        default=None,
        description=(
            "P1 结构化入参：fault_cause / standards / equipment_chain / general；"
            "缺省时由 GraphAgent 按 LLM 自动判定或走 general。"
        ),
    ),
):
    """Query knowledge graph for relations or causal chains.

    ``query_type``（P1）显式暴露结构化查询类型，透传给 GraphAgent.execute；
    缺省为 None 时行为与改造前一致（走 LLM/默认路径）。
    """

    try:
        result = get_graph_agent().execute(query, query_type=query_type)
        return GraphQueryResponse(query=query, result=_json_sanitize(result))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
