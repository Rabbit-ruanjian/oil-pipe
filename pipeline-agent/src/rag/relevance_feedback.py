"""ENRICH：Relevance Feedback（相关性反馈检索增强，Rocchio）。

P0-③ 可插拔 hook（默认关，关闭时行为与现状逐字节一致；hook 失败自动降级
跳过，不阻断主链路）。

闭环三段：
  1) 反馈入口（见 src/api/routes/knowledge.py /knowledge/feedback）：
     用户对"某 query 下某批 doc 的相关/不相关"做标注 → 落到 feedback_store。
  2) 反馈存储（本模块 FeedbackStore）：per-query 持久化 JSON（带时间戳、上限裁剪）。
  3) 反馈增强（本模块 rocchio_rerank）：用真实反馈算
         q' = q + β·mean_tfidf(relevant) − β·mean_tfidf(irrelevant)
     对首轮检索结果重排（TF-IDF 词向量版；无 jieba 依赖，无 LLM 也可跑）。

默认关闭（RAG_USE_RELEVANCE_FEEDBACK=False）；开关开但无该 query 的反馈记录
时也是 no-op（返回原结果），保证"无反馈即原样"。
"""

from __future__ import annotations

import json
import math
import time
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from src.utils import logger

# ---------------------------------------------------------------------------
# 反馈存储
# ---------------------------------------------------------------------------

_FEEDBACK_DIR = Path("knowledge_base") / ".feedback"
_MAX_FEEDBACK_PER_QUERY = 50
_MAX_AGE_SECONDS = 30 * 86400  # 30 天内的反馈参与增强


def _feedback_path() -> Path:
    _FEEDBACK_DIR.mkdir(parents=True, exist_ok=True)
    return _FEEDBACK_DIR / "relevance_feedback.json"


