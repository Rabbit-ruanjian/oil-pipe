#!/usr/bin/env python3
"""检索模式对比评测脚本 —— 传统办法评测各检索变体的召回效果。

评测对象（同一 golden set，横向对比）：
  1. bm25        —— 传统 BM25 关键词检索（sparse only）
  2. dense       —— 传统向量检索（Milvus cosine；无可用 embedding 时自动降级为
                    本地随机向量占位 + 标注，召回数值不可比，只验证链路通）
  3. hybrid      —— dense + BM25 的 RRF 融合（k=60，系统默认）
  4. metadata    —— hybrid + category 元数据过滤（元数据索引）
  5. graphrag    —— Graph RAG（关键词 → 图谱节点 → 因果链/子图）
  6. hybrid_graph —— hybrid + graphrag 结果 RRF 融合（向量 + 图）
  7. enrich      —— Relevance Feedback（Rocchio 反馈增强查）：
                    用"上一轮命中 top 文档"模拟用户正反馈，β 增强 query
                    → 再检索一次 → 命中变化；无 LLM 时用关键词/TF-IDF 向量做
                    Rocchio（非向量语义版，如实标注）

打分（传统 IR 指标，不依赖 LLM judge）：
  - 每条 golden 样本 = {query, gold_docs: [doc_id]}
  - hit@1 / hit@3 / hit@5：top-N 里是否出现任一 gold_doc
  - recall@k：gold_docs 被 top-k 覆盖的比例
  - mrr：第一个命中 gold 的排名倒数
  - 各模式横向对比表 + 总评

LLM / 依赖探测（全自动降级，标注不假装）：
  - 真 embedding key（可达的 OPENAI_API_BASE/EMBEDDING_API_BASE）→ dense 走真向量
  - ragas 已安装 → 追加 ragas faithfulness/context_recall（需 LLM，缺则跳过标注）
  - 均缺 → 仅跑 BM25 + 关键词版 Rocchio，报告里如实写明哪些指标在降级态下不可比

用法：
  cd pipeline-agent && .venv/bin/python scripts/eval_retrieval_modes.py
  可选： --top-k 5 --beta 0.5 --no-dense --out /tmp/eval_report.md
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# 把 .env 读进 os.environ，让 EMBEDDING_BACKEND / MILVUS_* 等对探测可见
try:
    from dotenv import load_dotenv

    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
except Exception:  # noqa: BLE001
    pass


# ---------------------------------------------------------------------------
# 环境探测
# ---------------------------------------------------------------------------

def _endpoint_reachable(url: str, timeout: float = 3.0) -> bool:
    import socket
    import urllib.parse

    parsed = urllib.parse.urlparse(url)
    host = parsed.hostname
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    if not host:
        return False
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


def probe_environment() -> Dict[str, Any]:
    """探测 LLM/向量/Milvus 可用性，返回标注用的 capability map。"""

    caps: Dict[str, Any] = {}
    base_llm = os.environ.get("OPENAI_API_BASE", "").rstrip("/")
    key_llm = os.environ.get("OPENAI_API_KEY", "")
    base_emb = os.environ.get("EMBEDDING_API_BASE", "").rstrip("/")
    key_emb = os.environ.get("EMBEDDING_API_KEY", "")
    milvus_host = os.environ.get("MILVUS_HOST", "127.0.0.1")
    milvus_port = int(os.environ.get("MILVUS_PORT", "19530"))

    caps["llm_base"] = base_llm
    caps["llm_key"] = bool(key_llm)
    caps["llm_reachable"] = bool(base_llm) and _endpoint_reachable(base_llm)
    caps["emb_base"] = base_emb
    caps["emb_key"] = bool(key_emb)
    caps["emb_reachable"] = bool(base_emb) and _endpoint_reachable(base_emb)
    caps["milvus_reachable"] = _endpoint_reachable(
        f"http://{milvus_host}:{milvus_port}", timeout=2.0
    )

    # 真 dense：本地 backend 只要求 Milvus 可达（向量由本地模型算，无需远端 API）；
    # api backend 要求 embedding 端点可达 + Milvus 可达
    emb_backend = os.environ.get("EMBEDDING_BACKEND", "api").lower()
    if emb_backend == "local":
        caps["emb_reachable"] = True  # 本地模型无需网络
        caps["real_dense"] = caps["milvus_reachable"]
    else:
        caps["real_dense"] = caps["emb_reachable"] and caps["milvus_reachable"]

    # ragas
    try:
        import ragas  # noqa: F401

        caps["ragas"] = True
    except Exception:
        caps["ragas"] = False

    return caps


# ---------------------------------------------------------------------------
# Golden set（自动生成：来自 knowledge_base 真实文档 + 已录入的专家因果）
# ---------------------------------------------------------------------------

@dataclass
class GoldSample:
    query: str
    gold_docs: List[str]  # doc_id 列表
    category: Optional[str] = None  # 用于 metadata 过滤模式
    kind: str = "auto"


def _load_registry_documents() -> Dict[str, dict]:
    """读 registry 全部文档（doc_id -> item）。带降级。"""
    try:
        from src.rag.knowledge_registry import get_knowledge_registry

        registry = get_knowledge_registry()
        data = registry._load_registry()  # noqa: SLF001
        return dict(data.get("documents") or {})
    except Exception as exc:
        print(f"[registry] 读取失败: {exc}")
        return {}


def _doc_title_map() -> Dict[str, str]:
    return {d: str(i.get("title") or d) for d, i in _load_registry_documents().items()}


def build_golden_set(limit: int = 12) -> List[GoldSample]:
    """自动生成 golden set。

    策略：取 knowledge_base 里**有内容差异**的文档，每条样本 = 该文档标题的
    前 8 字（模拟"用户用部分关键词问"）+ 其 doc_id。gold_docs 即该文档自身
    （"问它的内容，就该召回它"）。再补几条专家因果探针样本。
    """

    samples: List[GoldSample] = []
    title_map = _doc_title_map()

    # 从 registry 取"内容足够长"的文档（短标题无法当 query）
    docs = _load_registry_documents()
    for doc_id, item in docs.items():
        if len(samples) >= limit:
            break
        title = str(item.get("title") or "")
        if len(title) < 6:
            continue
        # query = 标题去掉标点后的前 8 字（模拟"用户用部分关键词问"）
        cleaned = re.sub(r"[\s\d\.\-_|]", "", title)
        query = cleaned[:8]
        if not query:
            continue
        samples.append(
            GoldSample(
                query=query,
                gold_docs=[doc_id],
                category=str(item.get("category") or None),
            )
        )

    # 兜底/补充：内置几条"专家因果"样本（对应 expert-relations 入库文本）
    expert_probe = [
        ("机封泄漏 端面烧蚀", "cases"),
        ("泵站出口压力下降 处置", "cases"),
        ("雷诺数 计算", "formulas"),
    ]
    for q, cat in expert_probe:
        if len(samples) >= limit + len(expert_probe):
            break
        # 找 gold_doc：标题含关键词的已有 doc；找不到就用 "expert-only" 占位（命中=被检索到）
        gold = [d for d, t in title_map.items() if any(k in t for k in q.split() if k)]
        if not gold:
            gold = ["expert-only"]
        samples.append(GoldSample(query=q, gold_docs=gold, category=cat, kind="expert"))

    # 元数据干扰样本：同一词在两个类别都存在，gold 指向"非过滤类别"的文档。
    # 用于体现 metadata（带 category 过滤）与 hybrid（不过滤）的差异：
    # 过滤类别若选错，metadata 会漏掉 gold；hybrid 则可能仍命中。
    conflict = _find_conflict_sample(title_map, docs := _load_registry_documents())
    if conflict:
        samples.append(conflict)

    # 去重
    seen: set = set()
    out: List[GoldSample] = []
    for s in samples:
        if s.query in seen:
            continue
        seen.add(s.query)
        out.append(s)
    return out[: limit + len(expert_probe) + (1 if conflict else 0)]


def _find_conflict_sample(
    title_map: Dict[str, str], docs: Dict[str, dict]
) -> Optional[GoldSample]:
    """找一个"跨类别同词"的干扰样本：某词同时出现在 ≥2 个类别的文档标题里。

    gold_docs 指向"少数类别"的文档，但 category 过滤设成"多数类别"——
    这样 metadata 模式（按 category 过滤）会因过滤掉少数类而漏召，
    与 hybrid（不过滤）形成可观测差异，体现元数据索引的双刃剑。
    """
    from collections import defaultdict

    # 标题关键词 → 出现的类别集合
    word_cats: Dict[str, set] = defaultdict(set)
    word_docs: Dict[str, Dict[str, List[str]]] = defaultdict(lambda: defaultdict(list))
    for doc_id, item in docs.items():
        cat = str(item.get("category") or "unknown")
        title = re.sub(r"[\s\d\.\-_|]", "", str(item.get("title") or ""))
        if len(title) < 4:
            continue
        # 取标题里的 2-gram 关键词
        for i in range(len(title) - 1):
            w = title[i : i + 2]
            word_cats[w].add(cat)
            word_docs[w][cat].append(doc_id)
    # 找跨 ≥2 类的词；gold 指向"另一类"，category 设为该类以外的类
    for w, cats in word_cats.items():
        if len(cats) >= 2:
            main_cat = max(cats, key=lambda c: len(word_docs[w][c]))
            other_cat = next(c for c in cats if c != main_cat)
            gold = word_docs[w][other_cat]
            if gold:
                return GoldSample(
                    query=w,
                    gold_docs=gold,
                    category=main_cat,  # 故意过滤到"主类"，gold 却在"另一类"
                    kind="conflict",
                )
    return None


# ---------------------------------------------------------------------------
# 各检索模式（全部走系统内组件，真实数据，统一接口）
# ---------------------------------------------------------------------------

@dataclass
class ModeResult:
    mode: str
    results: List[Tuple[str, str]]  # (doc_id, snippet) 按 rank 排序
    note: str = ""


class RetrievalEvaluator:
    def __init__(self, caps: Dict[str, Any], top_k: int = 5, beta: float = 0.5):
        self.caps = caps
        self.top_k = top_k
        self.beta = beta
        self._retriever = None
        self._embeddings = None
        self._graph = None

    # ---- 初始化（一次） ----
    def init(self):
        """构建组件：复用 pipeline 的 retriever（BM25 语料已在其内构建）。"""
        from src.rag.pipeline import get_rag_pipeline

        pipeline = get_rag_pipeline()
        # 确保 sparse 语料已构建（dense 失败降级不影响 sparse）
        pipeline.ensure_retriever_ready()
        self._retriever = pipeline.retriever  # 复用同一实例，BM25 语料共享
        self._embeddings = self._retriever.embeddings
        from src.knowledge_graph import get_knowledge_graph_builder

        self._graph = get_knowledge_graph_builder()
        self._graph.ensure_ready()

    # ---- 各模式 ----
    def run_bm25(self, query: str) -> ModeResult:
        """传统 BM25（sparse only）。"""
        retriever = self._retriever
        sparse = retriever._sparse_search(query, self.top_k * 2)  # [(chunk_id, score)]
        # chunk_id -> doc_id 去重
        seen: List[Tuple[str, str]] = []
        for chunk_id, _score in sparse:
            chunk = retriever._index_to_chunk.get(retriever._chunk_id_to_index.get(chunk_id, -1), {})
            doc_id = str(chunk.get("doc_id") or chunk_id)
            snippet = str(chunk.get("content") or "")[:80]
            if doc_id not in [d for d, _ in seen]:
                seen.append((doc_id, snippet))
        return ModeResult("bm25", seen[: self.top_k], "传统 BM25 关键词检索")

    def run_dense(self, query: str) -> ModeResult:
        """传统向量检索（Milvus cosine；降级态用占位向量+标注）。"""
        retriever = self._retriever
        if not self.caps["real_dense"]:
            return ModeResult(
                "dense",
                [],
                "降级态：embedding/Milvus 不可用，dense 返回空（仅验证链路，数值不可比）",
            )
        dense = retriever._dense_search(query, self.top_k * 2)  # [dict]
        seen: List[Tuple[str, str]] = []
        for item in dense:
            doc_id = str(item.get("doc_id") or item.get("chunk_id"))
            snippet = str(item.get("content") or item.get("full_text") or "")[:80]
            if doc_id not in [d for d, _ in seen]:
                seen.append((doc_id, snippet))
        return ModeResult("dense", seen[: self.top_k], "传统向量检索（真 embedding）")

    def run_hybrid(self, query: str) -> ModeResult:
        """RRF 融合（系统默认混合检索）。"""
        retriever = self._retriever
        results = retriever.retrieve(query, top_k=self.top_k, use_hybrid=True)
        seen: List[Tuple[str, str]] = []
        for r in results:
            if r.doc_id not in [d for d, _ in seen]:
                seen.append((r.doc_id, str(r.content or "")[:80]))
        return ModeResult("hybrid", seen[: self.top_k], "Dense+BM25 RRF 融合")

    def run_metadata(self, query: str, category: Optional[str] = None) -> ModeResult:
        """hybrid + category 元数据过滤（元数据索引）。"""
        retriever = self._retriever
        results = retriever.retrieve(
            query, top_k=self.top_k, category_filter=category, use_hybrid=True
        )
        seen: List[Tuple[str, str]] = []
        for r in results:
            if r.doc_id not in [d for d, _ in seen]:
                seen.append((r.doc_id, str(r.content or "")[:80]))
        note = f"元数据过滤 category={category!r}" if category else "无 category 过滤（等价 hybrid）"
        return ModeResult("metadata", seen[: self.top_k], note)

    def run_graphrag(self, query: str) -> ModeResult:
        """Graph RAG（多跳）：query → 图谱节点（入口）→ 沿因果边 BFS 多跳
        收集子图 → 用"子图内全部节点名 + 因果词"回查向量/BM25 → doc_id。

        体现图的优势：不只用入口节点名，而是沿 cause/solution 边多跳展开，
        把整条因果链上的概念都当作检索词，召回面比单节点回查宽。
        """
        graph = self._graph
        node_ids = graph.match_nodes_by_text(query)
        if not node_ids:
            return ModeResult("graphrag", [], "Graph RAG：未匹配到节点（新三层召回兜底前状态）")

        # 多跳 BFS：从命中入口出发，沿 cause/solution 边展开子图
        entry = node_ids[0]
        sub_ids = self._graph_bfs(graph, entry, edge_types=("caused_by", "solved_by", "references", "contains"), max_hops=2)
        if not sub_ids:
            sub_ids = node_ids[:3]

        # 子图内节点名 + 因果链 fault/cause/solution 名 → 检索词
        search_terms: List[str] = []
        for sid in sub_ids:
            attrs = graph.graph.nodes.get(sid, {})
            search_terms.append(str(attrs.get("name") or sid))
            if str(attrs.get("type", "")).startswith(("fault", "case")):
                for it in graph.query_fault_causes(str(attrs.get("name") or sid))[:3]:
                    search_terms.append(str(it.get("fault") or ""))
                    search_terms.append(str(it.get("cause") or ""))

        # 用子图概念回查 BM25（图给入口+多跳、向量库给文档）
        retriever = self._retriever
        seen: List[Tuple[str, str]] = []
        term = " ".join(t for t in dict.fromkeys(search_terms) if t)[:60] or query
        if term:
            sparse = retriever._sparse_search(term, self.top_k * 2)
            for chunk_id, _ in sparse:
                chunk = retriever._index_to_chunk.get(
                    retriever._chunk_id_to_index.get(chunk_id, -1), {}
                )
                doc_id = str(chunk.get("doc_id") or chunk_id)
                if doc_id not in [d for d, _ in seen]:
                    seen.append((doc_id, f"via-subgraph({len(sub_ids)}节点):{term[:20]}"))
        return ModeResult(
            "graphrag", seen[: self.top_k],
            f"Graph RAG 多跳（{len(node_ids)} 入口 → BFS {len(sub_ids)} 节点 → 子图概念回查 BM25）",
        )

    def _graph_bfs(self, graph, entry: str, edge_types: Tuple[str, ...], max_hops: int) -> List[str]:
        """沿指定边类型做有界 BFS，返回子图节点 id（含 entry）。"""
        from collections import deque

        visited: List[str] = [entry]
        seen_set = {entry}
        frontier: deque = deque([(entry, 0)])
        while frontier:
            node, hop = frontier.popleft()
            if hop >= max_hops:
                continue
            for nb in graph.graph.successors(node):
                etype = str(graph.graph.get_edge_data(node, nb, default={}).get("type", ""))
                if etype in edge_types:
                    if nb not in seen_set:
                        seen_set.add(nb)
                        visited.append(nb)
                        frontier.append((nb, hop + 1))
        return visited

    def run_hybrid_graph(self, query: str) -> ModeResult:
        """hybrid + graphrag 的 RRF 融合（向量 + 图）。"""
        h = self.run_hybrid(query)
        g = self.run_graphrag(query)
        return _rrf_fuse(h.results, g.results, self.top_k, note="Hybrid+Graph RRF 融合（向量+图）")

    def run_enrich(self, query: str) -> ModeResult:
        """ENRICH = 真闭环 Relevance Feedback（系统实现的 Rocchio 反馈增强）。

        走系统真实实现，不再脚本内模拟：
          1) 首轮 hybrid 检索 → 把命中 top 文档当"用户正反馈"
          2) 调 src.rag.relevance_feedback.record_feedback 落盘反馈
          3) 调 rocchio_rerank 对首轮结果做 TF-IDF 反馈重排
        负反馈（点踩）在降级态没有，按"其它高频无关语料"近似并如实标注。
        无 LLM 时也能跑（纯 TF-IDF 词向量），标注非语义向量版。
        """
        first = self.run_hybrid(query)
        if not first.results:
            return ModeResult("enrich", [], "ENRICH：首轮无命中，无法反馈增强（降级）")

        from src.rag.relevance_feedback import record_feedback, rocchio_rerank

        # 命中文档正文当正反馈；负反馈用"语料里高频但非命中"文档近似
        retriever = self._retriever
        hit_docs = {d for d, _ in first.results[: self.top_k]}
        pos_texts: List[str] = []
        for doc_id, _snip in first.results[: self.top_k]:
            for _idx, ch in retriever._index_to_chunk.items():
                if str(ch.get("doc_id")) == doc_id:
                    pos_texts.append(str(ch.get("full_text") or ch.get("content") or ""))
                    break
        pos_texts = [t for t in pos_texts if t]
        # 近似负反馈：语料里未命中且文本不重叠的文档
        neg_texts: List[str] = []
        for _idx, ch in list(retriever._index_to_chunk.items())[:200]:
            if str(ch.get("doc_id")) not in hit_docs:
                neg_texts.append(str(ch.get("content") or ch.get("full_text") or ""))
                if len(neg_texts) >= 8:
                    break

        # 走系统真实现：记录反馈（落盘）+ Rocchio 重排
        sources = [
            {"doc_id": d, "doc_title": d, "content": s, "full_text": s, "score": 0.5}
            for d, s in first.results[: self.top_k]
        ]
        record_feedback(query, [d for d, _ in first.results[: self.top_k]], None)
        reranked = rocchio_rerank(query, sources, pos_texts, neg_texts or None, beta=self.beta)

        note = (
            f"ENRICH 真闭环（record_feedback 落盘 + Rocchio TF-IDF 重排，β={self.beta}；"
            f"降级态无用户点踩，negative 用未命中语料近似 {len(neg_texts)} 篇）"
        )
        results = [
            (r["doc_id"], str(r.get("content") or r.get("content_preview") or "")[:80])
            for r in reranked
        ]
        return ModeResult("enrich", results, note)


def _rrf_fuse(
    a: List[Tuple[str, str]], b: List[Tuple[str, str]], top_k: int, note: str
) -> ModeResult:
    """两个结果列表 RRF 融合（k=60），doc 级去重。"""

    k = 60
    scores: Dict[str, float] = {}
    snippets: Dict[str, str] = {}
    for rank, (doc, snip) in enumerate(a, 1):
        scores[doc] = scores.get(doc, 0) + 1.0 / (k + rank)
        snippets.setdefault(doc, snip)
    for rank, (doc, snip) in enumerate(b, 1):
        scores[doc] = scores.get(doc, 0) + 1.0 / (k + rank)
        snippets.setdefault(doc, snip)
    ordered = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:top_k]
    return ModeResult("hybrid_graph", [(d, snippets[d]) for d, _ in ordered], note)


def _tokens_of(t: str) -> List[str]:
    """英文/数字词 + 中文"连续汉字串"内部的 2-gram（无 jieba 依赖的降级切法）。

    关键：2-gram 只在**连续汉字串**内部生成（被空格/标点/数字打断就断开），
    避免跨词边界产生"案当"这类幽灵 token。
    """
    import re as _re

    text = t or ""
    latin = _re.findall(r"[a-zA-Z0-9]+", text)
    # 连续汉字串（保持原文相邻关系）
    han_runs = _re.findall(r"[\u4e00-\u9fff]+", text)
    grams: List[str] = []
    for run in han_runs:
        if len(run) == 1:
            grams.append(run)
        else:
            grams.extend(run[i : i + 2] for i in range(len(run) - 1))
    return latin + grams


# 虚词（TF-IDF 分词时丢弃）
_STOP = set(
    "的 了 是 在 与 和 一个 如何 处置 请 你 我 他 她 它 之 及 当 时 而 或 对 于".split()
)


def _toks(t: str) -> List[str]:
    """英文/数字词 + 连续汉字 2-gram（无 jieba 依赖）。"""
    import re as _re

    latin = _re.findall(r"[a-zA-Z0-9]+", t or "")
    grams: List[str] = []
    for run in _re.findall(r"[\u4e00-\u9fff]+", t or ""):
        if len(run) == 1:
            grams.append(run)
        else:
            grams.extend(run[i : i + 2] for i in range(len(run) - 1))
    return [x for x in (latin + grams) if x not in _STOP]


def _tfidf_roccio_enhance(
    query: str, relevant_texts: List[str], beta: float, k: int = 6
) -> str:
    """TF-IDF 向量版 Rocchio（纯 numpy-free 实现，无 jieba 依赖）。

    q' = q + β · mean_tfidf(relevant) − β · mean_tfidf(non_relevant)
    非相关文档用"BM25 语料里随机其它文档"近似（降级态没有用户显式点踩）。
    返回增强后的 query 串（原 query + top-k 相关高频 TF-IDF 词）。

    这是 Rocchio 反馈增强的"词向量版"：比 2-gram 关键词拼接干净——
    TF-IDF 权重自动压低高频虚词、抬高区分度实词，避免"案当/当泵"噪声。
    如实标注：无 LLM/真 embedding 时的降级实现。
    """
    import math

    # 语料：relevant + 其它文档（当 negative 近似）
    pos_docs = list(relevant_texts)
    neg_docs: List[str] = []
    # 从 BM25 语料取"不相关"文档当 negative（降级近似；真实现应用用户点踩）
    try:
        from src.rag.embeddings import get_embeddings

        emb = get_embeddings()
        for _idx, ch in list(emb._index_to_chunk.items())[:200]:
            ctext = str(ch.get("content") or ch.get("full_text") or "")
            if ctext and ctext not in pos_docs and len(neg_docs) < 20:
                neg_docs.append(ctext)
    except Exception:
        neg_docs = []

    # TF-IDF 语料库
    corpus = pos_docs + neg_docs + [query]
    df: Counter = Counter()
    for doc in corpus:
        for tok in set(_toks(doc)):
            df[tok] += 1
    n = len(corpus)

    def tfidf_vec(text: str, neg: bool = False) -> Dict[str, float]:
        tf = Counter(_toks(text))
        vec: Dict[str, float] = {}
        for tok, f in tf.items():
            weight = math.log(1 + f) * math.log(n / (1 + df.get(tok, 0)))
            if neg:
                weight = -weight
            vec[tok] = weight
        return vec

    # Rocchio: q' = q + β·mean(pos) − β·mean(neg)
    qvec = tfidf_vec(query)
    if pos_docs:
        pos_mean: Dict[str, float] = {}
        for d in pos_docs:
            for tok, w in tfidf_vec(d).items():
                pos_mean[tok] = pos_mean.get(tok, 0.0) + w / len(pos_docs)
        for tok, w in pos_mean.items():
            qvec[tok] = qvec.get(tok, 0.0) + beta * w
    if neg_docs:
        neg_mean: Dict[str, float] = {}
        for d in neg_docs:
            for tok, w in tfidf_vec(d).items():
                neg_mean[tok] = neg_mean.get(tok, 0.0) + w / len(neg_docs)
        for tok, w in neg_mean.items():
            qvec[tok] = qvec.get(tok, 0.0) - beta * w

    # 取增强权重最高的 k 个新词（不在原 query 里的）拼到 query 后
    q_orig_toks = set(_toks(query))
    new_top = sorted(
        ((t, w) for t, w in qvec.items() if w > 0 and t not in q_orig_toks),
        key=lambda x: x[1],
        reverse=True,
    )[:k]
    return (query + " " + " ".join(t for t, _ in new_top)).strip()


# ---------------------------------------------------------------------------
# 打分（传统 IR 指标）
# ---------------------------------------------------------------------------

def score_mode(samples: List[GoldSample], mode_results: List[ModeResult]) -> Dict[str, Any]:
    """对某模式的所有样本打分。"""

    hits1, hits3, hits5, recalls, mrrs = 0, 0, 0, [], []
    for s, mr in zip(samples, mode_results):
        gold = set(s.gold_docs)
        ranked_docs = [d for d, _ in mr.results]
        for k in (1, 3, 5):
            topk = set(ranked_docs[:k])
            if topk & gold:
                if k == 1:
                    hits1 += 1
                elif k == 3:
                    hits3 += 1
                else:
                    hits5 += 1
        # recall@5
        top5 = set(ranked_docs[:5])
        recalls.append(len(top5 & gold) / max(len(gold), 1))
        # mrr
        rr = 0.0
        for rank, d in enumerate(ranked_docs, 1):
            if d in gold:
                rr = 1.0 / rank
                break
        mrrs.append(rr)
    n = max(len(samples), 1)
    return {
        "hit@1": round(hits1 / n, 3),
        "hit@3": round(hits3 / n, 3),
        "hit@5": round(hits5 / n, 3),
        "recall@5": round(sum(recalls) / n, 3),
        "mrr": round(sum(mrrs) / n, 3),
        "samples": n,
    }


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--top-k", type=int, default=5)
    ap.add_argument("--beta", type=float, default=0.5)
    ap.add_argument("--limit", type=int, default=12, help="golden set 条数（不含 expert 补充）")
    ap.add_argument("--no-dense", action="store_true", help="跳过 dense 模式")
    ap.add_argument("--out", default="/Users/Admin/Desktop/检索模式评测报告.md")
    args = ap.parse_args()

    t0 = time.time()
    caps = probe_environment()
    samples = build_golden_set(limit=args.limit)
    print(f"[probe] caps={json.dumps(caps, ensure_ascii=False)}")
    print(f"[golden] {len(samples)} 条样本（其中 expert {sum(1 for s in samples if s.kind == 'expert')}）")

    ev = RetrievalEvaluator(caps, top_k=args.top_k, beta=args.beta)
    ev.init()

    modes: List[str] = ["bm25", "dense", "hybrid", "metadata", "graphrag", "hybrid_graph", "enrich"]
    if args.no_dense or not caps["real_dense"]:
        modes = [m for m in modes if m not in ("dense",)]

    all_results: Dict[str, List[ModeResult]] = {}
    for m in modes:
        runner = {
            "bm25": ev.run_bm25,
            "dense": ev.run_dense,
            "hybrid": ev.run_hybrid,
            "metadata": ev.run_metadata,
            "graphrag": ev.run_graphrag,
            "hybrid_graph": ev.run_hybrid_graph,
            "enrich": ev.run_enrich,
        }[m]
        res_list: List[ModeResult] = []
        for s in samples:
            if m == "metadata":
                res_list.append(runner(s.query, s.category))
            else:
                res_list.append(runner(s.query))
        all_results[m] = res_list
        print(f"[mode] {m:12s} 跑完 {len(res_list)} 样本")

    # 打分
    report = []
    report.append("# 检索模式对比评测报告（传统 IR 指标）\n")
    report.append(f"- 日期：{time.strftime('%Y-%m-%d %H:%M')}")
    report.append(f"- 样本：{len(samples)} 条（自动生成 golden set）；top_k={args.top_k}")
    report.append(f"- 耗时：{time.time() - t0:.1f}s")
    report.append("\n## 环境标注（全自动降级，不假装）\n")
    report.append(f"- 真 dense（emb+Milvus 可达）：{caps['real_dense']}")
    report.append(f"- LLM 可达：{caps['llm_reachable']}；ragas 已装：{caps['ragas']}")
    if not caps["real_dense"]:
        report.append("- ⚠️ dense 走降级（占位向量），其 hit/recall 数值**不可比**，只看链路")
    if not caps["ragas"]:
        report.append("- ⚠️ 无 ragas 依赖，跳过 LLM judge（faithfulness/context_recall），只用传统 IR 指标")

    # 对比表
    report.append("\n## 各模式对比（传统 IR 指标）\n")
    report.append("| 模式 | hit@1 | hit@3 | hit@5 | recall@5 | MRR | 说明 |")
    report.append("|---|---|---|---|---|---|---|")
    scores: Dict[str, Any] = {}
    for m in modes:
        sc = score_mode(samples, all_results[m])
        scores[m] = sc
        note = all_results[m][0].note if all_results[m] else ""
        report.append(
            f"| {m} | {sc['hit@1']} | {sc['hit@3']} | {sc['hit@5']} | {sc['recall@5']} | {sc['mrr']} | {note} |"
        )

    # 最佳模式（按 mrr，dense 降级态剔除）
    comparable = [m for m in modes if not (m == "dense" and not caps["real_dense"])]
    best = max(comparable, key=lambda m: scores[m]["mrr"]) if comparable else "-"
    report.append(f"\n**最佳模式（MRR）：{best}**（降级态下 dense 不参与比选）")

    # 逐样本 top1 命中明细（前 8 条）
    report.append("\n## 逐样本命中明细（top-1 doc 是否命中 gold）\n")
    report.append("| 样本 query | gold_docs | " + " | ".join(modes) + " |")
    report.append("|" + "---|" * (len(modes) + 2))
    for i, s in enumerate(samples[:8]):
        golds = ",".join(s.gold_docs)
        row = [s.query, golds]
        for m in modes:
            top1 = all_results[m][i].results[0][0] if all_results[m][i].results else "-"
            mark = "✓" if top1 in set(s.gold_docs) else ("·" if top1 == "-" else "✗")
            row.append(f"{top1[:8]}{mark}")
        report.append("| " + " | ".join(row) + " |")

    report.append(
        "\n## 结论与 ENRICH 现状\n"
        "- 传统 BM25 / Hybrid / 元数据过滤 / Graph RAG / Hybrid+Graph 的相对优劣见上表。\n"
        "- **ENRICH（Relevance Feedback）目前系统里没有实现闭环**——本脚本用关键词版 Rocchio\n"
        "  模拟了'反馈增强查'的最小形态；要接真反馈（点赞/点踩/改写上报）+ 向量版 Rocchio\n"
        "  或 LLM judge，需另开 issue（数据管道 + 反馈入口 + 排序更新）。\n"
        "- 若后续要真 RAGAS：配 LLM key + ragas 依赖 + 本脚本 golden set 即可直接跑 faithfulness。\n"
    )

    with open(args.out, "w", encoding="utf-8") as f:
        f.write("\n".join(report))
    print(f"\n[out] 报告已写 {args.out}")
    print("\n".join(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
