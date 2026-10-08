"""Database MCP server skeleton."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

from src.agents.result_contracts import build_result_contract, wants_contract
from src.tools.database_tools import DATABASE_TOOLS
from src.utils import logger

from .base import MCPServer
from .types import MCPResourceDefinition, MCPToolCallResult, MCPToolDefinition


class DatabaseMCPServer(MCPServer):
    """Expose database querying as MCP-compatible tool/resource."""

    SCHEMA_URI = "schema://pipeline_cloud"
    COMPAT_QUERY_TOOL = "query_database"

    def __init__(self):
        self._tool_map = {tool.name: tool for tool in DATABASE_TOOLS}
        self._tools = [self._create_compat_query_tool()] + [
            self._convert_tool_definition(tool) for tool in DATABASE_TOOLS
        ]
        self._resources = [
            MCPResourceDefinition(
                uri=self.SCHEMA_URI,
                description="Pipeline database schema information",
                mime_type="text/sql",
            )
        ]
        self._schema_cache = self._load_schema_file()

    def _load_schema_file(self) -> str:
        """Load SQL schema from repository root."""
        candidates = [
            Path(__file__).resolve().parents[3] / "pipeline-energy-cloud/sql/schema.sql",
            Path(__file__).resolve().parents[2] / "knowledge_base/standards/pipeline_standards.md",
        ]
        for path in candidates:
            if path.exists():
                try:
                    text = path.read_text(encoding="utf-8")
                    if text.strip():
                        return text
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Failed to read MCP schema candidate {}: {}", path, exc)
        return "-- schema unavailable"

    @classmethod
    def _create_compat_query_tool(cls) -> MCPToolDefinition:
        return MCPToolDefinition(
            name=cls.COMPAT_QUERY_TOOL,
            description="Compatibility entry point for natural-language database queries.",
            input_schema={
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "Natural-language database query"},
                    "max_rows": {"type": "integer", "default": 100},
                    "response_format": {
                        "type": "string",
                        "enum": ["legacy", "contract"],
                        "default": "legacy",
                        "description": "legacy keeps the old raw result, contract returns a structured envelope.",
                    },
                },
                "required": ["question"],
            },
            input_examples=[
                {"question": "Query all pipeline diameters in project A", "max_rows": 50},
                {"question": "Count average efficiency by pump station"},
                {"question": "Query pipeline data for project A", "response_format": "contract"},
            ],
        )

    @staticmethod
    def _convert_tool_definition(tool_obj) -> MCPToolDefinition:
        args_schema = getattr(tool_obj, "args_schema", None)
        input_schema = args_schema.model_json_schema() if args_schema is not None else {"type": "object"}
        return MCPToolDefinition(
            name=tool_obj.name,
            description=str(getattr(tool_obj, "description", "") or ""),
            input_schema=input_schema,
            input_examples=[],
        )

    async def list_tools(self) -> List[MCPToolDefinition]:
        return list(self._tools)

    async def call_tool(self, tool_name: str, args: Dict[str, Any]) -> MCPToolCallResult:
        if tool_name == self.COMPAT_QUERY_TOOL:
            question = str(args.get("question", "")).strip()
            if not question:
                return MCPToolCallResult(ok=False, content=None, error="question is required")
            try:
                from src.agents import get_data_agent

                result = get_data_agent().execute(question)
                if wants_contract(args):
                    result = build_result_contract("data_agent", result)
                return MCPToolCallResult(ok=True, content=result)
            except Exception as exc:  # noqa: BLE001
                logger.error("MCP {} failed: {}", tool_name, exc)
                return MCPToolCallResult(ok=False, content=None, error=str(exc))

        tool_obj = self._tool_map.get(tool_name)
        if tool_obj is None:
            return MCPToolCallResult(ok=False, content=None, error=f"unsupported tool: {tool_name}")

        try:
            result = tool_obj.invoke(args)
            return MCPToolCallResult(ok=True, content=result)
        except Exception as exc:  # noqa: BLE001
            logger.error("MCP {} failed: {}", tool_name, exc)
            return MCPToolCallResult(ok=False, content=None, error=str(exc))

    async def list_resources(self) -> List[MCPResourceDefinition]:
        return list(self._resources)

    async def read_resource(self, uri: str) -> str:
        if uri != self.SCHEMA_URI:
            raise ValueError(f"unknown resource uri: {uri}")
        return self._schema_cache
