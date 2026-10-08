"""A 类"存入"编排层（P0-① 方案 A）：/knowledge/ingest 的领域逻辑。

职责边界（不重造 save_upload 的轮子）：
- ingest_structured_knowledge: 把 POST /knowledge/ingest 请求拆成"文档入 save_upload
  + 专家知识直入 / LLM 抽取 / 蒸馏"的编排，事务上复用 save_upload 的回滚语义。
- distill_expert_to_document_graph: A3 蒸馏，把专家因果/步骤/知识点单元 upsert 进
  文档图（走现有 REFERENCES/CONTAINS 边，不新增 Node/Edge 类型）。
- detect_complex_extraction: A1 HITL 扫描，LLM 判断"能不能做复杂抽取"，
  置信度 < hitl_confidence_threshold → HITL；历史选择过同类 → 自动做。
- ingest_pre_execution_hook: save_upload 的入库前 pre-execution hook 主体
  （挂 run_pre_ingestion_hooks），受 llm_extract 开关控制；关闭/异常时降级跳过。

所有新增 LLM 调用统一走 src.llm.llm_client.get_llm_client()；
HITL 复用 src.workflows.hitl.get_hitl_manager()（save_hitl_request → t_hitl_record）；
任何 hook 异常/超时 → 降级跳过，不阻断主流程。
"""

from __future__ import annotations

import hashlib
import json
import uuid
from pathlib import Path
from typing import Any, Optional

from src.config import get_rag_config
# 延迟导入 knowledge_graph：src.knowledge_graph.document_graph 反向依赖
# src.rag.contextual_chunker，而 knowledge_ingest 又挂在 src.rag.__init__ 里，
# top-level 直连会造成循环导入。这里只保留 schema（纯 dataclass，无依赖）。
from src.knowledge_graph.schema import EdgeType, NodeType
from src.llm import LLMClientError, get_llm_client
from src.models.enums import KnowledgeCategory
from src.utils import logger

# HITL 类型/Manager：延迟导入，避免 src.workflows.__init__ 循环导入链
# （src.rag → knowledge_ingest → src.workflows.hitl → workflows/__init__ →
#   graph → knowledge_agent → src.rag（未初始化）→ 失败）
_HITL_REQUEST_CLS: type | None = None
_HITL_TYPE_ENUM: type | None = None
_HITL_MANAGER_FACTORY: callable | None = None


def _ensure_hitl_imports() -> None:
    """首次调用时延迟导入 HITL 相关符号，失败则使用桩类。"""
    global _HITL_REQUEST_CLS, _HITL_TYPE_ENUM, _HITL_MANAGER_FACTORY
    if _HITL_REQUEST_CLS is not None:
        return
    try:
        import sys
        import pathlib
        import importlib.util
        # 直接加载 hitl.py 文件，绕过 workflows/__init__.py
        hitl_mod = sys.modules.get("src.workflows.hitl")
        if hitl_mod is None or not hasattr(hitl_mod, "HITLRequest"):
            pkg_dir = pathlib.Path(__file__).resolve().parent.parent.parent
            hitl_path = pkg_dir / "workflows" / "hitl.py"
            spec = importlib.util.spec_from_file_location(
                "src.workflows.hitl", str(hitl_path), submodule_search_locations=[],
            )
            hitl_mod = importlib.util.module_from_spec(spec)
            sys.modules["src.workflows.hitl"] = hitl_mod
            spec.loader.exec_module(hitl_mod)
        _HITL_REQUEST_CLS = hitl_mod.HITLRequest
        _HITL_TYPE_ENUM = hitl_mod.HITLType
        _HITL_MANAGER_FACTORY = hitl_mod.get_hitl_manager
    except Exception:
        # 降级：定义最小桩类，仅用于类型提示
        from dataclasses import dataclass
        from enum import Enum

        class _HITLTypeStub(str, Enum):
            PARAMETER_CONFIRM = "parameter_confirm"

        @dataclass
        class _HITLRequestStub:
            request_id: str = ""
            type: _HITLTypeStub = _HITLTypeStub.PARAMETER_CONFIRM
            title: str = ""
            description: str = ""
            options: list[dict] = None
            data: dict = None
            timeout_seconds: int = 300
            default_option: str | None = None

        _HITL_REQUEST_CLS = _HITLRequestStub
        _HITL_TYPE_ENUM = _HITLTypeStub
        _HITL_MANAGER_FACTORY = lambda: None

def _load_kg_factories():
    """延迟加载 knowledge_graph 工厂，规避 src.rag → knowledge_ingest →
    knowledge_graph.document_graph → src.rag.contextual_chunker 的循环导入。"""

    from src.knowledge_graph import (
        create_document_graph_registry,
        get_knowledge_graph_builder,
    )

    return create_document_graph_registry, get_knowledge_graph_builder

# 历史 HITL 选择记录键（存 sidecar 元数据，跨会话复用）
HITL_HISTORY_KEY = "hitl_extract_history"
_EXTRACT_CATEGORY = "complex_extract"
_MAX_LLM_TEXT_CHARS = 12000


