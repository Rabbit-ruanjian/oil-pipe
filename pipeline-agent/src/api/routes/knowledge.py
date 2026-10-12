"""Knowledge base management routes for stage-1 ingestion."""

from __future__ import annotations

import re
import time
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Body, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from src.models import KnowledgeDocumentMetadata, KnowledgeDocumentStatus
from src.models.enums import KnowledgeCategory
from src.rag import get_rag_pipeline, get_retriever, get_reranker
from src.rag.knowledge_registry import get_knowledge_registry
from src.utils import logger

router = APIRouter(prefix="/knowledge", tags=["Knowledge"])

ALLOWED_EXTENSIONS = {".md", ".txt", ".pdf", ".docx"}
ALLOWED_CATEGORIES = {"standards", "formulas", "operations", "cases", "faq"}


class ReindexRequest(BaseModel):
    """Reindex request payload."""

    recreate: bool = Field(default=True, description="Whether to recreate vector collection")


class ReindexResponse(BaseModel):
    """Reindex response payload."""

    success: bool
    documents_indexed: int
    registry_total: int
    recreate: bool
    message: str


class SearchRequest(BaseModel):
    """Knowledge search request."""

    query: str
    top_k: int = 5
    category: Optional[str] = None
    feedback: bool = Field(
        default=False,
        description="ENRICH：启用相关性反馈增强（Rocchio 重排）。需 RAG_USE_RELEVANCE_FEEDBACK 开关同开，"
        "且该 query 有历史反馈记录时生效，否则 no-op",
    )


class SearchItem(BaseModel):
    """Knowledge search item."""

    doc_id: str
    doc_title: str
    content_preview: str
    score: float
    category: Optional[str]


class SearchResponse(BaseModel):
    """Knowledge search response."""

    query: str
    results: list[SearchItem]
    total: int
    route_trace: Optional[dict[str, Any]] = None


class RetrievalDebugItem(BaseModel):
    """Single retrieval candidate for stage-2 debug output."""

    chunk_id: str
    doc_id: str
    doc_title: str
    source: str
    category: Optional[str] = None
    content_preview: str
    full_text_preview: Optional[str] = None
    score: float
    match_type: str


class RetrievalDebugMetrics(BaseModel):
    """Metrics describing the stage-2 retrieval pipeline."""

    use_hybrid: bool
    sparse_enabled: bool
    sparse_index_built: bool
    dense_weight: float
    sparse_weight: float
    dense_candidates: int
    sparse_candidates: int
    hybrid_candidates: int
    dense_duration_ms: float
    sparse_duration_ms: float
    fusion_duration_ms: float
    total_duration_ms: float


class SearchDebugResponse(BaseModel):
    """Debug response for stage-2 hybrid retrieval validation."""

    query: str
    top_k: int
    category_filter: Optional[str] = None
    dense_results: list[RetrievalDebugItem]
    sparse_results: list[RetrievalDebugItem]
    hybrid_results: list[RetrievalDebugItem]
    rerank_results: list["RerankDebugItem"]
    debug: RetrievalDebugMetrics
    rerank_debug: "RerankDebugMetrics"
    route_trace: Optional[dict[str, Any]] = None


class RerankDebugItem(BaseModel):
    """Single reranked result for stage-3 validation."""

    chunk_id: str
    doc_id: str
    doc_title: str
    source: str
    category: Optional[str] = None
    match_type: str
    original_score: float
    rerank_score: float
    final_score: float
    content_preview: str
    context_preview: Optional[str] = None
    full_text_preview: str


class RerankDebugMetrics(BaseModel):
    """Metrics for stage-3 reranker and contextual chunk inspection."""

    reranker_class: str
    reranker_threshold: float
    reranker_enabled: bool
    rerank_candidates_before: int
    rerank_candidates_after: int
    rerank_duration_ms: float
    contextual_enabled: bool
    contextual_results: int


SearchDebugResponse.model_rebuild()


