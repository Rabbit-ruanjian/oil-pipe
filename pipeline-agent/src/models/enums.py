"""
枚举定义
"""

from enum import Enum


class IntentType(str, Enum):
    """用户意图类型"""

    QUERY = "query"
    CALCULATE = "calculate"
    KNOWLEDGE = "knowledge"
    COMPLEX = "complex"
    CHAT = "chat"


class AgentType(str, Enum):
    """Agent 类型"""

    PLANNER = "planner"
    SUPERVISOR = "supervisor"
    DATA_AGENT = "data_agent"
    CALC_AGENT = "calc_agent"
    KNOWLEDGE_AGENT = "knowledge_agent"
    GRAPH_AGENT = "graph_agent"
    REFLEXION = "reflexion"
    SYNTHESIZER = "synthesizer"


class TaskStatus(str, Enum):
    """子任务状态"""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


class FlowRegime(str, Enum):
    """流态类型"""

    LAMINAR = "laminar"
    TRANSITIONAL = "transitional"
    SMOOTH_TURBULENT = "smooth"
    MIXED_FRICTION = "mixed"
    ROUGH_TURBULENT = "rough"


class RetrievalQuality(str, Enum):
    """CRAG 检索质量评估"""

    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class KnowledgeCategory(str, Enum):
    """知识库分类"""

    STANDARDS = "standards"
    FORMULAS = "formulas"
    OPERATIONS = "operations"
    CASES = "cases"
    FAQ = "faq"
