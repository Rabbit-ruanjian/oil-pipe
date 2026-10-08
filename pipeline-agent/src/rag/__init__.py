"""RAG module exports."""

from .document_processor import Document, DocumentProcessor, create_document_processor
from .contextual_chunker import Chunk, ContextualChunker, create_contextual_chunker
from .embeddings import HybridEmbeddings, EmbeddingCache, get_embeddings, get_cache
from .vector_store import MilvusVectorStore, get_vector_store
from .hybrid_retriever import RetrievalResult, HybridRetriever, get_retriever
from .reranker import RerankResult, Reranker, DashScopeReranker, LLMReranker, get_reranker
from .self_rag import RetrievalDecision, SelfRAG, QueryRewriter, get_self_rag, get_query_rewriter
from .question_refiner import QuestionRefiner, CompletenessResult, RefineOutcome, get_question_refiner, register_question_refine_hook
from .graph_rag import GraphRAGRetriever
from .pipeline import RAGPipeline, RAGResponse, get_rag_pipeline
from .knowledge_ingest import (
    detect_complex_extraction,
    ingest_pre_execution_hook,
    ingest_structured_knowledge,
    llm_extract_knowledge,
    normalize_expert_knowledge,
    record_hitl_history,
    read_hitl_history,
    register_ingest_llm_extract_hook,
    upsert_expert_relations,
)
from .hooks import (
    PreIngestionHook,
    PreRetrievalHook,
    register_pre_ingestion_hook,
    register_pre_retrieval_hook,
    run_pre_ingestion_hooks,
    run_pre_retrieval_hooks,
    clear_hooks,
)

__all__ = [
    "Document",
    "DocumentProcessor",
    "create_document_processor",
    "Chunk",
    "ContextualChunker",
    "create_contextual_chunker",
    "HybridEmbeddings",
    "EmbeddingCache",
    "get_embeddings",
    "get_cache",
    "MilvusVectorStore",
    "get_vector_store",
    "RetrievalResult",
    "HybridRetriever",
    "get_retriever",
    "RerankResult",
    "Reranker",
    "DashScopeReranker",
    "LLMReranker",
    "get_reranker",
    "RetrievalDecision",
    "SelfRAG",
    "QueryRewriter",
    "get_self_rag",
    "get_query_rewriter",
    # B5 在线 HyPE 完善问题
    "QuestionRefiner",
    "CompletenessResult",
    "RefineOutcome",
    "get_question_refiner",
    "register_question_refine_hook",
    "GraphRAGRetriever",
    "RAGResponse",
    "RAGPipeline",
    "get_rag_pipeline",
    # A 类"存入"（/knowledge/ingest + LLM 知识抽取 + 专家图蒸馏）
    "normalize_expert_knowledge",
    "llm_extract_knowledge",
    "detect_complex_extraction",
    "read_hitl_history",
    "record_hitl_history",
    "upsert_expert_relations",
    "ingest_pre_execution_hook",
    "ingest_structured_knowledge",
    # P0-③ pre-execution hooks
    "PreIngestionHook",
    "PreRetrievalHook",
    "register_pre_ingestion_hook",
    "register_pre_retrieval_hook",
    "run_pre_ingestion_hooks",
    "run_pre_retrieval_hooks",
    "clear_hooks",
]