class KnowledgeDocumentItem(BaseModel):
    """Knowledge document registry item."""

    doc_id: str
    title: str
    source: str
    category: str
    tags: list[str] = Field(default_factory=list)
    author: Optional[str] = None
    summary: Optional[str] = None
    language: Optional[str] = None
    version: Optional[str] = None
    external_id: Optional[str] = None
    effective_at: Optional[str] = None
    file_name: str
    relative_path: str
    file_type: str
    file_size_bytes: int
    source_type: str
    status: str
    chunk_count: int = 0
    ingest_stage: str = "QUEUED"
    progress_percent: int = 0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class KnowledgeDocumentListResponse(BaseModel):
    """Knowledge document list response."""

    documents: list[KnowledgeDocumentItem]
    total: int


class UploadResponse(BaseModel):
    """Knowledge upload response."""

    success: bool
    document: KnowledgeDocumentItem
    message: str


# ---------------------------------------------------------------------------
# A 类"存入"（POST /knowledge/ingest）请求/响应模型
# ---------------------------------------------------------------------------


class IngestExpertItem(BaseModel):
    """专家知识字段组（对齐 fault_causal.json schema）。

    支持两种形态：
      - 因果链扁平：fault + cause + prob + solution + cost/downtime
      - 嵌套：fault + causes[{cause, prob, solutions[{solution, cost, downtime}]}]
    """

    fault: str = Field(..., min_length=1, max_length=200, description="故障名")
    cause: Optional[str] = Field(default=None, max_length=200, description="原因名（扁平形态）")
    prob: Optional[float] = Field(default=None, ge=0.0, le=1.0, description="原因概率")
    solution: Optional[str] = Field(default=None, max_length=200, description="解法名（扁平形态）")
    cost: Optional[str] = Field(default=None, max_length=50, description="解法成本 high/medium/low")
    downtime: Optional[str] = Field(default=None, max_length=50, description="停机时长")
    causes: Optional[list[dict[str, Any]]] = Field(default=None, description="嵌套形态的 causes 列表")


class IngestOptions(BaseModel):
    """/knowledge/ingest 的可插拔选项。

    - llm_extract / build_hype 默认关（P0-③ 可插拔，关时行为与改造前逐字节一致）。
    - distill_to_expert_graph 默认 **True**：expert_knowledge 直入即建图入库
      （前端图谱区据此展示因果网）；显式传 False 可关闭蒸馏。
    """

    llm_extract: bool = Field(default=False, description="A2 入库 LLM 知识抽取开关")
    build_hype: bool = Field(default=False, description="A4 保留 HyPE 生成（B1 多路查询种子）")
    distill_to_expert_graph: bool = Field(default=True, description="A3 专家关系蒸馏进文档图（默认开，保证图谱展示有数据）")


class IngestRequest(BaseModel):
    """POST /knowledge/ingest 请求。"""

    doc_id: Optional[str] = Field(default=None, max_length=100, description="稳定文档 ID（upsert 覆盖）")
    title: str = Field(..., min_length=1, max_length=200)
    category: str = Field(default="operations", description="知识库分类（standards/formulas/operations/cases/faq）")
    content: Optional[str] = Field(default=None, description="纯文本内容（与 file 二选一或同时）")
    file: Optional[UploadFile] = Field(default=None, description="上传文件（与 content 二选一）")
    source: Optional[str] = Field(default=None, max_length=100, description="来源标签")
    tags: Optional[list[str]] = Field(default=None, description="标签")
    expert_knowledge: Optional[list[IngestExpertItem]] = Field(
        default=None, description="A1 结构化知识直入字段组"
    )
    options: IngestOptions = Field(default_factory=IngestOptions, description="可插拔选项")
    session_id: Optional[str] = Field(default=None, description="HITL 会话 ID（缺省用 ingest-default-session）")


class IngestResponse(BaseModel):
    """POST /knowledge/ingest 响应。"""

    success: bool
    doc_id: str
    chunk_count: int = 0
    expert_nodes_added: int = 0
    expert_edges_added: int = 0
    llm_extracted: bool = False
    hitl_triggered: bool = False
    hitl_request_id: Optional[str] = None
    message: str


class DeleteResponse(BaseModel):
    """Knowledge delete response."""

    success: bool
    doc_id: str
    file_deleted: bool
    index_deleted: bool
    message: str


