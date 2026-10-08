from __future__ import annotations

from types import SimpleNamespace

import src.agents.supervisor as supervisor_module
import src.workflows.graph as workflow_graph_module
from src.agents.supervisor import SupervisorAgent


class _FakeSkillRuntime:
    def __init__(self) -> None:
        self.get_calls: list[tuple[str, str]] = []
        self.render_calls: list[tuple[str, str, dict]] = []

    def get_prompt(self, skill_name: str, prompt_name: str) -> str:
        self.get_calls.append((skill_name, prompt_name))
        return f"PROMPT::{skill_name}::{prompt_name}"

    def render_prompt(self, skill_name: str, prompt_name: str, variables: dict) -> str:
        self.render_calls.append((skill_name, prompt_name, variables))
        return f"RENDER::{skill_name}::{prompt_name}::{variables}"


class _FakePromptTemplate:
    def __init__(self, sink: dict) -> None:
        self._sink = sink

    def __or__(self, _other):
        return _FakePromptAfterLLM(self._sink)


class _FakePromptAfterLLM:
    def __init__(self, sink: dict) -> None:
        self._sink = sink

    def __or__(self, _other):
        return _FakeChain(self._sink)

    def invoke(self, payload: dict) -> str:
        return _FakeChain(self._sink).invoke(payload)

    def stream(self, payload: dict):
        yield from _FakeChain(self._sink).stream(payload)


class _FakeChain:
    def __init__(self, sink: dict) -> None:
        self._sink = sink

    def invoke(self, payload: dict) -> str:
        self._sink.setdefault("payloads", []).append(payload)
        return self._sink.get("invoke_result", "")

    def stream(self, payload: dict):
        self._sink.setdefault("payloads", []).append(payload)
        for token in self._sink.get("stream_tokens", []):
            yield SimpleNamespace(content=token)


class _FakeBoundLLM:
    def __init__(self) -> None:
        self.messages = None

    def invoke(self, messages):
        self.messages = messages
        return SimpleNamespace(content="workflow-response")


def test_select_active_tools_uses_registered_tools_when_search_disabled(monkeypatch) -> None:
    monkeypatch.setattr(workflow_graph_module.settings, "TOOL_SEARCH_ENABLED", False)
    monkeypatch.setattr(
        workflow_graph_module,
        "get_all_registered_tool_names",
        lambda: ["query_database", "mcp_only_tool"],
    )

    result = workflow_graph_module._select_active_tools("test query")

    assert result["selected_names"] == ["query_database", "mcp_only_tool"]
    assert result["total_tools"] == 2
    assert [tool["name"] for tool in result["scored_tools"]] == ["query_database", "mcp_only_tool"]


def test_select_active_tools_falls_back_to_registered_tools_when_search_returns_nothing(monkeypatch) -> None:
    class _EmptySearchEngine:
        def search_with_scores(self, *_args, **_kwargs):
            return []

    monkeypatch.setattr(workflow_graph_module.settings, "TOOL_SEARCH_ENABLED", True)
    monkeypatch.setattr(workflow_graph_module, "get_tool_search_engine", lambda: _EmptySearchEngine())
    monkeypatch.setattr(
        workflow_graph_module,
        "get_all_registered_tool_names",
        lambda: ["query_database", "mcp_only_tool"],
    )
    monkeypatch.setattr(workflow_graph_module, "ALWAYS_LOADED_TOOL_NAMES", [])

    result = workflow_graph_module._select_active_tools("test query")

    assert result["selected_names"] == ["query_database", "mcp_only_tool"]
    assert result["total_tools"] == 2


