"""Knowledge MCP server skeleton."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

from src.agents import get_graph_agent, get_knowledge_agent
from src.agents.result_contracts import build_result_contract, wants_contract
from src.utils import logger

from .base import MCPServer
from .types import MCPResourceDefinition, MCPToolCallResult, MCPToolDefinition


def _knowledge_tool_schema(field_name: str, description: str) -> Dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            field_name: {"type": "string", "description": description},
            "response_format": {
                "type": "string",
                "enum": ["legacy", "contract"],
                "default": "legacy",
                "description": "legacy keeps the old raw result, contract returns a structured envelope.",
            },
        },
        "required": [field_name],
    }


class KnowledgeMCPServer(MCPServer):
    """Expose knowledge retrieval and graph reasoning tools via MCP."""

    def __init__(self):
        self._tools = [
            MCPToolDefinition(
                name="search_knowledge_base",
                description="Search standards, principles, and formulas in the pipeline knowledge base.",
                input_schema=_knowledge_tool_schema("question", "Knowledge lookup question"),
                input_examples=[
                    {"question": "How should Darcy friction coefficient be chosen?"},
                    {"question": "What standards govern pipeline pressure-drop calculations?"},
                    {"question": "Search hydraulic formulas", "response_format": "contract"},
                ],
            ),
            MCPToolDefinition(
                name="query_fault_cause",
                description="Analyze fault cause chains with the knowledge graph.",
                input_schema=_knowledge_tool_schema("query", "Fault diagnosis query"),
                input_examples=[
                    {"query": "Possible root causes of outlet pressure oscillation?"},
                    {"query": "Which equipment faults may cause abnormal flow drop?"},
                    {"query": "Analyze fault cause chain", "response_format": "contract"},
                ],
            ),
            MCPToolDefinition(
                name="query_standards",
                description="Query standards and compliance requirements via the knowledge graph.",
                input_schema=_knowledge_tool_schema("query", "Standards lookup query"),
                input_examples=[
                    {"query": "Design-pressure standard clauses for oil pipelines"},
                    {"query": "Routine inspection requirements for pump stations"},
                    {"query": "Lookup compliance standards", "response_format": "contract"},
                ],
            ),
            MCPToolDefinition(
                name="query_equipment_chain",
                description="Query upstream and downstream equipment relationships.",
                input_schema=_knowledge_tool_schema("query", "Equipment chain query"),
                input_examples=[
                    {"query": "Upstream and downstream chain for pump station A"},
                    {"query": "Which critical devices are related to valve V-21?"},
                    {"query": "Lookup equipment chain", "response_format": "contract"},
                ],
            ),
        ]
        self._resource_map = self._load_resources()
        self._resources = [
            MCPResourceDefinition(
                uri=uri,
                description=meta["description"],
                mime_type=meta["mime_type"],
            )
            for uri, meta in self._resource_map.items()
        ]

    def _load_resources(self) -> Dict[str, Dict[str, str]]:
        base = Path(__file__).resolve().parents[2] / "knowledge_base"
        resource_defs = [
            (
                "knowledge://standards/pipeline",
                "Pipeline design and operation standards",
                "text/markdown",
                base / "standards/pipeline_standards.md",
            ),
            (
                "knowledge://operations/pump_optimization",
                "Pump station optimization knowledge",
                "text/markdown",
                base / "operations/pump_optimization.md",
            ),
            (
                "knowledge://formulas/hydraulic",
                "Hydraulic calculation formulas",
                "text/markdown",
                base / "formulas/hydraulic_formulas.md",
            ),
        ]

        loaded: Dict[str, Dict[str, str]] = {}
        for uri, description, mime_type, path in resource_defs:
            content = "-- resource unavailable"
            if path.exists():
                try:
                    content = path.read_text(encoding="utf-8")
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Failed to read knowledge MCP resource {}: {}", path, exc)
            loaded[uri] = {
                "description": description,
                "mime_type": mime_type,
                "content": content,
            }
        return loaded

    async def list_tools(self) -> List[MCPToolDefinition]:
        return list(self._tools)

    async def call_tool(self, tool_name: str, args: Dict[str, Any]) -> MCPToolCallResult:
        query_text = str(args.get("question") or args.get("query") or "").strip()
        if not query_text:
            return MCPToolCallResult(ok=False, content=None, error="question/query is required")

        try:
            if tool_name == "search_knowledge_base":
                result = get_knowledge_agent().execute(query_text)
                if wants_contract(args):
                    result = build_result_contract("knowledge_agent", result)
                return MCPToolCallResult(ok=True, content=result)
            if tool_name == "query_fault_cause":
                result = get_graph_agent().execute(query_text, query_type="fault_cause")
                if wants_contract(args):
                    result = build_result_contract("graph_agent", result)
                return MCPToolCallResult(ok=True, content=result)
            if tool_name == "query_standards":
                result = get_graph_agent().execute(query_text, query_type="standards")
                if wants_contract(args):
                    result = build_result_contract("graph_agent", result)
                return MCPToolCallResult(ok=True, content=result)
            if tool_name == "query_equipment_chain":
                result = get_graph_agent().execute(query_text, query_type="equipment_chain")
                if wants_contract(args):
                    result = build_result_contract("graph_agent", result)
                return MCPToolCallResult(ok=True, content=result)
            return MCPToolCallResult(ok=False, content=None, error=f"unsupported tool: {tool_name}")
        except Exception as exc:  # noqa: BLE001
            logger.error("MCP {} failed: {}", tool_name, exc)
            return MCPToolCallResult(ok=False, content=None, error=str(exc))

    async def list_resources(self) -> List[MCPResourceDefinition]:
        return list(self._resources)

    async def read_resource(self, uri: str) -> str:
        meta = self._resource_map.get(uri)
        if meta is None:
            raise ValueError(f"unknown resource uri: {uri}")
        return meta["content"]
