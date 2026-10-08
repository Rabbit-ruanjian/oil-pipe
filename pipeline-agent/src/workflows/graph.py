"""
ReAct 主图 - 所有用户输入均由 LLM 处理，LLM 自主决定是否调用工具。
不存在任何硬编码路由或规则拦截。

架构：
  START --> agent --> tools_condition --> tools --> agent（循环）
                                      -> __end__（结束）
"""

from __future__ import annotations

import json
import time
from typing import Any, Dict, List, Optional

from langchain_core.messages import SystemMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import MessagesState, START, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition
from langgraph.types import Command

from src.agents.knowledge_agent import get_knowledge_agent
from src.config import settings
from src.mcp import ensure_builtin_mcp_servers_sync
from src.skills import get_skill_runtime
from src.tool_search import get_tool_search_engine
from src.tools.mcp_langchain_adapter import get_mcp_langchain_tools
from src.tools.agent_tools import (
    ALWAYS_LOADED_TOOL_NAMES,
    get_all_registered_tool_names,
    get_tools_by_names,
)
from src.utils import generate_session_id, logger

_base_llm: Optional[ChatOpenAI] = None
_final_llm: Optional[ChatOpenAI] = None
_llm_tools_cache: Dict[str, Any] = {}
_workflow_tools_cache: Dict[str, List[Any]] = {}
_skill_runtime = get_skill_runtime()


def _get_base_llm() -> ChatOpenAI:
    global _base_llm
    if _base_llm is None:
        model_name = settings.tool_calling_model_name
        if model_name != settings.router_model_name:
            logger.warning(
                "Router model '{}' does not support tool calling in workflow, fallback to '{}'",
                settings.router_model_name,
                model_name,
            )
        _base_llm = ChatOpenAI(
            api_key=settings.OPENAI_API_KEY,
            base_url=settings.OPENAI_API_BASE,
            model=model_name,
            temperature=settings.LLM_TEMPERATURE,
            max_tokens=settings.LLM_MAX_TOKENS,
            streaming=True,
        )
    return _base_llm


def _get_final_llm() -> ChatOpenAI:
    global _final_llm
    if _final_llm is None:
        _final_llm = ChatOpenAI(
            api_key=settings.OPENAI_API_KEY,
            base_url=settings.OPENAI_API_BASE,
            model=settings.final_synthesis_model_name,
            temperature=settings.LLM_TEMPERATURE,
            max_tokens=settings.LLM_MAX_TOKENS,
            streaming=False,
        )
    return _final_llm


def _get_react_system_prompt() -> str:
    return _skill_runtime.get_prompt("chat-orchestrator", "system")


def _get_final_synthesis_prompt() -> str:
    return _skill_runtime.get_prompt("final-synthesis", "system")


def _extract_latest_user_query(messages: List[Any]) -> str:
    for message in reversed(messages):
        if isinstance(message, dict) and message.get("role") == "user":
            return str(message.get("content", ""))
        msg_type = getattr(message, "type", "")
        if msg_type == "human":
            return str(getattr(message, "content", ""))
    if messages:
        return str(getattr(messages[-1], "content", ""))
    return ""


def _merge_tool_names(always_loaded: List[str], dynamic: List[str]) -> List[str]:
    merged: List[str] = []
    seen = set()
    known_names = set(get_all_registered_tool_names())
    for name in always_loaded + dynamic:
        if name in seen:
            continue
        if name not in known_names:
            continue
        merged.append(name)
        seen.add(name)
    return merged


def _parse_csv_setting(raw: str) -> List[str]:
    return [item.strip() for item in str(raw).split(",") if item.strip()]


