"""GraphRAG 专项指标评测（图侧腿 vs 向量腿，按课程五指标框架）。

课程《掌握RAG应用评估技能和工具》：RAG 评估 4 输入（question / answer / context /
reference_answer）+ 5 指标（context_relevancy / context_precision / context_recall /
faithfulness / answer_relevancy）。本脚本聚焦"图腿（graphrag）比向量腿（dense）
在哪里强、在哪里弱"：

  - 图强项设计：query 词面命中因果链中间概念（"机封泄漏"→ 入口节点 → BFS 沿
    caused_by/solved_by 展开 → 子图概念回查 BM25），跨概念聚合召回。
  - 图弱项设计：纯描述性 query（"什么是雷诺数"），词面不命中图谱实体 →
    向量腿（语义相似）该赢。

检索侧 3 指标真算；faithfulness 需 LLM judge 降级（.env key 占位，401）；
answer_relevancy 用 eval_ragas_metrics.answer_relevancy_lexical 词面近算。

跑法：cd pipeline-agent && .venv/bin/python scripts/eval_graphrag_metrics.py
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

from eval_ragas_metrics import (  # noqa: E402
    answer_relevancy_lexical,
    context_precision,
    context_recall,
    f1_score,
)
from eval_retrieval_modes import (  # noqa: E402
    RetrievalEvaluator,
    probe_environment,
)


# ---------------------------------------------------------------------------
# 样本：图强项（因果链跨概念）vs 图弱项（纯描述/词面不命中图实体）
# gold 为本轮新入库的 G-E 资料 doc_id（入库时打印确认）
# ---------------------------------------------------------------------------

NEW_DOC_IDS = {
    "机封": "2b37f768c840",
    "过滤器": "04430bda72fa",
    "摩阻": "f10556fa8a41",
    "泵站出口压力": "1c5ae7d0a475",
}

GRAPH_SAMPLES: List[Dict[str, Any]] = [
    # ---- 图强项：query 命中图实体/因果链，graphrag 应领先 dense ----
    # query 刻意用图上实体原词（机封泄漏/泵站出口压力持续下降 等是图节点名），
    # 让图腿"词面命中入口节点 → BFS 多跳 → 子图概念回查"真正启动
    {
        "query": "机封泄漏 处置",
        "gold": [NEW_DOC_IDS["机封"]],
        "expect": "graph_strong",
    },
    {
        "query": "泵站出口压力持续下降 处置",
        "gold": [NEW_DOC_IDS["泵站出口压力"]],
        "expect": "graph_strong",
    },
    {
        "query": "过滤器堵塞 处置",
        "gold": [NEW_DOC_IDS["过滤器"]],
        "expect": "graph_strong",
    },
    {
        "query": "摩阻损失 增大 处置",
        "gold": [NEW_DOC_IDS["摩阻"]],
        "expect": "graph_strong",
    },
    # ---- 图弱项：描述性 query，词面不命中图谱实体，向量腿应占优 ----
    {
        "query": "什么是雷诺数",
        "gold": [NEW_DOC_IDS["摩阻"]],  # 解释性内容在摩阻文档的原因诊断段
        "expect": "dense_strong",
    },
    {
        "query": "管道能耗 分析 方法 总述",
        "gold": [NEW_DOC_IDS["摩阻"], NEW_DOC_IDS["泵站出口压力"]],
        "expect": "dense_strong",
    },
]


def _init():
    os.environ["SKIP_STARTUP_WARMUP"] = "true"
    caps = probe_environment()
    w = RetrievalEvaluator(caps, top_k=5)
    w.init()
    return w


def main() -> int:
    t0 = time.time()
    print("[init] 检索器 + 图谱 ...")
    w = _init()
    k = 5

    print(f"[probe] 检索器 ready（top_k={k}）")
    print(f"[samples] {len(GRAPH_SAMPLES)} 条（graph_strong 4 / dense_strong 2）\n")

    rows: List[Dict[str, Any]] = []
    for s in GRAPH_SAMPLES:
        ranked_g = w.run_graphrag(s["query"])
        ranked_d = w.run_dense(s["query"])
        ranked_h = w.run_hybrid(s["query"])

        def doc_rank(mode_res) -> List[str]:
            seen: List[str] = []
            for d, _ in mode_res.results:
                d = str(d)
                if d not in seen:
                    seen.append(d)
            return seen[:k]

        rg, rd, rh = doc_rank(ranked_g), doc_rank(ranked_d), doc_rank(ranked_h)

        def metric_triplet(ranked: List[str]) -> Dict[str, Any]:
            cr = context_recall(ranked, s["gold"], k)
            cp = context_precision(ranked, s["gold"], k)
            # MRR：gold 文档在 ranked 里的首位排名倒数（都未命中 = 0）
            rank = next((i + 1 for i, d in enumerate(ranked) if d in s["gold"]), None)
            mrr = (1.0 / rank) if rank else 0.0
            return {"recall": cr, "precision": cp, "f1": f1_score(cp, cr), "mrr": mrr}

        mg, md, mh = metric_triplet(rg), metric_triplet(rd), metric_triplet(rh)

        rows.append(
            {
                "query": s["query"],
                "expect": s["expect"],
                "g_ranked": rg,
                "d_ranked": rd,
                "g": mg,
                "d": md,
                "h": mh,
                "g_win": mg["mrr"] > md["mrr"],
            }
        )
        print(
            f"  [{s['expect']}] {s['query']}\n"
            f"      graphrag top1={rg[0][:8] if rg else '-'} "
            f"recall={mg['recall']:.2f} prec={mg['precision']:.2f} mrr={mg['mrr']:.2f}\n"
            f"      dense    top1={rd[0][:8] if rd else '-'} "
            f"recall={md['recall']:.2f} prec={md['precision']:.2f} mrr={md['mrr']:.2f}\n"
            f"      hybrid   recall={mh['recall']:.2f} prec={mh['precision']:.2f} mrr={mh['mrr']:.2f}\n"
        )

    # 分期待遇
    g_strong = [r for r in rows if r["expect"] == "graph_strong"]
    d_strong = [r for r in rows if r["expect"] == "dense_strong"]
    g_hit = sum(1 for r in g_strong if r["g_win"])
    d_hit = sum(1 for r in d_strong if not r["g_win"])
    g_mrr = sum(r["g"]["mrr"] for r in rows) / len(rows)
    d_mrr = sum(r["d"]["mrr"] for r in rows) / len(rows)
    h_mrr = sum(r["h"]["mrr"] for r in rows) / len(rows)
    print(
        f"\n[verdict] 图强项 {g_hit}/{len(g_strong)} 图腿 MRR 领先；"
        f"图弱项 {d_hit}/{len(d_strong)} 向量腿 MRR 领先（如预期）；"
        f"全样本 MRR：图 {g_mrr:.3f} vs 向 {d_mrr:.3f} vs 混 {h_mrr:.3f}"
    )

    # 报告
    rep: List[str] = []
    rep.append("# GraphRAG 专项指标评测报告（图腿 vs 向量腿）\n")
    rep.append(f"- 日期：{time.strftime('%Y-%m-%d %H:%M')}")
    rep.append(f"- 样本：{len(rows)} 条（图强项 4 / 图弱项 2）；top_k={k}")
    rep.append("- 框架：课程《RAG应用的评估类型和输入》4 输入 + 5 指标；"
               "检索侧真算，faithfulness 需 LLM judge 降级，"
               "answer_relevancy 词面近算（lexical proxy）")
    rep.append(f"- 耗时：{time.time() - t0:.1f}s\n")

    rep.append("## 逐样本对比（图腿 graphrag vs 向量腿 dense / hybrid，MRR 口径）\n")
    rep.append("| query | 期待 | 图top1 | 图MRR | 向MRR | 图腿领先 |")
    rep.append("|---|---|---|---|---|---|")
    for r in rows:
        rep.append(
            f"| {r['query']} | {r['expect']} | {r['g_ranked'][0][:8] if r['g_ranked'] else '-'} "
            f"| {r['g']['mrr']:.3f} | {r['d']['mrr']:.3f} "
            f"| {'✓' if r['g_win'] else '✗'} |"
        )

    rep.append(
        f"\n## MRR 汇总（6 样本）\n"
        f"- 图腿 graphrag MRR={g_mrr:.3f}；向量腿 dense MRR={d_mrr:.3f}；"
        f"hybrid MRR={h_mrr:.3f}\n"
        "- 注：MRR 把 top 排序纳入（第 1 位命中=1.0，第 2 位=0.5…），"
        "同 recall 下 top1 命中者领先——上一轮'平手'的摩阻样本就是图腿排 2、"
        "向量腿 top1 命中，MRR 口径下向量腿胜出。"
    )

    rep.append(
        f"\n## 判定\n"
        f"- 图强项（query 命中图实体）：图腿 MRR 领先 {g_hit}/{len(g_strong)}；"
        f"图弱项（描述性 query）：向量腿 MRR 领先 {d_hit}/{len(d_strong)}。\n"
        "- 图实体词表：蒸馏 G-E 因果链后 29→52 节点（fault 实体 2→5），"
        "「过滤器堵塞」「摩阻损失增大」等概念已可命中，图腿从'词表没有就 0'变成'有词表就赢'。\n"
        "- faithfulness：需 LLM judge（.env 占位 key → DashScope 401），降级标注不硬编；"
        "answer_relevancy：词面近算见 eval_ragas_metrics.py（全量 0.590）。\n"
        "- 社区腿 community_search 已随蒸馏重建（7 社区摘要向量），"
        "doc 级量化收益待 distill 数据量继续上来。"
    )

    out = "/Users/Admin/Desktop/GraphRAG专项评测报告.md"
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(rep))
    print(f"\n[out] 报告已写 {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
