"""长文本 → LLM 蒸馏进 Graph RAG 全链路。

把一份长 MD/文本交给 LLM，抽取"故障→原因→解法"因果链 + 客户重要性权重
（importance），蒸馏进知识图谱，刷新三层结构（PageRank / 边描述向量 /
社区向量），最后用该文档内容做验证 query 确认能命中。

这是把"客户真实知识"真正落成 Graph RAG 的标准入口（对标 ragflow：
实体/边都带向量 + 结构信息离线编码，检索靠语义相似度，而非离散步搜）。

跑法：
  cd pipeline-agent && .venv/bin/python scripts/distill_longtext_to_graphrag.py <长MD路径> [title]

依赖 LLM key（DashScope/OpenAI 兼容）；无 key 时自动降级为"纯规则蒸馏"
（按行解析已标 good 的故障表），仍保证可入图 + 三层刷新 + 检索验证。
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict, List

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("SKIP_STARTUP_WARMUP", "true")

try:
    from dotenv import load_dotenv

    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
except Exception:  # noqa: BLE001
    pass

from src.knowledge_graph import get_knowledge_graph_builder
from src.knowledge_graph.community import build_communities, upsert_community_vectors
from src.knowledge_graph.graph_rank import build_graph_rank
from src.rag.knowledge_registry import get_knowledge_registry
from src.rag.edge_vector_store import build_edge_descriptions, upsert_edge_vectors
from src.rag.knowledge_ingest import (
    llm_extract_knowledge,
    normalize_expert_knowledge,
    upsert_expert_relations,
)
from src.rag.edge_vector_store import edge_search
from src.knowledge_graph.community import community_search
from src.utils import logger


class _LongTextDoc:
    """最小 Document 占位，供 llm_extract_knowledge 读 content/doc_id/source。"""

    def __init__(self, doc_id: str, content: str, title: str) -> None:
        self.doc_id = doc_id
        self.source = f"distill:{title}"
        self.content = content
        self.title = title


def _hash_slug(text: str) -> str:
    import hashlib

    digest = hashlib.md5(text.encode("utf-8")).hexdigest()[:12]
    normalized = "".join(ch for ch in text if ch.isalnum() or ch in "_-")
    return f"{normalized or 'doc'}-{digest}"


def _rule_fallback_expert(content: str, doc_id: str) -> Dict[str, Any]:
    """LLM 不可用时的降级蒸馏。

    优先解析本脚本约定的"故障 N：标题 + 主要原因 + 处置"结构化格式
    （客户提供的长文档若能整理成此格式，无需 LLM 也能落成因果图）；
    解析不到再退回"含原因/处置关键词的行"启发式，赋中等 importance。
    """
    import re

    items: List[Dict[str, Any]] = []
    # 1) 结构化格式：## 故障：xxx / 原因：...（0.9）... / 处置：...（高优先）
    fault_blocks = re.split(r"^#+\s*故障\s*[:：]?\s*", content, flags=re.M)
    for block in fault_blocks[1:]:
        fault = block.splitlines()[0].strip()
        if not fault or len(fault) > 60:
            continue
        cause_block = re.search(r"原因\s*[:：]\s*(.+)", block, re.S)
        sol_block = re.search(r"处置\s*[:：]\s*(.+)", block, re.S)
        c_raw = cause_block.group(1).strip() if cause_block else "（规则兜底，需人工补全原因）"
        s_raw = sol_block.group(1).strip() if sol_block else "（规则兜底，需人工补全处置）"
        # 重要性：从文本里的 0~1 数字取最大（客户标注的权重）；没标注给 0.4
        imp_matches = re.findall(r"0?\.\d+\b", c_raw + " " + s_raw)
        imp = max((float(x) for x in imp_matches), default=0.4)
        imp = min(max(imp, 0.0), 1.0)
        # 原因/处置按"；"或换行拆成多条
        causes = [c.strip() for c in re.split(r"[；;]\s*", c_raw) if c.strip()]
        solutions = [s.strip() for s in re.split(r"[；;]\s*", s_raw) if s.strip()]
        for i, c in enumerate(causes[:4]):
            sol_name = solutions[i] if i < len(solutions) else (solutions[-1] if solutions else "（规则兜底，需人工补全处置）")
            items.append(
                {
                    "fault": fault,
                    "cause": c,
                    "solution": sol_name,
                    "importance": imp,
                }
            )
    if items:
        return normalize_expert_knowledge(items, source_doc_id=doc_id)

    # 2) 启发式兜底：含"原因/处置"关键词的行
    for ln in [l.strip() for l in content.splitlines() if l.strip()]:
        if ("原因" in ln or "处置" in ln) and len(ln) < 200:
            key = ln.split("原因")[0].split("处置")[0].strip() or ln[:20]
            items.append(
                {
                    "fault": key,
                    "cause": "（规则兜底，需人工补全原因）",
                    "solution": "（规则兜底，需人工补全处置）",
                    "importance": 0.4,
                }
            )
    return normalize_expert_knowledge(items[:20], source_doc_id=doc_id)


def main() -> int:
    if len(sys.argv) < 2:
        print("用法: python scripts/distill_longtext_to_graphrag.py <长MD路径> [title]")
        return 1
    path = sys.argv[1]
    title = sys.argv[2] if len(sys.argv) > 2 else os.path.splitext(os.path.basename(path))[0]
    content = open(path, encoding="utf-8").read().strip()
    if not content:
        print("[err] 文件为空")
        return 1

    doc_id = _hash_slug(title)
    print(f"[distill] 长文本《{title}》({len(content)} 字符) → doc_id={doc_id}")

    # 1) LLM 蒸馏（带客户权重 importance）；失败降级规则
    expert: Dict[str, Any]
    used_llm = False
    try:
        extracted = llm_extract_knowledge(_LongTextDoc(doc_id, content, title))
        faults = extracted.get("faults", [])
        if faults:
            expert = normalize_expert_knowledge(faults, source_doc_id=doc_id)
            used_llm = True
            n_imp = sum(
                1
                for f in expert.get("faults", [])
                for c in f.get("causes", [])
                if c.get("importance") is not None
            )
            print(f"[llm] 抽出 {len(faults)} 条故障 / {n_imp} 条带 importance 权重")
        else:
            expert = _rule_fallback_expert(content, doc_id)
            print("[llm] 未抽到因果链 → 规则兜底")
    except Exception as exc:  # noqa: BLE001
        logger.warning("LLM 蒸馏降级（规则兜底）: {}", exc)
        expert = _rule_fallback_expert(content, doc_id)
        print(f"[llm→规则] {exc}")

    n_nodes = len(expert.get("expert_nodes", []))
    n_edges = len(expert.get("expert_edges", []))
    print(f"[distill] 蒸馏出 {n_nodes} 节点 / {n_edges} 边")
    if n_nodes == 0:
        print("[skip] 无因果结构可蒸馏，不做入图（避免空操作污染图）")
        return 0

    # 2) 入库：长文本作为 .md 文档落盘 + chunk 入向量库
    registry = get_knowledge_registry()
    from src.models import KnowledgeDocumentMetadata
    from src.models.enums import KnowledgeCategory

    metadata = KnowledgeDocumentMetadata(
        title=title,
        source="distill",
        category=KnowledgeCategory("cases"),
        tags=["cases", "distilled"],
        language="zh-CN",
    )
    stored = registry.save_upload(
        file_name=f"{title}.md",
        file_bytes=content.encode("utf-8"),
        metadata=metadata,
    )
    print(f"[ingest] doc saved: {stored.get('doc_id')} chunks={stored.get('chunk_count')}")

    # 3) 蒸馏入图 + 三层刷新（PageRank / 边向量 / 社区向量 自动跟进）
    summary = upsert_expert_relations(expert, root_path="knowledge_base")
    print(
        f"[graph] 入图: +{summary.get('expert_nodes_added', 0)} 节点 / "
        f"+{summary.get('expert_edges_added', 0)} 边（已含三层刷新）"
    )

    # 4) 三层结构刷新（upsert_expert_relations 已挂，这里幂等再跑一遍保证最新）
    builder = get_knowledge_graph_builder()
    rank = build_graph_rank(builder.graph)
    upsert_edge_vectors(build_edge_descriptions(builder.graph))
    coms = build_communities(builder)
    if coms:
        upsert_community_vectors(coms)
    print(
        f"[rank] PageRank {len(rank['pagerank'])} 节点 / "
        f"边向量 {len(build_edge_descriptions(builder.graph))} 条 / "
        f"社区 {len(coms)} 个"
    )

    # 5) 检索验证：用蒸馏出的 fault 名做 query，确认边/社区向量能命中
    faults = [f["fault"] for f in expert.get("faults", [])][:3]
    print(f"[verify] 用 {faults} 做检索验证：")
    for q in faults:
        e = edge_search(q, top_k=2)
        c = community_search(q, top_k=1)
        e_desc = "；".join(h["description"][:30] for h in e) or "（无命中）"
        c_desc = c[0]["summary"][:40] if c else "（无命中）"
        print(f"    「{q}」 边向量→ {e_desc}")
        print(f"             社区→ {c_desc}")

    print(f"\n[done] 《{title}》已入 Graph RAG（LLM={used_llm}），"
          f"doc={stored.get('doc_id')}。可在前端 ①图谱 区查「{faults[0] if faults else ''}」验证因果网。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