class StatsResponse(BaseModel):
    """Knowledge stats response."""

    total_documents: int
    documents_by_category: dict[str, int]
    collection_name: str
    total_chunks: int
    index_exists: bool
    knowledge_root: str


def _parse_tags(raw: str) -> list[str]:
    return [item.strip() for item in re.split(r"[,，]", str(raw or "")) if item.strip()]


def _normalize_category(raw: str) -> KnowledgeCategory:
    try:
        return KnowledgeCategory(str(raw).strip())
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid category: {raw}") from exc


def _to_document_item(item: dict[str, Any]) -> KnowledgeDocumentItem:
    return KnowledgeDocumentItem(**item)


def _extract_context_preview(full_text: str, content: str) -> Optional[str]:
    """Extract contextual prefix from the stored full_text payload."""

    if not full_text:
        return None
    if full_text == content:
        return None
    if "[Parent Context]" in full_text:
        preview_parts: list[str] = []
        if "[Section]" in full_text:
            section_part = full_text.split("[Section]", 1)[1]
            section_text = section_part.split("[Parent Context]", 1)[0].strip()
            if section_text:
                preview_parts.append(section_text)
        parent_text = full_text.split("[Parent Context]", 1)[1]
        parent_text = parent_text.split("[Focus Snippet]", 1)[0].strip()
        if parent_text:
            preview_parts.append(parent_text[:240] + "..." if len(parent_text) > 240 else parent_text)
        return "\n\n".join(preview_parts).strip() or None
    marker = "[原文]"
    if marker in full_text:
        prefix = full_text.split(marker, 1)[0]
        return prefix.replace("[上下文]", "").strip() or None
    normalized = full_text.replace(content, "").strip()
    return normalized or None


def _to_rerank_debug_item(item: Any, match_type_lookup: dict[str, str]) -> RerankDebugItem:
    full_text = item.full_text or item.content or ""
    content = item.content or ""
    return RerankDebugItem(
        chunk_id=item.chunk_id,
        doc_id=item.doc_id,
        doc_title=item.doc_title,
        source=item.source,
        category=item.category,
        match_type=match_type_lookup.get(item.chunk_id, "hybrid"),
        original_score=float(item.original_score),
        rerank_score=float(item.rerank_score),
        final_score=float(item.final_score),
        content_preview=content[:240] + "..." if len(content) > 240 else content,
        context_preview=_extract_context_preview(full_text, content),
        full_text_preview=full_text[:320] + "..." if len(full_text) > 320 else full_text,
    )


def _search_knowledge_sync(request: SearchRequest) -> SearchResponse:
    rag_response = get_rag_pipeline().retrieve(
        query=request.query,
        top_k=request.top_k,
        category_filter=request.category,
        skip_self_rag=False,
        feedback=bool(request.feedback),
    )
    results = [
        SearchItem(
            doc_id=src.get("doc_id", ""),
            doc_title=src.get("doc_title", ""),
            content_preview=src.get("content_preview", "")[:300],
            score=float(src.get("score", 0.0)),
            category=src.get("category"),
        )
        for src in rag_response.sources
    ]
    return SearchResponse(
        query=request.query,
        results=results,
        total=len(results),
        route_trace=rag_response.metadata,
    )


