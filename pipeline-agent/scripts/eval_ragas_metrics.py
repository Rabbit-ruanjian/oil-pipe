"""RAG 应用评估（RAGAS 五指标，自动降级不假装）。

按课程《掌握RAG应用评估技能和工具》的评分机制，跑通 5 指标流程：

检索侧（不需要 LLM，真实计算）：
  - context_recall   检索到的 top-k chunk 中，命中 gold 文档的比例
                    （课程：上下文覆盖参考答案关键信息的比例；
                      本脚本 gold=doc_id，recall = 命中 gold doc 数 / gold 总数）
  - context_precision top-k chunk 中属于 gold 文档的占比（纯度）
  - F1               精确率与召回率的调和平均（课程用来"两组指标难比时"的综合分）

生成侧（需要 LLM judge，本环境自动降级标注，不假装算分）：
  - faithfulness      生成答案是否完全基于上下文（无幻觉）→ 需 LLM 逐句核对
  - answer_relevancy  答案是否直接回答原问题（不冗长）→ 需 LLM 判断

降级态（无 LLM key / ragas 未装）：
  - 检索侧 3 指标真算
  - 生成侧 2 指标显示 "n/a（需 LLM judge，本环境降级）"，不硬编数值

跑法：
  cd pipeline-agent && .venv/bin/python scripts/eval_ragas_metrics.py
可选：--top-k 5 --limit 12 --out 报告路径
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

try:
    from dotenv import load_dotenv

    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
except Exception:  # noqa: BLE001
    pass


# ---------------------------------------------------------------------------
# 检索侧指标（真实计算）
# ---------------------------------------------------------------------------


def context_recall(ranked_doc_ids: List[str], gold_docs: List[str], k: int = 5) -> float:
    """top-k 中命中 gold 的比例（命中去重）。

    课程 context_recall = "上下文中覆盖问题关键信息的比例"。
    本脚本 gold=目标 doc_id 集合；检索结果 top-k 里有多少 gold 出现在 top-k。
    若 gold 只有 1 个 doc，则 recall = 1.0（top-k 命中它）/ 0.0。
    """
    topk = set(ranked_doc_ids[:k])
    gold = set(gold_docs)
    if not gold:
        return 0.0
    return len(topk & gold) / len(gold)


def context_precision(ranked_doc_ids: List[str], gold_docs: List[str], k: int = 5) -> float:
    """top-k 中属于 gold 文档的 chunk 占比（纯度）。

    课程 context_precision = "上下文关键信息是否靠前 / 占比"。
    本脚本：top-k 里 gold doc 的 chunk 数 / top-k 总数。
    （若 gold 只 1 个 doc，且该 doc 只占 1 个 chunk，则 precision = 1/k）
    """
    topk = ranked_doc_ids[:k]
    gold = set(gold_docs)
    if not topk:
        return 0.0
    return sum(1 for d in topk if d in gold) / len(topk)


def f1_score(precision: float, recall: float) -> float:
    """调和平均（课程用 F1 综合精确率与召回率）。"""
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


def grade_recall(v: float) -> str:
    """课程指标等级：≥0.8 高 / 0.5~0.8 中 / <0.5 低。"""
    if v >= 0.8:
        return "高"
    if v >= 0.5:
        return "中"
    return "低"


def grade_precision(v: float) -> str:
    if v >= 0.7:
        return "高"
    if v >= 0.4:
        return "中"
    return "低"


# ---------------------------------------------------------------------------
# 生成侧指标（需 LLM judge；降级标注）
# ---------------------------------------------------------------------------


def llm_judge_available() -> bool:
    """探测 LLM judge 是否可用（ragas 或 LLM key 可达）。

    本环境 LLM 不可达 + ragas 未装 → 返回 False，生成侧 2 指标走降级。
    """
    try:
        import ragas  # noqa: F401

        return True
    except Exception:
        return False


def faithfulness_degraded() -> str:
    return "n/a（需 LLM judge：逐句核对答案是否完全基于上下文；本环境降级）"


def answer_relevancy_degraded() -> str:
    return "n/a（需 LLM judge：判断答案是否直接回答原问题；本环境降级）"


# ---------------------------------------------------------------------------
# golden set 复用（与 eval_retrieval_modes.py 同款）
# ---------------------------------------------------------------------------


@dataclass
class GoldSample:
    query: str
    gold_docs: List[str]
    category: Optional[str] = None
    kind: str = "auto"


def build_golden_set(limit: int = 12) -> List[GoldSample]:
    from eval_retrieval_modes import build_golden_set as _bgs

    return _bgs(limit=limit)


# ---------------------------------------------------------------------------
# 检索器（单路：hybrid 混合检索，不做多路融合——按用户要求）
# ---------------------------------------------------------------------------


def _init_retriever():
    import os

    os.environ["SKIP_STARTUP_WARMUP"] = "true"
    from src.rag.pipeline import RAGPipeline

    p = RAGPipeline()
    p.ensure_retriever_ready()
    return p


def retrieve_doc_ranked(retriever, query: str, k: int) -> List[str]:
    """单路 hybrid 检索 → top-k doc_id 有序列表（doc 级去重）。"""
    results = retriever.retrieve(query, top_k=k, use_hybrid=True)
    seen: List[str] = []
    for r in results:
        d = str(r.doc_id)
        if d not in seen:
            seen.append(d)
    return seen[:k]


def retrieve_answer(retriever, query: str, k: int) -> str:
    """单路 hybrid 检索 → top-k chunk 拼接成"生成答案"（检索侧 answer 近算）。

    无 LLM 时 RAG 的 answer 由检索出的 chunk 拼接而成；用其做
    answer_relevancy 的词面近算。
    """
    results = retriever.retrieve(query, top_k=k, use_hybrid=True)
    parts: List[str] = []
    for r in results:
        c = getattr(r, "content", None) or getattr(r, "text", None) or ""
        if c:
            parts.append(str(c))
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# 生成侧指标（无 LLM 词面近算 + 降级标注）
# ---------------------------------------------------------------------------


def _cjk_terms(text: str) -> List[str]:
    """粗粒度中文实体/关键词抽取：去掉常见停用词后，取 2 字以上 CJK 词块。

    不依赖 jieba；用 2-gram 滑窗近似"问题关键实体"。仅用于 answer_relevancy
    词面覆盖度近算，非精确分词。
    """
    import re

    stop = set(
        "的 了 在 是 我 有 和 就 也 都 而 及 与 着 或 一个 没有 这个 什么 怎样 如何 为什么"
        .split()
    )
    cjk = re.findall(r"[\u4e00-\u9fff]+", text)
    grams: List[str] = []
    for seg in cjk:
        if len(seg) == 1:
            if seg not in stop:
                grams.append(seg)
            continue
        for i in range(len(seg) - 1):
            g = seg[i : i + 2]
            if g not in stop:
                grams.append(g)
    return grams


def answer_relevancy_lexical(question: str, answer: str) -> float:
    """answer_relevancy 词面近算（无 LLM）：答案对问题关键 2-gram 的覆盖度。

    课程 answer_relevancy = "答案是否直接回答原问题（不冗长）"。真算需 LLM
    judge；本环境无 LLM → 用"问题关键 2-gram 在答案里出现的比例"做近算，
    并明确标注为 lexical proxy（非 LLM judge 分）。
    返回 [0,1]；问题无可抽 2-gram 时返回 None（不可算）。
    """
    q_terms = _cjk_terms(question)
    if not q_terms:
        return None
    ans_terms = set(_cjk_terms(answer))
    hit = sum(1 for t in set(q_terms) if t in ans_terms)
    return hit / len(set(q_terms))


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--top-k", type=int, default=5)
    ap.add_argument("--limit", type=int, default=12)
    ap.add_argument("--out", default="/Users/Admin/Desktop/RAGAS评测报告.md")
    args = ap.parse_args()

    t0 = time.time()
    print(f"[init] 检索器 + 社区索引 ...")
    p = _init_retriever()
    retriever = p.retriever

    samples = build_golden_set(limit=args.limit)
    print(f"[golden] {len(samples)} 条样本")

    llm_ok = llm_judge_available()
    print(f"[probe] LLM judge 可用: {llm_ok}" + ("" if llm_ok else "（生成侧指标降级标注）"))

    k = args.top_k
    recalls, precisions, f1s = [], [], []
    ans_rel = []  # 词面近算，可能 None
    per_sample: List[Dict[str, Any]] = []
    for s in samples:
        ranked = retrieve_doc_ranked(retriever, s.query, k)
        cr = context_recall(ranked, s.gold_docs, k)
        cp = context_precision(ranked, s.gold_docs, k)
        f1 = f1_score(cp, cr)
        recalls.append(cr)
        precisions.append(cp)
        f1s.append(f1)
        # 生成侧词面近算：检索出的 top-k chunk 拼接为 answer
        answer = retrieve_answer(retriever, s.query, k)
        ar = answer_relevancy_lexical(s.query, answer)
        if ar is not None:
            ans_rel.append(ar)
        per_sample.append(
            {
                "query": s.query,
                "gold": s.gold_docs,
                "ranked_top1": ranked[0] if ranked else "-",
                "hit_top1": ranked[0] in set(s.gold_docs) if ranked else False,
                "context_recall": round(cr, 3),
                "context_precision": round(cp, 3),
                "F1": round(f1, 3),
                "answer_relevancy": round(ar, 3) if ar is not None else None,
            }
        )

    n = max(len(samples), 1)
    avg_cr = sum(recalls) / n
    avg_cp = sum(precisions) / n
    avg_f1 = sum(f1s) / n
    avg_ar = (sum(ans_rel) / len(ans_rel)) if ans_rel else None

    # ---- 报告 ----
    rep: List[str] = []
    rep.append("# RAG 应用评估报告（RAGAS 五指标）\n")
    rep.append(f"- 日期：{time.strftime('%Y-%m-%d %H:%M')}")
    rep.append(f"- 样本：{n} 条（自动生成 golden set）；top_k={k}")
    rep.append(f"- 检索器：单路 hybrid（BM25+向量 RRF），**不做多路融合**")
    rep.append(f"- 耗时：{time.time() - t0:.1f}s")

    rep.append("\n## 检索侧指标（真实计算，无 LLM）\n")
    rep.append("| 指标 | 均值 | 等级（课程标准） | 说明 |")
    rep.append("|---|---|---|---|")
    rep.append(
        f"| context_recall | {avg_cr:.3f} | {grade_recall(avg_cr)} | "
        "top-k 命中 gold 文档的比例（覆盖关键信息） |"
    )
    rep.append(
        f"| context_precision | {avg_cp:.3f} | {grade_precision(avg_cp)} | "
        "top-k 中属于 gold 的占比（纯净度） |"
    )
    rep.append(
        f"| F1 | {avg_f1:.3f} | - | 精确率与召回率调和平均（课程难比时的综合分） |"
    )

    rep.append("\n## 生成侧指标（需 LLM judge，本环境自动降级 / 词面近算）\n")
    rep.append("| 指标 | 值 | 说明 |")
    rep.append("|---|---|---|")
    rep.append(
        f"| faithfulness | {faithfulness_degraded()} | "
        "答案是否完全基于上下文（逐句核对，防幻觉） |"
    )
    ar_disp = (
        f"{avg_ar:.3f}（词面近算，非 LLM judge）"
        if avg_ar is not None
        else answer_relevancy_degraded()
    )
    rep.append(
        f"| answer_relevancy | {ar_disp} | "
        "答案是否直接回答原问题（无 LLM 时用问题 2-gram 对答案的词面覆盖度近算） |"
    )
    if not llm_ok:
        rep.append("\n> ⚠️ 本环境无 LLM key / ragas 未装，生成侧 2 指标降级标注，未硬编数值。")
        rep.append(
            "> 要真跑：`pip install ragas` + 配 LLM key，本脚本 golden set 可直接喂 ragas "
            "评估 faithfulness/context_recall/answer_relevancy。"
        )

    rep.append("\n## 逐样本明细\n")
    rep.append(
        "| query | gold | top-1 | 命中 | recall | precision | F1 | answer_relevancy(词面) |"
    )
    rep.append("|---|---|---|---|---|---|---|---|")
    for row in per_sample:
        ar_cell = f"{row['answer_relevancy']}" if row["answer_relevancy"] is not None else "-"
        rep.append(
            f"| {row['query']} | {','.join(row['gold'])} | {row['ranked_top1'][:8]} "
            f"| {'✓' if row['hit_top1'] else '✗'} | {row['context_recall']} "
            f"| {row['context_precision']} | {row['F1']} | {ar_cell} |"
        )

    rep.append(
        "\n## 结论与优化方向（课程「检索优先、生成增强」路径）\n"
        f"- 检索侧 context_recall={avg_cr:.3f}（{grade_recall(avg_cr)}）、"
        f"context_precision={avg_cp:.3f}（{grade_precision(avg_cp)}）；"
        f" 若两者难比，看 F1={avg_f1:.3f}。\n"
        f"- 生成侧 answer_relevancy（词面近算）={f'{avg_ar:.3f}' if avg_ar is not None else 'n/a'}，"
        "仅量级参考；faithfulness 需 LLM judge，本环境降级不硬编。\n"
        "- 按课程「先固根基再求精进」：recall 低 → 检索器未覆盖关键文档，"
        "可加查询改写 / 混合检索权重；precision 低 → top-k 引入噪声，"
        "可加重排序 / 收紧 top_k / 调 chunk 大小。\n"
        "- 生成侧配 LLM key + ragas 后可把 answer_relevancy 换成 LLM judge 分、"
        "并补 faithfulness，完成五指标闭环。"
    )

    with open(args.out, "w", encoding="utf-8") as f:
        f.write("\n".join(rep))
    print(f"\n[out] 报告已写 {args.out}")
    print("\n".join(rep))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