def _select_active_tools(user_query: str) -> Dict[str, Any]:
    if not settings.TOOL_SEARCH_ENABLED:
        names = get_all_registered_tool_names()
        return {
            "selected_names": names,
            "scored_tools": [{"name": name, "score": 1.0, "forced": False} for name in names],
            "total_tools": len(names),
            "duration_ms": 0.0,
            "mode": "all",
        }

    started = time.perf_counter()
    search_engine = get_tool_search_engine()
    allowed_categories = _parse_csv_setting(settings.TOOL_SEARCH_ALLOWED_CATEGORIES)
    allowed_sources = _parse_csv_setting(settings.TOOL_SEARCH_ALLOWED_SOURCES)
    dynamic_scored = search_engine.search_with_scores(
        user_query,
        top_k=max(1, settings.TOOL_SEARCH_TOP_K),
        min_score=max(0.0, settings.TOOL_SEARCH_MIN_SCORE),
        categories=allowed_categories or None,
        sources=allowed_sources or None,
    )
    # 低分兜底，避免因为阈值过高导致无工具可用。
    if not dynamic_scored:
        dynamic_scored = search_engine.search_with_scores(
            user_query,
            top_k=max(1, settings.TOOL_SEARCH_TOP_K),
            min_score=0.0,
            categories=allowed_categories or None,
            sources=allowed_sources or None,
        )

    dynamic_tools = [name for name, _ in dynamic_scored]
    selected = _merge_tool_names(ALWAYS_LOADED_TOOL_NAMES, dynamic_tools)
    if not selected:
        selected = get_all_registered_tool_names()

    score_map = {name: float(score) for name, score in dynamic_scored}
    scored_tools = []
    for name in selected:
        scored_tools.append(
            {
                "name": name,
                "score": round(score_map.get(name, 1.0 if name in ALWAYS_LOADED_TOOL_NAMES else 0.0), 4),
                "forced": name in ALWAYS_LOADED_TOOL_NAMES and name not in score_map,
            }
        )

    duration_ms = round((time.perf_counter() - started) * 1000, 2)
    return {
        "selected_names": selected,
        "scored_tools": scored_tools,
        "total_tools": len(get_all_registered_tool_names()),
        "duration_ms": duration_ms,
        "mode": "hybrid",
        "filters": {
            "categories": allowed_categories,
            "sources": allowed_sources,
        },
    }


def _get_llm_with_tools(tool_names: List[str]) -> Any:
    selected_names = [name for name in tool_names if name in get_all_registered_tool_names()]
    if not selected_names:
        selected_names = get_all_registered_tool_names()

    cache_key = "|".join(sorted(selected_names))
    cached = _llm_tools_cache.get(cache_key)
    if cached is not None:
        return cached

    selected_tools = _get_workflow_tools(selected_names)
    llm_with_tools = _get_base_llm().bind_tools(selected_tools)
    _llm_tools_cache[cache_key] = llm_with_tools
    return llm_with_tools


