"""Trace query routes."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from src.models.schemas import TraceSummaryResponse
from src.observability import get_trace_summary, list_trace_ids
from src.persistence import load_trace_summary

router = APIRouter(prefix="/trace", tags=["Trace"])


@router.get("", summary="List active trace ids")
async def list_traces():
    return {"trace_ids": list_trace_ids()}


@router.get("/{trace_id}", response_model=TraceSummaryResponse)
async def get_trace(trace_id: str):
    summary = get_trace_summary(trace_id)
    if summary is None:
        summary = load_trace_summary(trace_id)
    if summary is None:
        raise HTTPException(status_code=404, detail="trace not found")

    return TraceSummaryResponse(
        trace_id=summary.get("trace_id", trace_id),
        metrics=summary.get("metrics", {}),
        event_count=summary.get("event_count", 0),
        timeline=summary.get("timeline", []),
    )
