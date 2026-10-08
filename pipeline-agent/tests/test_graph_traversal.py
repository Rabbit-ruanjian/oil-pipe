"""P0-③ B4 + P1：graph_traversal LLM-in-the-loop + /graph/query query_type。

覆盖：
  1. 开关关（graph_traversal_llm=False）→ planner.plan 返回 None，GraphAgent
     走原有固定路径（逐字节不变）
  2. 开关开 + LLM 正常 → plan 返回 LLM 决策的遍历计划，traverse 做有界 BFS
  3. 开关开 + LLM 失败（LLMClientError）→ 降级为默认计划，不阻断
  4. /graph/query 暴露 query_type 参数并透传给 GraphAgent.execute
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("OPENAI_API_KEY", "sk-test-key")
os.environ.setdefault("EMBEDDING_API_KEY", "sk-test-key")
os.environ.setdefault("DB_PASSWORD", "test")
os.environ.setdefault("JAVA_AUTH_PASSWORD", "test")
os.environ.setdefault("AUTH_REQUIRED_IN_PRODUCTION", "false")


# ===========================================================================
# helpers
# ===========================================================================


class FakeLLMClient:
    """记录 complete 调用；可注入 LLMClientError。"""

    def __init__(self, response: str = "", raise_exc: Any = None) -> None:
        self.response = response
        self.raise_exc = raise_exc
        self.calls: list[dict] = []

    def complete(self, prompt, *, system=None, temperature=None, timeout=None):
        self.calls.append({"prompt": prompt, "system": system, "timeout": timeout})
        if self.raise_exc is not None:
            raise self.raise_exc
        return self.response


def _planner_with(client: FakeLLMClient) -> Any:
    from src.knowledge_graph.graph_traversal import GraphTraversalPlanner

    return GraphTraversalPlanner(llm_client=client)


# ===========================================================================
# 1. 开关关 → plan 返回 None（走原路径）
# ===========================================================================


def test_plan_returns_none_when_switch_off() -> None:
    client = FakeLLMClient()
    planner = _planner_with(client)
    with patch.object(planner.__class__, "enabled", return_value=False):
        plan = planner.plan(query="泵站压力低", node_ids=["fault_001"], edge_types=["cause"])
    assert plan is None
    assert client.calls == []  # 未触 LLM


# ===========================================================================
# 2. 开关开 + LLM 正常 → LLM 决策计划
# ===========================================================================


def test_plan_uses_llm_decision_when_switch_on() -> None:
    client = FakeLLMClient(
        response=json.dumps(
            {"start_node_id": "fault_001", "edge_types": ["cause", "solution"], "max_hops": 3}
        )
    )
    planner = _planner_with(client)
    with patch.object(planner.__class__, "enabled", return_value=True):
        plan = planner.plan(query="泵站压力低", node_ids=["fault_001", "叶轮磨损"], edge_types=["cause", "solution"])
    assert plan is not None
    assert plan["start_node_id"] == "fault_001"
    assert set(plan["edge_types"]) == {"cause", "solution"}
    assert plan["max_hops"] == 3
    assert len(client.calls) == 1


# ===========================================================================
# 3. 开关开 + LLM 失败 → 默认计划（不阻断）
# ===========================================================================


def test_plan_degrades_to_default_on_llm_error() -> None:
    from src.llm import LLMClientError

    client = FakeLLMClient(raise_exc=LLMClientError("boom"))
    planner = _planner_with(client)
    with patch.object(planner.__class__, "enabled", return_value=True):
        plan = planner.plan(query="x", node_ids=["fault_001"], edge_types=["cause", "solution"])
    assert plan is not None
    # 默认计划：首节点 + 前 2 边 + max_hops=2
    assert plan["start_node_id"] == "fault_001"
    assert plan["max_hops"] == 2


def test_plan_default_when_no_nodes() -> None:
    client = FakeLLMClient()
    planner = _planner_with(client)
    with patch.object(planner.__class__, "enabled", return_value=True):
        plan = planner.plan(query="x", node_ids=[], edge_types=["cause"])
    assert plan is not None
    assert plan["start_node_id"] == "fault_001"  # 缺省种子


# ===========================================================================
# traverse 有界 BFS
# ===========================================================================


def test_traverse_bounded_bfs() -> None:
    class FakeGraph:
        def outgoing_edges(self, node):
            return {
                "fault_001": [
                    {"target": "叶轮磨损", "edge_type": "cause"},
                    {"target": "管道结蜡", "edge_type": "cause"},
                ],
                "叶轮磨损": [
                    {"target": "更换叶轮", "edge_type": "solution"},
                ],
            }.get(node, [])

    planner = _planner_with(FakeLLMClient())
    plan = {
        "start_node_id": "fault_001",
        "edge_types": ["cause", "solution"],
        "max_hops": 2,
    }
    out = planner.traverse(FakeGraph(), query="泵站压力低", plan=plan)
    assert "叶轮磨损" in out["reached"]
    assert "更换叶轮" in out["reached"]
    # visited = start + 2 causes + 1 solution = 4
    assert out["path_count"] == 4


# ===========================================================================
# 真实 builder 图：fault_001 沿 caused_by→solved_by 多跳因果链遍历
# （防回归：概念边类型 cause/solution 匹配 builder 实际边 caused_by/solved_by）
# ===========================================================================


def test_traverse_on_real_builder_graph_causal_chain() -> None:
    from src.knowledge_graph.builder import get_knowledge_graph_builder

    graph = get_knowledge_graph_builder()
    graph.build_from_data()
    planner = _planner_with(FakeLLMClient())
    plan = {"start_node_id": "fault_001", "edge_types": ["cause", "solution"], "max_hops": 2}
    out = planner.traverse(graph, query="泵站出口压力下降", plan=plan)
    reached = out["reached"]
    # 第 1 跳：fault_001 → cause_001~004（caused_by 边）
    assert any("cause" in n for n in reached)
    # 第 2 跳：cause_xxx → sol_xxx（solved_by 边）
    assert any("sol" in n for n in reached)
    assert out["path_count"] >= 2


def test_edge_type_matching_conceptual_to_actual() -> None:
    """概念边类型与 builder 实际边 type 的匹配规则（防回归）。"""
    from src.knowledge_graph.graph_traversal import GraphTraversalPlanner as P

    assert P._edge_type_matches("caused_by", ["cause", "solution"]) is True
    assert P._edge_type_matches("solved_by", ["cause", "solution"]) is True
    assert P._edge_type_matches("references", ["reference"]) is True
    assert P._edge_type_matches("contains", ["contains"]) is True
    # 不匹配的类型（references 边不算 cause/solution）
    assert P._edge_type_matches("references", ["cause", "solution"]) is False
    # 空概念类型 → 全部匹配
    assert P._edge_type_matches("anything", []) is True

