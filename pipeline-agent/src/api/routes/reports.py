"""Dynamic report routes."""

from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool

from src.models.schemas import DynamicReportRequest, DynamicReportResponse
from src.reporting import generate_dynamic_report

router = APIRouter(prefix="/reports", tags=["reports"])


@router.post("/generate", response_model=DynamicReportResponse)
async def generate_report(request: DynamicReportRequest) -> DynamicReportResponse:
    """Generate a dynamic report using rules-first analysis and optional LLM polishing."""

    return await run_in_threadpool(generate_dynamic_report, request)
