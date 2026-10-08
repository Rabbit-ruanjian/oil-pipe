"""Knowledge graph schema definitions."""

from dataclasses import dataclass, field
from enum import Enum


class NodeType(str, Enum):
    DOCUMENT = "document"
    SECTION = "section"
    CONCEPT = "concept"
    PIPELINE = "pipeline"
    PUMP_STATION = "pump_station"
    PUMP = "pump"
    OIL_PROPERTY = "oil_property"
    FAULT = "fault"
    CAUSE = "cause"
    SOLUTION = "solution"
    STANDARD = "standard"
    PARAMETER = "parameter"
    FLOW_REGIME = "flow_regime"


class EdgeType(str, Enum):
    CONTAINS = "contains"
    INSTALLED = "installed"
    TRANSPORTS = "transports"
    REFERENCES = "references"
    HAS_PARAM = "has_param"
    CAUSED_BY = "caused_by"
    SOLVED_BY = "solved_by"
    AFFECTS = "affects"
    DETERMINES = "determines"
    SPECIFIES = "specifies"


@dataclass
class GraphNode:
    id: str
    type: NodeType
    name: str
    properties: dict = field(default_factory=dict)
    description: str = ""


@dataclass
class GraphEdge:
    source_id: str
    target_id: str
    type: EdgeType
    weight: float = 1.0
    properties: dict = field(default_factory=dict)
