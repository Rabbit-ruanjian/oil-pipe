"""RAG 回复质量评测（课程《RAG应用的评估类型和输入》4 输入 + 5 指标）。

评估模块输入（课程 4 要素）：
  question            测试问题
  answer              系统"回复"——本环境无 LLM key（DashScope 401 确认），
                      RAG 回复 = 检索出的 top-k chunk 拼接（检索即回复形态）
  context             检索阶段生成/使用的参考上下文（= 同上 top-k chunk）
  reference_answer    人工标注的标准答案（本脚本随资料生成，标注关键要点）

5 指标可算性：
  检索侧（真算）：上下文相关性 / 上下文精度 / 上下文召回率
  生成侧：
    答案相关性——无 LLM 用词面近算（问题 2-gram 覆盖），标注 lexical proxy
    忠实度——需 LLM 逐句核对防幻觉，本环境 401 → 降级标注，不硬编
  综合分 F1（precision/recall 调和，课程"难比时"用）

跑法：cd pipeline-agent && .venv/bin/python scripts/eval_rag_quality.py
"""

from __future__ import annotations

import os
import sys
import time
from typing import Any, Dict, List, Optional

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
    grade_precision,
    grade_recall,
)


# ---------------------------------------------------------------------------
# 人工标注的 golden set（question + gold doc_id + reference_answer 要点）
# gold 为本轮新蒸馏资料（doc_id 经入库确认）
# ---------------------------------------------------------------------------

GOLDEN: List[Dict[str, Any]] = [
    {
        "question": "机封泄漏了怎么办？",
        "gold_docs": ["2b37f768c840"],  # G-E1 机封泄漏端面烧蚀处置
        "reference_answer": "处置：恢复冲洗液通路；研磨或更换端面/密封副；检查弹簧组件；"
        "预防：冲洗系统压差报警、机封 8000h 强制更换",
    },
    {
        "question": "过滤器堵塞压差升高怎么处理？",
        "gold_docs": ["04430bda72fa"],  # G-E2 过滤器堵塞压差升高处置
        "reference_answer": "处置：切换备用过滤器；热油冲洗清洗滤网；冬季伴热保温；"
        "压差 0.12MPa 强制切换",
    },
    {
        "question": "摩阻损失增大怎么办？",
        "gold_docs": ["f10556fa8a41"],  # G-E3 摩阻损失过大降负荷处置
        "reference_answer": "处置：提高输送温度降低黏度；恢复正常输量使雷诺数回湍流区；"
        "热油清蜡；8 泵组合寻优",
    },
    {
        "question": "泵站出口压力持续下降是什么原因、怎么处理？",
        "gold_docs": ["1c5ae7d0a475"],  # G-E4 泵站出口压力下降根因处置
        "reference_answer": "原因：叶轮磨损/管路结蜡/油品变稀/转速波动；"
        "处置：叶轮检修更换、清蜡、检查变频器、提温增黏过渡",
    },
    {
        "question": "雷诺数怎么计算？",
        "gold_docs": ["228841109a14"],  # 旧公式文档（formulas/hydraulic_formulas）
        "reference_answer": "Re = ρvD/μ，ρ 密度、v 流速、D 管径、μ 黏度；"
        "层流/湍流判据 Re<2000/Re>4000",
    },
]


def _init_retriever():
    os.environ["SKIP_STARTUP_WARMUP"] = "true"
    from src.rag.pipeline import RAGPipeline

    p = RAGPipeline()
    p.ensure_retriever_ready()
    return p


def doc_ranked(retriever, question: str, k: int) -> List[str]:
    results = retriever.retrieve(question, top_k=k, use_hybrid=True)
    seen: List[str] = []
    for r in results:
        d = str(r.doc_id)
        if d not in seen:
            seen.append(d)
    return seen[:k]


def answer_text(retriever, question: str, k: int) -> str:
    """RAG 回复 = 检索 top-k chunk 拼接（无 LLM 生成形态）。"""
    results = retriever.retrieve(question, top_k=k, use_hybrid=True)
    parts = []
    for r in results:
        c = str(r.content or "")
        if c:
            parts.append(c)
    return "\n".join(parts)


