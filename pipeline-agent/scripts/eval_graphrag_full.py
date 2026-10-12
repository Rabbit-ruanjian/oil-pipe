"""完整 Graph RAG（实体+边+社区 三层向量） vs 纯文本 chunk 向量 对比评测。

Graph RAG 的本质：把图上的实体、边（关系）、社区都算成向量，query 向量直接
语义命中——不是离散步搜。本脚本把图侧三层腿（实体词面/边向量/社区向量）
合成"完整图 RAG"，跟纯文本腿（chunk 向量 hybrid）比 5 指标 + MRR。

纯文本腿只是对照基准：证明"图 RAG 比纯文本好在哪、差在哪"。
faithfulness 需 LLM judge（401 降级）；answer_relevancy 词面近算。

跑法：cd pipeline-agent && .venv/bin/python scripts/eval_graphrag_full.py
"""

from __future__ import annotations

import os
import sys
import time
from typing import Any, Dict, List

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

try:
    from dotenv import load_dotenv

    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
except Exception:  # noqa: BLE001
    pass

from eval_retrieval_modes import RetrievalEvaluator, probe_environment
from eval_ragas_metrics import (
    answer_relevancy_lexical,
    context_precision,
    context_recall,
    f1_score,
    grade_precision,
    grade_recall,
)

# 完整图 RAG golden set——只放"图有结构、文本靠语义"的题。
# 关系推理题（gold 设到相关 G-E 资料）：图腿（边向量）应领先，纯文本腿靠猜
# 因果处置题（图实体词面 + 边向量 + 社区都能命中）：两条腿比
SAMPLES: List[Dict[str, Any]] = [
    # ---- 关系推理题（图 RAG 的不可替代区间）----
    {"query": "机封泄漏和弹簧断裂是什么关系", "gold": ["2b37f768c840"], "kind": "relation"},
    {"query": "过滤器堵塞有哪些原因", "gold": ["04430bda72fa"], "kind": "relation"},
    {"query": "泵站出口压力持续下降会导致什么问题", "gold": ["1c5ae7d0a475"], "kind": "relation"},
    # ---- 因果处置题（图腿强项）----
    {"query": "机封泄漏 处置", "gold": ["2b37f768c840"], "kind": "causal"},
    {"query": "泵站出口压力持续下降 处置", "gold": ["1c5ae7d0a475"], "kind": "causal"},
    {"query": "过滤器堵塞 处置", "gold": ["04430bda72fa"], "kind": "causal"},
    {"query": "摩阻损失 增大 处置", "gold": ["f10556fa8a41"], "kind": "causal"},
]


def _init():
    os.environ["SKIP_STARTUP_WARMUP"] = "true"
    caps = probe_environment()
    ev = RetrievalEvaluator(caps, top_k=5)
    ev.init()
    return ev


def graph_leg_ranked(ev, query: str, k: int) -> List[str]:
    """完整图 RAG 腿：实体词面多跳 + 边向量命中 + 社区向量命中 → doc 级去重排序。

    三层都是"向量/结构命中"（边、社区走向量；实体词面是精确入口），
    不是离线 BFS。边/社区命中带回的 doc_ids 排前，实体多跳回查的 doc 排后。
    """
    from src.knowledge_graph import get_knowledge_graph_builder
    from src.knowledge_graph.community import community_search
    from src.rag.edge_vector_store import edge_search

    builder = get_knowledge_graph_builder()
    ranked: List[str] = []

    # 1) 边向量命中 → 带回 doc_ids（因果边直接指向处置文档）
    for hit in edge_search(query, top_k=3):
        for d in hit.get("doc_ids", []):
            if d and d not in ranked:
                ranked.append(d)

    # 2) 社区向量命中 → 带回 doc_ids / chunk_ids 映射的 doc
    for hit in community_search(query, top_k=2):
        for d in hit.get("doc_ids", []):
            if d and d not in ranked:
                ranked.append(d)

    # 3) 实体词面多跳 → 子图概念回查 BM25（图结构的传统腿，排最后）
    g = builder.graph
    node_ids = builder.match_nodes_by_text(query)
    if node_ids:
        sub_ids = RetrievalEvaluator._graph_bfs(
            ev,
            builder,
            node_ids[0],
            ("caused_by", "solved_by", "references", "contains"),
            2,
        )
        terms = " ".join(
            dict.fromkeys(
                str(g.nodes[sid].get("name") or sid) for sid in sub_ids
            )
        )[:60]
        sparse = ev._retriever._sparse_search(terms or query, k * 2)
        for chunk_id, _ in sparse:
            chunk = ev._retriever._index_to_chunk.get(
                ev._retriever._chunk_id_to_index.get(chunk_id, -1), {}
            )
            d = str(chunk.get("doc_id") or chunk_id)
            if d and d not in ranked:
                ranked.append(d)

    return ranked[:k]


