"""
聊天 API 路由 — 真流式实现。
使用 LangGraph astream_events 实现 token 级 SSE 流式输出。
"""

from __future__ import annotations

import json
import time
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from src.utils import generate_session_id, generate_trace_id, logger
from src.workflows.graph import get_workflow

router = APIRouter(prefix="/chat", tags=["chat"])


# ═══════════════════════════════════════════════════════════════
# 请求/响应模型
# ═══════════════════════════════════════════════════════════════


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    stream: bool = True


class HITLConfirmRequest(BaseModel):
    session_id: str
    selected_option: Optional[str] = None
    comment: Optional[str] = None
    modified_data: Optional[dict] = None
    request_id: Optional[str] = None


# ═══════════════════════════════════════════════════════════════
# POST /chat — 非流式（保留兼容）
# ═══════════════════════════════════════════════════════════════


@router.post("")
async def chat(request: ChatRequest):
    """非流式聊天接口。所有输入都经过 LLM，无硬编码路由。"""
    session_id = request.session_id or generate_session_id()
    trace_id = generate_trace_id()
    workflow = get_workflow()

    start_time = time.time()
    result = await workflow.ainvoke(
        user_input=request.message,
        session_id=session_id,
        trace_id=trace_id,
    )
    elapsed = int((time.time() - start_time) * 1000)

    result["execution_time_ms"] = elapsed
    return result


# ═══════════════════════════════════════════════════════════════
# POST /chat/stream — 真流式 SSE
# ═══════════════════════════════════════════════════════════════


@router.post("/stream")
async def chat_stream(request: ChatRequest):
    """
    真流式聊天接口。
    使用 LangGraph astream_events 实现 token 级 SSE。

    SSE 事件类型：
      - trace_init:      {session_id, trace_id}
      - response_chunk:  {chunk}           — 每个 LLM token
      - tool_start:      {tool, input}     — 工具开始执行
      - tool_end:        {tool, output}    — 工具执行完成
      - hitl_waiting:    {...}             — 等待用户确认
      - final_response:  {response, session_id, intent, tool_calls, ...}
      - error:           {error}
    """
    session_id = request.session_id or generate_session_id()
    trace_id = generate_trace_id()
    workflow = get_workflow()

    async def generate():
        # 1. 发送 trace_init
        yield {
            "event": "trace_init",
            "data": json.dumps(
                {
                    "session_id": session_id,
                    "trace_id": trace_id,
                    "timestamp": time.time(),
                }
            ),
        }

        # 2. 真流式：逐 token / 逐工具事件发送
        try:
            async for item in workflow.astream(
                user_input=request.message,
                session_id=session_id,
            ):
                item_type = item.get("type")

                if item_type == "token":
                    yield {
                        "event": "response_chunk",
                        "data": json.dumps({"chunk": item["content"]}),
                    }

                elif item_type == "tool_start":
                    yield {
                        "event": "tool_start",
                        "data": json.dumps(
                            {
                                "tool": item["tool"],
                                "call_id": item.get("call_id", ""),
                                "input": item.get("input", {}),
                                "timestamp": time.time(),
                            }
                        ),
                    }

                elif item_type == "tool_end":
                    yield {
                        "event": "tool_end",
                        "data": json.dumps(
                            {
                                "tool": item["tool"],
                                "call_id": item.get("call_id", ""),
                                "output": item.get("output", ""),
                                "timestamp": time.time(),
                            }
                        ),
                    }

                elif item_type == "hitl_waiting":
                    yield {
                        "event": "hitl_waiting",
                        "data": json.dumps(
                            {
                                **item.get("data", {}),
                                "timestamp": time.time(),
                            },
                            ensure_ascii=False,
                        ),
                    }

                elif item_type == "done":
                    response_data = item.get("response", {})
                    response_data["trace_id"] = trace_id
                    yield {
                        "event": "final_response",
                        "data": json.dumps(response_data),
                    }

                elif item_type == "error":
                    yield {
                        "event": "error",
                        "data": json.dumps(
                            {
                                "error": item.get("error", "未知错误"),
                                "timestamp": time.time(),
                            }
                        ),
                    }

        except Exception as exc:
            logger.error(f"Stream generation failed: {exc}")
            yield {
                "event": "error",
                "data": json.dumps({"error": str(exc)}),
            }

    return EventSourceResponse(generate())


# ═══════════════════════════════════════════════════════════════
# POST /chat/confirm — HITL 确认（真实恢复执行）
# ═══════════════════════════════════════════════════════════════


@router.post("/confirm")
async def chat_confirm(request: HITLConfirmRequest):
    """
    HITL 确认接口。
    前端用户选择泵方案后调用此接口，恢复被 interrupt() 暂停的子图。
    """
    workflow = get_workflow()

    user_choice = {
        "selected_option": request.selected_option,
        "comment": request.comment or "",
        "modified_data": request.modified_data,
        "request_id": request.request_id,
    }

    result = await workflow.resume_from_hitl(
        session_id=request.session_id,
        user_choice=user_choice,
    )

    return result


# ═══════════════════════════════════════════════════════════════
# GET /chat/history/{session_id} — 会话历史
# ═══════════════════════════════════════════════════════════════


@router.get("/history/{session_id}")
async def chat_history(session_id: str):
    """获取会话历史。从 LangGraph checkpointer 读取。"""
    workflow = get_workflow()
    state = workflow.get_state(session_id)

    if not state:
        return {"session_id": session_id, "messages": []}

    messages = state.get("messages", [])
    history = []
    for msg in messages:
        msg_type = getattr(msg, "type", "unknown")
        content = getattr(msg, "content", "")
        if msg_type in ("human", "ai"):
            history.append(
                {
                    "role": "user" if msg_type == "human" else "assistant",
                    "content": content,
                }
            )

    return {"session_id": session_id, "messages": history}
