from __future__ import annotations

from src.tool_search.engine import ToolSearchEngine
from src.tools.agent_tools import TOOL_REGISTRY


def test_tool_search_prefers_database_tool_for_chinese_data_query() -> None:
    engine = ToolSearchEngine(TOOL_REGISTRY)

    results = engine.search("查询项目A的管道直径和长度", top_k=3, min_score=0.0)

    assert "query_database" in results[:2]


def test_tool_search_prefers_calc_tool_for_chinese_calculation_query() -> None:
    engine = ToolSearchEngine(TOOL_REGISTRY)

    results = engine.search("计算压降和雷诺数", top_k=3, min_score=0.0)

    assert "hydraulic_calculation" in results[:2]