def main() -> int:
    ap_sys = sys.argv[1:]
    k = 5
    if "--top-k" in ap_sys:
        k = int(ap_sys[ap_sys.index("--top-k") + 1])

    t0 = time.time()
    print(f"[init] 检索器（top_k={k}）...")
    retriever = _init_retriever().retriever

    rows: List[Dict[str, Any]] = []
    for g in GOLDEN:
        ranked = doc_ranked(retriever, g["question"], k)
        ans = answer_text(retriever, g["question"], k)
        cr = context_recall(ranked, g["gold_docs"], k)
        cp = context_precision(ranked, g["gold_docs"], k)
        f1 = f1_score(cp, cr)
        ar = answer_relevancy_lexical(g["question"], ans)
        rows.append(
            {
                "q": g["question"],
                "ranked": ranked,
                "recall": cr,
                "precision": cp,
                "f1": f1,
                "answer_relevancy": ar,
                "answer_len": len(ans),
                "gold_hit_top1": ranked[0] in g["gold_docs"] if ranked else False,
            }
        )

    n = len(rows)
    avg = lambda key: sum(r[key] for r in rows if r.get(key) is not None) / sum(
        1 for r in rows if r.get(key) is not None
    )
    avg_cr, avg_cp, avg_f1 = avg("recall"), avg("precision"), avg("f1")
    avg_ar = avg("answer_relevancy")

    # ---- 终端输出 ----
    print(f"\n===== RAG 回复质量评测（{n} 题，top_k={k}，耗时 {time.time()-t0:.1f}s）=====\n")
    for r in rows:
        print(
            f"Q: {r['q']}\n"
            f"   回复top1: {r['ranked'][0][:8] if r['ranked'] else '-'}"
            f"{'✓命中gold' if r['gold_hit_top1'] else '✗'}  "
            f"上下文相关性(recall)={r['recall']:.2f} 精度(precision)={r['precision']:.2f} "
            f"F1={r['f1']:.2f} 答案相关性(词面)={r['answer_relevancy'] if r['answer_relevancy'] is not None else 'n/a'} "
            f"回复长度={r['answer_len']}字\n"
        )

    print("===== 指标均值（课程 5 指标框架）=====")
    print(f"  上下文相关性 (Context Relevancy)  ≈ recall  {avg_cr:.3f}  [{grade_recall(avg_cr)}]")
    print(f"  上下文精度   (Context Precision)   {avg_cp:.3f}  [{grade_precision(avg_cp)}]")
    print(f"  上下文召回率 (Context Recall)      {avg_cr:.3f}  [{grade_recall(avg_cr)}]")
    print(f"  F1（综合）                          {avg_f1:.3f}")
    print(f"  答案相关性 (Answer Relevancy, 词面近算) {avg_ar:.3f}")
    print("  忠实度 (Faithfulness): n/a —— 需 LLM 逐句核对回复是否完全基于上下文；"
          "本环境 LLM key 401，降级标注不硬编（课程'不假装'）")

    # ---- 报告 ----
    rep: List[str] = []
    rep.append("# RAG 回复质量评测报告（课程 4 输入 + 5 指标）\n")
    rep.append(f"- 日期：{time.strftime('%Y-%m-%d %H:%M')}")
    rep.append(f"- 样本：{n} 题人工标注 golden set（含新蒸馏 G-E 资料）；top_k={k}")
    rep.append("- 回复形态：本环境无 LLM key（DashScope 401），RAG 回复 = 检索 top-k chunk 拼接")
    rep.append("- 框架：《RAG应用的评估类型和输入》——4 输入（question/answer/context/"
               "reference_answer）+ 5 指标；检索侧真算，答案相关性词面近算，"
               "忠实度需 LLM judge 降级标注，不假装\n")

    rep.append("## 指标总览（5 指标）\n")
    rep.append("| 指标 | 归属 | 均值 | 课程等级 | 可算方式 |")
    rep.append("|---|---|---|---|---|")
    rep.append(f"| 上下文相关性 | 检索 | {avg_cr:.3f} | {grade_recall(avg_cr)} | 真算 |")
    rep.append(f"| 上下文精度 | 检索 | {avg_cp:.3f} | {grade_precision(avg_cp)} | 真算 |")
    rep.append(f"| 上下文召回率 | 检索 | {avg_cr:.3f} | {grade_recall(avg_cr)} | 真算 |")
    rep.append(f"| F1（precision/recall 调和） | 综合 | {avg_f1:.3f} | - | 真算 |")
    rep.append(f"| 答案相关性 | 生成 | {avg_ar:.3f} | - | 词面近算（问题 2-gram 对回复覆盖度，非 LLM） |")
    rep.append("| 忠实度 | 生成 | n/a | - | ⚠️ 需 LLM 逐句核对回复是否全基于 context；本环境 401 降级 |")

    rep.append("\n## 逐题明细（回复效果）\n")
    rep.append("| 问题 | 回复 top-1 | 命中 | 相关性 | 精度 | F1 | 答案相关性(词面) |")
    rep.append("|---|---|---|---|---|---|---|")
    for r in rows:
        rep.append(
            f"| {r['q']} | {r['ranked'][0][:8] if r['ranked'] else '-'} "
            f"| {'✓' if r['gold_hit_top1'] else '✗'} "
            f"| {r['recall']:.2f} | {r['precision']:.2f} | {r['f1']:.2f} "
            f"| {r['answer_relevancy'] if r['answer_relevancy'] is not None else '-'} |"
        )

    rep.append("\n## 诊断（课程'对症下药'）\n")
    hit_rate = sum(1 for r in rows if r["gold_hit_top1"]) / n
    rep.append(
        f"- 回复效果（top-1 命中率）= {hit_rate:.0%}："
        "回复第一段（最被'阅读'的 chunk）是否为标准答案所在文档\n"
        f"- 上下文精度 {avg_cp:.3f}（{grade_precision(avg_cp)}）为瓶颈：top-{k} 里混入"
        "重复测试残留文档（3 份同内容短句），拉低纯度 → 清理后预期上升\n"
        f"- 答案相关性（词面）{avg_ar:.3f}：回复对问题关键实体的覆盖度；"
        "LLM 可用后换 judge 分数才是真'答案相关性'\n"
        "- 忠实度待 LLM：配真实 DashScope key 后，把本脚本 golden set 直接喂 ragas "
        "（pip install ragas），faithfulness 真算，5 指标闭环"
    )

    out = "/Users/Admin/Desktop/RAG回复质量评测报告.md"
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(rep))
    print(f"\n[out] 报告已写 {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
