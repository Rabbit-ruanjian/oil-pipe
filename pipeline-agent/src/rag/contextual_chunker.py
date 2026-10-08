"""
Context-aware parent/child chunking for retrieval.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

from src.config import rag_config, settings
from src.models.enums import KnowledgeCategory
from src.utils import logger

from .document_processor import Document


@dataclass
class Chunk:
    """One retrievable child chunk plus its parent context window."""

    chunk_id: str
    content: str
    context: Optional[str] = None
    full_text: Optional[str] = None
    hypothetical_questions: List[str] = field(default_factory=list)
    doc_id: str = ""
    doc_title: str = ""
    source: str = ""
    category: Optional[KnowledgeCategory] = None
    chunk_index: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)
    retrieval_text: Optional[str] = None
    parent_chunk_id: Optional[str] = None
    parent_chunk_index: int = 0
    heading_path: str = ""


@dataclass
class _Section:
    """Logical document section resolved from headings or fallback rules."""

    title: str
    heading_path: List[str]
    content: str


@dataclass
class _ParentChunk:
    """Larger context window returned to reranker and final generation."""

    parent_chunk_id: str
    parent_chunk_index: int
    heading_path: str
    content: str


class ContextualChunker:
    """
    Build parent/child chunks so retrieval can match children but answer with parents.
    """

    HYPE_PROMPT = """Generate {num_questions} realistic user questions for this text.

<content>
{chunk_content}
</content>