def record_feedback(
    query: str,
    relevant_doc_ids: List[str],
    irrelevant_doc_ids: Optional[List[str]] = None,
    session_id: Optional[str] = None,
) -> dict:
    """记录一次反馈（用户对该 query 下文档的相关性标注）。

    relevant/irrelevant 都可为空；至少一个非空才有意义。落盘 + 裁剪旧记录。
    """

    path = _feedback_path()
    store: Dict[str, Any] = {}
    if path.exists():
        try:
            store = json.loads(path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            store = {}

    now = time.time()
    entry = {
        "ts": now,
        "relevant": [str(d) for d in (relevant_doc_ids or []) if str(d)],
        "irrelevant": [str(d) for d in (irrelevant_doc_ids or []) if str(d)],
        "session_id": session_id,
    }

    # 同 query 累积（按时间），超上限裁剪最旧
    bucket: List[dict] = store.get(query, [])
    bucket.append(entry)
    bucket = bucket[-_MAX_FEEDBACK_PER_QUERY:]
    store[query] = bucket

    # 清 30 天前的过期 query
    for q in list(store.keys()):
        store[q] = [e for e in store[q] if now - e.get("ts", 0) <= _MAX_AGE_SECONDS]
        if not store[q]:
            del store[q]

    path.write_text(json.dumps(store, ensure_ascii=False), encoding="utf-8")
    logger.info(
        "Relevance feedback recorded: query={} relevant={} irrelevant={}",
        query[:40], len(entry["relevant"]), len(entry["irrelevant"]),
    )
    return {"query": query, "recorded": len(entry["relevant"] + entry["irrelevant"])}


def load_feedback(query: str) -> Dict[str, List[str]]:
    """读某 query 的全部有效反馈，合并成 {relevant:[], irrelevant:[]}。"""

    path = _feedback_path()
    if not path.exists():
        return {"relevant": [], "irrelevant": []}
    try:
        store = json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {"relevant": [], "irrelevant": []}

    now = time.time()
    relevant: set = set()
    irrelevant: set = set()
    for e in store.get(query, []):
        if now - e.get("ts", 0) > _MAX_AGE_SECONDS:
            continue
        relevant.update(e.get("relevant", []))
        irrelevant.update(e.get("irrelevant", []))
    # 同时标了正负的去掉（以 recent 的为准：irrelevant 优先排除）
    relevant.difference_update(irrelevant)
    return {"relevant": sorted(relevant), "irrelevant": sorted(irrelevant)}


def clear_feedback(query: str) -> int:
    """清除某 query 的反馈，返回清除条数。"""

    path = _feedback_path()
    if not path.exists():
        return 0
    try:
        store = json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return 0
    removed = len(store.pop(query, []))
    if store:
        path.write_text(json.dumps(store, ensure_ascii=False), encoding="utf-8")
    else:
        path.unlink(missing_ok=True)
    return removed


# ---------------------------------------------------------------------------
# TF-IDF 词向量版 Rocchio（无 jieba / 无 LLM / 无 numpy 依赖）
# ---------------------------------------------------------------------------

_STOP = set("的 了 是 在 与 和 一个 请 你 我 他 她 它 之 及 当 时 而 或 对 于 这 那".split())


def _tokens(text: str) -> List[str]:
    """英文/数字词 + 连续汉字 2-gram（保相邻关系，避免跨词边界幽灵 token）。"""
    import re

    latin = re.findall(r"[a-zA-Z0-9]+", text or "")
    grams: List[str] = []
    for run in re.findall(r"[\u4e00-\u9fff]+", text or ""):
        if len(run) == 1:
            grams.append(run)
        else:
            grams.extend(run[i : i + 2] for i in range(len(run) - 1))
    return [x for x in (latin + grams) if x not in _STOP]


def _tfidf_weights(
    docs: List[str], df: Counter, n_docs: int
) -> List[Dict[str, float]]:
    """朴素 TF-IDF：tf=log(1+freq) · idf=log(N/(1+df))。"""
    vecs = []
    for text in docs:
        tf = Counter(_tokens(text))
        vecs.append(
            {t: math.log(1 + f) * math.log(n_docs / (1 + df.get(t, 0))) for t, f in tf.items()}
        )
    return vecs


def rocchio_rerank(
    query: str,
    candidates: List[Dict[str, Any]],
    relevant_texts: List[str],
    irrelevant_texts: Optional[List[str]] = None,
    beta: float = 0.5,
) -> List[Dict[str, Any]]:
    """Rocchio 反馈增强重排（TF-IDF 词向量版，无 numpy/jieba 依赖）。

    对每个候选打"反馈相关度"，再按相关度降序重排：
      score(c) = cos(tfidf(c), mean_tfidf(pos)) · (1+β) − cos(tfidf(c), mean_tfidf(neg)) · β

    即"越贴近用户标相关的文档、越远离标不相关的文档，排越前"。
    - 无 relevant 或 candidates 为空 → 原样返回（no-op，降级不阻断）。
    - 候选文本取 full_text，缺失退回 content_preview，再缺失退回 content（sources
      里只有 content_preview 也能跑，不踩空文本陷阱）。

    Args:
      query: 原始查询（保留作 tie-break 与日志）
      candidates: 首轮检索结果，每项含 'full_text' 或 'content'/'content_preview'
      relevant_texts: 用户标"相关"的文档正文
      irrelevant_texts: 用户标"不相关"的文档正文（None=不用负反馈）
      beta: Rocchio 强度（越大越偏向反馈）

    Returns:
      按反馈相关度降序重排后的 candidates（同结构，补 'feedback_score' 字段）
    """

    if not relevant_texts or not candidates:
        return candidates

    pos_docs = [t for t in relevant_texts if t]
    neg_docs = [t for t in (irrelevant_texts or []) if t]
    if not pos_docs:
        return candidates

    def _cand_text(c: Dict[str, Any]) -> str:
        return str(c.get("full_text") or c.get("content") or c.get("content_preview") or "")

    cand_texts = [_cand_text(c) for c in candidates]
    corpus = cand_texts + pos_docs + neg_docs
    n_docs = max(len(corpus), 1)
    df: Counter = Counter()
    for text in corpus:
        for tok in set(_tokens(text)):
            df[tok] += 1

    cand_vecs = _tfidf_weights(cand_texts, df, n_docs)
    pos_mean = _mean_tfidf(pos_docs, df, n_docs)
    neg_mean = _mean_tfidf(neg_docs, df, n_docs) if neg_docs else {}

    def _cos(a: Dict[str, float], b: Dict[str, float]) -> float:
        dot = sum(a.get(t, 0.0) * b.get(t, 0.0) for t in a if t in b)
        na = math.sqrt(sum(v * v for v in a.values())) or 1.0
        nb = math.sqrt(sum(v * v for v in b.values())) or 1.0
        return dot / (na * nb)

    for i, cand in enumerate(candidates):
        pos_sim = _cos(cand_vecs[i], pos_mean)
        neg_sim = _cos(cand_vecs[i], neg_mean) if neg_mean else 0.0
        cand["feedback_score"] = round((1.0 + beta) * pos_sim - beta * neg_sim, 4)
    candidates.sort(key=lambda c: c.get("feedback_score", 0.0), reverse=True)
    logger.info(
        "Rocchio re-rank: {} candidates, {} pos / {} neg feedback, beta={}",
        len(candidates), len(pos_docs), len(neg_docs), beta,
    )
    return candidates


def _mean_tfidf(docs: List[str], df: Counter, n_docs: int) -> Dict[str, float]:
    """多篇文档的 TF-IDF 均值向量（用于 Rocchio 的 relevant/irrelevant 中心）。"""
    mean: Dict[str, float] = {}
    docs = [d for d in docs if d]
    if not docs:
        return mean
    for text in docs:
        for tok, w in _tfidf_weights([text], df, n_docs)[0].items():
            mean[tok] = mean.get(tok, 0.0) + w / len(docs)
    return mean


def enhance_query_text(
    query: str,
    relevant_texts: List[str],
    irrelevant_texts: Optional[List[str]] = None,
    beta: float = 0.5,
    top_terms: int = 6,
) -> str:
    """TF-IDF Rocchio 的"增强查询串"版（可解释、可直接再检索一次）。

    返回 q + top-k 相关 TF-IDF 词。与 rocchio_rerank 同思想，但产出的是
    字符串（适合喂回检索器做二次召回，而非只做重排）。
    """

    pos_docs = [t for t in (relevant_texts or []) if t]
    neg_docs = [t for t in (irrelevant_texts or []) if t]
    if not pos_docs:
        return query

    corpus = pos_docs + neg_docs + [query]
    n_docs = max(len(corpus), 1)
    df: Counter = Counter()
    for text in corpus:
        for tok in set(_tokens(text)):
            df[tok] += 1

    qvec = _tfidf_weights([query], df, n_docs)[0]
    pos_mean: Dict[str, float] = {}
    for text in pos_docs:
        for tok, w in _tfidf_weights([text], df, n_docs)[0].items():
            pos_mean[tok] = pos_mean.get(tok, 0.0) + w / len(pos_docs)
    neg_mean: Dict[str, float] = {}
    if neg_docs:
        for text in neg_docs:
            for tok, w in _tfidf_weights([text], df, n_docs)[0].items():
                neg_mean[tok] = neg_mean.get(tok, 0.0) + w / len(neg_docs)

    enhanced = dict(qvec)
    for tok, w in pos_mean.items():
        enhanced[tok] = enhanced.get(tok, 0.0) + beta * w
    for tok, w in neg_mean.items():
        enhanced[tok] = enhanced.get(tok, 0.0) - beta * w

    orig = set(_tokens(query))
    # 优先取"相关文档里出现、query 里没有"的高权词（正反馈信号）；
    # 极小语料下 TF-IDF idf≈0 会过滤掉一切，故退回用相关文档原始 TF 频率兜底。
    pos_tf: Counter = Counter()
    for text in pos_docs:
        pos_tf.update(_tokens(text))
    new_terms = [t for t in pos_tf if t not in orig and t not in _STOP and len(t) >= 2]
    if new_terms:
        new_terms.sort(key=lambda t: pos_tf[t], reverse=True)
        new_terms = new_terms[:top_terms]
        return (query + " " + " ".join(new_terms)).strip()
    # 兜底：相关文档全是 query 已有词 → 原样返回
    return query
