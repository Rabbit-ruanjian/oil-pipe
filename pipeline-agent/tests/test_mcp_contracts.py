from __future__ import annotations

import pytest

import src.agents as agents_module
import src.mcp.knowledge_server as knowledge_server_module
from src.mcp.calculation_server import CalculationMCPServer
from src.mcp.database_server import DatabaseMCPServer
from src.mcp.knowledge_server import KnowledgeMCPServer


class _StubAgent:
    def __init__(self, output):
        self._output = output

    def execute(self, *_args, **_kwargs):
        return self._output


class _StubGraphAgent:
    def execute(self, query: str, query_type: str | None = None, summarize: bool = False):
        return {
            "query": query,
            "query_type": query_type,
            "summarize": summarize,
            "nodes": [{"id": "n1"}],
        }


@pytest.mark.asyncio
async def test_database_compat_tool_supports_contract_format(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        agents_module,
        "get_data_agent",
        lambda: _StubAgent('{"success": true, "data": {"pipeline": {"id": 1}}}'),
    )

    server = DatabaseMCPServer()
    result = await server.call_tool(
        "query_database",
        {"question": "查询项目A管道参数", "response_format": "contract"},
    )

    assert result.ok is True
    assert result.content["agent"] == "data_agent"
    assert result.content["kind"] == "data"
    assert result.content["data"]["data"]["pipeline"]["id"] == 1


@pytest.mark.asyncio
async def test_database_compat_tool_keeps_legacy_default(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = '{"success": true, "data": {"pipeline": {"id": 2}}}'
    monkeypatch.setattr(
        agents_module,
        "get_data_agent",
        lambda: _StubAgent(payload),
    )

    server = DatabaseMCPServer()
    result = await server.call_tool("query_database", {"question": "查询项目B管道参数"})

    assert result.ok is True
    assert result.content == payload


@pytest.mark.asyncio
async def test_calculation_compat_tool_supports_contract_format(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        agents_module,
        "get_calc_agent",
        lambda: _StubAgent("计算完成: 压降=0.25MPa"),
    )

    server = CalculationMCPServer()
    result = await server.call_tool(
        "hydraulic_calculation",
        {"question": "计算压降", "response_format": "contract"},
    )

    assert result.ok is True
    assert result.content["agent"] == "calc_agent"
    assert result.content["kind"] == "text"
    assert result.content["text"] == "计算完成: 压降=0.25MPa"


@pytest.mark.asyncio
async def test_calculation_compat_tool_keeps_legacy_default(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = "计算完成: 压降=0.30MPa"
    monkeypatch.setattr(
        agents_module,
        "get_calc_agent",
        lambda: _StubAgent(payload),
    )

    server = CalculationMCPServer()
    result = await server.call_tool("hydraulic_calculation", {"question": "计算压降"})

    assert result.ok is True
    assert result.content == payload


@pytest.mark.asyncio
async def test_knowledge_server_contract_mode_wraps_graph_and_qa_results(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        knowledge_server_module,
        "get_knowledge_agent",
        lambda: _StubAgent("知识库回答"),
    )
    monkeypatch.setattr(
        knowledge_server_module,
        "get_graph_agent",
        lambda: _StubGraphAgent(),
    )

    server = KnowledgeMCPServer()

    qa_result = await server.call_tool(
        "search_knowledge_base",
        {"question": "什么是达西公式", "response_format": "contract"},
    )
    graph_result = await server.call_tool(
        "query_fault_cause",
        {"query": "出口压力波动根因", "response_format": "contract"},
    )

    assert qa_result.ok is True
    assert qa_result.content["agent"] == "knowledge_agent"
    assert qa_result.content["kind"] == "text"

    assert graph_result.ok is True
    assert graph_result.content["agent"] == "graph_agent"
    assert graph_result.content["kind"] == "data"
    assert graph_result.content["data"]["query_type"] == "fault_cause"
    assert graph_result.content["data"]["summarize"] is False


@pytest.mark.asyncio
async def test_knowledge_server_keeps_legacy_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        knowledge_server_module,
        "get_knowledge_agent",
        lambda: _StubAgent("知识库原始回答"),
    )
    monkeypatch.setattr(
        knowledge_server_module,
        "get_graph_agent",
        lambda: _StubGraphAgent(),
    )

    server = KnowledgeMCPServer()

    qa_result = await server.call_tool("search_knowledge_base", {"question": "什么是达西公式"})
    graph_result = await server.call_tool("query_fault_cause", {"query": "出口压力波动根因"})

    assert qa_result.ok is True
    assert qa_result.content == "知识库原始回答"

    assert graph_result.ok is True
    assert graph_result.content["query_type"] == "fault_cause"
    assert graph_result.content["summarize"] is False
