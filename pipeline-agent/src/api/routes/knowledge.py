"""Knowledge base management routes for stage-1 ingestion."""

from __future__ import annotations

import re
import time
from typing import Any, Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
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
