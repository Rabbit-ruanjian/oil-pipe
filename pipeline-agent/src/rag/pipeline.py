"""
RAG Pipeline
整合所有RAG组件的完整流程
"""

import json
from pathlib import Path
from typing import List, Optional, Dict, Any
from dataclasses import dataclass, field

from src.config import settings, rag_config
from src.utils import logger
from src.models.enums import RetrievalQuality, KnowledgeCategory
from src.knowledge_graph import get_knowledge_graph_builder

from .document_processor import DocumentProcessor, Document, create_document_processor
from .contextual_chunker import ContextualChunker, Chunk, create_contextual_chunker
from .embeddings import HybridEmbeddings, get_embeddings
from .vector_store import MilvusVectorStore, get_vector_store
from .hybrid_retriever import HybridRetriever, RetrievalResult, get_retriever
from .reranker import Reranker, RerankResult, get_reranker
from .hooks import run_pre_retrieval_hooks
from .self_rag import SelfRAG, RetrievalDecision, get_self_rag, get_query_rewriter
from .graph_rag import GraphRAGRetriever


@dataclass
class RAGResponse:
    """RAG响应"""
    context: str                               # 检索到的上下文
    sources: List[Dict[str, Any]]              # 来源引用
    retrieval_quality: RetrievalQuality        # 检索质量
    decision: RetrievalDecision                # 检索决策
    should_fallback: bool = False              # 是否需要降级
    query_rewritten: Optional[str] = None      # 改写后的查询
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class IndexingReport:
    """Indexing summary used by knowledge-base management flows."""

    documents_loaded: int
    documents_indexed: int
    document_ids: List[str] = field(default_factory=list)
    document_chunk_counts: Dict[str, int] = field(default_factory=dict)
    chunk_count: int = 0


@dataclass
class AddDocumentReport:
    """Incremental indexing result for one uploaded document."""

    success: bool
    doc_id: str = ""
    chunk_count: int = 0
    dense_ready: bool = False
    sparse_ready: bool = False
    ingest_stage: str = "QUEUED"
    progress_percent: int = 0
    message: str = ""


@dataclass
class RouteStepTrace:
    """One step in the agentic retrieval loop."""

    route: str
    reason: str
    result_count: int = 0
    quality_after: str = "low"
    continue_next: bool = False
    details: Dict[str, Any] = field(default_factory=dict)