# ---------------------------------------------------------------------------
# 专家知识字段归一化（对齐 fault_causal.json schema）
# ---------------------------------------------------------------------------


def normalize_expert_knowledge(
    raw_items: list[dict[str, Any]], *, source_doc_id: str
) -> dict[str, Any]:
    """归一化 expert_knowledge 字段组。

    支持两种入参形态（报告 A 方案"故障/原因/解法/步骤"字段组）：
      1) 因果链形态: {fault, cause, prob, solution, cost, downtime}
      2) 嵌套形态:   {fault, causes: [{cause, prob, solutions: [{solution, cost, downtime}]}]}

    返回按 fault 分组、去重后的结构（同 fault+cause+solution 去重），
    供 distill_expert_to_document_graph 直接消费。
    """

    by_fault: dict[str, dict[str, Any]] = {}

    def _slug(text: str, prefix: str) -> str:
        text = str(text or "").strip()
        normalized = "".join(ch for ch in text if ch.isalnum() or ch in "_-")
        digest = hashlib.md5(text.casefold().encode("utf-8")).hexdigest()[:12]
        label = normalized or digest[:8]
        return f"{prefix}::{label}-{digest}"

    for item in raw_items or []:
        if not isinstance(item, dict):
            continue
        fault_name = str(item.get("fault") or "").strip()
        if not fault_name:
            continue

        cause_entries: list[dict[str, Any]]
        if isinstance(item.get("causes"), list):
            cause_entries = [c for c in item["causes"] if isinstance(c, dict)]
        else:
            cause_entries = []
            if item.get("cause") is not None:
                cause_entries.append(
                    {
                        "cause": item.get("cause"),
                        "prob": item.get("prob"),
                        "solutions": item.get("solutions", [
                            {
                                "solution": item.get("solution"),
                                "cost": item.get("cost"),
                                "downtime": item.get("downtime"),
                            },
                        ])
                        if item.get("solution") is not None
                        else [],
                    }
                )

        fault_entry = by_fault.setdefault(fault_name, {"fault": fault_name, "causes": []})
        for cause_entry in cause_entries:
            cause_name = str(cause_entry.get("cause") or "").strip()
            if not cause_name:
                continue
            prob = _clamp_probability(cause_entry.get("prob"))

            solutions = []
            raw_solutions = cause_entry.get("solutions") or []
            if isinstance(raw_solutions, list):
                raw_solution_items = raw_solutions
            elif raw_solutions:
                raw_solution_items = [raw_solutions]
            else:
                raw_solution_items = []

            for sol in raw_solution_items:
                if isinstance(sol, str):
                    sol_name, sol_cost, sol_downtime = sol.strip(), None, None
                elif isinstance(sol, dict):
                    sol_name = str(sol.get("solution") or "").strip()
                    sol_cost = sol.get("cost")
                    sol_downtime = sol.get("downtime")
                else:
                    continue
                if not sol_name:
                    continue
                solutions.append({"solution": sol_name, "cost": sol_cost, "downtime": sol_downtime})

            fault_entry["causes"].append({"cause": cause_name, "prob": prob, "solutions": solutions})

    # 去重 + 生成稳定节点 ID
    seen_nodes: set[str] = set()
    for fault_name, fault_entry in by_fault.items():
        deduped_causes: list[dict[str, Any]] = []
        seen_cause_keys: set[str] = set()
        for cause_entry in fault_entry["causes"]:
            cause_key = cause_entry["cause"].casefold()
            if cause_key in seen_cause_keys:
                continue
            seen_cause_keys.add(cause_key)

            deduped_solutions: list[dict[str, Any]] = []
            seen_sol_keys: set[str] = set()
            for sol in cause_entry["solutions"]:
                sol_key = sol["solution"].casefold()
                if sol_key in seen_sol_keys:
                    continue
                seen_sol_keys.add(sol_key)
                deduped_solutions.append(sol)

            deduped_causes.append(
                {
                    "cause": cause_entry["cause"],
                    "prob": cause_entry["prob"],
                    "solutions": deduped_solutions,
                }
            )
        fault_entry["causes"] = deduped_causes

        fault_id = _slug(fault_name, "fault")
        fault_entry["fault_id"] = fault_id
        seen_nodes.add(fault_id)

        for cause_entry in fault_entry["causes"]:
            cause_id = _slug(cause_entry["cause"], "cause")
            cause_entry["cause_id"] = cause_id

            for sol in cause_entry["solutions"]:
                sol_id = _slug(sol["solution"], "sol")
                sol["solution_id"] = sol_id

    expert_nodes = []
    for fault_name, fault_entry in by_fault.items():
        expert_nodes.append(
            {
                "id": fault_entry["fault_id"],
                "type": NodeType.FAULT.value,
                "name": fault_name,
                "description": f"故障：{fault_name}",
                "properties": {
                    "namespace": "expert",
                    "source_doc_id": source_doc_id,
                },
            }
        )
        for cause_entry in fault_entry["causes"]:
            expert_nodes.append(
                {
                    "id": cause_entry["cause_id"],
                    "type": NodeType.CAUSE.value,
                    "name": cause_entry["cause"],
                    "description": f"原因：{cause_entry['cause']}（概率 {cause_entry['prob']:.2f}）"
                    if cause_entry["prob"] is not None
                    else f"原因：{cause_entry['cause']}",
                    "properties": {
                        "namespace": "expert",
                        "source_doc_id": source_doc_id,
                        "probability": cause_entry["prob"],
                    },
                }
            )
            for sol in cause_entry["solutions"]:
                expert_nodes.append(
                    {
                        "id": sol["solution_id"],
                        "type": NodeType.SOLUTION.value,
                        "name": sol["solution"],
                        "description": f"解法：{sol['solution']}",
                        "properties": {
                            "namespace": "expert",
                            "source_doc_id": source_doc_id,
                            "cost": sol.get("cost"),
                            "downtime": sol.get("downtime"),
                        },
                    }
                )

    expert_edges = []
    for fault_name, fault_entry in by_fault.items():
        fault_id = fault_entry["fault_id"]
        for cause_entry in fault_entry["causes"]:
            expert_edges.append(
                {
                    "source_id": fault_id,
                    "target_id": cause_entry["cause_id"],
                    "type": EdgeType.CAUSED_BY.value,
                    "weight": 1.0 if cause_entry["prob"] is None else float(cause_entry["prob"]),
                    "properties": {
                        "namespace": "expert",
                        "relation": "caused_by",
                        "probability": cause_entry["prob"],
                        "source_doc_id": source_doc_id,
                    },
                }
            )
            for sol in cause_entry["solutions"]:
                expert_edges.append(
                    {
                        "source_id": cause_entry["cause_id"],
                        "target_id": sol["solution_id"],
                        "type": EdgeType.SOLVED_BY.value,
                        "weight": 1.0,
                        "properties": {
                            "namespace": "expert",
                            "relation": "solved_by",
                            "cost": sol.get("cost"),
                            "downtime": sol.get("downtime"),
                            "source_doc_id": source_doc_id,
                        },
                    }
                )

    return {
        "expert_nodes": expert_nodes,
        "expert_edges": expert_edges,
        "faults": [
            {
                "fault_id": entry["fault_id"],
                "fault": name,
                "causes": entry["causes"],
            }
            for name, entry in by_fault.items()
        ],
    }