def test_workflow_tools_keep_mcp_only_tool_names(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_get_mcp_langchain_tools(_servers, include_tools=None, exclude_tools=None):
        captured["include_tools"] = list(include_tools or [])
        return [SimpleNamespace(name="mcp_only_tool")]

    monkeypatch.setattr(workflow_graph_module, "_workflow_tools_cache", {})
    monkeypatch.setattr(
        workflow_graph_module,
        "get_all_registered_tool_names",
        lambda: ["query_database", "mcp_only_tool"],
    )
    monkeypatch.setattr(
        workflow_graph_module,
        "get_mcp_langchain_tools",
        fake_get_mcp_langchain_tools,
    )
    monkeypatch.setattr(workflow_graph_module, "get_tools_by_names", lambda names: [])

    tools = workflow_graph_module._get_workflow_tools(["mcp_only_tool"])

    assert captured["include_tools"] == ["mcp_only_tool"]
    assert [tool.name for tool in tools] == ["mcp_only_tool"]


def test_workflow_tool_node_uses_registered_tool_names_after_mcp_sync(monkeypatch) -> None:
    seen: dict[str, object] = {}

    def fake_get_workflow_tools(names):
        seen["tool_names"] = list(names)
        return []

    monkeypatch.setattr(
        workflow_graph_module,
        "ensure_builtin_mcp_servers_sync",
        lambda server_names=None: seen.setdefault("servers", list(server_names or [])),
    )
    monkeypatch.setattr(
        workflow_graph_module,
        "get_all_registered_tool_names",
        lambda: ["query_database", "mcp_only_tool"],
    )
    monkeypatch.setattr(
        workflow_graph_module,
        "_get_workflow_tools",
        fake_get_workflow_tools,
    )

    workflow_graph_module.create_react_graph()

    assert seen["servers"] == ["database-mcp", "calculation-mcp", "knowledge-mcp"]
    assert seen["tool_names"] == ["query_database", "mcp_only_tool"]


def test_supervisor_synthesize_response_uses_skill_even_for_single_task(
    monkeypatch,
) -> None:
    sink = {"invoke_result": "统一综合输出"}
    runtime = _FakeSkillRuntime()
    agent = SupervisorAgent()
    agent._llm = object()
    agent._skill_runtime = runtime

    monkeypatch.setattr(
        supervisor_module.ChatPromptTemplate,
        "from_messages",
        lambda _messages: _FakePromptTemplate(sink),
    )
    monkeypatch.setattr(supervisor_module, "StrOutputParser", lambda: object())

    result = agent.synthesize_response(
        user_input="请总结结果",
        completed_tasks=[{"agent": "knowledge_agent", "task": "回答问题", "result": "原始单步结果"}],
        intent="complex",
    )

    assert result == "统一综合输出"
    assert runtime.render_calls[0][1] == "synthesis"
    assert "原始单步结果" in runtime.render_calls[0][2]["agent_results"]
    assert sink["payloads"][0]["input"].startswith("RENDER::supervisor::synthesis::")


def test_supervisor_synthesize_response_stream_uses_skill_even_for_single_task(
    monkeypatch,
) -> None:
    sink = {"stream_tokens": ["统一", "流式", "输出"]}
    runtime = _FakeSkillRuntime()
    agent = SupervisorAgent()
    agent._llm = object()
    agent._skill_runtime = runtime
    seen_chunks: list[str] = []

    monkeypatch.setattr(
        supervisor_module.ChatPromptTemplate,
        "from_messages",
        lambda _messages: _FakePromptTemplate(sink),
    )

    result = agent.synthesize_response_stream(
        user_input="请总结结果",
        completed_tasks=[{"agent": "calc_agent", "task": "计算", "result": "单步计算结果"}],
        intent="complex",
        on_chunk=seen_chunks.append,
    )

    assert result == "统一流式输出"
    assert seen_chunks == ["统一", "流式", "输出"]
    assert runtime.render_calls[0][1] == "synthesis"
    assert "单步计算结果" in runtime.render_calls[0][2]["agent_results"]
    assert sink["payloads"][0]["input"].startswith("RENDER::supervisor::synthesis::")


def test_workflow_agent_node_uses_skill_backed_system_prompt(monkeypatch) -> None:
    runtime = _FakeSkillRuntime()
    fake_llm = _FakeBoundLLM()

    monkeypatch.setattr(workflow_graph_module, "_skill_runtime", runtime)
    monkeypatch.setattr(
        workflow_graph_module,
        "_select_active_tools",
        lambda _query: {
            "selected_names": ["query_database"],
            "scored_tools": [],
            "total_tools": 1,
            "duration_ms": 0.0,
            "mode": "test",
        },
    )
    monkeypatch.setattr(workflow_graph_module, "_get_llm_with_tools", lambda _tool_names: fake_llm)

    result = workflow_graph_module.agent_node(
        {"messages": [{"role": "user", "content": "查询项目A的管道参数"}]}
    )

    assert result["messages"][0].content == "workflow-response"
    assert runtime.get_calls[0] == ("chat-orchestrator", "system")
    assert fake_llm.messages[0].content == "PROMPT::chat-orchestrator::system"
    assert fake_llm.messages[1]["content"] == "查询项目A的管道参数"


def test_workflow_final_synthesis_uses_skill_prompt(monkeypatch) -> None:
    sink = {"invoke_result": "最终综合答案"}
    runtime = _FakeSkillRuntime()

    monkeypatch.setattr(workflow_graph_module, "_skill_runtime", runtime)
    monkeypatch.setattr(
        workflow_graph_module.ChatPromptTemplate,
        "from_messages",
        lambda _messages: _FakePromptTemplate(sink),
    )
    monkeypatch.setattr(workflow_graph_module, "StrOutputParser", lambda: object())
    monkeypatch.setattr(workflow_graph_module, "_get_final_llm", lambda: object())

    result = workflow_graph_module._synthesize_final_response(
        user_input="请输出最终结论",
        draft_response="草稿答案",
        tool_calls=[{"tool": "query_database", "args": {"question": "查询项目A"}}],
    )

    assert result == "最终综合答案"
    assert ("final-synthesis", "system") in runtime.get_calls
    assert sink["payloads"][0]["draft_response"] == "草稿答案"