def _debug_search_knowledge_sync(request: SearchRequest) -> SearchDebugResponse:
    pipeline = get_rag_pipeline()
    pipeline.sync_sparse_index_if_needed()
    payload = get_retriever().retrieve_debug_bundle(
        query=request.query,
        top_k=request.top_k,
        category_filter=request.category,
        use_hybrid=True,
    )
    hybrid_results = list(payload.pop("hybrid_raw_results", []))
    payload.pop("dense_raw_results", None)
    payload.pop("sparse_raw_results", None)

    match_type_lookup = {item.chunk_id: item.match_type for item in hybrid_results}
    reranker = get_reranker()
    rerank_started = time.perf_counter()
    reranked = reranker.rerank(request.query, hybrid_results, top_k=request.top_k * 2)
    reranked = pipeline._dedupe_rerank_results(reranked)[:request.top_k]
    rerank_duration_ms = round((time.perf_counter() - rerank_started) * 1000, 2)

    payload["rerank_results"] = [
        _to_rerank_debug_item(item, match_type_lookup)
        for item in reranked
    ]
    payload["rerank_debug"] = RerankDebugMetrics(
        reranker_class=type(reranker).__name__,
        reranker_threshold=float(getattr(reranker, "threshold", 0.0) or 0.0),
        reranker_enabled=bool(getattr(reranker, "enabled", True)),
        rerank_candidates_before=len(hybrid_results),
        rerank_candidates_after=len(reranked),
        rerank_duration_ms=rerank_duration_ms,
        contextual_enabled=bool(getattr(pipeline.chunker, "use_contextual", False)),
        contextual_results=sum(1 for item in reranked if _extract_context_preview(item.full_text or "", item.content or "")),
    )
    rag_response = pipeline.retrieve(
        query=request.query,
        top_k=request.top_k,
        category_filter=request.category,
        skip_self_rag=False,
    )
    payload["route_trace"] = rag_response.metadata
    return SearchDebugResponse(**payload)


@router.get("/baseline")
async def get_knowledge_baseline():
    """Return resolved stage-0 baseline for the knowledge roadmap."""

    return get_knowledge_registry().get_baseline()


@router.get("/documents", response_model=KnowledgeDocumentListResponse)
async def list_documents(
    category: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
):
    """List ingested knowledge documents."""

    registry = get_knowledge_registry()
    documents = registry.list_documents(category=category, status=status)
    return KnowledgeDocumentListResponse(
        documents=[_to_document_item(item) for item in documents],
        total=len(documents),
    )