def _clamp_probability(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        prob = float(value)
    except (TypeError, ValueError):
        return None
    return min(max(prob, 0.0), 1.0)


# ---------------------------------------------------------------------------
# LLM 知识抽取（A2：因果链 / 步骤顺序 / 知识点单元）
# ---------------------------------------------------------------------------

_LLM_EXTRACT_SYSTEM = """你是管道能耗领域的知识抽取器。从给定的文本中抽取结构化知识。

输出严格 JSON（不要 markdown 代码块），形如：
{
  "faults": [
    {"fault": "故障名", "cause": "原因", "prob": 0.0~1.0, "solution": "解法", "cost": "high|medium|low", "downtime": "8h"}
  ],
  "steps": [
    {"step": 1, "action": "操作动作", "next_step": 2}
  ],
  "knowledge_units": [
    {"type": "知识点|题目|方法", "title": "标题", "content": "摘要"}
  ]
}

抽取原则：
- 因果链必须是"故障→原因→解法"的专家级语义，不是词共现。
- prob 缺省填 null；cost/downtime 无法确定时省略字段。
- 步骤顺序保留原文的操作次序，next_step 省略表示无后续。
- 抽不到对应单元就输出空数组。"""


def llm_extract_knowledge(document: Any) -> dict[str, Any]:
    """用 LLM 从文档内容抽取结构化知识（因果链/步骤/知识点）。

    失败抛 LLMClientError；调用方（ingest_pre_execution_hook / ingest_structured_knowledge）
    负责捕获并降级。
    """

    client = get_llm_client()
    content = str(getattr(document, "content", "") or "")
    if not content.strip():
        return {"faults": [], "steps": [], "knowledge_units": []}

    truncated = content[:_MAX_LLM_TEXT_CHARS]
    prompt = f"请从以下文本中抽取结构化知识：\n\n{truncated}"

    raw = client.complete(
        prompt,
        system=_LLM_EXTRACT_SYSTEM,
        temperature=0.1,
        timeout=60.0,
    )
    parsed = _parse_json_payload(raw)
    result = parsed if isinstance(parsed, dict) else {}
    return {
        "faults": result.get("faults", []) if isinstance(result.get("faults"), list) else [],
        "steps": result.get("steps", []) if isinstance(result.get("steps"), list) else [],
        "knowledge_units": result.get("knowledge_units", [])
        if isinstance(result.get("knowledge_units"), list)
        else [],
    }


def _parse_json_payload(raw: str) -> Any:
    text = str(raw or "").strip()
    if not text:
        return {}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    if start < 0:
        return {}
    for end in range(len(text) - 1, start, -1):
        if text[end] == "}":
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                continue
    return {}


# ---------------------------------------------------------------------------
# 复杂抽取检测（A1 HITL 扫描）
# ---------------------------------------------------------------------------

_DETECT_COMPLEX_SYSTEM = """你是文档类型判断器。给定文档标题与摘要，判断它是否适合做"复杂知识抽取"
（故障表/知识表/报告/规程/案例——即含因果链、步骤或可抽象的知识点单元）。

输出严格 JSON（不要 markdown 代码块）：
{"complex": true 或 false, "confidence": 0.0~1.0, "category": "bug_table|knowledge_table|report|procedure|case|plain", "reason": "一句话"}

confidence 表示你判断的置信度。拿不准就压低 confidence（不要瞎猜）。"""


def detect_complex_extraction(
    *,
    title: str,
    summary: Optional[str] = None,
    content: Optional[str] = None,
    llm_client: Any = None,
) -> dict[str, Any]:
    """LLM 检测文档是否适合做复杂抽取，返回置信度与类别。

    失败（LLMClientError）返回 {"complex": False, "confidence": 0.0, "degraded": True}，
    由调用方走 HITL 兜底（C 规则：拿不准就问）。
    """

    client = llm_client if llm_client is not None else get_llm_client()
    material = "\n".join(part for part in [f"标题：{title or ''}", f"摘要：{summary or ''}", f"正文节选：{(content or '')[:1500]}"] if part)
    prompt = f"请判断以下文档是否适合复杂知识抽取：\n\n{material}"
    try:
        raw = client.complete(prompt, system=_DETECT_COMPLEX_SYSTEM, temperature=0.0, timeout=30.0)
    except LLMClientError as exc:
        logger.warning("detect_complex_extraction LLM degraded: %s", exc)
        return {"complex": False, "confidence": 0.0, "category": "unknown", "reason": "LLM unavailable", "degraded": True}

    parsed = _parse_json_payload(raw)
    if not isinstance(parsed, dict):
        parsed = {}
    confidence = _clamp_probability(parsed.get("confidence"))
    confidence = 0.0 if confidence is None else float(confidence)
    return {
        "complex": bool(parsed.get("complex", False)),
        "confidence": confidence,
        "category": str(parsed.get("category") or "unknown"),
        "reason": str(parsed.get("reason") or ""),
        "degraded": False,
    }


# ---------------------------------------------------------------------------
# HITL 历史选择（用户之前选过同类 → 自动做）
# ---------------------------------------------------------------------------


def _get_registry() -> Any:
    """延迟获取 KnowledgeBaseRegistry 单例（切断顶层循环导入）。"""

    from .knowledge_registry import get_knowledge_registry

    return get_knowledge_registry()


def _resolve_file_path(doc_id: str) -> Optional[Path]:
    """解析 doc_id 对应的落盘文件路径；未登记/未找到返回 None。"""

    registry = _get_registry()
    item = registry.get_document(doc_id)
    if item and item.get("relative_path"):
        return registry.root_path / str(item["relative_path"])
    return None


def read_hitl_history(doc_id: str, root_path: str = "knowledge_base") -> dict[str, Any]:
    """读取文档的 HITL 复杂抽取历史选择记录。

    优先读 sidecar 元数据（.meta.json）的 hitl_extract_history 字段；
    找不到 sidecar 时读 knowledge_base/<doc_id>/hitl_history.json。
    """

    file_path = _resolve_file_path(doc_id)
    if file_path is not None:
        payload = _get_registry()._load_sidecar_payload(file_path)  # noqa: SLF001
        if payload:
            return dict(payload.get(HITL_HISTORY_KEY) or {})

    fallback = Path(root_path) / doc_id / "hitl_history.json"
    if fallback.exists():
        try:
            data = json.loads(fallback.read_text(encoding="utf-8"))
            return dict(data.get(HITL_HISTORY_KEY) or {})
        except Exception as exc:  # noqa: BLE001
            logger.warning("hitl history load failed for %s: %s", doc_id, exc)
    return {}


def record_hitl_history(
    doc_id: str, category: str, decision: str, root_path: str = "knowledge_base"
) -> None:
    """记录用户对"同类复杂抽取"的决策，供后续自动复用。

    decision ∈ {"auto", "yes", "no"}；
    "auto" 表示用户选过同类且本次未弹窗直接执行。
    优先写 sidecar 元数据；找不到 sidecar 时落盘到 knowledge_base/<doc_id>/hitl_history.json。
    """

    file_path = _resolve_file_path(doc_id)
    if file_path is not None:
        registry = _get_registry()
        payload = registry._load_sidecar_payload(file_path)  # noqa: SLF001
        history = dict(payload.get(HITL_HISTORY_KEY) or {})
        history[category] = {"decision": decision, "doc_id": doc_id}
        payload[HITL_HISTORY_KEY] = history
        registry._write_sidecar_payload(file_path, payload)  # noqa: SLF001
        return

    fallback_dir = Path(root_path) / doc_id
    fallback_dir.mkdir(parents=True, exist_ok=True)
    fallback = fallback_dir / "hitl_history.json"
    existing = {}
    if fallback.exists():
        try:
            existing = json.loads(fallback.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            existing = {}
    history = dict(existing.get(HITL_HISTORY_KEY) or {})
    history[category] = {"decision": decision, "doc_id": doc_id}
    existing[HITL_HISTORY_KEY] = history
    fallback.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")


def should_auto_extract(doc_id: str, category: str, root_path: str = "knowledge_base") -> bool:
    """用户之前对同类（category）选过"要做复杂抽取"→ 自动做。"""

    history = read_hitl_history(doc_id, root_path=root_path)
    entry = history.get(category)
    if isinstance(entry, dict):
        return entry.get("decision") in {"yes", "auto"}
    return str(entry) in {"yes", "auto"} if entry else False


def record_hitl_request_for_extraction(
    *,
    doc_id: str,
    session_id: str,
    title: str,
    detection: dict[str, Any],
) -> str:
    """创建 HITL 请求（复用 hitl.py，写 t_hitl_record），返回 request_id。

    失败降级：Redis 不可用时返回 "hitl_unavailable"，调用方继续走"不做"的安全路径。
    """

    confidence = detection.get("confidence", 0.0)
    request_id = f"ingest-{uuid.uuid4().hex[:12]}"
    options = [
        {
            "id": "yes",
            "label": "执行复杂抽取",
            "description": f"LLM 推荐：{detection.get('reason') or '识别到可抽取的因果/步骤/知识点单元'}",
        },
        {"id": "no", "label": "跳过抽取", "description": "仅保留常规入库，不做 LLM 知识抽取"},
    ]
    try:
        _ensure_hitl_imports()
        manager = _HITL_MANAGER_FACTORY()
        request = _HITL_REQUEST_CLS(
            request_id=request_id,
            type=_HITL_TYPE_ENUM.SCHEME_SELECTION,
            title=f"是否对「{title}」执行复杂知识抽取？",
            description=(
                f"系统检测到该文档可能适合复杂抽取（类别={detection.get('category')}，"
                f"置信度={confidence:.2f}，低于阈值）。请确认是否执行。"
            ),
            options=options,
            data={
                "doc_id": doc_id,
                "hitl_category": _EXTRACT_CATEGORY,
                "detection": detection,
                "default_choice": "yes" if confidence >= 0.5 else "no",
            },
            default_option="yes",
        )
        manager.create_request(session_id=session_id, request=request)
    except Exception as exc:  # noqa: BLE001
        logger.warning("HITL request create degraded for %s: %s", doc_id, exc)
        return "hitl_unavailable"
    return request_id


# ---------------------------------------------------------------------------
# 专家关系 → 文档图蒸馏（A3）
# ---------------------------------------------------------------------------


def distill_expert_to_document_graph(
    doc_id: str,
    *,
    expert_data: dict[str, Any],
    root_path: str = "knowledge_base",
) -> dict[str, int]:
    """把归一化的专家因果/解法单元 upsert 进文档图（不新增 Node/Edge 类型）。

    复用现有 CONTAINS/REFERENCES/CAUSED_BY/SOLVED_BY 边类型；
    节点 namespace 标 "expert" 以便与文档共现节点区分。
    返回 {"expert_nodes_added": N, "expert_edges_added": M}。
    """

    create_registry, _ = _load_kg_factories()
    registry = create_registry(root_path)
    store = registry._load_store()  # noqa: SLF001
    document_entry = store.setdefault("documents", {}).get(doc_id)
    if document_entry is None:
        # 文档图尚未为该 doc 建立快照（例如仅直入 expert_knowledge、未入库文件），
        # 补建最小快照占位，保证后续文档图查询可见。
        document_entry = {
            "doc_id": doc_id,
            "title": doc_id,
            "nodes": [],
            "edges": [],
        }
        store.setdefault("documents", {})[doc_id] = document_entry

    node_ids = {node.get("id") for node in document_entry.get("nodes", [])}
    existing_edge_keys = set()
    for edge in document_entry.get("edges", []):
        relation = str(edge.get("properties", {}).get("relation", ""))
        key = (
            str(edge.get("source_id", "")),
            str(edge.get("target_id", "")),
            str(edge.get("type", "")),
            relation,
        )
        existing_edge_keys.add(key)

    nodes_added = 0
    for node in expert_data.get("expert_nodes", []):
        node_id = str(node.get("id", "")).strip()
        if not node_id:
            continue
        if node_id in node_ids:
            continue
        node_ids.add(node_id)
        document_entry.setdefault("nodes", []).append(
            {
                "id": node_id,
                "type": node.get("type", NodeType.CONCEPT.value),
                "name": node.get("name", node_id),
                "description": node.get("description", ""),
                "properties": dict(node.get("properties", {})),
            }
        )
        nodes_added += 1

    edges_added = 0
    for edge in expert_data.get("expert_edges", []):
        source = str(edge.get("source_id", "")).strip()
        target = str(edge.get("target_id", "")).strip()
        if not source or not target:
            continue
        if source not in node_ids or target not in node_ids:
            continue
        etype = str(edge.get("type", EdgeType.REFERENCES.value))
        relation = str(edge.get("properties", {}).get("relation", "caused_by" if etype == EdgeType.CAUSED_BY.value else "solved_by" if etype == EdgeType.SOLVED_BY.value else ""))
        key = (source, target, etype, relation)
        if key in existing_edge_keys:
            continue
        existing_edge_keys.add(key)
        document_entry.setdefault("edges", []).append(
            {
                "source_id": source,
                "target_id": target,
                "type": etype,
                "weight": float(edge.get("weight", 1.0)),
                "properties": dict(edge.get("properties", {})),
            }
        )
        edges_added += 1

    registry._save_store(store)  # noqa: SLF001
    logger.info(
        "Expert distilled into document graph: doc_id=%s nodes_added=%s edges_added=%s",
        doc_id,
        nodes_added,
        edges_added,
    )
    return {"expert_nodes_added": nodes_added, "expert_edges_added": edges_added}


def upsert_expert_relations(
    expert_data: dict[str, Any], *, root_path: str = "knowledge_base"
) -> dict[str, int]:
    """A3 蒸馏入口：upsert 专家关系进文档图并触发图加载器 reload。

    distill_expert_graph 开关在调用方（路由）判断；此处只负责落盘 + reload。
    """

    summary = distill_expert_to_document_graph(
        _primary_doc_id_from_expert_data(expert_data), expert_data=expert_data, root_path=root_path
    )
    try:
        create_registry, get_builder = _load_kg_factories()
        get_builder().reload_all(
            document_graph_path=create_registry(root_path).path(),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Expert graph reload after distill degraded: %s", exc)
    return summary


def _primary_doc_id_from_expert_data(expert_data: dict[str, Any]) -> str:
    for node in expert_data.get("expert_nodes", []) or []:
        props = node.get("properties", {})
        if props.get("source_doc_id"):
            return str(props["source_doc_id"])
    for edge in expert_data.get("expert_edges", []) or []:
        props = edge.get("properties", {})
        if props.get("source_doc_id"):
            return str(props["source_doc_id"])
    return "expert-only"


# ---------------------------------------------------------------------------
# 入库前 pre-execution hook 主体（挂 save_upload 的 run_pre_ingestion_hooks）
# ---------------------------------------------------------------------------


def ingest_pre_execution_hook(
    *,
    document: Any,
    pipeline: Any,
    registry: Any,
    root_path: str,
) -> Optional[dict[str, Any]]:
    """save_upload 解析落盘之后、upsert_document 抽实体之前触发的 hook。

    行为（受 llm_extract / distill_expert_graph 开关控制）：
      - llm_extract=False 且 distill_expert_graph=False → 直接返回 None（no-op，逐字节一致）
      - llm_extract=True → 调 LLM 抽取因果链/步骤/知识点；
        抽取到专家关系且 distill_expert_graph=True → upsert 进文档图 + reload
      - 任何 LLMClientError / 超时 / 内部异常 → 降级跳过，返回 None，不阻断主链路

    返回 None 或 {"llm_extracted": True, "expert_nodes_added": N, "expert_edges_added": M}
    """

    flags = get_rag_config().pluggable
    if not (flags.get("llm_extract") or flags.get("distill_expert_graph")):
        return None

    doc_id = str(getattr(document, "doc_id", "") or "")
    source_doc = str(getattr(document, "source", "") or "")

    try:
        extracted = llm_extract_knowledge(document)
    except LLMClientError as exc:
        logger.warning("ingest_pre_execution_hook LLM degraded, skipping: %s", exc)
        return None

    faults = extracted.get("faults", [])
    if not faults:
        return {"llm_extracted": True, "expert_nodes_added": 0, "expert_edges_added": 0}

    if not flags.get("distill_expert_graph"):
        return {"llm_extracted": True, "expert_nodes_added": 0, "expert_edges_added": 0}

    normalized = normalize_expert_knowledge(faults, source_doc_id=doc_id or source_doc)
    if not normalized["expert_nodes"]:
        return {"llm_extracted": True, "expert_nodes_added": 0, "expert_edges_added": 0}

    try:
        summary = upsert_expert_relations(normalized, root_path=root_path)
    except Exception as exc:  # noqa: BLE001
        logger.warning("ingest_pre_execution_hook distill degraded, skipping: %s", exc)
        return {"llm_extracted": True, "expert_nodes_added": 0, "expert_edges_added": 0}

    return {
        "llm_extracted": True,
        "expert_nodes_added": int(summary.get("expert_nodes_added", 0)),
        "expert_edges_added": int(summary.get("expert_edges_added", 0)),
    }


def register_ingest_llm_extract_hook() -> None:
    """将 ingest_pre_execution_hook 注册为 PreIngestionHook。

    调用此函数后，save_upload 中 run_pre_ingestion_hooks 会自动触发
    A2 LLM 知识抽取 + A3 专家图蒸馏（受 llm_extract / distill_expert_graph 开关门控）。
    幂等：重复注册时不叠加。
    """

    from .hooks import register_pre_ingestion_hook

    # 按"函数对象是否已注册"去重，避免多次导入/初始化导致重复挂点
    import src.rag.hooks as hooks_module

    if any(h is ingest_pre_execution_hook for h in hooks_module._ingestion_hooks):  # noqa: SLF001
        return
    register_pre_ingestion_hook(ingest_pre_execution_hook, name="ingest_llm_extract")
    logger.debug("Ingest LLM-extract pre-ingestion hook registered")


# ---------------------------------------------------------------------------
# /knowledge/ingest 编排（A1）
# ---------------------------------------------------------------------------


def ingest_structured_knowledge(
    *,
    doc_id: Optional[str],
    title: str,
    category: KnowledgeCategory,
    content: Optional[str] = None,
    file_name: Optional[str] = None,
    file_bytes: Optional[bytes] = None,
    expert_knowledge: Optional[list[dict[str, Any]]] = None,
    options: Optional[dict[str, Any]] = None,
    session_id: Optional[str] = None,
    tags: Optional[list[str]] = None,
    source: Optional[str] = None,
) -> dict[str, Any]:
    """POST /knowledge/ingest 的领域编排。

    - 文件 / content 走 save_upload 完整链路（校验→落盘→sidecar→解析→双索引→文档图→回滚）
    - expert_knowledge 直入 expert_knowledge 字段组（A1）
    - options.llm_extract / distill_to_expert_graph 控制 A2/A3
    - options.build_hype 透传给 contextual_chunker（A4）
    - HITL：LLM 检测"能否做复杂抽取"，高置信静默自动；判不准（<阈值）走 hitl.py 弹窗；
      用户之前选过同类 → 自动做（record_hitl_history / should_auto_extract）

    返回 {doc_id, chunk_count, expert_nodes_added, expert_edges_added}
    """

    options = dict(options or {})
    do_llm_extract = bool(options.get("llm_extract"))
    do_distill = bool(options.get("distill_to_expert_graph"))
    session_id = session_id or "ingest-default-session"
    flags = get_rag_config().pluggable

    # 1) 文档入库（复用 save_upload）
    from src.models import KnowledgeDocumentMetadata  # 延迟导入避免循环

    doc_metadata = KnowledgeDocumentMetadata(
        title=title,
        source=source or doc_id or title,
        category=category,
        tags=tags or [category.value, "ingest"],
    )

    registry = _get_registry()

    if file_bytes is not None:
        stored = registry.save_upload(
            file_name=file_name or doc_metadata.title,
            file_bytes=file_bytes,
            metadata=doc_metadata,
        )
        resolved_doc_id = str(stored.get("doc_id") or doc_id or "")
    else:
        # 纯 content 入：落地为 .md 文件再走 save_upload 完整链路（保证事务回滚语义一致）
        text_bytes = (content or "").encode("utf-8")
        stored = registry.save_upload(
            file_name=f"{title or 'ingest'}.md",
            file_bytes=text_bytes,
            metadata=doc_metadata,
        )
        resolved_doc_id = str(stored.get("doc_id") or doc_id or "")

    resolved_doc_id = str(stored.get("doc_id") or resolved_doc_id or doc_id or "")

    # 2) 专家知识直入（A1）
    expert_data: dict[str, Any] = {"expert_nodes": [], "expert_edges": [], "faults": []}
    expert_added = {"expert_nodes_added": 0, "expert_edges_added": 0}

    raw_expert = expert_knowledge or []
    if raw_expert:
        expert_data = normalize_expert_knowledge(raw_expert, source_doc_id=resolved_doc_id)
        if do_distill:
            expert_added = upsert_expert_relations(expert_data, root_path=str(registry.root_path))
        else:
            expert_added = {
                "expert_nodes_added": len(expert_data.get("expert_nodes", [])),
                "expert_edges_added": len(expert_data.get("expert_edges", [])),
            }

    # 3) LLM 知识抽取（A2）
    llm_extract_summary: Optional[dict[str, Any]] = None
    if do_llm_extract:
        llm_extract_summary = _run_llm_extraction(
            doc_id=resolved_doc_id,
            title=title,
            category=category,
            content=content,
            session_id=session_id,
            root_path=str(registry.root_path),
            do_distill=do_distill,
            flags=flags,
        )
        if llm_extract_summary.get("expert_data"):
            expert_data = llm_extract_summary["expert_data"]
            expert_added = llm_extract_summary.get("expert_added", expert_added)
        if llm_extract_summary.get("hitl_triggered"):
            return {
                "doc_id": resolved_doc_id,
                "chunk_count": int(stored.get("chunk_count", 0)),
                "expert_nodes_added": int(expert_added.get("expert_nodes_added", 0)),
                "expert_edges_added": int(expert_added.get("expert_edges_added", 0)),
                "llm_extracted": False,
                "hitl_triggered": True,
                "hitl_request_id": llm_extract_summary.get("hitl_request_id"),
                "message": "HITL 待确认：复杂抽取需用户拍板，本次未执行",
            }

    # 4) 汇总
    chunk_count = int(stored.get("chunk_count", 0))
    if llm_extract_summary and llm_extract_summary.get("expert_added"):
        expert_added = llm_extract_summary["expert_added"]

    return {
        "doc_id": resolved_doc_id,
        "chunk_count": chunk_count,
        "expert_nodes_added": int(expert_added.get("expert_nodes_added", 0)),
        "expert_edges_added": int(expert_added.get("expert_edges_added", 0)),
        "llm_extracted": bool(llm_extract_summary and llm_extract_summary.get("llm_extracted")),
        "message": "ingest completed",
    }


def _run_llm_extraction(
    *,
    doc_id: str,
    title: str,
    category: KnowledgeCategory,
    content: Optional[str],
    session_id: str,
    root_path: str,
    do_distill: bool,
    flags: dict[str, Any],
) -> dict[str, Any]:
    """A2 LLM 抽取 + A1 HITL 检测 + 历史选择自动做。

    返回 dict: {llm_extracted, expert_data, expert_added, hitl_triggered, hitl_request_id}
    """

    summary: dict[str, Any] = {"llm_extracted": False, "expert_data": None, "expert_added": None}

    # 历史选择自动做（C 规则）
    if should_auto_extract(doc_id, _EXTRACT_CATEGORY, root_path=root_path):
        record_hitl_history(doc_id, _EXTRACT_CATEGORY, "auto", root_path=root_path)
        detection = {"complex": True, "confidence": 1.0, "category": "auto", "reason": "历史选择自动执行", "degraded": False}
    else:
        detection = detect_complex_extraction(title=title, summary=content[:200] if content else None, content=content)

    threshold = float(flags.get("hitl_confidence_threshold", 0.5))
    confident = (not detection.get("degraded")) and detection["confidence"] >= threshold and detection["complex"]

    if not confident:
        # 判不准 → HITL 弹窗（C 规则：默认问）
        request_id = record_hitl_request_for_extraction(
            doc_id=doc_id, session_id=session_id, title=title, detection=detection
        )
        if request_id == "hitl_unavailable":
            # Redis 降级 → 安全路径：不抽取，不阻断主流程
            summary["llm_extracted"] = False
            summary["hitl_triggered"] = False
            record_hitl_history(doc_id, _EXTRACT_CATEGORY, "no", root_path=root_path)
            return summary

        summary["hitl_triggered"] = True
        summary["hitl_request_id"] = request_id
        return summary

    # 高置信 / 历史自动 → 直接抽
    record_hitl_history(doc_id, _EXTRACT_CATEGORY, "yes", root_path=root_path)

    # 取文档内容供 LLM（content 已传入或从 registry 读）
    material = content
    if material is None:
        material = _read_document_content(doc_id)

    fake_doc = _FakeDocument(doc_id=doc_id, source=f"ingest:{doc_id}", content=material or "")
    try:
        extracted = llm_extract_knowledge(fake_doc)
    except LLMClientError as exc:
        logger.warning("A2 llm_extract degraded for %s: %s", doc_id, exc)
        summary["llm_extracted"] = False
        return summary

    summary["llm_extracted"] = True
    faults = extracted.get("faults", [])
    if faults and do_distill:
        expert_data = normalize_expert_knowledge(faults, source_doc_id=doc_id)
        summary["expert_data"] = expert_data
        try:
            summary["expert_added"] = upsert_expert_relations(expert_data, root_path=root_path)
        except Exception as exc:  # noqa: BLE001
            logger.warning("A3 distill degraded for %s: %s", doc_id, exc)
            summary["expert_added"] = {"expert_nodes_added": 0, "expert_edges_added": 0}
    else:
        summary["expert_added"] = {"expert_nodes_added": 0, "expert_edges_added": 0}

    return summary


class _FakeDocument:
    """最小 Document 占位，供 llm_extract_knowledge 读 content/doc_id/source。"""

    def __init__(self, *, doc_id: str, source: str, content: str) -> None:
        self.doc_id = doc_id
        self.source = source
        self.content = content


def _read_document_content(doc_id: str) -> Optional[str]:
    """从 registry 定位 doc_id 的落盘文件并读取文本；读不到返回 None。"""

    file_path = _resolve_file_path(doc_id)
    if file_path is None or not file_path.exists():
        return None
    try:
        return file_path.read_text(encoding="utf-8", errors="ignore")
    except Exception:  # noqa: BLE001
        return None
