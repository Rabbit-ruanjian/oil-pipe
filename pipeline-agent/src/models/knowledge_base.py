"""Knowledge base ingestion models and stage baseline."""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field

from .enums import KnowledgeCategory


class KnowledgeFileType(str, Enum):
    """Supported file types for stage-1 knowledge ingestion."""

    MD = "md"
    TXT = "txt"
    PDF = "pdf"
    DOCX = "docx"


class KnowledgeSourceType(str, Enum):
    """Where a knowledge document comes from."""

    UPLOAD = "upload"
    LOCAL_FILE = "local_file"
    SEED = "seed"
    MIGRATION = "migration"


class KnowledgeDocumentStatus(str, Enum):
    """Knowledge document lifecycle used by ingestion pipeline."""

    DRAFT = "draft"
    UPLOADED = "uploaded"
    PARSING = "parsing"
    CHUNKED = "chunked"
    INDEXED = "indexed"
    FAILED = "failed"
    ARCHIVED = "archived"


class KnowledgeDocumentMetadata(BaseModel):
    """Normalized metadata shared by upload, parsing, and indexing stages."""

    title: str = Field(..., min_length=1, max_length=200, description="Document title")
    source: str = Field(..., min_length=1, max_length=100, description="Knowledge source label")
    category: KnowledgeCategory = Field(..., description="Knowledge category")
    tags: list[str] = Field(..., min_length=1, description="Knowledge tags")
    author: str | None = Field(default=None, max_length=100, description="Optional author")
    summary: str | None = Field(default=None, max_length=1000, description="Optional summary")
    language: str = Field(default="zh-CN", max_length=20, description="Document language")
    version: str | None = Field(default=None, max_length=50, description="Optional version")
    external_id: str | None = Field(default=None, max_length=100, description="External business id")
    effective_at: datetime | None = Field(default=None, description="Optional effective datetime")


class KnowledgeDocumentManifest(BaseModel):
    """Stage-0 manifest for a knowledge document before ingestion."""

    file_name: str = Field(..., min_length=1, max_length=255, description="Original file name")
    file_type: KnowledgeFileType = Field(..., description="Normalized file type")
    source_type: KnowledgeSourceType = Field(..., description="Document source type")
    status: KnowledgeDocumentStatus = Field(
        default=KnowledgeDocumentStatus.DRAFT,
        description="Current ingestion lifecycle status",
    )
    metadata: KnowledgeDocumentMetadata = Field(..., description="Normalized metadata")


class KnowledgeStageBaseline(BaseModel):
    """Reusable baseline definition for the knowledge-base roadmap."""

    supported_file_types: list[KnowledgeFileType] = Field(default_factory=lambda: _default_supported_file_types())
    required_metadata_fields: list[str] = Field(default_factory=lambda: _default_required_metadata_fields())
    minimal_pipeline: list[str] = Field(
        default_factory=lambda: [
            "upload",
            "metadata_validation",
            "document_parsing",
            "chunking",
            "indexing",
            "retrieval_validation",
        ]
    )
    module_boundaries: dict[str, list[str]] = Field(
        default_factory=lambda: {
            "ingestion": [
                "src/models/knowledge_base.py",
                "src/api/routes/knowledge.py",
            ],
            "retrieval": [
                "src/rag/document_processor.py",
                "src/rag/contextual_chunker.py",
                "src/rag/vector_store.py",
            ],
            "graph": ["src/knowledge_graph/*"],
            "agent": ["src/workflows/*", "src/agents/*"],
        }
    )


def build_stage0_baseline() -> KnowledgeStageBaseline:
    """Return the shared stage-0 baseline for the knowledge roadmap."""

    return KnowledgeStageBaseline()


def _default_supported_file_types() -> list[KnowledgeFileType]:
    """Resolve stage-0 supported file types from runtime settings."""

    from src.config import get_settings

    resolved: list[KnowledgeFileType] = []
    for ext in get_settings().kb_allowed_extensions:
        try:
            resolved.append(KnowledgeFileType(ext))
        except ValueError:
            continue
    return resolved or [
        KnowledgeFileType.MD,
        KnowledgeFileType.TXT,
        KnowledgeFileType.PDF,
        KnowledgeFileType.DOCX,
    ]


def _default_required_metadata_fields() -> list[str]:
    """Resolve required metadata fields from runtime settings."""

    from src.config import get_settings

    fields = get_settings().kb_required_metadata_fields
    return fields or ["title", "source", "category", "tags"]