Return one question per line, without numbering.
"""

    def __init__(
        self,
        chunk_size: int = 512,
        chunk_overlap: int = 50,
        use_contextual: bool = True,
        use_hype: bool = False,
        hype_questions_per_chunk: int = 3,
        parent_chunk_size: Optional[int] = None,
        parent_chunk_overlap: Optional[int] = None,
    ):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.use_contextual = use_contextual
        self.use_hype = use_hype
        self.hype_questions_per_chunk = hype_questions_per_chunk
        self.parent_chunk_size = parent_chunk_size or max(chunk_size * 3, chunk_size + 256)
        self.parent_chunk_overlap = parent_chunk_overlap or max(chunk_overlap * 2, 64)
        self.separators = ["\n\n", "\n", "\u3002", "\uff01", "\uff1f", ";", ".", ",", "\uff0c", " "]
        self._llm: Optional[ChatOpenAI] = None

    @property
    def llm(self) -> ChatOpenAI:
        if self._llm is None:
            self._llm = ChatOpenAI(
                api_key=settings.OPENAI_API_KEY,
                base_url=settings.OPENAI_API_BASE,
                model=settings.router_model_name,
                temperature=0.3,
                max_tokens=300,
            )
        return self._llm

    def chunk_document(self, document: Document) -> List[Chunk]:
        """Split one document into parent windows and child retrieval units."""

        sections = self._extract_sections(document)
        parent_chunks = self._build_parent_chunks(document, sections)

        chunks: List[Chunk] = []
        child_index = 0
        for parent_chunk in parent_chunks:
            child_texts = self._split_text(
                parent_chunk.content,
                max_size=self.chunk_size,
                overlap=self.chunk_overlap,
            )
            for child_text in child_texts:
                chunk = Chunk(
                    chunk_id=self._generate_child_chunk_id(parent_chunk.parent_chunk_id, child_index),
                    content=child_text,
                    context=self._build_context_summary(document, parent_chunk),
                    full_text=self._build_parent_payload(parent_chunk, child_text),
                    doc_id=document.doc_id,
                    doc_title=document.title or "",
                    source=document.source,
                    category=document.category,
                    chunk_index=child_index,
                    retrieval_text=self._build_retrieval_text(parent_chunk.heading_path, child_text),
                    parent_chunk_id=parent_chunk.parent_chunk_id,
                    parent_chunk_index=parent_chunk.parent_chunk_index,
                    heading_path=parent_chunk.heading_path,
                    metadata={
                        "doc_title": document.title,
                        "category": document.category.value if document.category else None,
                        "heading_path": parent_chunk.heading_path,
                        "parent_chunk_id": parent_chunk.parent_chunk_id,
                        "parent_chunk_index": parent_chunk.parent_chunk_index,
                    },
                )

                if self.use_hype:
                    chunk.hypothetical_questions = self._generate_hypothetical_questions(child_text)

                chunks.append(chunk)
                child_index += 1

        logger.info(
            "Chunked document '{}' into {} parent windows and {} child chunks",
            document.title,
            len(parent_chunks),
            len(chunks),
        )
        return chunks

    def _extract_sections(self, document: Document) -> List[_Section]:
        """Resolve heading-aware sections; fallback to one whole-document section."""

        lines = document.content.splitlines()
        heading_pattern = re.compile(r"^\s{0,3}(#{1,6})\s+(.*\S)\s*$")
        has_markdown_headings = any(heading_pattern.match(line) for line in lines)
        if not has_markdown_headings:
            title = (document.title or "").strip()
            heading_path = [title] if title else []
            return [_Section(title=title or "Document", heading_path=heading_path, content=document.content.strip())]

        sections: List[_Section] = []
        heading_stack: List[str] = []
        current_lines: List[str] = []
        current_path: List[str] = [document.title] if document.title else []

        def flush_current() -> None:
            content = "\n".join(current_lines).strip()
            if not content:
                return
            resolved_path = self._normalize_heading_path(document.title or "", current_path)
            title = resolved_path[-1] if resolved_path else (document.title or "Document")
            sections.append(_Section(title=title, heading_path=resolved_path, content=content))

        for line in lines:
            match = heading_pattern.match(line)
            if not match:
                current_lines.append(line)
                continue

            flush_current()
            current_lines = []
            level = len(match.group(1))
            title = match.group(2).strip()
            heading_stack = heading_stack[: level - 1]
            heading_stack.append(title)
            current_path = self._normalize_heading_path(document.title or "", heading_stack)

        flush_current()

        if not sections:
            title = (document.title or "").strip()
            heading_path = [title] if title else []
            return [_Section(title=title or "Document", heading_path=heading_path, content=document.content.strip())]
        return sections

    @staticmethod
    def _normalize_heading_path(document_title: str, parts: List[str]) -> List[str]:
        cleaned = [item.strip() for item in parts if item and item.strip()]
        if document_title and (not cleaned or cleaned[0] != document_title):
            return [document_title, *cleaned]
        return cleaned

    def _build_parent_chunks(self, document: Document, sections: List[_Section]) -> List[_ParentChunk]:
        parent_chunks: List[_ParentChunk] = []
        parent_index = 0

        for section in sections:
            parent_windows = self._split_text(
                section.content,
                max_size=self.parent_chunk_size,
                overlap=self.parent_chunk_overlap,
            )
            for window_text in parent_windows:
                heading_path = " > ".join(section.heading_path)
                parent_chunks.append(
                    _ParentChunk(
                        parent_chunk_id=self._generate_parent_chunk_id(document.doc_id, parent_index),
                        parent_chunk_index=parent_index,
                        heading_path=heading_path,
                        content=window_text,
                    )
                )
                parent_index += 1

        return parent_chunks

    def _build_context_summary(self, document: Document, parent_chunk: _ParentChunk) -> str:
        if not self.use_contextual:
            return ""

        labels = []
        if document.title:
            labels.append(f"Document: {document.title}")
        if parent_chunk.heading_path:
            labels.append(f"Section: {parent_chunk.heading_path}")
        labels.append(f"Parent Window: {parent_chunk.parent_chunk_index}")
        return " | ".join(labels)

    def _build_parent_payload(self, parent_chunk: _ParentChunk, child_text: str) -> str:
        if not self.use_contextual:
            return child_text

        parts = []
        if parent_chunk.heading_path:
            parts.append(f"[Section]\n{parent_chunk.heading_path}")
        parts.append(f"[Parent Context]\n{parent_chunk.content}")
        parts.append(f"[Focus Snippet]\n{child_text}")
        return "\n\n".join(parts)

    @staticmethod
    def _build_retrieval_text(heading_path: str, child_text: str) -> str:
        if heading_path:
            return f"{heading_path}\n{child_text}"
        return child_text

    def _split_text(
        self,
        text: str,
        *,
        max_size: int,
        overlap: int,
    ) -> List[str]:
        chunks: List[str] = []
        cleaned = (text or "").strip()
        if not cleaned:
            return chunks
        self._recursive_split(cleaned, chunks, 0, max_size=max_size, overlap=overlap)
        return [item.strip() for item in chunks if item and item.strip()]

    def _recursive_split(
        self,
        text: str,
        chunks: List[str],
        sep_index: int,
        *,
        max_size: int,
        overlap: int,
    ) -> None:
        if len(text) <= max_size:
            if text.strip():
                chunks.append(text.strip())
            return

        if sep_index >= len(self.separators):
            step = max(1, max_size - overlap)
            for index in range(0, len(text), step):
                chunk = text[index:index + max_size]
                if chunk.strip():
                    chunks.append(chunk.strip())
            return

        separator = self.separators[sep_index]
        parts = text.split(separator)
        current_chunk = ""

        for part in parts:
            piece = f"{part}{separator}" if separator != " " else f"{part} "

            if len(current_chunk) + len(piece) <= max_size:
                current_chunk += piece
                continue

            if current_chunk.strip():
                if len(current_chunk) > max_size:
                    self._recursive_split(
                        current_chunk,
                        chunks,
                        sep_index + 1,
                        max_size=max_size,
                        overlap=overlap,
                    )
                else:
                    chunks.append(current_chunk.strip())

            if len(piece) > max_size:
                self._recursive_split(
                    piece,
                    chunks,
                    sep_index + 1,
                    max_size=max_size,
                    overlap=overlap,
                )
                current_chunk = ""
            else:
                current_chunk = piece

        if current_chunk.strip():
            if len(current_chunk) > max_size:
                self._recursive_split(
                    current_chunk,
                    chunks,
                    sep_index + 1,
                    max_size=max_size,
                    overlap=overlap,
                )
            else:
                chunks.append(current_chunk.strip())

    def _generate_hypothetical_questions(self, chunk_content: str) -> List[str]:
        """Keep HyPE optional, but only for one child chunk at a time."""

        try:
            prompt = ChatPromptTemplate.from_template(self.HYPE_PROMPT)
            chain = prompt | self.llm
            response = chain.invoke(
                {
                    "chunk_content": chunk_content,
                    "num_questions": self.hype_questions_per_chunk,
                }
            )
            questions = []
            for line in response.content.strip().splitlines():
                cleaned = re.sub(r"^\d+[\.\)\-\s]*", "", line.strip())
                if cleaned and len(cleaned) > 5:
                    questions.append(cleaned)
            return questions[: self.hype_questions_per_chunk]
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"Failed to generate hypothetical questions: {exc}")
            return []

    @staticmethod
    def _generate_parent_chunk_id(doc_id: str, parent_index: int) -> str:
        raw = f"{doc_id}:parent:{parent_index}"
        return f"p{hashlib.md5(raw.encode()).hexdigest()[:16]}"

    @staticmethod
    def _generate_child_chunk_id(parent_chunk_id: str, child_index: int) -> str:
        return f"{parent_chunk_id}-c{child_index:04d}"


def create_contextual_chunker() -> ContextualChunker:
    """Create a chunker from runtime config."""

    return ContextualChunker(
        chunk_size=rag_config.chunking["chunk_size"],
        chunk_overlap=rag_config.chunking["chunk_overlap"],
        use_contextual=rag_config.features["contextual"],
        use_hype=rag_config.hype["enabled"],
        hype_questions_per_chunk=rag_config.hype["questions_per_chunk"],
    )
