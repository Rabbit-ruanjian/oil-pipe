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
