"""Chat API v2 with unified multi-channel streaming protocol."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from src.streaming import StreamEventProcessor
from src.utils import generate_session_id, generate_trace_id, logger
from src.workflows.graph import get_workflow

router = APIRouter(prefix="/chat", tags=["chat-v2"])


class ChatV2Request(BaseModel):
    message: str
    session_id: Optional[str] = None
    stream: bool = True


class HITLConfirmRequest(BaseModel):
    session_id: str
    selected_option: Optional[str] = None
    comment: Optional[str] = None
    modified_data: Optional[dict] = None
    request_id: Optional[str] = None


@router.post("/stream")
async def chat_stream_v2(request: ChatV2Request):
    """Unified stream endpoint for v2 frontend clients."""
    session_id = request.session_id or generate_session_id()
    trace_id = generate_trace_id()
    workflow = get_workflow()
    processor = StreamEventProcessor(trace_id=trace_id)

    async def generate():
        # initialization event
        yield processor.trace_init(session_id=session_id)

        try:
            async for item in workflow.astream(
                user_input=request.message,
                session_id=session_id,
            ):
                packets = processor.map_workflow_item(item)
                for packet in packets:
                    yield packet
        except Exception as exc:
            logger.error(f"v2 stream failed: {exc}")
            for packet in processor.map_workflow_item({"type": "error", "error": str(exc)}):
                yield packet

    return EventSourceResponse(generate())


@router.post("/confirm")
async def chat_confirm_v2(request: HITLConfirmRequest):
    """HITL confirm endpoint compatible with v2 stream clients."""
    workflow = get_workflow()
    user_choice = {
        "selected_option": request.selected_option,
        "comment": request.comment or "",
        "modified_data": request.modified_data,
        "request_id": request.request_id,
    }
    return await workflow.resume_from_hitl(
        session_id=request.session_id,
        user_choice=user_choice,
    )