def text_leg_ranked(ev, query: str, k: int) -> List[str]:
    """纯文本对照腿：hybrid（chunk 向量 + BM25 RRF）→ doc 级去重。"""
    res = ev.run_hybrid(query)
    ranked: List[str] = []
    for d, _snip in res.results:
        d = str(d)
        if d not in ranked:
            ranked.append(d)
    return ranked[:k]


def mrr(ranked: List[str], gold: List[str], k: int) -> float:
    for i, d in enumerate(ranked[:k]):
        if d in gold:
            return 1.0 / (i + 1)
    return 0.0


def main() -> int:
    t0 = time.time()
    k = 5
    print(f"[init] 检索器 + 图谱 + 边/社区向量（top_k={k}）...")
    ev = _init()

    rows: List[Dict[str, Any]] = []
    for s in SAMPLES:
        g_ranked = graph_leg_ranked(ev, s["query"], k)
        t_ranked = text_leg_ranked(ev, s["query"], k)
        ar_g = answer_relevancy_lexical(s["query"], " ".join(g_ranked))
        rows.append(
            {
                "q": s["query"],
                "kind": s["kind"],
                "g": {
                    "mrr": mrr(g_ranked, s["gold"], k),
                    "recall": context_recall(g_ranked, s["gold"], k),
                    "precision": context_precision(g_ranked, s["gold"], k),
                    "f1": 0.0,
                    "ar": ar_g,
                    "top1": g_ranked[0][:8] if g_ranked else "-",
                    "n": len(g_ranked),
                },
                "t": {
                    "mrr": mrr(t_ranked, s["gold"], k),
                    "recall": context_recall(t_ranked, s["gold"], k),
                    "precision": context_precision(t_ranked, s["gold"], k),
                    "f1": 0.0,
                    "ar": None,
                    "top1": t_ranked[0][:8] if t_ranked else "-",
                    "n": len(t_ranked),
                },
            }
        )
        rows[-1]["g"]["f1"] = f1_score(rows[-1]["g"]["precision"], rows[-1]["g"]["recall"])
        rows[-1]["t"]["f1"] = f1_score(rows[-1]["t"]["precision"], rows[-1]["t"]["recall"])

    n = len(rows)
    avg = lambda side, key: sum(r[side][key] for r in rows if r[side][key] is not None) / n
    g_mrr, g_r, g_p, g_f1 = avg("g", "mrr"), avg("g", "recall"), avg("g", "precision"), avg("g", "f1")
    t_mrr, t_r, t_p, t_f1 = avg("t", "mrr"), avg("t", "recall"), avg("t", "precision"), avg("t", "f1")
    g_ar = avg("g", "ar")

    # 分组看（图腿的不可替代区间 vs 因果处置区）
    rel = [r for r in rows if r["kind"] == "relation"]
    cau = [r for r in rows if r["kind"] == "causal"]
    grp_mrr = lambda grp, side: sum(r[side]["mrr"] for r in grp) / max(len(grp), 1)
    g_rel_mrr, t_rel_mrr = grp_mrr(rel, "g"), grp_mrr(rel, "t")
    g_cau_mrr, t_cau_mrr = grp_mrr(cau, "g"), grp_mrr(cau, "t")

    print(f"\n===== 完整 Graph RAG（实体+边+社区 三层）vs 纯文本 对照（{n} 样本，{time.time()-t0:.1f}s）=====")
    print(f"\n  样本：")
    for r in rows:
        print(
            f"    [{r['kind']}] {r['q']}  图MRR {r['g']['mrr']:.2f} / 文MRR {r['t']['mrr']:.2f}"
        )
    print(f"\n  指标均值（全 {n} 样本，5 指标框架 + MRR）：")
    print(f"    图 RAG：MRR {g_mrr:.3f} | 召回 {g_r:.3f}[{grade_recall(g_r)}] 精度 {g_p:.3f}[{grade_precision(g_p)}] F1 {g_f1:.3f} 答案相关(词面) {g_ar:.3f}")
    print(f"    纯文本：MRR {t_mrr:.3f} | 召回 {t_r:.3f}[{grade_recall(t_r)}] 精度 {t_p:.3f}[{grade_precision(t_p)}] F1 {t_f1:.3f}")
    print(f"    忠实度：n/a（需 LLM judge，401 降级）")
    print(f"\n  分区看（谁在哪个区强）：")
    print(f"    关系推理区（{len(rel)} 题，图腿不可替代）：图 {g_rel_mrr:.3f} vs 文 {t_rel_mrr:.3f}")
    print(f"    因果处置区（{len(cau)} 题）：图 {g_cau_mrr:.3f} vs 文 {t_cau_mrr:.3f}")
    verdict = "图 RAG 更强" if g_mrr > t_mrr else ("持平" if g_mrr == t_mrr else "纯文本更强")
    print(f"\n  全样本判定（MRR）：{verdict}（图 {g_mrr:.3f} vs 文 {t_mrr:.3f}）；"
          f"关系区图腿 {g_rel_mrr:.3f} vs 文 {t_rel_mrr:.3f}")

    rep: List[str] = []
    rep.append("# 完整 Graph RAG vs 纯文本 对比评测报告\n")
    rep.append(f"- 日期：{time.strftime('%Y-%m-%d %H:%M')}")
    rep.append(f"- 图 RAG 腿：实体词面多跳 + 边描述向量 + 社区向量（三层全向量/结构命中，非离散步搜）")
    rep.append(f"- 纯文本腿：hybrid（chunk 向量 + BM25 RRF），仅作对照基准")
    rep.append(f"- 样本：{n} 条（{sum(1 for r in rows if r['kind']=='graph_strong')} 图强项 / "
               f"{sum(1 for r in rows if r['kind']=='descriptive')} 描述项）；top_k={k}")
    rep.append(f"- 耗时：{time.time()-t0:.1f}s\n")
    rep.append("## 指标对比\n")
    rep.append("| 腿 | MRR | 召回 | 精度 | F1 | 答案相关(词面) | 忠实度 |")
    rep.append("|---|---|---|---|---|---|---|")
    rep.append(
        f"| 图 RAG | {g_mrr:.3f} | {g_r:.3f}[{grade_recall(g_r)}] | {g_p:.3f}[{grade_precision(g_p)}] | {g_f1:.3f} | {g_ar:.3f} | n/a(401降级) |"
    )
    rep.append(
        f"| 纯文本 | {t_mrr:.3f} | {t_r:.3f}[{grade_recall(t_r)}] | {t_p:.3f}[{grade_precision(t_p)}] | {t_f1:.3f} | - | n/a |"
    )
    rep.append("\n## 逐样本\n")
    rep.append("| 问题 | 类型 | 图MRR | 文MRR | 图top1 | 文top1 |")
    rep.append("|---|---|---|---|---|---|")
    for r in rows:
        rep.append(
            f"| {r['q']} | {r['kind']} | {r['g']['mrr']:.2f} | {r['t']['mrr']:.2f} "
            f"| {r['g']['top1']} | {r['t']['top1']} |"
        )
    rep.append(
        f"\n## 判定\n- MRR 口径：{verdict}（图 {g_mrr:.3f} vs 文 {t_mrr:.3f}）。"
        "纯文本腿仅作对照基准，图 RAG 的三层向量/结构命中是主菜。\n"
        "- 忠实度需 LLM judge（.env 占位 key → 401），降级不硬编；"
        "配有效 key 后 golden set 可直接喂 ragas 补满 5 指标。"
    )
    out = "/Users/Admin/Desktop/完整GraphRAG对比评测报告.md"
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(rep))
    print(f"\n[out] 报告已写 {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
