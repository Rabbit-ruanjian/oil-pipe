"""Knowledge graph query routes."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from src.agents import get_graph_agent
from src.models.schemas import GraphQueryResponse

router = APIRouter(prefix="/graph", tags=["Graph"])


@router.get("/query", response_model=GraphQueryResponse)
async def query_graph(query: str = Query(..., min_length=1, max_length=500)):
    """Query knowledge graph for relations or causal chains."""

    try:
        result = get_graph_agent().execute(query)
        return GraphQueryResponse(query=query, result=result)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
