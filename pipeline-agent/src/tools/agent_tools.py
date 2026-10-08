"""Compatibility tool wrappers and metadata for the ReAct workflow."""

from __future__ import annotations

from typing import Any, Dict, List

from langchain_core.tools import tool

from src.agents import (
    get_calc_agent,
    get_data_agent,
    get_graph_agent,
    get_knowledge_agent,
)
from src.utils import logger


def _run_agent_tool(tool_name: str, agent_factory, method_name: str, *args, **kwargs) -> str:
    """Call one agent method and keep a stable string-returning compatibility contract."""
    try:
        agent = agent_factory()
        method = getattr(agent, method_name)
        return method(*args, **kwargs)
    except Exception as exc:  # noqa: BLE001
        logger.error("{} failed: {}", tool_name, exc)
        return f"调用失败: {tool_name}: {exc}"


def _run_graph_query(tool_name: str, query: str, query_type: str) -> str:
    return _run_agent_tool(
        tool_name,
        get_graph_agent,
        "execute",
        query,
        query_type=query_type,
    )


@tool
def query_database(question: str) -> str:
    """Query structured business data such as projects, pipelines, stations, and oil data."""
    return _run_agent_tool("query_database", get_data_agent, "execute", question)


@tool
def hydraulic_calculation(question: str) -> str:
    """Run hydraulic calculation or optimization from a natural-language request."""
    return _run_agent_tool("hydraulic_calculation", get_calc_agent, "execute", question)


@tool
def search_knowledge_base(question: str) -> str:
    """Search the pipeline engineering knowledge base and return an answer."""
    return _run_agent_tool("search_knowledge_base", get_knowledge_agent, "execute", question)


@tool
def query_fault_cause(query: str) -> str:
    """Query the knowledge graph for fault-cause relationships."""
    return _run_graph_query("query_fault_cause", query, "fault_cause")


@tool
def query_standards(query: str) -> str:
    """Query standards and compliance information from the knowledge graph."""
    return _run_graph_query("query_standards", query, "standards")


@tool
def query_equipment_chain(query: str) -> str:
    """Query equipment upstream/downstream relationships from the knowledge graph."""
    return _run_graph_query("query_equipment_chain", query, "equipment_chain")


@tool
def run_sensitivity_analysis(question: str) -> str:
    """Run sensitivity analysis through the extended analysis toolchain."""
    try:
        from src.tools.extended_tools import call_sensitivity_analysis

        return call_sensitivity_analysis.invoke(question)
    except Exception as exc:  # noqa: BLE001
        logger.error("run_sensitivity_analysis failed: {}", exc)
        return f"调用失败: run_sensitivity_analysis: {exc}"


@tool
def plan_complex_task(task_description: str) -> str:
    """Run the plan-and-execute subgraph for multi-step tasks."""
    try:
        from src.workflows.subgraph import run_plan_execute

        return run_plan_execute(task_description)
    except Exception as exc:  # noqa: BLE001
        logger.error("plan_complex_task failed: {}", exc)
        return f"调用失败: plan_complex_task: {exc}"


REACT_TOOLS = [
    query_database,
    hydraulic_calculation,
    search_knowledge_base,
    query_fault_cause,
    query_standards,
    query_equipment_chain,
    run_sensitivity_analysis,
    plan_complex_task,
]

TOOL_NAME_TO_TOOL = {tool.name: tool for tool in REACT_TOOLS}

# Keep high-frequency data/knowledge tools always available to avoid empty-tool edge cases.
ALWAYS_LOADED_TOOL_NAMES = ["query_database", "search_knowledge_base"]

