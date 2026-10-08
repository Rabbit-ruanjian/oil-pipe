"""Calculation MCP server skeleton."""

from __future__ import annotations

from typing import Any, Dict, List

from src.agents.result_contracts import build_result_contract, wants_contract
from src.tools.calculation_tools import CALCULATION_TOOLS
from src.tools.java_service_tools import JAVA_SERVICE_TOOLS
from src.utils import logger

from .base import MCPServer
from .types import MCPResourceDefinition, MCPToolCallResult, MCPToolDefinition


class CalculationMCPServer(MCPServer):
    """Expose calculation capabilities as MCP tools."""

    COMPAT_HYDRAULIC_TOOL = "hydraulic_calculation"
    COMPAT_SENSITIVITY_TOOL = "run_sensitivity_analysis"

    def __init__(self):
        self._tool_map = {tool.name: tool for tool in CALCULATION_TOOLS + JAVA_SERVICE_TOOLS}
        self._tools = [
            self._create_compat_hydraulic_tool(),
            self._create_compat_sensitivity_tool(),
        ] + [
            self._convert_tool_definition(tool) for tool in CALCULATION_TOOLS + JAVA_SERVICE_TOOLS
        ]

    @classmethod
    def _create_compat_hydraulic_tool(cls) -> MCPToolDefinition:
        return MCPToolDefinition(
            name=cls.COMPAT_HYDRAULIC_TOOL,
            description="Compatibility entry point for natural-language hydraulic calculations.",
            input_schema={
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "Natural-language calculation request"},
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
                {"question": "Calculate Reynolds number and pressure drop at 1000 m3/h"},
                {"question": "Compare outlet pressure under two pump combinations"},
                {"question": "Run hydraulic analysis for project A", "response_format": "contract"},
            ],
        )

    @classmethod
    def _create_compat_sensitivity_tool(cls) -> MCPToolDefinition:
        return MCPToolDefinition(
            name=cls.COMPAT_SENSITIVITY_TOOL,
            description="Compatibility entry point for natural-language sensitivity analysis.",
            input_schema={
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "Natural-language sensitivity request"},
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
                {"question": "Analyze how flow-rate changes affect friction loss"},
                {"question": "Compare density and viscosity impact on pressure drop"},
                {"question": "Run sensitivity analysis", "response_format": "contract"},
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
        if tool_name in {self.COMPAT_HYDRAULIC_TOOL, self.COMPAT_SENSITIVITY_TOOL}:
            question = str(args.get("question", "")).strip()
            if not question:
                return MCPToolCallResult(ok=False, content=None, error="question is required")
            try:
                from src.agents import get_calc_agent

                result = get_calc_agent().execute(question)
                if wants_contract(args):
                    result = build_result_contract("calc_agent", result)
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
        return []

    async def read_resource(self, uri: str) -> str:
        raise ValueError(f"unknown resource uri: {uri}")