@router.post("/documents/upload", response_model=UploadResponse)
@router.post("/upload", response_model=UploadResponse, include_in_schema=False)
async def upload_document(
    file: UploadFile = File(...),
    title: str = Form(...),
    source: str = Form(...),
    category: str = Form(...),
    tags: str = Form(...),
    author: Optional[str] = Form(default=None),
    summary: Optional[str] = Form(default=None),
    language: Optional[str] = Form(default=None),
    version: Optional[str] = Form(default=None),
    external_id: Optional[str] = Form(default=None),
    effective_at: Optional[str] = Form(default=None),
):
    """Upload one knowledge document, persist metadata, and index it."""

    registry = get_knowledge_registry()
    try:
        metadata = KnowledgeDocumentMetadata(
            title=title.strip(),
            source=source.strip(),
            category=_normalize_category(category),
            tags=_parse_tags(tags),
            author=author.strip() if author else None,
            summary=summary.strip() if summary else None,
            language=(language or "").strip() or "zh-CN",
            version=version.strip() if version else None,
            external_id=external_id.strip() if external_id else None,
            effective_at=effective_at.strip() if effective_at else None,
        )
        file_bytes = await file.read()
        stored = await run_in_threadpool(
            registry.save_upload,
            file_name=file.filename or metadata.title,
            file_bytes=file_bytes,
            metadata=metadata,
        )
        status_value = str(stored.get("status", "")).strip().lower()
        ingest_stage = str(stored.get("ingest_stage", "")).strip().upper()
        success = status_value == KnowledgeDocumentStatus.INDEXED.value or ingest_stage == "DONE"
        message = (
            "Document uploaded and indexed successfully"
            if success
            else f"Knowledge indexing failed at stage {stored.get('ingest_stage') or 'FAILED'}"
        )
        return UploadResponse(
            success=success,
            document=_to_document_item(stored),
            message=message,
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Knowledge upload failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _ingest_sync(request: IngestRequest) -> IngestResponse:
    """POST /knowledge/ingest 的同步执行体（线程池里跑）。"""

    from src.rag import ingest_structured_knowledge

    category = _normalize_category(request.category)
    file_bytes: Optional[bytes] = None
    if request.file is not None:
        file_bytes = request.file.file.read()

    expert_items = [item.model_dump() for item in (request.expert_knowledge or [])]
    options = request.options.model_dump()

    try:
        result = ingest_structured_knowledge(
            doc_id=request.doc_id,
            title=request.title,
            category=category,
            content=request.content,
            file_bytes=file_bytes,
            file_name=request.file.filename if request.file else None,
            expert_knowledge=expert_items or None,
            options=options,
            session_id=request.session_id,
            tags=request.tags,
            source=request.source,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Knowledge ingest failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return IngestResponse(
        success=True,
        doc_id=str(result.get("doc_id", "")),
        chunk_count=int(result.get("chunk_count", 0)),
        expert_nodes_added=int(result.get("expert_nodes_added", 0)),
        expert_edges_added=int(result.get("expert_edges_added", 0)),
        llm_extracted=bool(result.get("llm_extracted", False)),
        hitl_triggered=bool(result.get("hitl_triggered", False)),
        hitl_request_id=result.get("hitl_request_id"),
        message=str(result.get("message", "ingest completed")),
    )


@router.post("/ingest", response_model=IngestResponse)
async def ingest_knowledge(request: IngestRequest):
    """A 类"存入"接口：文档入库 + 专家知识直入 + LLM 抽取 + 专家图蒸馏。

    - 支持 content 或 file 二选一（或同时）；同 doc_id 覆盖（upsert 语义）。
    - expert_knowledge 字段组直入专家因果链（对齐 fault_causal.json schema）。
    - options.llm_extract / distill_to_expert_graph / build_hype 控制 A2/A3/A4，默认全关。
    - 复杂抽取走 HITL：高置信静默自动，判不准弹窗，用户历史选过同类自动做。
    - 返回 {doc_id, chunk_count, expert_nodes_added, expert_edges_added}。
    """

    return await run_in_threadpool(_ingest_sync, request)


@router.delete("/documents/{doc_id}", response_model=DeleteResponse)
@router.delete("/document/{doc_id}", response_model=DeleteResponse, include_in_schema=False)
async def delete_document(doc_id: str):
    """Delete one knowledge document from registry, storage, and index."""

    registry = get_knowledge_registry()
    try:
        result = registry.delete_document(doc_id)
        return DeleteResponse(
            success=True,
            doc_id=doc_id,
            file_deleted=bool(result.get("file_deleted")),
            index_deleted=bool(result.get("index_deleted")),
            message="文档已删除",
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Knowledge delete failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/reindex", response_model=ReindexResponse)
@router.post("/index", response_model=ReindexResponse, include_in_schema=False)
async def rebuild_index(request: ReindexRequest):
    """Rebuild vector index from current knowledge files."""

    try:
        result = await run_in_threadpool(
            get_knowledge_registry().rebuild_index,
            recreate=request.recreate,
        )
        return ReindexResponse(
            success=True,
            documents_indexed=int(result.get("documents_indexed", 0)),
            registry_total=int(result.get("registry_total", 0)),
            recreate=bool(result.get("recreate", request.recreate)),
            message=f"知识库重建完成，索引文档 {int(result.get('documents_indexed', 0))} 个",
        )
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Knowledge reindex failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/search", response_model=SearchResponse)
async def search_knowledge(request: SearchRequest):
    """Search knowledge base documents."""

    try:
        return await run_in_threadpool(_search_knowledge_sync, request)
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Knowledge search failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/search/debug", response_model=SearchDebugResponse)
async def debug_search_knowledge(request: SearchRequest):
    """Return stage-3 retrieval debug data with reranker and contextual previews."""

    try:
        return await run_in_threadpool(_debug_search_knowledge_sync, request)
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Knowledge debug search failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/stats", response_model=StatsResponse)
async def get_knowledge_stats():
    """Get knowledge-base stats for stage-1 ingestion and indexing."""

    try:
        return StatsResponse(**get_knowledge_registry().get_stats())
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Knowledge stats failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class AutoRouteRequest(BaseModel):
    """POST /knowledge/auto-route 请求：对话入口 LLM 自动路由（B4 图 / B1B2B3 检索）。"""

    question: str = Field(..., min_length=1, max_length=500)
    top_k: int = Field(default=5, ge=1, le=20)


class AutoRouteResponse(BaseModel):
    """自动路由结果。route=fault_cause/equipment_chain 时 graph 为图查询结果；
    route=retrieve/default 时 sources 为检索来源列表。"""

    route: str
    reason: str
    graph: Optional[Any] = None
    sources: Optional[list] = None


@router.post("/auto-route", response_model=AutoRouteResponse)
async def auto_route_knowledge(request: AutoRouteRequest):
    """对话入口自动路由（RAG_AUTO_ROUTE 门控，可插拔默认关）。

    LLM 判定走 B4 图查询（fault_cause/equipment_chain）还是 B1B2B3 检索
    （retrieve）；开关关 / LLM 失败 → route=default 走默认检索，行为不变。
    """

    from src.agents.knowledge_agent import get_knowledge_agent

    try:
        out = await run_in_threadpool(
            get_knowledge_agent().auto_route_search, request.question, request.top_k
        )
        return AutoRouteResponse(
            route=out.get("route", "default"),
            reason=out.get("reason", ""),
            graph=out.get("graph"),
            sources=out.get("sources"),
        )
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Knowledge auto-route failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# ENRICH：相关性反馈（Relevance Feedback / Rocchio）闭环
# 开关 RAG_USE_RELEVANCE_FEEDBACK 默认关；反馈记录持久化在
# knowledge_base/.feedback/relevance_feedback.json。
# ---------------------------------------------------------------------------


class FeedbackRequest(BaseModel):
    """POST /knowledge/feedback 请求：用户对某 query 下文档的相关性标注。"""

    query: str = Field(..., min_length=1, max_length=500)
    relevant_doc_ids: list[str] = Field(default_factory=list, description="用户标「相关」的 doc_id")
    irrelevant_doc_ids: list[str] = Field(default_factory=list, description="用户标「不相关」的 doc_id")
    session_id: Optional[str] = Field(default=None, max_length=100, description="可选会话标识")


class FeedbackResponse(BaseModel):
    """反馈记录结果。"""

    query: str
    recorded: int
    message: str = "反馈已记录"


class FeedbackQueryRequest(BaseModel):
    query: str


class FeedbackInfoResponse(BaseModel):
    query: str
    relevant: list[str]
    irrelevant: list[str]
    has_feedback: bool


class FeedbackClearResponse(BaseModel):
    query: str
    removed: int
    message: str = "反馈已清除"


@router.post("/feedback", response_model=FeedbackResponse)
async def record_relevance_feedback(request: FeedbackRequest):
    """记录一次相关性反馈（ENRICH 反馈入口）。

    用户对本轮 query 的检索结果做"相关/不相关"标注 → 落盘，
    供后续 `/knowledge/search`（feedback=true + RAG_USE_RELEVANCE_FEEDBACK 开关开）
    做 Rocchio 反馈增强重排。
    """

    from src.rag.relevance_feedback import record_feedback

    if not request.relevant_doc_ids and not request.irrelevant_doc_ids:
        raise HTTPException(status_code=400, detail="relevant/irrelevant 至少一个非空")

    out = await run_in_threadpool(
        record_feedback,
        request.query,
        request.relevant_doc_ids,
        request.irrelevant_doc_ids,
        request.session_id,
    )
    return FeedbackResponse(query=request.query, recorded=out.get("recorded", 0))


@router.get("/feedback", response_model=FeedbackInfoResponse)
async def get_relevance_feedback(request: Annotated[FeedbackQueryRequest, Body()]):
    """查询某 query 当前累积的相关/不反馈 doc 列表。"""

    from src.rag.relevance_feedback import load_feedback

    fb = await run_in_threadpool(load_feedback, request.query)
    relevant = fb.get("relevant", [])
    irrelevant = fb.get("irrelevant", [])
    return FeedbackInfoResponse(
        query=request.query,
        relevant=relevant,
        irrelevant=irrelevant,
        has_feedback=bool(relevant or irrelevant),
    )


@router.delete("/feedback", response_model=FeedbackClearResponse)
async def clear_relevance_feedback(request: Annotated[FeedbackQueryRequest, Body()]):
    """清除某 query 的全部反馈记录。"""

    from src.rag.relevance_feedback import clear_feedback

    removed = await run_in_threadpool(clear_feedback, request.query)
    return FeedbackClearResponse(query=request.query, removed=removed)