TOOL_REGISTRY: Dict[str, Dict[str, Any]] = {
    "query_database": {
        "description": "查询结构化项目、管道、泵站、油品等业务数据。Query structured project, pipeline, station, and oil-property data.",
        "keywords": [
            "数据库", "数据查询", "项目", "管道", "泵站", "油品", "参数", "字段", "表", "SQL",
            "database", "query", "project", "pipeline", "station", "oil", "data",
        ],
        "category": "data",
        "defer_loading": False,
        "usage_frequency": 0.75,
        "input_examples": [
            {"question": "查询项目A的所有管道直径和长度"},
            {"question": "统计各泵站的平均效率"},
            {"question": "Query all pipeline diameters and lengths for project A"},
        ],
    },
    "hydraulic_calculation": {
        "description": "执行水力计算、压降分析和泵组优化。Run hydraulic calculations, pressure-drop analysis, and pump optimization.",
        "keywords": [
            "水力", "计算", "雷诺数", "摩阻", "压降", "流量", "扬程", "泵", "优化",
            "hydraulic", "calculation", "reynolds", "friction", "pressure drop", "flow", "pump",
        ],
        "category": "calculation",
        "defer_loading": True,
        "usage_frequency": 0.75,
        "input_examples": [
            {"question": "计算流量1200m3/h时的雷诺数和沿程压降"},
            {"question": "对比两种泵组组合下的出口压力"},
            {"question": "Calculate Reynolds number and pressure drop at 1200 m3/h"},
        ],
    },
    "search_knowledge_base": {
        "description": "检索知识库中的规范、标准、手册、原理和公式。Search standards, manuals, principles, and formulas in the knowledge base.",
        "keywords": [
            "知识库", "规范", "标准", "手册", "原理", "公式", "FAQ", "检索", "问答",
            "knowledge", "manual", "standard", "spec", "principle", "formula", "search",
        ],
        "category": "knowledge",
        "defer_loading": True,
        "usage_frequency": 0.72,
        "input_examples": [
            {"question": "达西摩阻系数应如何选取？"},
            {"question": "管道设计压力应参考哪些标准？"},
            {"question": "How should Darcy friction coefficient be chosen?"},
        ],
    },
    "query_fault_cause": {
        "description": "通过知识图谱分析故障根因和因果链。Analyze fault root causes and causal chains with the knowledge graph.",
        "keywords": [
            "故障", "根因", "因果", "异常", "诊断", "原因", "告警",
            "fault", "root cause", "causal", "abnormal", "diagnosis", "reason",
        ],
        "category": "graph",
        "defer_loading": True,
        "usage_frequency": 0.42,
        "input_examples": [
            {"query": "出口压力波动可能有哪些根因？"},
            {"query": "流量异常下降可能对应什么故障链？"},
            {"query": "Possible root causes of outlet pressure oscillation?"},
        ],
    },
    "query_standards": {
        "description": "查询标准、规范条款和合规要求。Query standards, clauses, and compliance requirements.",
        "keywords": [
            "标准", "规范", "条款", "合规", "要求", "依据",
            "standard", "specification", "compliance", "requirement", "clause",
        ],
        "category": "graph",
        "defer_loading": True,
        "usage_frequency": 0.40,
        "input_examples": [
            {"query": "管道允许压力偏差的相关标准条款"},
            {"query": "泵站运维巡检频次要求"},
            {"query": "Relevant standard clauses for allowable pipeline pressure deviation"},
        ],
    },
    "query_equipment_chain": {
        "description": "查询设备上下游关系和依赖链路。Query upstream/downstream equipment relationships and dependencies.",
        "keywords": [
            "设备", "链路", "上下游", "关联", "依赖", "关系",
            "equipment", "chain", "upstream", "downstream", "relation", "dependency",
        ],
        "category": "graph",
        "defer_loading": True,
        "usage_frequency": 0.38,
        "input_examples": [
            {"query": "泵站A的上下游设备链路"},
            {"query": "与阀门V-21相关的关键设备有哪些？"},
            {"query": "Upstream and downstream chain for pump station A"},
        ],
    },
    "run_sensitivity_analysis": {
        "description": "执行参数敏感性分析并比较变量变化对结果的影响。Run sensitivity analysis on key variables and compare impact on outputs.",
        "keywords": [
            "敏感性", "参数", "变量", "变化", "影响", "分析", "对比",
            "sensitivity", "parameter", "variation", "impact", "analysis", "compare",
        ],
        "category": "analysis",
        "defer_loading": True,
        "usage_frequency": 0.48,
        "input_examples": [
            {"question": "分析流量变化对摩阻损失的影响"},
            {"question": "比较密度和粘度变化对压降的影响"},
            {"question": "Analyze how flow-rate changes affect friction loss"},
        ],
    },
    "plan_complex_task": {
        "description": "对需要多个工具或多个 agent 协作的复杂任务进行规划和执行。Plan and execute multi-step tasks that need several tools or agents.",
        "keywords": [
            "复杂任务", "规划", "步骤", "多步", "报告", "方案", "协作",
            "complex task", "steps", "plan", "multi-step", "report", "solution",
        ],
        "category": "orchestration",
        "defer_loading": True,
        "usage_frequency": 0.34,
        "input_examples": [
            {"task_description": "先查参数，再做水力分析，最后输出优化报告"},
            {"task_description": "对比三种泵方案并给出推荐和风险说明"},
            {"task_description": "Query parameters, run hydraulic analysis, then output an optimization report"},
        ],
    },
}


def get_tools_by_names(tool_names: List[str]) -> List[Any]:
    """Return tools by name while preserving order and removing duplicates."""
    selected: List[Any] = []
    seen = set()
    for name in tool_names:
        if name in seen:
            continue
        tool_obj = TOOL_NAME_TO_TOOL.get(name)
        if tool_obj is None:
            continue
        selected.append(tool_obj)
        seen.add(name)
    return selected


def get_all_tool_names() -> List[str]:
    return list(TOOL_NAME_TO_TOOL.keys())


def get_all_registered_tool_names() -> List[str]:
    """Return every tool name currently indexed for search/execution."""
    return list(TOOL_REGISTRY.keys())
