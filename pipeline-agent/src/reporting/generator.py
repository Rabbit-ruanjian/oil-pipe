"""Compatibility entrypoint for dynamic report generation."""

from __future__ import annotations

from src.models.schemas import DynamicReportRequest, DynamicReportResponse

from .report_orchestrator import generate_report


def generate_dynamic_report(request: DynamicReportRequest) -> DynamicReportResponse:
    return generate_report(request)
