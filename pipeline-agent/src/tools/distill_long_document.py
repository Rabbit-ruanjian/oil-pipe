"""长文本 → LLM 六维关系抽取 → 蒸馏进 Graph RAG（未注册文档自动入库）。

复用 scripts/distill_longtext_to_graphrag.py 的核心链路，封装成服务函数
供 LangGraph 智能体经 `process_long_document` 工具调用：
  长文本 → 自动入库（doc_id 未注册时：.md 落盘 + 双向量 + 文档图快照，
          必须先于 expert 入图——upsert_document 全量替换 doc 快照）
  → LLM 六维关系抽取（故障因果链 + 跨故障共享 + 设备链路 + 标准引用 + 步骤顺序 + 知识点）
  → 归一化（eq::/std::/stp::/ku:: 新前缀，确定性幂等）→ 入图 + 三层结构刷新
    （PageRank/边向量/社区向量）→ 检索验证（edge_search / community_search）。
LLM 401/失败时降级规则兜底（解析"故障 N + 原因(x.x) + 处置"格式，新维度置空），不阻断。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from src.utils import logger

# 六维统计的空值兜底（规则兜底 / LLM 未抽到新维度时返回给 Agent，口径恒定）
_EMPTY_RELATION_STATS: Dict[str, Any] = {
    "equipment_nodes": 0,
    "equipment_edges": 0,
    "standard_nodes": 0,
    "standard_edges": 0,
    "step_nodes": 0,
    "step_edges": 0,
    "knowledge_nodes": 0,
    "knowledge_edges": 0,
    "equipment_names": [],
    "standard_names": [],
    "step_names": [],
    "knowledge_names": [],
}


def _hash_slug(text: str) -> str:
    import hashlib

    digest = hashlib.md5(text.encode("utf-8")).hexdigest()[:12]
    normalized = "".join(ch for ch in text if ch.isalnum() or ch in "_-")
    return f"{normalized or 'doc'}-{digest}"


def _rule_fallback_expert(content: str, doc_id: str) -> Dict[str, Any]:
    """LLM 不可用时的降级蒸馏：解析"故障 N + 原因(x.x) + 处置"结构化格式。"""
    import re

    from src.rag.knowledge_ingest import normalize_expert_knowledge

    items: List[Dict[str, Any]] = []
    fault_blocks = re.split(r"^#+\s*故障\s*[:：]?\s*", content, flags=re.M)
    for block in fault_blocks[1:]:
        fault = block.splitlines()[0].strip()
        if not fault or len(fault) > 60:
            continue
        cause_block = re.search(r"原因\s*[:：]\s*(.+)", block, re.S)
        sol_block = re.search(r"处置\s*[:：]\s*(.+)", block, re.S)
        c_raw = cause_block.group(1).strip() if cause_block else "（规则兜底，需人工补全原因）"
        s_raw = sol_block.group(1).strip() if sol_block else "（规则兜底，需人工补全处置）"
        imp_matches = re.findall(r"0?\.\d+\b", c_raw + " " + s_raw)
        imp = min(max(max((float(x) for x in imp_matches), default=0.4), 0.0), 1.0)
        causes = [c.strip() for c in re.split(r"[；;]\s*", c_raw) if c.strip()]
        solutions = [s.strip() for s in re.split(r"[；;]\s*", s_raw) if s.strip()]
        for i, c in enumerate(causes[:4]):
            sol_name = solutions[i] if i < len(solutions) else (solutions[-1] if solutions else "（规则兜底，需人工补全处置）")
            items.append({"fault": fault, "cause": c, "solution": sol_name, "importance": imp})
    if items:
        return normalize_expert_knowledge(items, source_doc_id=doc_id)
    # 规则兜底也未抽到 → 返回空结构（带 shared_relations_added 键，保持契约一致）
    return {"expert_nodes": [], "expert_edges": [], "shared_relations_added": 0, "faults": []}


def process_long_document(
    content: str,
    title: str = "未命名文档",
    auto_refresh: bool = True,
    doc_id: Optional[str] = None,
    category: str = "cases",
) -> Dict[str, Any]:
    """把长文本的六类关系蒸馏进 Graph RAG 并刷新三层结构。

    doc_id：显式指定目标文档 ID（如把共享关系补进 legacy 文档 465e9dd71e50 的图）；
    缺省按 title 哈希生成新 slug。doc_id 未注册时自动入库（存 .md + 向量 + 文档图快照），
    入图后所有检索层（图谱/边向量/社区/BM25）同步可查；入库失败降级为纯图谱蒸馏，
    结果里带 auto_ingest_skipped 原因。
    category：自动入库的文档分类（cases/standards/operations/formulas/faq），默认 cases。

    六类关系：故障-原因(带 importance)-处置、跨故障共享（共享根因/共享处置/强相关）、
    设备链路（installed/transports/contains）、标准引用（specifies）、步骤顺序、知识点。

    返回 {ok, doc_id, auto_ingested, auto_ingest_skipped, used_llm,
    expert_nodes_added, expert_edges_added, shared_relations_added, fault_names,
    relation_stats, edge_verify, community_verify, node_verify, message}。
    """
    from src.knowledge_graph import get_knowledge_graph_builder
    from src.knowledge_graph.community import build_communities, upsert_community_vectors
    from src.knowledge_graph.graph_rank import build_graph_rank
    from src.rag.edge_vector_store import build_edge_descriptions, upsert_edge_vectors
    from src.rag.knowledge_ingest import (
        _resolve_file_path,
        ingest_structured_knowledge,
        llm_extract_relations,
        normalize_expert_knowledge,
        upsert_expert_relations,
    )

    content = str(content or "").strip()
    if not content:
        return {"ok": False, "message": "content 为空，无法蒸馏", "doc_id": None}

    doc_id = doc_id or _hash_slug(title)

    # 0) 自动入库：doc_id 未注册（.md 未落盘）→ 先走 save_upload 全链
    #    （.md 落盘 + sidecar + dense/sparse 向量 + 文档图概念层）。
    #    顺序约束：必须先于 expert upsert——upsert_document 是整段替换 doc 快照，
    #    若入库快照落在 expert 入图之后会把新节点/边冲掉。入库后用返回的
    #    resolved doc_id（路径 md5 派生）继续，不再用入参 doc_id。
    auto_ingested = False
    auto_ingest_skipped: Optional[str] = None
    if _resolve_file_path(doc_id) is None:
        from src.models import KnowledgeCategory

        try:
            try:
                category_enum = KnowledgeCategory(category)
            except ValueError:
                category_enum = KnowledgeCategory.CASES
            stored = ingest_structured_knowledge(
                doc_id=None,
                title=title,
                category=category_enum,
                content=content,
                options={"llm_extract": False},
            )
            doc_id = str(stored.get("doc_id") or doc_id)
            auto_ingested = True
        except Exception as exc:  # noqa: BLE001
            # 降级：继续纯图谱蒸馏（节点/边照样入图，只是缺 dense/sparse 语料）
            logger.warning("自动入库失败，降级为纯图谱蒸馏: {}", exc)
            auto_ingest_skipped = str(exc)

    # 1) LLM 六维蒸馏（带客户 importance）；失败降级规则兜底（故障域，新维度置空）
    expert: Dict[str, Any]
    used_llm = False
    try:
        # 用 SimpleNamespace 构造 duck-typed document（类体作用域读不到外层局部变量，
        # 不能写 `class _Doc: source = f"distill:{title}"`——那是 NameError 陷阱）
        import types

        doc = types.SimpleNamespace(
            source=f"distill:{title}", title=title, content=content, doc_id=doc_id
        )
        extracted = llm_extract_relations(doc)
        faults = extracted.get("faults", []) or []
        shared = extracted.get("shared_relations", []) or []
        equipment = extracted.get("equipment", []) or []
        standards = extracted.get("standards", []) or []
        step_items = extracted.get("steps", []) or []
        knowledge = extracted.get("knowledge_units", []) or []
        if any([faults, shared, equipment, standards, step_items, knowledge]):
            # 空 list 传 None 保持 normalize 旧契约（新维度缺省不产节点/边）
            expert = normalize_expert_knowledge(
                faults,
                source_doc_id=doc_id,
                shared_relations=shared or None,
                equipment=equipment or None,
                standards=standards or None,
                steps=step_items or None,
                knowledge_units=knowledge or None,
            )
            used_llm = True
        else:
            expert = _rule_fallback_expert(content, doc_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("LLM 蒸馏降级（规则兜底）: {}", exc)
        expert = _rule_fallback_expert(content, doc_id)

    relation_stats: Dict[str, Any] = dict(
        expert.get("relation_stats") or _EMPTY_RELATION_STATS
    )

    n_nodes = len(expert.get("expert_nodes", []))
    n_edges = len(expert.get("expert_edges", []))
    n_shared = int(expert.get("shared_relations_added", 0))
    if n_nodes == 0 and n_edges == 0:
        return {
            "ok": True,
            "doc_id": doc_id,
            "auto_ingested": auto_ingested,
            "auto_ingest_skipped": auto_ingest_skipped,
            "used_llm": used_llm,
            "expert_nodes_added": 0,
            "expert_edges_added": 0,
            "shared_relations_added": 0,
            "fault_names": [],
            "relation_stats": relation_stats,
            "message": "未抽到因果结构，未入图（避免空操作污染图）",
        }

    # 2) 入图 + 三层刷新（upsert_expert_relations 内部已挂 PageRank/边向量/社区刷新）
    try:
        summary = upsert_expert_relations(expert, root_path="knowledge_base")
    except Exception as exc:  # noqa: BLE001
        logger.error("入图失败: {}", exc)
        return {
            "ok": False,
            "message": f"入图失败: {exc}",
            "doc_id": doc_id,
            "auto_ingested": auto_ingested,
            "auto_ingest_skipped": auto_ingest_skipped,
            "expert_nodes_added": 0,
        }

    # 3) 幂等再刷一遍三层（保证最新）+ 检索验证（六维 query 合并，去重 cap 6）
    edge_verify: List[Dict[str, Any]] = []
    community_verify: List[Dict[str, Any]] = []
    node_verify: List[Dict[str, Any]] = []
    fault_names: List[str] = [f.get("fault") or f.get("fault_id", "") for f in expert.get("faults", [])][:5]
    # 共享关系验证 query：跨故障共性词（如"入口滤网堵塞/管壁结蜡"），确保新边可检索
    shared_verify_queries: List[str] = []
    for edge in expert.get("expert_edges", []):
        if str(edge.get("type", "")) in ("shared_cause", "shared_solution", "related_fault"):
            detail = str((edge.get("properties") or {}).get("shared_cause")
                         or (edge.get("properties") or {}).get("shared_solution") or "")
            if detail:
                shared_verify_queries.append(detail)
    shared_verify_queries = list(dict.fromkeys(shared_verify_queries))[:3]
    # 六维验证 query：故障名 + 共享共性词 + 设备名 + 标准名（设备/标准边向量白名单内）
    verify_queries: List[str] = list(dict.fromkeys(
        fault_names[:3]
        + shared_verify_queries
        + (relation_stats.get("equipment_names") or [])[:2]
        + (relation_stats.get("standard_names") or [])[:2]
    ))[:6]
    if auto_refresh:
        try:
            builder = get_knowledge_graph_builder()
            build_graph_rank(builder.graph)
            upsert_edge_vectors(build_edge_descriptions(builder.graph))
            coms = build_communities(builder)
            if coms:
                upsert_community_vectors(coms)

            from src.knowledge_graph.community import community_search
            from src.rag.edge_vector_store import edge_search

            for q in verify_queries:
                e = edge_search(q, top_k=1)
                c = community_search(q, top_k=1)
                edge_verify.append({
                    "query": q,
                    "edge_hit": e[0]["description"][:60] if e else None,
                    "edge_score": round(e[0]["score"], 3) if e else None,
                })
                community_verify.append({
                    "query": q,
                    "community_hit": c[0]["summary"][:60] if c else None,
                    "community_score": round(float(c[0]["score"]), 3) if c else None,
                })
            # 步骤/知识点维：REFERENCES 类边不在边向量白名单，用图节点文本匹配验证
            for q in (relation_stats.get("step_names") or [])[:2] + (relation_stats.get("knowledge_names") or [])[:2]:
                try:
                    hits = builder.match_nodes_by_text(q)
                    node_verify.append({"query": q, "hits": len(hits), "node_ids": [str(h) for h in (hits or [])[:3]]})
                except Exception:  # noqa: BLE001
                    node_verify.append({"query": q, "hits": 0, "node_ids": []})
        except Exception as exc:  # noqa: BLE001
            logger.warning("三层刷新/验证降级: {}", exc)

    ingest_note = f"文档已自动入库（新 doc_id={doc_id}）；" if auto_ingested else ""
    skip_note = f"自动入库失败已降级（{auto_ingest_skipped}）；" if auto_ingest_skipped else ""
    message = (
        f"{ingest_note}{skip_note}六维关系已蒸馏入图 +{n_nodes} 节点 / +{n_edges} 边"
        f"（LLM={used_llm}，跨故障共享 {n_shared} 条，"
        f"设备链路 {relation_stats.get('equipment_edges', 0)} 条，"
        f"标准引用 {relation_stats.get('standard_edges', 0)} 条，"
        f"步骤 {relation_stats.get('step_nodes', 0)} 个，"
        f"知识点 {relation_stats.get('knowledge_nodes', 0)} 个），"
        f"三层结构已刷新，可检索验证"
    )
    return {
        "ok": True,
        "doc_id": doc_id,
        "auto_ingested": auto_ingested,
        "auto_ingest_skipped": auto_ingest_skipped,
        "used_llm": used_llm,
        "expert_nodes_added": int(summary.get("expert_nodes_added", n_nodes)),
        "expert_edges_added": int(summary.get("expert_edges_added", n_edges)),
        "shared_relations_added": n_shared,
        "fault_names": fault_names,
        "relation_stats": relation_stats,
        "edge_verify": edge_verify,
        "community_verify": community_verify,
        "node_verify": node_verify,
        "message": message,
    }