def _get_workflow_tools(tool_names: List[str]) -> List[Any]:
    selected_names = [name for name in tool_names if name in get_all_registered_tool_names()]
    if not selected_names:
        selected_names = get_all_registered_tool_names()

    cache_key = "|".join(sorted(selected_names))
    cached = _workflow_tools_cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        mcp_tools = get_mcp_langchain_tools(
            ["database-mcp", "calculation-mcp", "knowledge-mcp"],
            include_tools=selected_names,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Workflow MCP tool resolution fallback triggered: {}", exc)
        mcp_tools = []
    resolved_names = {tool.name for tool in mcp_tools}
    missing_names = [name for name in selected_names if name not in resolved_names]
    fallback_tools = get_tools_by_names(missing_names)
    combined_tools = mcp_tools + fallback_tools

    _workflow_tools_cache[cache_key] = combined_tools
    return combined_tools


def _get_all_workflow_tool_names() -> List[str]:
    """Return the full workflow-executable tool set after builtin MCP sync."""
    ensure_builtin_mcp_servers_sync(["database-mcp", "calculation-mcp", "knowledge-mcp"])
    return get_all_registered_tool_names()


def _synthesize_final_response(
    *,
    user_input: str,
    draft_response: str,
    tool_calls: List[Dict[str, Any]],
) -> str:
    """Use the stronger synthesis model to produce the final user-facing answer."""

    if not draft_response and not tool_calls:
        return draft_response

    try:
        prompt = ChatPromptTemplate.from_messages([
            ("system", _get_final_synthesis_prompt()),
            (
                "human",
                "用户问题:\n{user_input}\n\n草稿回答:\n{draft_response}\n\n工具调用记录(JSON):\n{tool_calls}",
            ),
        ])
        chain = prompt | _get_final_llm() | StrOutputParser()
        synthesized = chain.invoke(
            {
                "user_input": user_input,
                "draft_response": draft_response,
                "tool_calls": json.dumps(tool_calls, ensure_ascii=False, default=str),
            }
        ).strip()
        return synthesized or draft_response
    except Exception as exc:
        logger.warning(f"Final synthesis fallback to draft response: {exc}")
        return draft_response


def _maybe_apply_knowledge_fallback(
    *,
    user_input: str,
    draft_response: str,
    tool_calls: List[Dict[str, Any]],
) -> str:
    """Use KB answer as a final fallback when the model skipped tools but retrieval is strong."""
    if tool_calls:
        return draft_response

    try:
        knowledge_agent = get_knowledge_agent()
        sources = knowledge_agent.search_knowledge(user_input, top_k=3)
        if not sources:
            return draft_response

        top_score = 0.0
        for source in sources:
            try:
                top_score = max(top_score, float(source.get("score", 0.0) or 0.0))
            except (TypeError, ValueError):
                continue

        if top_score < 0.45:
            return draft_response

        answer = knowledge_agent.execute(user_input)
        if answer:
            logger.info(
                "Applied knowledge fallback for query='{}' with top_score={}",
                user_input[:80],
                round(top_score, 4),
            )
            return answer
    except Exception as exc:
        logger.warning(f"Knowledge fallback skipped: {exc}")

    return draft_response


# ═══════════════════════════════════════════════════════════════
# 图节点 — 没有任何硬编码路由，没有 _is_trivial_chat
# ═══════════════════════════════════════════════════════════════


def agent_node(state: MessagesState) -> dict:
    """
    ReAct Agent 核心节点。
    所有用户输入都经过 LLM，由 LLM 自主决定是直接回复还是调用工具。
    没有任何 if-else 快速路径。
    """
    messages = state["messages"]
    user_query = _extract_latest_user_query(list(messages))
    selection = _select_active_tools(user_query)
    active_tool_names = selection["selected_names"]
    llm = _get_llm_with_tools(active_tool_names)
    logger.info(
        "Tool search selected {} tools for query='{}' (mode={}, {}ms): {}",
        len(active_tool_names),
        user_query[:80],
        selection.get("mode", "hybrid"),
        selection.get("duration_ms", 0.0),
        ", ".join(active_tool_names),
    )
    full_messages = [SystemMessage(content=_get_react_system_prompt())] + list(messages)
    response = llm.invoke(full_messages)
    return {"messages": [response]}


# ═══════════════════════════════════════════════════════════════
# 构建主图
# ═══════════════════════════════════════════════════════════════


def create_react_graph() -> StateGraph:
    graph = StateGraph(MessagesState)
    graph.add_node("agent", agent_node)
    graph.add_node("tools", ToolNode(_get_workflow_tools(_get_all_workflow_tool_names())))
    graph.add_edge(START, "agent")
    graph.add_conditional_edges("agent", tools_condition)
    graph.add_edge("tools", "agent")
    return graph


# ═══════════════════════════════════════════════════════════════
# AgentWorkflow 封装
# ═══════════════════════════════════════════════════════════════


class AgentWorkflow:
    def __init__(self):
        self.graph = create_react_graph()
        self.checkpointer = MemorySaver()
        self.app = self.graph.compile(checkpointer=self.checkpointer)

    def invoke(
        self,
        user_input: str,
        session_id: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        session_id = session_id or generate_session_id()
        config = {"configurable": {"thread_id": session_id}}
        try:
            result = self.app.invoke(
                {"messages": [{"role": "user", "content": user_input}]},
                config=config,
            )
            return self._build_response(result, session_id, trace_id)
        except Exception as exc:
            logger.error(f"Workflow invoke failed: {exc}")
            return {
                "response": f"处理失败: {exc}",
                "session_id": session_id,
                "trace_id": trace_id or "",
                "error": str(exc),
            }

    async def ainvoke(
        self,
        user_input: str,
        session_id: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        session_id = session_id or generate_session_id()
        config = {"configurable": {"thread_id": session_id}}
        try:
            result = await self.app.ainvoke(
                {"messages": [{"role": "user", "content": user_input}]},
                config=config,
            )
            return self._build_response(result, session_id, trace_id)
        except Exception as exc:
            logger.error(f"Workflow ainvoke failed: {exc}")
            return {
                "response": f"处理失败: {exc}",
                "session_id": session_id,
                "trace_id": trace_id or "",
                "error": str(exc),
            }

    async def astream(self, user_input: str, session_id: str):
        """
        真流式输出。使用 LangGraph 的 astream_events(version="v2")。

        yield 的每个 item 是一个 dict：
          {"type": "tool_search", "query": "...", "selected_tools": [...]} — 动态工具选择
          {"type": "token", "content": "..."}           — LLM 输出的文本 token
          {"type": "tool_start", "tool": "...", "input": {...}}  — 工具开始执行
          {"type": "tool_end", "tool": "...", "output": "..."}   — 工具执行完成
          {"type": "done", "response": {...}}            — 流结束
          {"type": "error", "error": "..."}              — 出错
        """
        config = {"configurable": {"thread_id": session_id}}
        input_data = {"messages": [{"role": "user", "content": user_input}]}
        final_content = ""
        tool_calls_record = []

        # 先向上游输出本轮动态工具选择结果，便于前端 trace 展示。
        selection = _select_active_tools(user_input)
        yield {
            "type": "tool_search",
            "query": user_input,
            "selected_tools": selection["selected_names"],
            "selected_scores": selection["scored_tools"],
            "total_tools": selection["total_tools"],
            "duration_ms": selection["duration_ms"],
            "mode": selection["mode"],
            "filters": selection.get("filters", {}),
        }

        try:
            async for event in self.app.astream_events(
                input_data, config=config, version="v2"
            ):
                kind = event["event"]

                if kind == "on_chat_model_stream":
                    chunk = event["data"].get("chunk")
                    if chunk and hasattr(chunk, "content") and chunk.content:
                        if not (hasattr(chunk, "tool_calls") and chunk.tool_calls):
                            final_content += chunk.content
                            yield {"type": "token", "content": chunk.content}

                elif kind == "on_tool_start":
                    tool_name = event.get("name", "")
                    tool_input = event.get("data", {}).get("input", {})
                    call_id = str(event.get("run_id") or event.get("id") or "")
                    tool_calls_record.append(
                        {
                            "tool": tool_name,
                            "args": tool_input,
                            "call_id": call_id,
                        }
                    )
                    yield {
                        "type": "tool_start",
                        "tool": tool_name,
                        "call_id": call_id,
                        "input": tool_input,
                    }

                elif kind == "on_tool_end":
                    tool_name = event.get("name", "")
                    call_id = str(event.get("run_id") or event.get("id") or "")
                    tool_output = str(event.get("data", {}).get("output", ""))

                    # 子图 HITL 中断桥接：识别 [HITL_WAITING]{...} 标记并向上层抛出事件
                    if tool_output.startswith("[HITL_WAITING]"):
                        hitl_payload = tool_output[len("[HITL_WAITING]") :]
                        try:
                            hitl_data = json.loads(hitl_payload)
                        except Exception:
                            hitl_data = {"raw": hitl_payload}
                        yield {"type": "hitl_waiting", "data": hitl_data}

                    if len(tool_output) > 1000:
                        tool_output = tool_output[:1000] + "...(已截断)"
                    yield {
                        "type": "tool_end",
                        "tool": tool_name,
                        "call_id": call_id,
                        "output": tool_output,
                    }

            # 流结束，从 checkpointer 获取最终内容
            state = self.app.get_state(config)
            if state and state.values:
                msgs = state.values.get("messages", [])
                if msgs and hasattr(msgs[-1], "content") and msgs[-1].content:
                    final_content = msgs[-1].content

            final_content = _synthesize_final_response(
                user_input=user_input,
                draft_response=final_content,
                tool_calls=tool_calls_record,
            )
            final_content = _maybe_apply_knowledge_fallback(
                user_input=user_input,
                draft_response=final_content,
                tool_calls=tool_calls_record,
            )
            intent = self._infer_intent(tool_calls_record)
            yield {
                "type": "done",
                "response": {
                    "response": final_content,
                    "session_id": session_id,
                    "intent": intent,
                    "tool_calls": tool_calls_record,
                    "sources": [],
                    "confidence": 0.85 if tool_calls_record else 0.95,
                },
            }
        except Exception as exc:
            logger.error(f"Workflow astream failed: {exc}")
            yield {"type": "error", "error": str(exc)}

    async def resume_from_hitl(self, session_id: str, user_choice: dict) -> Dict[str, Any]:
        """从 HITL 中断恢复执行。"""
        # 优先恢复 Plan-and-Execute 子图（通过 request_id 桥接）
        request_id = str(user_choice.get("request_id", "")).strip()
        if request_id:
            try:
                from src.workflows.subgraph import resume_plan_execute

                resumed = resume_plan_execute(request_id=request_id, user_choice=user_choice)
                resumed_status = resumed.get("status")

                if resumed_status == "completed":
                    return {
                        "response": str(resumed.get("response", "")),
                        "session_id": session_id,
                        "trace_id": "",
                        "intent": "complex",
                        "sources": [],
                        "confidence": 0.9,
                        "tool_calls": [{"tool": "plan_complex_task", "args": {"request_id": request_id}}],
                    }

                if resumed_status == "hitl_waiting":
                    return {
                        "response": "任务仍需人工确认，请继续选择方案。",
                        "session_id": session_id,
                        "trace_id": "",
                        "intent": "complex",
                        "sources": [],
                        "confidence": 0.85,
                        "tool_calls": [{"tool": "plan_complex_task", "args": {"request_id": request_id}}],
                        "hitl_request": resumed.get("hitl_data"),
                    }

                if resumed_status == "error":
                    return {
                        "response": f"恢复执行失败: {resumed.get('error', '未知错误')}",
                        "session_id": session_id,
                        "trace_id": "",
                        "error": str(resumed.get("error", "")),
                    }
            except Exception as exc:
                logger.error(f"Subgraph resume bridge failed: {exc}")

        # 回退：尝试主图级 Command(resume)
        config = {"configurable": {"thread_id": session_id}}
        try:
            result = await self.app.ainvoke(
                Command(resume=user_choice), config=config
            )
            return self._build_response(result, session_id, None)
        except Exception as exc:
            logger.error(f"HITL resume failed: {exc}")
            return {
                "response": f"恢复执行失败: {exc}",
                "session_id": session_id,
                "trace_id": "",
                "error": str(exc),
            }

    def get_state(self, session_id: str) -> Optional[Dict[str, Any]]:
        config = {"configurable": {"thread_id": session_id}}
        try:
            state = self.app.get_state(config)
            return state.values if state else None
        except Exception as exc:
            logger.error(f"Failed to get state: {exc}")
            return None

    @staticmethod
    def _infer_intent(tool_calls: list) -> str:
        if not tool_calls:
            return "chat"
        tool_names = {tc["tool"] for tc in tool_calls}
        if "plan_complex_task" in tool_names:
            return "complex"
        if "hydraulic_calculation" in tool_names or "run_sensitivity_analysis" in tool_names:
            return "calculate"
        if "query_database" in tool_names:
            return "query"
        if tool_names & {
            "search_knowledge_base",
            "query_fault_cause",
            "query_standards",
            "query_equipment_chain",
        }:
            return "knowledge"
        return "chat"

    def _build_response(
        self,
        result: dict,
        session_id: str,
        trace_id: Optional[str],
    ) -> Dict[str, Any]:
        messages = result.get("messages", [])
        final_message = messages[-1] if messages else None
        response_text = final_message.content if final_message else ""

        current_turn_messages = messages
        for idx in range(len(messages) - 1, -1, -1):
            if getattr(messages[idx], "type", "") == "human":
                current_turn_messages = messages[idx + 1 :]
                break

        tool_calls = []
        for msg in current_turn_messages:
            if hasattr(msg, "tool_calls") and msg.tool_calls:
                for tc in msg.tool_calls:
                    tool_calls.append({"tool": tc.get("name", ""), "args": tc.get("args", {})})

        user_input = _extract_latest_user_query(messages)
        response_text = _synthesize_final_response(
            user_input=user_input,
            draft_response=response_text,
            tool_calls=tool_calls,
        )
        response_text = _maybe_apply_knowledge_fallback(
            user_input=user_input,
            draft_response=response_text,
            tool_calls=tool_calls,
        )
        intent = AgentWorkflow._infer_intent(tool_calls)
        return {
            "response": response_text,
            "session_id": session_id,
            "trace_id": trace_id or "",
            "intent": intent,
            "sources": [],
            "confidence": 0.85 if tool_calls else 0.95,
            "tool_calls": tool_calls,
        }


# ═══════════════════════════════════════════════════════════════
# 单例
# ═══════════════════════════════════════════════════════════════

_workflow: Optional[AgentWorkflow] = None


def get_workflow() -> AgentWorkflow:
    global _workflow
    if _workflow is None:
        _workflow = AgentWorkflow()
    return _workflow
