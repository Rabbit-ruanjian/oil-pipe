"""LLM-in-the-loop graph traversal (P0-③ B4, pluggable, default off).

Replaces the fixed top3 causal-chain walk in reasoning.summarize_causal_chain
with an LLM-decided traversal plan ("from which node, along which edge types,
how many hops") when the graph_traversal_llm switch is ON. When the switch is
OFF or the LLM fails, it degrades to the existing fixed walk so behavior is
byte-identical to the pre-change path.

All LLM calls go through src/llm/llm_client.get_llm_client() (LLMClientError
on timeout/network/config failure); no ChatOpenAI direct construction.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from src.config import rag_config
from src.utils import logger


class GraphTraversalPlanner:
    """Decide a bounded graph-traversal plan with the LLM.

    The plan is intentionally minimal:
      - start_node_id: the node to begin traversal from
      - edge_types:    which edge relations to follow
      - max_hops:      traversal depth (bounded to avoid blow-up)

    The LLM is asked to emit strict JSON; parse failures degrade to a
    default plan (fault_001 start, cause/solution edges, 2 hops) rather than
    raising, so the main graph query flow is never blocked.
    """

    SYSTEM_PROMPT = (
        "你是知识图谱查询规划器。给定用户问题与图谱节点/边列表，输出严格 JSON："
        '{"start_node_id": str, "edge_types": [str], "max_hops": int}。'
        "edge_types 只能从给定集合里选；max_hops 在 1~3 之间。"
    )

    DEFAULT_MAX_HOPS = 2

    def __init__(self, llm_client: Optional[Any] = None) -> None:
        self._llm_client = llm_client  # injectable for tests; default get_llm_client()

    # ------------------------------------------------------------------
    # switch / degradation
    # ------------------------------------------------------------------

    @staticmethod
    def enabled() -> bool:
        try:
            if hasattr(rag_config, "pluggable"):
                return bool(rag_config.pluggable.get("graph_traversal_llm", False))
        except Exception:  # noqa: BLE001
            pass
        return False

    def plan(
        self,
        *,
        query: str,
        node_ids: List[str],
        edge_types: List[str],
    ) -> Optional[Dict[str, Any]]:
        """Return a traversal plan, or None if the switch is OFF (caller keeps
        the fixed walk). When ON, build an LLM-decided plan; on any LLM failure
        return a default plan (never None, never raise)."""
        if not self.enabled():
            return None

        client = self._llm_client
        if client is None:
            from src.llm import get_llm_client

            client = get_llm_client()

        default_plan = self._default_plan(node_ids, edge_types)
        if not node_ids or not edge_types:
            return default_plan

        prompt = (
            f"用户问题: {query}\n"
            f"可用节点: {json.dumps(node_ids, ensure_ascii=False)}\n"
            f"可用边类型: {json.dumps(edge_types, ensure_ascii=False)}\n"
            "请输出遍历计划（严格 JSON）。"
        )
        try:
            from src.llm import LLMClientError

            raw = client.complete(prompt, system=self.SYSTEM_PROMPT, timeout=30.0)
            plan = self._parse_plan(raw)
            if plan is None:
                logger.warning("graph_traversal LLM 输出无法解析，用默认计划")
                return default_plan
            return plan
        except LLMClientError as exc:
            logger.warning(f"graph_traversal LLM 失败，降级为默认计划: {exc}")
            return default_plan
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"graph_traversal 异常，降级为默认计划: {exc}")
            return default_plan

    @staticmethod
    def _default_plan(node_ids: List[str], edge_types: List[str]) -> Dict[str, Any]:
        return {
            "start_node_id": node_ids[0] if node_ids else "fault_001",
            "edge_types": edge_types[:2] if edge_types else ["cause", "solution"],
            "max_hops": GraphTraversalPlanner.DEFAULT_MAX_HOPS,
        }

    @staticmethod
    def _parse_plan(raw: str) -> Optional[Dict[str, Any]]:
        text = (raw or "").strip()
        if not text:
            return None
        candidate = text
        if candidate.startswith("{"):
            end = candidate.rfind("}")
            if end != -1:
                candidate = candidate[: end + 1]
        try:
            data = json.loads(candidate)
        except (json.JSONDecodeError, ValueError):
            return None
        if not isinstance(data, dict):
            return None
        plan: Dict[str, Any] = {}
        if "start_node_id" in data and data["start_node_id"]:
            plan["start_node_id"] = str(data["start_node_id"])
        if "edge_types" in data and isinstance(data["edge_types"], list):
            plan["edge_types"] = [str(e) for e in data["edge_types"] if str(e)]
        if "max_hops" in data:
            try:
                plan["max_hops"] = max(1, min(3, int(data["max_hops"])))
            except (TypeError, ValueError):
                plan["max_hops"] = GraphTraversalPlanner.DEFAULT_MAX_HOPS
        return plan or None

    # ------------------------------------------------------------------
    # bounded traversal
    # ------------------------------------------------------------------

    def traverse(
        self,
        graph: Any,
        *,
        query: str,
        plan: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Run a bounded BFS over the graph following plan['edge_types'] up to
        plan['max_hops'] from plan['start_node_id'].

        Delegates the actual edge lookups to the graph builder's existing
        methods where available; falls back to a dict describing the visited
        frontier so the result shape is stable for callers/tests.
        """
        start = plan.get("start_node_id")
        edge_types = plan.get("edge_types") or []
        max_hops = int(plan.get("max_hops", self.DEFAULT_MAX_HOPS))

        visited: List[str] = [start] if start else []
        frontier: List[str] = [start] if start else []
        reached: Dict[str, Dict[str, Any]] = {}

        for _hop in range(max_hops):
            next_frontier: List[str] = []
            for node in frontier:
                neighbors = self._neighbors(graph, node, edge_types)
                for neighbor in neighbors:
                    if neighbor in visited:
                        continue
                    visited.append(neighbor)
                    next_frontier.append(neighbor)
                    reached[neighbor] = {"from": node, "via": edge_types[0] if edge_types else None}
            frontier = next_frontier
            if not frontier:
                break

        return {
            "query": query,
            "plan": plan,
            "reached": reached,
            "path_count": len(visited),
        }

    @staticmethod
    def _neighbors(graph: Any, node: str, edge_types: List[str]) -> List[str]:
        """Best-effort neighbour lookup against the knowledge-graph builder.

        Tries graph.neighbors / graph.outgoing_edges patterns used by the
        networkx-backed builder; returns [] when the API is absent so the
        traversal degrades gracefully instead of raising.
        """
        if graph is None:
            return []
        for method in ("outgoing_edges", "neighbors", "adjacent_nodes"):
            fn = getattr(graph, method, None)
            if callable(fn):
                try:
                    raw = fn(node)
                    out: List[str] = []
                    for item in raw:
                        if isinstance(item, dict):
                            # honour edge_type filter when present
                            et = item.get("edge_type") or item.get("relation")
                            if edge_types and et not in edge_types:
                                continue
                            out.append(str(item.get("target") or item.get("to") or ""))
                        else:
                            out.append(str(item))
                    return [x for x in out if x]
                except Exception:  # noqa: BLE001
                    continue
        return []
