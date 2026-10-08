"""Knowledge graph builder and query helpers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

import networkx as nx
from sqlalchemy import text
from src.tools.database_tools import get_engine
from src.utils import logger

from .schema import EdgeType, GraphEdge, GraphNode, NodeType


class KnowledgeGraphBuilder:
    """Build and query pipeline-domain knowledge graph."""

    DEFAULT_DATA_DIR = Path(__file__).parent / "data"
    DEFAULT_DOCUMENT_GRAPH_PATH = Path("knowledge_base") / ".registry" / "document_graph.json"

    def __init__(self) -> None:
        self.graph = nx.DiGraph()
        self._built = False
        self._data_dir = str(self.DEFAULT_DATA_DIR)
        self._document_graph_path = str(self.DEFAULT_DOCUMENT_GRAPH_PATH)
        self._document_graph_revision = ""

    def build_from_data(
        self,
        data_dir: str = "src/knowledge_graph/data",
        document_graph_path: str = "knowledge_base/.registry/document_graph.json",
    ) -> None:
        """Build graph from local JSON files."""

        self.graph.clear()
        data_path = Path(data_dir)
        self._load_equipment_data(data_path / "equipment.json")
        self._load_fault_causal_data(data_path / "fault_causal.json")
        self._load_standards_data(data_path / "standards.json")
        self._load_document_graph(Path(document_graph_path))
        self._built = True
        self._data_dir = str(data_path)
        self._document_graph_path = str(Path(document_graph_path))
        self._document_graph_revision = self._read_document_graph_revision(Path(document_graph_path))
        logger.info(f"Knowledge graph built: nodes={self.graph.number_of_nodes()}, edges={self.graph.number_of_edges()}")
        self.sync_to_database(clear_existing=True)

    def reload_all(
        self,
        data_dir: Optional[str] = None,
        document_graph_path: Optional[str] = None,
    ) -> None:
        """Reload static graph data plus persisted document subgraphs."""

        self.build_from_data(
            data_dir=str(Path(data_dir) if data_dir else self.DEFAULT_DATA_DIR),
            document_graph_path=str(Path(document_graph_path) if document_graph_path else self.DEFAULT_DOCUMENT_GRAPH_PATH),
        )

    def add_node(self, node: GraphNode) -> None:
        self.graph.add_node(
            node.id,
            type=node.type.value,
            name=node.name,
            description=node.description,
            **node.properties,
        )

    def add_edge(self, edge: GraphEdge) -> None:
        self.graph.add_edge(
            edge.source_id,
            edge.target_id,
            type=edge.type.value,
            weight=edge.weight,
            **edge.properties,
        )

    def ensure_ready(self) -> None:
        """Build graph once on first use."""

        if self._built:
            current_revision = self._read_document_graph_revision(Path(self._document_graph_path))
            if current_revision and current_revision != self._document_graph_revision:
                logger.info("Document graph revision changed, reloading graph builder")
                self.reload_all(
                    data_dir=self._data_dir,
                    document_graph_path=self._document_graph_path,
                )
            return

        self.build_from_data(
            str(self.DEFAULT_DATA_DIR),
            str(self.DEFAULT_DOCUMENT_GRAPH_PATH),
        )

    def match_nodes_by_text(self, text: str) -> List[str]:
        """Fuzzy match node names by text tokens."""

        self.ensure_ready()
        if not text:
            return []

        tokens = [token for token in text.replace("，", " ").replace(",", " ").split() if token]
        lowered = text.lower()
        matched = []

        for node_id, attrs in self.graph.nodes(data=True):
            name = str(attrs.get("name", ""))
            description = str(attrs.get("description", ""))
            aliases = attrs.get("aliases", [])
            heading_path = str(attrs.get("heading_path", attrs.get("properties", {}).get("heading_path", "")))
            name_lower = name.lower()
            haystacks = [name_lower, description.lower(), heading_path.lower()]
            haystacks.extend(str(alias).lower() for alias in aliases if alias)
            if any(lowered in haystack or haystack in lowered for haystack in haystacks if haystack):
                matched.append(node_id)
                continue

            if tokens and any(
                token.lower() in haystack
                for token in tokens
                for haystack in haystacks
                if haystack
            ):
                matched.append(node_id)

        return matched

    def query_fault_causes(self, fault_name: str) -> List[dict]:
        """Find causes and solutions for a given fault name."""

        self.ensure_ready()
        matched_faults = [
            node_id
            for node_id in self.match_nodes_by_text(fault_name)
            if self.graph.nodes[node_id].get("type") == NodeType.FAULT.value
        ]

        results: List[dict] = []
        for fault_id in matched_faults:
            fault_node = self.graph.nodes[fault_id]
            fault_display = fault_node.get("name", fault_id)

            for cause_id in self.graph.successors(fault_id):
                edge = self.graph.get_edge_data(fault_id, cause_id, default={})
                if edge.get("type") != EdgeType.CAUSED_BY.value:
                    continue

                cause_node = self.graph.nodes[cause_id]
                solutions = []
                for solution_id in self.graph.successors(cause_id):
                    solved_edge = self.graph.get_edge_data(cause_id, solution_id, default={})
                    if solved_edge.get("type") != EdgeType.SOLVED_BY.value:
                        continue
                    solution_node = self.graph.nodes[solution_id]
                    solutions.append(
                        {
                            "id": solution_id,
                            "name": solution_node.get("name", solution_id),
                            "properties": {
                                key: value
                                for key, value in solution_node.items()
                                if key not in {"type", "name", "description"}
                            },
                        }
                    )

                results.append(
                    {
                        "fault_id": fault_id,
                        "fault": fault_display,
                        "cause_id": cause_id,
                        "cause": cause_node.get("name", cause_id),
                        "probability": float(edge.get("weight", 0)),
                        "evidence": edge.get("evidence_parameters", []),
                        "solutions": solutions,
                    }
                )

        results.sort(key=lambda item: item.get("probability", 0), reverse=True)
        return results

    def query_equipment_chain(self, pipeline_text: str) -> dict:
        """Return pipeline -> station -> pump chain."""

        self.ensure_ready()
        pipeline_nodes = [
            node_id
            for node_id in self.match_nodes_by_text(pipeline_text)
            if self.graph.nodes[node_id].get("type") == NodeType.PIPELINE.value
        ]

        if not pipeline_nodes:
            return {"pipeline": None, "pump_stations": []}

        pipeline_id = pipeline_nodes[0]
        chain = {"pipeline": self._node_view(pipeline_id), "pump_stations": []}

        for station_id in self.graph.successors(pipeline_id):
            edge = self.graph.get_edge_data(pipeline_id, station_id, default={})
            if edge.get("type") != EdgeType.CONTAINS.value:
                continue

            station = self._node_view(station_id)
            station["pumps"] = []

            for pump_id in self.graph.successors(station_id):
                pump_edge = self.graph.get_edge_data(station_id, pump_id, default={})
                if pump_edge.get("type") != EdgeType.INSTALLED.value:
                    continue
                station["pumps"].append(self._node_view(pump_id))

            chain["pump_stations"].append(station)

        return chain

    def find_related_standards(self, parameter_text: str) -> List[dict]:
        """Find standards related to parameter-like nodes."""

        self.ensure_ready()
        parameter_ids = [
            node_id
            for node_id in self.match_nodes_by_text(parameter_text)
            if self.graph.nodes[node_id].get("type") == NodeType.PARAMETER.value
        ]

        standards: List[dict] = []
        visited: Set[str] = set()

        for parameter_id in parameter_ids:
            for source_id, _, edge in self.graph.in_edges(parameter_id, data=True):
                if edge.get("type") != EdgeType.SPECIFIES.value:
                    continue
                if source_id in visited:
                    continue
                visited.add(source_id)

                node = self.graph.nodes[source_id]
                standards.append(
                    {
                        "id": source_id,
                        "name": node.get("name", source_id),
                        "threshold": edge.get("threshold"),
                        "parameter": self.graph.nodes[parameter_id].get("name", parameter_id),
                    }
                )

        return standards

    def get_subgraph_for_visualization(self, center_node: str, depth: int = 2) -> dict:
        """Return nodes/edges payload for graph visualization."""

        self.ensure_ready()
        if center_node not in self.graph:
            return {"nodes": [], "edges": []}

        nodes: Dict[str, dict] = {}
        edges: List[dict] = []
        frontier = {center_node}
        visited = {center_node}

        for _ in range(max(depth, 1)):
            next_frontier: Set[str] = set()
            for node_id in frontier:
                neighbors = set(self.graph.successors(node_id)) | set(self.graph.predecessors(node_id))
                for neighbor in neighbors:
                    if neighbor not in visited:
                        visited.add(neighbor)
                        next_frontier.add(neighbor)
            frontier = next_frontier

        for node_id in visited:
            nodes[node_id] = self._node_view(node_id)

        for source_id in visited:
            for target_id in self.graph.successors(source_id):
                if target_id not in visited:
                    continue
                edge = self.graph.get_edge_data(source_id, target_id, default={})
                edges.append(
                    {
                        "source": source_id,
                        "target": target_id,
                        "type": edge.get("type", ""),
                        "weight": edge.get("weight", 1.0),
                    }
                )

        return {"nodes": list(nodes.values()), "edges": edges}

    def query_fuzzy(self, text: str, depth: int = 2, limit: int = 3) -> dict:
        """Return fuzzy matched nodes plus a visualization-ready subgraph."""

        self.ensure_ready()
        matched_ids = self.match_nodes_by_text(text)
        if not matched_ids:
            return {
                "message": f"未找到与 '{text}' 相关的知识图谱信息。",
                "matched_nodes": [],
                "center_node": None,
                "visualization": {"nodes": [], "edges": []},
                "total_matches": 0,
            }

        limited_ids = matched_ids[: max(limit, 1)]
        matched_nodes = [self._node_view(node_id) for node_id in limited_ids]
        center_node = limited_ids[0]
        visualization = self.get_subgraph_for_visualization(center_node, depth=depth)

        return {
            "message": f"已匹配 {len(matched_ids)} 个图谱节点，当前展示 {len(visualization.get('nodes', []))} 个节点的关联子图。",
            "matched_nodes": matched_nodes,
            "center_node": center_node,
            "visualization": visualization,
            "total_matches": len(matched_ids),
        }

    def sync_to_database(self, clear_existing: bool = True) -> None:
        """Sync in-memory graph to MySQL tables."""

        node_sql = text(
            """
            INSERT INTO t_kg_node
                (node_id, node_type, name, description, properties, create_time, update_time)
            VALUES
                (:node_id, :node_type, :name, :description, CAST(:properties AS JSON), NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                node_type = VALUES(node_type),
                name = VALUES(name),
                description = VALUES(description),
                properties = VALUES(properties),
                update_time = NOW()
            """
        )
        edge_sql = text(
            """
            INSERT INTO t_kg_edge
                (source_id, target_id, edge_type, weight, properties, create_time)
            VALUES
                (:source_id, :target_id, :edge_type, :weight, CAST(:properties AS JSON), NOW())
            """
        )
        try:
            engine = get_engine()
            with engine.begin() as conn:
                if clear_existing:
                    conn.execute(text("DELETE FROM t_kg_edge"))
                    conn.execute(text("DELETE FROM t_kg_node"))

                for node_id, attrs in self.graph.nodes(data=True):
                    conn.execute(
                        node_sql,
                        {
                            "node_id": node_id,
                            "node_type": str(attrs.get("type", "")),
                            "name": str(attrs.get("name", node_id)),
                            "description": str(attrs.get("description", "")),
                            "properties": json.dumps(
                                {
                                    key: value
                                    for key, value in attrs.items()
                                    if key not in {"type", "name", "description"}
                                },
                                ensure_ascii=False,
                            ),
                        },
                    )

                edge_seen: Set[tuple[str, str, str]] = set()
                for source_id, target_id, attrs in self.graph.edges(data=True):
                    edge_type = str(attrs.get("type", ""))
                    key = (source_id, target_id, edge_type)
                    if key in edge_seen:
                        continue
                    edge_seen.add(key)
                    conn.execute(
                        edge_sql,
                        {
                            "source_id": source_id,
                            "target_id": target_id,
                            "edge_type": edge_type,
                            "weight": float(attrs.get("weight", 1.0)),
                            "properties": json.dumps(
                                {
                                    k: v
                                    for k, v in attrs.items()
                                    if k not in {"type", "weight"}
                                },
                                ensure_ascii=False,
                            ),
                        },
                    )
            logger.info("Knowledge graph synced to database")
        except Exception as exc:
            logger.warning("Knowledge graph DB sync failed, keeping previous DB state: {}", exc)

    def _load_document_graph(self, file_path: Path) -> None:
        """Load persisted document subgraphs from the knowledge-base registry."""

        if not file_path.exists():
            return

        try:
            payload = self._load_json(file_path)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Document graph load failed: {}", exc)
            return

        documents = payload.get("documents", {})
        for item in documents.values():
            for node in item.get("nodes", []):
                self._add_serialized_node(node)
            for edge in item.get("edges", []):
                self._add_serialized_edge(edge)

    def _add_serialized_node(self, node: Dict[str, Any]) -> None:
        node_id = str(node.get("id", "")).strip()
        if not node_id:
            return

        properties = dict(node.get("properties") or {})
        self.graph.add_node(
            node_id,
            type=str(node.get("type", "")),
            name=str(node.get("name", node_id)),
            description=str(node.get("description", "")),
            **properties,
        )

    def _add_serialized_edge(self, edge: Dict[str, Any]) -> None:
        source_id = str(edge.get("source_id", "")).strip()
        target_id = str(edge.get("target_id", "")).strip()
        if not source_id or not target_id:
            return
        if source_id not in self.graph or target_id not in self.graph:
            return

        properties = dict(edge.get("properties") or {})
        self.graph.add_edge(
            source_id,
            target_id,
            type=str(edge.get("type", "")),
            weight=float(edge.get("weight", 1.0) or 1.0),
            **properties,
        )

    @staticmethod
    def _read_document_graph_revision(file_path: Path) -> str:
        if not file_path.exists():
            return ""
        try:
            stat = file_path.stat()
            return f"{stat.st_mtime_ns}:{stat.st_size}"
        except Exception:
            return ""

    def _load_equipment_data(self, file_path: Path) -> None:
        if not file_path.exists():
            return

        data = self._load_json(file_path)
        for pipeline in data.get("pipelines", []):
            pipeline_id = pipeline["id"]
            self.add_node(
                GraphNode(
                    id=pipeline_id,
                    type=NodeType.PIPELINE,
                    name=pipeline.get("name", pipeline_id),
                    properties={"length_km": pipeline.get("length_km")},
                )
            )

            oil = pipeline.get("oil_property")
            if oil:
                oil_id = oil["id"]
                self.add_node(
                    GraphNode(
                        id=oil_id,
                        type=NodeType.OIL_PROPERTY,
                        name=oil.get("name", oil_id),
                        properties={"density": oil.get("density"), "viscosity": oil.get("viscosity")},
                    )
                )
                self.add_edge(GraphEdge(source_id=pipeline_id, target_id=oil_id, type=EdgeType.TRANSPORTS))

            for station in pipeline.get("pump_stations", []):
                station_id = station["id"]
                self.add_node(
                    GraphNode(
                        id=station_id,
                        type=NodeType.PUMP_STATION,
                        name=station.get("name", station_id),
                        properties={"index": station.get("index")},
                    )
                )
                self.add_edge(GraphEdge(source_id=pipeline_id, target_id=station_id, type=EdgeType.CONTAINS))

                for pump in station.get("pumps", []):
                    pump_id = pump["id"]
                    self.add_node(
                        GraphNode(
                            id=pump_id,
                            type=NodeType.PUMP,
                            name=pump.get("name", pump_id),
                            properties={"model": pump.get("model"), "head": pump.get("head")},
                        )
                    )
                    self.add_edge(GraphEdge(source_id=station_id, target_id=pump_id, type=EdgeType.INSTALLED))

    def _load_fault_causal_data(self, file_path: Path) -> None:
        if not file_path.exists():
            return

        data = self._load_json(file_path)
        for fault in data.get("faults", []):
            fault_id = fault["id"]
            self.add_node(
                GraphNode(
                    id=fault_id,
                    type=NodeType.FAULT,
                    name=fault.get("name", fault_id),
                    properties={"affected_parameters": fault.get("affected_parameters", [])},
                )
            )

            for cause in fault.get("causes", []):
                cause_id = cause["id"]
                self.add_node(
                    GraphNode(
                        id=cause_id,
                        type=NodeType.CAUSE,
                        name=cause.get("name", cause_id),
                        properties={"evidence_parameters": cause.get("evidence_parameters", [])},
                    )
                )
                self.add_edge(
                    GraphEdge(
                        source_id=fault_id,
                        target_id=cause_id,
                        type=EdgeType.CAUSED_BY,
                        weight=float(cause.get("probability", 0)),
                        properties={"evidence_parameters": cause.get("evidence_parameters", [])},
                    )
                )

                for solution in cause.get("solutions", []):
                    solution_id = solution["id"]
                    self.add_node(
                        GraphNode(
                            id=solution_id,
                            type=NodeType.SOLUTION,
                            name=solution.get("name", solution_id),
                            properties={
                                "cost": solution.get("cost"),
                                "downtime": solution.get("downtime"),
                            },
                        )
                    )
                    self.add_edge(
                        GraphEdge(
                            source_id=cause_id,
                            target_id=solution_id,
                            type=EdgeType.SOLVED_BY,
                        )
                    )

            for parameter in fault.get("affected_parameters", []):
                parameter_id = f"param_{parameter}"
                self.add_node(
                    GraphNode(
                        id=parameter_id,
                        type=NodeType.PARAMETER,
                        name=parameter,
                    )
                )
                self.add_edge(GraphEdge(source_id=fault_id, target_id=parameter_id, type=EdgeType.AFFECTS))

    def _load_standards_data(self, file_path: Path) -> None:
        if not file_path.exists():
            return

        data = self._load_json(file_path)
        for standard in data.get("standards", []):
            std_id = standard["id"]
            self.add_node(
                GraphNode(
                    id=std_id,
                    type=NodeType.STANDARD,
                    name=standard.get("name", std_id),
                    properties={"code": standard.get("code")},
                )
            )

            for item in standard.get("specifies", []):
                parameter_name = item.get("parameter")
                parameter_id = f"param_{parameter_name}"
                if parameter_id not in self.graph:
                    self.add_node(
                        GraphNode(
                            id=parameter_id,
                            type=NodeType.PARAMETER,
                            name=parameter_name,
                        )
                    )
                self.add_edge(
                    GraphEdge(
                        source_id=std_id,
                        target_id=parameter_id,
                        type=EdgeType.SPECIFIES,
                        weight=1.0,
                        properties={"threshold": item.get("threshold")},
                    )
                )

    @staticmethod
    def _load_json(path: Path) -> dict:
        with path.open("r", encoding="utf-8-sig") as file:
            return json.load(file)

    def _node_view(self, node_id: str) -> dict:
        attrs = self.graph.nodes[node_id]
        return {
            "id": node_id,
            "type": attrs.get("type"),
            "name": attrs.get("name", node_id),
            "description": attrs.get("description", ""),
            "properties": {
                key: value
                for key, value in attrs.items()
                if key not in {"type", "name", "description"}
            },
        }


_BUILDER: Optional[KnowledgeGraphBuilder] = None


def get_knowledge_graph_builder() -> KnowledgeGraphBuilder:
    """Return singleton knowledge graph builder."""

    global _BUILDER
    if _BUILDER is None:
        _BUILDER = KnowledgeGraphBuilder()
        _BUILDER.ensure_ready()
    return _BUILDER