class RAGPipeline:
    """
    RAG Pipeline

    完整流程：
    1. Self-RAG决策 - 判断是否需要检索
    2. 查询改写 - 优化查询
    3. 混合检索 - Dense + Sparse
    4. 重排序 - BGE-Reranker
    5. CRAG评估 - 检索质量评估
    6. 上下文构建 - 组装最终上下文
    """

    def __init__(
        self,
        document_processor: DocumentProcessor = None,
        chunker: ContextualChunker = None,
        embeddings: HybridEmbeddings = None,
        vector_store: MilvusVectorStore = None,
        retriever: HybridRetriever = None,
        reranker: Reranker = None,
        self_rag: SelfRAG = None,
        graph_rag: GraphRAGRetriever = None,
    ):
        """初始化RAG Pipeline"""
        self.document_processor = document_processor or create_document_processor()
        self.chunker = chunker or create_contextual_chunker()
        self.embeddings = embeddings or get_embeddings()
        self.vector_store = vector_store or get_vector_store()
        self.retriever = retriever or get_retriever()
        self.reranker = reranker or get_reranker()
        self.self_rag = self_rag or get_self_rag()
        self.query_rewriter = get_query_rewriter()
        self.graph_rag = graph_rag or GraphRAGRetriever(get_knowledge_graph_builder())
        # P0-③ 注册可插拔 pre-retrieval hooks（B5 问题完整性 + HITL 反问补全）
        self._register_retrieval_hooks()

    def _register_retrieval_hooks(self) -> None:
        """注册已启用的 pre-retrieval hooks（P0-③ 可插拔基线）。

        每个 hook 由独立开关控制（RAG_QUESTION_REFINE 等），默认关闭；
        关闭时 hook 实现内部 no-op，pipeline 行为与现状逐字节一致。
        """
        try:
            from .question_refiner import register_question_refine_hook
            register_question_refine_hook()
        except Exception as exc:
            logger.warning(f"注册 question_refiner hook 失败（降级跳过）: {exc}")
        self._last_sparse_revision: Optional[str] = None

    def index_documents_report(
        self,
        knowledge_base_path: str = "knowledge_base",
        recreate: bool = False
    ) -> IndexingReport:
        """
        索引知识库文档

        Args:
            knowledge_base_path: 知识库路径
            recreate: 是否重建索引

        Returns:
            索引的文档数量
        """
        logger.info(f"开始索引知识库: {knowledge_base_path}")

        # 1. 加载文档
        self.document_processor = DocumentProcessor(knowledge_base_path)
        documents = self.document_processor.load_all_documents()

        if not documents:
            logger.warning("没有找到可索引的文档")
            self.retriever.clear_sparse_index()
            return IndexingReport(
                documents_loaded=0,
                documents_indexed=0,
                document_ids=[],
                document_chunk_counts={},
                chunk_count=0,
            )

        # 2. 创建/重建Collection
        self.vector_store.create_collection(recreate=recreate)

        # 3. 分块和向量化
        all_chunks = []
        all_embeddings = []
        bm25_corpus = []
        indexed_doc_ids = []
        doc_chunk_counts: Dict[str, int] = {}

        for doc in documents:
            logger.info(f"处理文档: {doc.title}")

            # 分块（含Contextual Retrieval和HyPE）
            chunks = self.chunker.chunk_document(doc)

            # 准备向量化文本
            texts_to_embed = []
            for chunk in chunks:
                # Parent/child retrieval embeds the fine-grained child text.
                texts_to_embed.append(chunk.retrieval_text or chunk.content)

                # 如果启用HyPE，也对假设问题进行向量化
                if chunk.hypothetical_questions:
                    # 这里简化处理，将问题拼接到主文本中
                    # 实际可以分别存储问题向量
                    pass

            # 批量向量化
            if texts_to_embed:
                embeddings = self.embeddings.embed_documents(texts_to_embed)
                all_chunks.extend(chunks)
                all_embeddings.extend(embeddings)
                indexed_doc_ids.append(doc.doc_id)

                # 收集BM25语料
                for chunk in chunks:
                    bm25_corpus.append({
                        "chunk_id": chunk.chunk_id,
                        "content": chunk.retrieval_text or chunk.content,
                        "full_text": chunk.full_text,
                        "doc_id": chunk.doc_id,
                        "doc_title": chunk.doc_title,
                        "source": chunk.source,
                        "category": chunk.category.value if chunk.category else "",
                        "chunk_index": chunk.chunk_index,
                    })

        # 4. 批量插入Milvus
        if all_chunks:
            self.vector_store.insert_chunks(all_chunks, all_embeddings)
            for chunk in all_chunks:
                doc_chunk_counts[chunk.doc_id] = doc_chunk_counts.get(chunk.doc_id, 0) + 1

        # 5. 构建BM25索引
        if bm25_corpus:
            self.retriever.build_sparse_index(bm25_corpus)
        else:
            self.retriever.clear_sparse_index()

        logger.info(f"索引完成，共 {len(documents)} 个文档，{len(all_chunks)} 个分块")
        return IndexingReport(
            documents_loaded=len(documents),
            documents_indexed=len(indexed_doc_ids),
            document_ids=indexed_doc_ids,
            document_chunk_counts=doc_chunk_counts,
            chunk_count=len(all_chunks),
        )

    def index_documents(
        self,
        knowledge_base_path: str = "knowledge_base",
        recreate: bool = False
    ) -> int:
        """Keep the legacy int-return API for existing callers."""

        report = self.index_documents_report(
            knowledge_base_path=knowledge_base_path,
            recreate=recreate,
        )
        return report.documents_loaded

    def refresh_sparse_index(self, knowledge_base_path: str = "knowledge_base") -> int:
        """
        仅刷新BM25稀疏索引，保持向量索引不变。

        Args:
            knowledge_base_path: 知识库路径

        Returns:
            已纳入BM25语料的文档数量
        """
        processor = DocumentProcessor(knowledge_base_path)
        documents = processor.load_all_documents()
        if not documents:
            self.retriever.clear_sparse_index()
            logger.info("知识库为空，已清空BM25索引")
            return 0

        bm25_corpus = []
        for doc in documents:
            chunks = self.chunker.chunk_document(doc)
            for chunk in chunks:
                bm25_corpus.append({
                    "chunk_id": chunk.chunk_id,
                    "content": chunk.retrieval_text or chunk.content,
                    "full_text": chunk.full_text,
                    "doc_id": chunk.doc_id,
                    "doc_title": chunk.doc_title,
                    "source": chunk.source,
                    "category": chunk.category.value if chunk.category else "",
                    "chunk_index": chunk.chunk_index,
                })

        if bm25_corpus:
            self.retriever.build_sparse_index(bm25_corpus)
        else:
            self.retriever.clear_sparse_index()

        logger.info(f"BM25索引刷新完成，文档数: {len(documents)}，分块数: {len(bm25_corpus)}")
        self._last_sparse_revision = self._read_sparse_revision(knowledge_base_path)
        return len(documents)

    def ensure_retriever_ready(self, knowledge_base_path: str = "knowledge_base") -> int:
        """
        Ensure sparse retrieval is ready for an existing knowledge base.

        This is used during service startup when the vector collection already
        exists but the in-memory BM25 index has not been rebuilt yet.
        """
        if getattr(self.retriever, "_sparse_corpus_built", False):
            self._last_sparse_revision = self._read_sparse_revision(knowledge_base_path)
            return len(getattr(self.retriever, "_index_to_chunk", {}))
        return self.refresh_sparse_index(knowledge_base_path)

    def sync_sparse_index_if_needed(self, knowledge_base_path: str = "knowledge_base") -> int:
        """Refresh process-local BM25 when another worker updated the shared revision."""

        current_revision = self._read_sparse_revision(knowledge_base_path)
        sparse_ready = bool(getattr(self.retriever, "_sparse_corpus_built", False))
        if sparse_ready and current_revision and current_revision == self._last_sparse_revision:
            return len(getattr(self.retriever, "_index_to_chunk", {}))
        return self.refresh_sparse_index(knowledge_base_path)

    def retrieve(
        self,
        query: str,
        top_k: int = None,
        category_filter: Optional[str] = None,
        skip_self_rag: bool = False
    ) -> RAGResponse:
        """
        执行RAG检索

        Args:
            query: 用户查询
            top_k: 返回数量
            category_filter: 分类过滤
            skip_self_rag: 是否跳过Self-RAG决策

        Returns:
            RAG响应
        """
        top_k = top_k or rag_config.retrieval["final_k"]
        self.sync_sparse_index_if_needed()

        if skip_self_rag:
            decision = RetrievalDecision.RETRIEVE
            decision_reason = "跳过Self-RAG"
        else:
            decision, decision_reason = self.self_rag.should_retrieve(query)

        logger.info(f"Self-RAG决策: {decision.value} - {decision_reason}")

        if decision in {RetrievalDecision.DIRECT, RetrievalDecision.CALCULATE}:
            return RAGResponse(
                context="",
                sources=[],
                retrieval_quality=RetrievalQuality.HIGH,
                decision=decision,
                metadata={"reason": decision_reason}
            )

        rewritten_query = query
        if rag_config.features.get("query_rewrite", False):
            rewritten_query = self.query_rewriter.rewrite(query)

        # P0-③ 检索前 hook：改写之后、plan_routes/retriever 执行之前调用。
        # 由 config.RAG_MULTI_QUERY / RAG_HYDE / RAG_QUESTION_REFINE 等开关控制，
        # 关闭时 run_pre_retrieval_hooks 是 no-op（返回原查询串），行为与现状逐字节一致。
        # hook 内部异常自动降级，不阻断主链路。
        pluggable = rag_config.pluggable
        if any([
            pluggable["multi_query"],
            pluggable["decompose"],
            pluggable["hyde"],
            pluggable["question_refine"],
            pluggable["graph_traversal_llm"],
        ]):
            rewritten_query = run_pre_retrieval_hooks(
                query=rewritten_query,
                decision=decision,
                top_k=top_k or rag_config.retrieval["final_k"],
                category_filter=category_filter,
            )

        route_plan = self.self_rag.plan_routes(rewritten_query, decision)
        route_trace: List[RouteStepTrace] = []
        rerank_results: List[RerankResult] = []
        graph_results: List[Dict[str, Any]] = []
        database_results: List[Dict[str, Any]] = []
        quality = RetrievalQuality.LOW
        quality_reason = "尚未执行检索"

        for index, route_item in enumerate(route_plan):
            route_name = str(route_item.get("route", "hybrid"))
            route_reason = str(route_item.get("reason", ""))
            step_details: Dict[str, Any] = {}
            step_result_count = 0

            if route_name == "hybrid":
                hybrid_candidates, reranked = self._run_hybrid_route(
                    query=rewritten_query,
                    top_k=top_k,
                    category_filter=category_filter,
                )
                rerank_results = reranked or rerank_results
                step_result_count = len(reranked)
                step_details = {
                    "hybrid_candidates": len(hybrid_candidates),
                    "reranked_results": len(reranked),
                }
            elif route_name == "graph":
                graph_batch = self.graph_rag.retrieve(query, top_k=3)
                graph_results = self._merge_auxiliary_results(
                    graph_results,
                    graph_batch,
                )
                step_result_count = len(graph_batch)
                step_details = {
                    "graph_results": len(graph_batch),
                    "graph_results_total": len(graph_results),
                }
            elif route_name == "database":
                database_batch = self._run_database_route(query, top_k=top_k)
                database_results = self._merge_auxiliary_results(
                    database_results,
                    database_batch,
                )
                step_result_count = len(database_batch)
                step_details = {
                    "database_results": len(database_batch),
                    "database_results_total": len(database_results),
                }
            else:
                logger.debug("Skip unknown agentic route: {}", route_name)

            quality, quality_reason = self._evaluate_agentic_quality(
                query=query,
                rerank_results=rerank_results,
                graph_results=graph_results,
                database_results=database_results,
            )
            continue_next = self._should_continue_agentic_loop(
                current_quality=quality,
                route_plan=route_plan,
                current_index=index,
                current_route=route_name,
                rerank_results=rerank_results,
                graph_results=graph_results,
                database_results=database_results,
            )
            route_trace.append(
                RouteStepTrace(
                    route=route_name,
                    reason=route_reason,
                    result_count=step_result_count,
                    quality_after=quality.value,
                    continue_next=continue_next,
                    details=step_details,
                )
            )
            if not continue_next:
                break

        if not rerank_results and not graph_results and not database_results:
            return RAGResponse(
                context="",
                sources=[],
                retrieval_quality=RetrievalQuality.LOW,
                decision=decision,
                should_fallback=True,
                query_rewritten=rewritten_query if rewritten_query != query else None,
                metadata={
                    "reason": "无检索结果",
                    "decision_reason": decision_reason,
                    "agentic_trace": [self._serialize_route_trace(item) for item in route_trace],
                    "planned_routes": route_plan,
                }
            )

        logger.info(f"CRAG评估: {quality.value} - {quality_reason}")

        context = self._build_context(
            rerank_results,
            quality,
            graph_results,
            database_results,
        )

        sources = self._build_sources(
            rerank_results,
            graph_results,
            database_results,
        )

        return RAGResponse(
            context=context,
            sources=sources,
            retrieval_quality=quality,
            decision=decision,
            should_fallback=(quality == RetrievalQuality.LOW),
            query_rewritten=rewritten_query if rewritten_query != query else None,
            metadata={
                "decision_reason": decision_reason,
                "quality_reason": quality_reason,
                "num_results": len(rerank_results),
                "graph_results": len(graph_results),
                "database_results": len(database_results),
                "planned_routes": route_plan,
                "agentic_trace": [self._serialize_route_trace(item) for item in route_trace],
            }
        )


    @staticmethod
    def _dedupe_rerank_results(results: List[RerankResult]) -> List[RerankResult]:
        """Deduplicate dense/sparse/HyPE retrieval outputs by chunk/doc identity."""
        deduped: List[RerankResult] = []
        seen = set()
        for item in results:
            parent_key = RAGPipeline._extract_parent_chunk_key(getattr(item, "chunk_id", None))
            if parent_key:
                key = ("parent", getattr(item, "doc_id", None), parent_key)
            else:
                key = (
                    getattr(item, "chunk_id", None),
                    getattr(item, "doc_id", None),
                    getattr(item, "content", "")[:120],
                )
            if key in seen:
                continue
            seen.add(key)
            deduped.append(item)
        return deduped

    @staticmethod
    def _extract_parent_chunk_key(chunk_id: Optional[str]) -> Optional[str]:
        if not chunk_id or "-c" not in chunk_id:
            return None
        return chunk_id.rsplit("-c", 1)[0]

    def preview_agentic_routes(
        self,
        query: str,
        *,
        skip_self_rag: bool = False,
    ) -> Dict[str, Any]:
        """Return the route plan without executing retrieval."""

        if skip_self_rag:
            decision = RetrievalDecision.RETRIEVE
            decision_reason = "跳过Self-RAG"
        else:
            decision, decision_reason = self.self_rag.should_retrieve(query)

        rewritten_query = query
        if rag_config.features.get("query_rewrite", False):
            rewritten_query = self.query_rewriter.rewrite(query)

        route_plan = self.self_rag.plan_routes(rewritten_query, decision)
        return {
            "decision": decision.value,
            "decision_reason": decision_reason,
            "query_rewritten": rewritten_query if rewritten_query != query else None,
            "planned_routes": route_plan,
            "route_hints": self.self_rag.detect_route_hints(rewritten_query),
        }

    def _run_hybrid_route(
        self,
        *,
        query: str,
        top_k: int,
        category_filter: Optional[str],
    ) -> tuple[List[RetrievalResult], List[RerankResult]]:
        """混合检索单路。P0-③ 开关关闭时逐字节等价于改造前的实现。

        当 multi_query / decompose 开关命中时，走多路查询（B1 扩召回）+ 问题
        分解（B2 拆子问题）编排；任一 LLM 环节失败/超时自动降级回单查询路径。
        """
        pluggable = self._pluggable_features()

        if pluggable.get("multi_query") or pluggable.get("decompose") or pluggable.get("hyde"):
            try:
                candidate_pool = self._collect_multi_query_candidates(
                    query=query,
                    top_k=top_k,
                    category_filter=category_filter,
                    decompose=pluggable.get("decompose"),
                    hyde=pluggable.get("hyde"),
                )
                if candidate_pool:
                    rerank_top_k = max(top_k * 2, top_k)
                    reranked = self.reranker.rerank(
                        query=query,
                        results=candidate_pool,
                        top_k=rerank_top_k,
                    )
                    reranked = self._dedupe_rerank_results(reranked)[:top_k]
                    return candidate_pool, reranked
            except Exception as exc:  # noqa: BLE001
                # 降级兜底：多路/分解失败 → 回退单查询，不阻断主链路
                logger.warning(f"多路查询/问题分解失败，降级为单查询: {exc}")

        retrieval_results = self.retriever.retrieve(
            query=query,
            top_k=top_k * 2,
            category_filter=category_filter,
        )
        if not retrieval_results:
            return [], []

        rerank_top_k = max(top_k * 2, top_k)
        reranked = self.reranker.rerank(
            query=query,
            results=retrieval_results,
            top_k=rerank_top_k,
        )
        reranked = self._dedupe_rerank_results(reranked)[:top_k]
        return retrieval_results, reranked

    @staticmethod
    def _pluggable_features() -> Dict[str, Any]:
        """读取 P0-③ 可插拔开关（对缺失属性做防御，保证旧配置可用）。"""
        try:
            if hasattr(rag_config, "pluggable"):
                return rag_config.pluggable
        except Exception:  # noqa: BLE001
            pass
        return {"multi_query": False, "decompose": False}

    def _build_multi_query_list(
        self,
        *,
        base_query: str,
        decompose: bool,
        hyde: bool = False,
    ) -> List[str]:
        """B1+B2+B3(HyDE) 入口自动路由：生成需要执行多路检索的查询串列表。

        - 开关 decompose 命中且 LLM 判定为复杂问题（置信度≥阈值）→ 先 B2 拆子问题，
          每个子问题再各自 B1 扩召回；
        - 简单问题 / 低置信度 / decompose 关闭 → 只走 B1 对 base_query 扩召回；
        - 开关 hyde 命中 → 额外把 LLM 生成的假想答案（B3）并入查询串列表，
          假想答案向量化后更易命中含答案细节的文档片段。

        返回的列表始终含 base_query 本身（保证降级/无变体时行为不劣于单查询）。
        任何 LLM 失败/超时都被 QueryRewriter 内部降级吞掉。
        """
        rewriter = self.query_rewriter
        expanded = rewriter.expand(base_query, n=3)
        simple_query_set = [base_query, *expanded]

        if not decompose:
            return self._append_hyde(simple_query_set, base_query, hyde)

        decomposition = rewriter.decompose(base_query)
        threshold = float(self._pluggable_features().get("hitl_confidence_threshold", 0.5))
        is_complex = decomposition.get("complex")
        confidence = float(decomposition.get("confidence", 0.0))

        # C 规则：判定为复杂但置信度不足 → 不赌，走 HITL 弹窗让用户拍板走哪条路。
        if is_complex and confidence < threshold:
            self._trigger_low_confidence_hitl(base_query, decomposition, threshold)

        sub_queries = decomposition.get("sub_queries") or []
        if not is_complex or not sub_queries:
            return self._append_hyde(simple_query_set, base_query, hyde)

        # 复杂问题：每个子问题各自 B1 扩召回，再汇总
        multi: List[str] = []
        seen = set()
        for sub in sub_queries:
            sub_text = (sub or "").strip()
            if not sub_text or sub_text in seen:
                continue
            seen.add(sub_text)
            multi.append(sub_text)
            for variant in rewriter.expand(sub_text, n=3):
                if variant and variant not in seen:
                    seen.add(variant)
                    multi.append(variant)
        return self._append_hyde([base_query, *multi], base_query, hyde)

    def _append_hyde(self, query_list: List[str], base_query: str, hyde: bool) -> List[str]:
        """B3 在线 HyDE：开关命中时生成假想答案并入查询串列表。

        假想答案作为额外检索串（与 base_query/变体并列召回，再走 RRF 去重重排）。
        LLM 失败/降级（返回空串）时列表保持不变，行为不劣于未开 HyDE。
        """
        if not hyde:
            return query_list
        hyde_answer = self.query_rewriter.hyde(base_query)
        if hyde_answer and hyde_answer.strip() not in {q.strip() for q in query_list}:
            return [*query_list, hyde_answer.strip()]
        return query_list

    def _trigger_low_confidence_hitl(
        self,
        query: str,
        decomposition: Dict[str, Any],
        threshold: float,
    ) -> None:
        """C 规则兜底：复杂/简单判定置信度低于阈值时，触发 HITL 弹窗让用户拍板。

        失败静默降级（记录日志），绝不阻断检索主链路。
        """
        try:
            from src.workflows.hitl import (
                HITLManager,
                HITLRequest,
                HITLType,
                get_hitl_manager,
            )
            import uuid

            manager: HITLManager = get_hitl_manager()
            request = HITLRequest(
                request_id=str(uuid.uuid4()),
                type=HITLType.PARAMETER_CONFIRM,
                title="检索路径确认",
                description=(
                    f"系统对问题「{query}」判定为复杂问题，但置信度 "
                    f"{float(decomposition.get('confidence', 0.0)):.2f} 低于阈值 "
                    f"{threshold:.2f}，不确定该走问题分解(B2)还是多路扩召回(B1)。"
                    "请拍板走哪条路。"
                ),
                options=[
                    {"key": "decompose", "label": "走问题分解(B2)"},
                    {"key": "expand", "label": "只走多路扩召回(B1)"},
                ],
                data={"query": query, "decomposition": decomposition, "threshold": threshold},
                default_option="expand",
            )
            manager.create_request(
                session_id="retrieval-rag",
                request=request,
                trace_id="rag-multi-query",
            )
            logger.info(
                f"多路/分解判定置信度不足，已触发 HITL 弹窗 (query={query!r})"
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"HITL 弹窗触发失败，静默降级走 B1: {exc}")

    def _collect_multi_query_candidates(
        self,
        *,
        query: str,
        top_k: int,
        category_filter: Optional[str],
        decompose: bool,
        hyde: bool = False,
    ) -> List[RetrievalResult]:
        """对 B1/B2/B3(HyDE) 生成的每个查询串各调一次检索，合并后按 RRF 逻辑去重重排。

        复用 retriever 自带的 RRF/融合：每个查询串的候选都走 retriever.retrieve
        （内部已含 dense+sparse+RRF），再按 chunk 身份去重合并，秩融合重排。
        """
        query_list = self._build_multi_query_list(base_query=query, decompose=decompose, hyde=hyde)
        ordered: List[str] = []
        seen = set()
        for q in query_list:
            key = (q or "").strip()
            if not key or key in seen:
                continue
            seen.add(key)
            ordered.append(key)

        per_query_candidates: List[RetrievalResult] = []
        for q in ordered:
            results = self.retriever.retrieve(
                query=q,
                top_k=top_k * 2,
                category_filter=category_filter,
            )
            per_query_candidates.extend(results)

        return self._merge_and_rerank_candidates(per_query_candidates, top_k * 2)

    @staticmethod
    def _merge_and_rerank_candidates(
        results: List[RetrievalResult],
        top_k: int,
    ) -> List[RetrievalResult]:
        """多路检索结果去重合并（RRF 风格的秩融合 + 去重）。

        复用 hybrid_retriever 的 RRF 思路（k=60）：对同一 chunk 在多路中出现的，
        累加 1/(k+rank) 的秩分；每个 chunk 保留最高分的那份结果，按秩分降序返回。
        不复制一套融合逻辑。
        """
        k = 60
        fused_score: Dict[str, float] = {}
        best: Dict[str, RetrievalResult] = {}

        for rank, item in enumerate(results, 1):
            key = RAGPipeline._result_identity_key(item)
            fused_score[key] = fused_score.get(key, 0.0) + 1.0 / (k + rank)
            prev = best.get(key)
            if prev is None or item.score > prev.score:
                best[key] = item

        merged = [best[key] for key in fused_score]
        merged.sort(key=lambda r: (-fused_score[RAGPipeline._result_identity_key(r)], -r.score))
        return merged[:top_k]

    @staticmethod
    def _result_identity_key(result: RetrievalResult) -> str:
        """多路去重键：按 chunk 身份（chunk_id + doc_id + 内容前缀）去重。"""
        parent_key = RAGPipeline._extract_parent_chunk_key(result.chunk_id)
        if parent_key:
            return f"parent|{result.doc_id}|{parent_key}"
        return f"chunk|{result.doc_id}|{result.chunk_id}|{result.content[:120]}"

    def _run_database_route(self, query: str, top_k: int) -> List[Dict[str, Any]]:
        from src.agents import get_data_agent

        raw_output = get_data_agent().execute(query)
        return self._parse_database_route_output(raw_output, top_k=top_k)

    def _parse_database_route_output(self, raw_output: str, top_k: int) -> List[Dict[str, Any]]:
        try:
            payload = json.loads(raw_output)
        except Exception:
            payload = {"raw": raw_output}

        rows = payload.get("data")
        if isinstance(rows, dict):
            rows = [rows]
        if not isinstance(rows, list):
            rows = []

        contexts: List[Dict[str, Any]] = []
        for index, row in enumerate(rows[: max(top_k, 1)], start=1):
            row_text = json.dumps(row, ensure_ascii=False, default=str)
            contexts.append(
                {
                    "type": "database",
                    "content": row_text,
                    "confidence": 0.78,
                    "source": "database",
                    "title": f"数据库结果 {index}",
                }
            )

        if not contexts and payload.get("raw"):
            contexts.append(
                {
                    "type": "database",
                    "content": str(payload.get("raw", ""))[:500],
                    "confidence": 0.62,
                    "source": "database",
                    "title": "数据库结果",
                }
            )
        return contexts

    @staticmethod
    def _merge_auxiliary_results(existing: List[Dict[str, Any]], incoming: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        merged = list(existing)
        seen = {
            (
                str(item.get("type", "")),
                str(item.get("content", ""))[:240],
            )
            for item in merged
        }
        for item in incoming:
            key = (
                str(item.get("type", "")),
                str(item.get("content", ""))[:240],
            )
            if key in seen:
                continue
            seen.add(key)
            merged.append(item)
        return merged

    def _evaluate_agentic_quality(
        self,
        *,
        query: str,
        rerank_results: List[RerankResult],
        graph_results: List[Dict[str, Any]],
        database_results: List[Dict[str, Any]],
    ) -> tuple[RetrievalQuality, str]:
        if rerank_results:
            return self.self_rag.evaluate_retrieval_quality(query=query, results=rerank_results)
        if database_results and graph_results:
            return RetrievalQuality.HIGH, "数据库与图谱均提供了补充上下文"
        if database_results:
            return RetrievalQuality.MEDIUM, "数据库结果可回答结构化事实"
        if graph_results:
            return RetrievalQuality.MEDIUM, "图谱结果可支持关系型问题"
        return RetrievalQuality.LOW, "尚未获得有效上下文"

    @staticmethod
    def _should_continue_agentic_loop(
        *,
        current_quality: RetrievalQuality,
        route_plan: List[Dict[str, Any]],
        current_index: int,
        current_route: str,
        rerank_results: List[RerankResult],
        graph_results: List[Dict[str, Any]],
        database_results: List[Dict[str, Any]],
    ) -> bool:
        if current_index >= len(route_plan) - 1:
            return False
        remaining_routes = [
            str(item.get("route", ""))
            for item in route_plan[current_index + 1 :]
            if str(item.get("route", ""))
        ]
        if not remaining_routes:
            return False
        if not rerank_results and not graph_results and not database_results:
            return True
        if current_quality == RetrievalQuality.HIGH:
            return False
        return any(route != current_route for route in remaining_routes)

    @staticmethod
    def _serialize_route_trace(item: RouteStepTrace) -> Dict[str, Any]:
        return {
            "route": item.route,
            "reason": item.reason,
            "result_count": item.result_count,
            "quality_after": item.quality_after,
            "continue_next": item.continue_next,
            "details": item.details,
        }

    def _build_context(
        self,
        results: List[RerankResult],
        quality: RetrievalQuality,
        graph_results: Optional[List[Dict[str, Any]]] = None,
        database_results: Optional[List[Dict[str, Any]]] = None,
    ) -> str:
        """构建检索上下文"""
        graph_results = graph_results or []
        database_results = database_results or []

        if not results:
            auxiliary_context = [
                item.get("content", "")
                for item in [*graph_results, *database_results]
                if item.get("content")
            ]
            return "\n\n".join(auxiliary_context)

        # 根据质量决定处理方式
        if quality == RetrievalQuality.HIGH:
            # 直接使用full_text
            parts = [r.full_text or r.content for r in results]
        elif quality == RetrievalQuality.MEDIUM:
            # 精炼上下文
            parts = [r.full_text or r.content for r in results]
        else:
            # 低质量，只取最相关的
            parts = [results[0].full_text or results[0].content] if results else []

        # 追加图谱上下文
        parts.extend([item.get("content", "") for item in graph_results if item.get("content")])
        parts.extend([item.get("content", "") for item in database_results if item.get("content")])

        return "\n\n---\n\n".join(parts)

    def _build_sources(
        self,
        results: List[RerankResult],
        graph_results: Optional[List[Dict[str, Any]]] = None,
        database_results: Optional[List[Dict[str, Any]]] = None,
    ) -> List[Dict[str, Any]]:
        """构建来源引用"""
        sources = []
        seen_sources = set()

        for r in results:
            parent_key = self._extract_parent_chunk_key(r.chunk_id) or r.chunk_id
            source_key = (r.doc_id, parent_key)
            if source_key in seen_sources:
                continue
            sources.append({
                "doc_id": r.doc_id,
                "doc_title": r.doc_title,
                "source": r.source,
                "category": r.category,
                "score": r.final_score,
                "content_preview": self._build_source_preview(r),
            })
            seen_sources.add(source_key)

        for index, graph_item in enumerate(graph_results or [], start=1):
            sources.append({
                "doc_id": f"graph_{index}",
                "doc_title": "知识图谱推理结果",
                "source": "knowledge_graph",
                "category": "graph",
                "score": graph_item.get("confidence", 0.0),
                "content_preview": graph_item.get("content", "")[:200],
            })

        for index, database_item in enumerate(database_results or [], start=1):
            sources.append({
                "doc_id": f"database_{index}",
                "doc_title": database_item.get("title", "结构化数据库结果"),
                "source": "database",
                "category": "database",
                "score": database_item.get("confidence", 0.0),
                "content_preview": str(database_item.get("content", ""))[:200],
            })

        return sources

    @staticmethod
    def _build_source_preview(result: RerankResult) -> str:
        full_text = result.full_text or ""
        if "[Section]" in full_text and "[Focus Snippet]" in full_text:
            try:
                section = full_text.split("[Section]", 1)[1].split("[Parent Context]", 1)[0].strip()
                snippet = full_text.split("[Focus Snippet]", 1)[1].strip()
                preview = f"{section}\n{snippet}".strip()
                return preview[:200] + "..." if len(preview) > 200 else preview
            except Exception:
                pass
        return result.content[:200] + "..." if len(result.content) > 200 else result.content

    def add_document(self, file_path: str) -> bool:
        """Keep the legacy bool-return API for existing callers."""

        return self.add_document_report(file_path).success

    def add_document_report(self, file_path: str) -> AddDocumentReport:
        """
        添加单个文档到知识库

        Args:
            file_path: 文件路径

        Returns:
            是否成功
        """
        report = AddDocumentReport(
            success=False,
            ingest_stage="QUEUED",
            progress_percent=0,
            message="等待解析文档",
        )
        try:
            # 加载文档
            doc = self.document_processor.load_document(file_path)
            if not doc:
                report.ingest_stage = "FAILED"
                report.message = "文档解析失败"
                return report

            report.doc_id = doc.doc_id
            report.ingest_stage = "PARSED"
            report.progress_percent = 20
            report.message = "文档解析完成"

            # 分块
            chunks = self.chunker.chunk_document(doc)
            report.chunk_count = len(chunks)
            report.ingest_stage = "CHUNKED"
            report.progress_percent = 45
            report.message = f"文档分块完成，共 {len(chunks)} 个切片"

            # 向量化
            texts = [c.retrieval_text or c.content for c in chunks]
            embeddings = self.embeddings.embed_documents(texts)

            # 插入Milvus
            self.vector_store.insert_chunks(chunks, embeddings)
            report.dense_ready = True
            report.ingest_stage = "DENSE_READY"
            report.progress_percent = 75
            report.message = "向量索引写入完成"

            self.refresh_sparse_index()
            report.sparse_ready = True
            report.ingest_stage = "DONE"
            report.progress_percent = 100
            report.message = "Dense 与 Sparse 索引均已就绪"
            report.success = True

            logger.info(f"已添加文档: {file_path}, chunks={len(chunks)}")
            return report

        except Exception as e:
            logger.error(f"添加文档失败: {e}")
            report.ingest_stage = "FAILED"
            report.message = str(e)
            return report

    def delete_document(self, doc_id: str) -> bool:
        """
        从知识库删除文档

        Args:
            doc_id: 文档ID

        Returns:
            是否成功
        """
        try:
            self.vector_store.delete_by_doc_id(doc_id)
            self.retriever.remove_document_from_sparse_index(doc_id)
            logger.info(f"已删除文档: {doc_id}")
            return True
        except Exception as e:
            logger.error(f"删除文档失败: {e}")
            return False

    def get_stats(self) -> Dict[str, Any]:
        """获取知识库统计信息"""
        return self.vector_store.get_stats()

    @staticmethod
    def _read_sparse_revision(knowledge_base_path: str) -> str:
        state_path = Path(knowledge_base_path) / ".registry" / "sparse_state.json"
        if not state_path.exists():
            return ""
        try:
            payload = json.loads(state_path.read_text(encoding="utf-8"))
            return str(payload.get("revision") or "")
        except Exception:
            return ""


# 全局实例
_pipeline: Optional[RAGPipeline] = None


def get_rag_pipeline() -> RAGPipeline:
    """获取RAG Pipeline实例"""
    global _pipeline
    if _pipeline is None:
        _pipeline = RAGPipeline()
    return _pipeline
