"""Document graph extraction and registry persistence."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from src.rag.contextual_chunker import Chunk, create_contextual_chunker
from src.rag.document_processor import Document
from src.utils import logger

from .schema import EdgeType, NodeType


@dataclass
class DocumentGraphSnapshot:
    """One persisted document subgraph."""

    doc_id: str
    title: str
    nodes: List[dict]
    edges: List[dict]
    updated_at: str


class RuleBasedDocumentGraphExtractor:
    """Extract a lightweight, deletable document subgraph from one document."""

    CHINESE_STOPWORDS = {
        "我们", "你们", "他们", "以及", "或者", "如果", "其中", "这个", "那个", "一种", "一个",
        "可以", "需要", "进行", "通过", "根据", "由于", "相关", "内容", "文档", "章节", "说明",
        "要求", "数据", "系统", "方法", "问题", "结果", "分析", "处理", "使用", "管道", "知识库",
    }

    ENGLISH_STOPWORDS = {
        "the", "and", "for", "with", "from", "into", "that", "this", "are", "was",
        "were", "can", "will", "shall", "must", "should", "use", "using", "used",
        "api", "json", "http", "https", "www", "com",
    }

    def __init__(self) -> None:
        self.chunker = create_contextual_chunker()

    def extract(self, document: Document) -> DocumentGraphSnapshot:
        chunks = self.chunker.chunk_document(document)
        now = datetime.utcnow().isoformat()

        doc_node_id = self._document_node_id(document.doc_id)
        nodes: Dict[str, dict] = {
            doc_node_id: self._build_document_node(document, doc_node_id),
        }
        edges: Dict[tuple[str, str, str, str], dict] = {}
        parent_seen: Dict[str, dict] = {}

        for chunk in chunks:
            parent_lookup_key = chunk.parent_chunk_id or self._fallback_parent_id(document.doc_id, chunk)
            parent_node = parent_seen.get(parent_lookup_key)
            if parent_node is None:
                parent_node = self._build_parent_node(document, chunk)
                parent_seen[parent_lookup_key] = parent_node
                nodes[parent_node["id"]] = parent_node
                self._put_edge(
                    edges,
                    {
                        "source_id": doc_node_id,
                        "target_id": parent_node["id"],
                        "type": EdgeType.CONTAINS.value,
                        "weight": 1.0,
                        "properties": {
                            "namespace": "document",
                            "source_doc_id": document.doc_id,
                            "source_chunk_id": chunk.parent_chunk_id or "",
                            "heading_path": chunk.heading_path,
                        },
                    },
                )

            entity_terms = self._extract_terms(chunk)
            entity_node_ids: List[str] = []

            for term in entity_terms:
                entity_node = self._build_entity_node(document, term)
                nodes[entity_node["id"]] = entity_node
                entity_node_ids.append(entity_node["id"])
                self._put_edge(
                    edges,
                    {
                        "source_id": parent_node["id"],
                        "target_id": entity_node["id"],
                        "type": EdgeType.REFERENCES.value,
                        "weight": 1.0,
                        "properties": {
                            "namespace": "document",
                            "source_doc_id": document.doc_id,
                            "source_chunk_id": chunk.chunk_id,
                            "heading_path": chunk.heading_path,
                        },
                    },
                )

            for left_index, source_entity_id in enumerate(entity_node_ids):
                for target_entity_id in entity_node_ids[left_index + 1 :]:
                    self._put_edge(
                        edges,
                        {
                            "source_id": source_entity_id,
                            "target_id": target_entity_id,
                            "type": EdgeType.REFERENCES.value,
                            "weight": 0.6,
                            "properties": {
                                "namespace": "document",
                                "source_doc_id": document.doc_id,
                                "source_chunk_id": chunk.chunk_id,
                                "relation": "cooccurs",
                            },
                        },
                    )

        ordered_parent_ids = sorted(
            [node_id for node_id, node in nodes.items() if node.get("type") == NodeType.SECTION.value],
            key=lambda item: int(nodes[item].get("properties", {}).get("parent_chunk_index", 0) or 0),
        )
        for index, source_parent_id in enumerate(ordered_parent_ids[:-1]):
            target_parent_id = ordered_parent_ids[index + 1]
            self._put_edge(
                edges,
                {
                    "source_id": source_parent_id,
                    "target_id": target_parent_id,
                    "type": EdgeType.REFERENCES.value,
                    "weight": 0.8,
                    "properties": {
                        "namespace": "document",
                        "source_doc_id": document.doc_id,
                        "relation": "sequential_section",
                    },
                },
            )

        return DocumentGraphSnapshot(
            doc_id=document.doc_id,
            title=document.title or document.doc_id,
            nodes=list(nodes.values()),
            edges=list(edges.values()),
            updated_at=now,
        )

    def _build_document_node(self, document: Document, node_id: str) -> dict:
        return {
            "id": node_id,
            "type": NodeType.DOCUMENT.value,
            "name": document.title or document.doc_id,
            "description": str(document.metadata.get("summary") or "")[:500],
            "properties": {
                "namespace": "document",
                "source_doc_id": document.doc_id,
                "source": document.source,
                "category": document.category.value if document.category else "",
                "tags": document.metadata.get("tags", []),
                "language": document.metadata.get("language"),
            },
        }

    def _build_parent_node(self, document: Document, chunk: Chunk) -> dict:
        parent_id = self._parent_node_id(chunk.parent_chunk_id or self._fallback_parent_id(document.doc_id, chunk))
        section_name = chunk.heading_path.split(" > ")[-1].strip() if chunk.heading_path else (document.title or "Section")
        return {
            "id": parent_id,
            "type": NodeType.SECTION.value,
            "name": section_name,
            "description": self._extract_parent_context(chunk)[:800],
            "properties": {
                "namespace": "document",
                "source_doc_id": document.doc_id,
                "source_chunk_id": chunk.parent_chunk_id or "",
                "heading_path": chunk.heading_path,
                "parent_chunk_index": chunk.parent_chunk_index,
            },
        }

    def _build_entity_node(self, document: Document, term: str) -> dict:
        normalized_term = self._normalize_term(term)
        node_id = self._entity_node_id(normalized_term)
        return {
            "id": node_id,
            "type": NodeType.CONCEPT.value,
            "name": normalized_term,
            "description": "",
            "properties": {
                "namespace": "document",
                "normalized_name": normalized_term.casefold(),
            },
        }

    def _extract_terms(self, chunk: Chunk) -> List[str]:
        heading_terms = [part.strip() for part in chunk.heading_path.split(" > ") if part.strip()]
        text = "\n".join([chunk.content or "", chunk.heading_path or ""])

        candidates: List[str] = []
        candidates.extend(heading_terms)
        candidates.extend(self._extract_markdown_link_terms(text))
        candidates.extend(self._extract_chinese_terms(text))
        candidates.extend(self._extract_english_terms(text))

        deduped: List[str] = []
        seen = set()
        for candidate in candidates:
            normalized = self._normalize_term(candidate)
            if not normalized:
                continue
            key = normalized.casefold()
            if key in seen:
                continue
            seen.add(key)
            deduped.append(normalized)
            if len(deduped) >= 10:
                break
        return deduped

    @staticmethod
    def _extract_markdown_link_terms(text: str) -> List[str]:
        terms = []
        for pattern in [r"\[\[([^\]]+)\]\]", r"\[([^\]]+)\]\([^)]+\)"]:
            terms.extend(match.strip() for match in re.findall(pattern, text or "") if match.strip())
        return terms

    def _extract_chinese_terms(self, text: str) -> List[str]:
        matches = re.findall(r"[\u4e00-\u9fff]{2,12}", text or "")
        terms: List[str] = []
        for item in matches:
            normalized = item.strip()
            if normalized in self.CHINESE_STOPWORDS:
                continue
            if normalized.endswith(("进行", "处理", "说明", "相关")):
                continue
            terms.append(normalized)
        return terms

    def _extract_english_terms(self, text: str) -> List[str]:
        matches = re.findall(r"[A-Za-z][A-Za-z0-9_\-\/]{2,40}", text or "")
        terms: List[str] = []
        for item in matches:
            lowered = item.lower()
            if lowered in self.ENGLISH_STOPWORDS:
                continue
            if lowered.isdigit():
                continue
            terms.append(item)
        return terms

    @staticmethod
    def _normalize_term(term: str) -> str:
        cleaned = re.sub(r"\s+", " ", str(term or "").strip())
        cleaned = cleaned.strip("[](){}<>.,;:!?'\"")
        if len(cleaned) < 2:
            return ""
        return cleaned[:80]

    @staticmethod
    def _put_edge(store: Dict[tuple[str, str, str, str], dict], edge: dict) -> None:
        relation = str(edge.get("properties", {}).get("relation", ""))
        key = (
            str(edge.get("source_id", "")),
            str(edge.get("target_id", "")),
            str(edge.get("type", "")),
            relation,
        )
        if key not in store:
            store[key] = edge

    @staticmethod
    def _extract_parent_context(chunk: Chunk) -> str:
        full_text = chunk.full_text or ""
        if "[Parent Context]" in full_text:
            return full_text.split("[Parent Context]", 1)[1].split("[Focus Snippet]", 1)[0].strip()
        return chunk.content or ""

    @staticmethod
    def _document_node_id(doc_id: str) -> str:
        return f"doc::{doc_id}"

    @staticmethod
    def _parent_node_id(parent_chunk_id: str) -> str:
        return f"sec::{parent_chunk_id}"

    @staticmethod
    def _entity_node_id(term: str) -> str:
        digest = hashlib.md5(term.casefold().encode()).hexdigest()[:20]
        return f"ent::{digest}"

    @staticmethod
    def _fallback_parent_id(doc_id: str, chunk: Chunk) -> str:
        return hashlib.md5(f"{doc_id}:{chunk.chunk_index}".encode()).hexdigest()[:16]


class DocumentGraphRegistry:
    """Persist document subgraphs in the knowledge-base registry directory."""

    REGISTRY_DIR_NAME = ".registry"
    FILE_NAME = "document_graph.json"

    def __init__(self, root_path: str = "knowledge_base") -> None:
        self.root_path = Path(root_path)
        self.registry_dir = self.root_path / self.REGISTRY_DIR_NAME
        self.store_path = self.registry_dir / self.FILE_NAME
        self.extractor = RuleBasedDocumentGraphExtractor()

    def upsert_document(self, document: Document) -> dict[str, Any]:
        self._ensure_store()
        store = self._load_store()
        snapshot = self.extractor.extract(document)
        store.setdefault("documents", {})[document.doc_id] = {
            "doc_id": snapshot.doc_id,
            "title": snapshot.title,
            "nodes": snapshot.nodes,
            "edges": snapshot.edges,
            "updated_at": snapshot.updated_at,
        }
        self._save_store(store)
        logger.info(
            "Document graph updated: doc_id={}, nodes={}, edges={}",
            document.doc_id,
            len(snapshot.nodes),
            len(snapshot.edges),
        )
        return store["documents"][document.doc_id]

    def remove_document(self, doc_id: str) -> bool:
        self._ensure_store()
        store = self._load_store()
        removed = store.setdefault("documents", {}).pop(doc_id, None) is not None
        if removed:
            self._save_store(store)
            logger.info("Document graph removed: doc_id={}", doc_id)
        return removed

    def rebuild_from_documents(self, documents: List[Document]) -> dict[str, Any]:
        self._ensure_store()
        next_documents: Dict[str, Any] = {}
        for document in documents:
            snapshot = self.extractor.extract(document)
            next_documents[document.doc_id] = {
                "doc_id": snapshot.doc_id,
                "title": snapshot.title,
                "nodes": snapshot.nodes,
                "edges": snapshot.edges,
                "updated_at": snapshot.updated_at,
            }
        store = {
            "documents": next_documents,
            "updated_at": datetime.utcnow().isoformat(),
        }
        self._save_store(store)
        logger.info("Document graph rebuilt: documents={}", len(next_documents))
        return store

    def path(self) -> str:
        self._ensure_store()
        return str(self.store_path)

    def _ensure_store(self) -> None:
        self.root_path.mkdir(parents=True, exist_ok=True)
        self.registry_dir.mkdir(parents=True, exist_ok=True)
        if not self.store_path.exists():
            self._save_store({"documents": {}, "updated_at": datetime.utcnow().isoformat()})

    def _load_store(self) -> dict[str, Any]:
        self._ensure_store()
        try:
            return json.loads(self.store_path.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            logger.warning("Document graph registry read failed: {}", exc)
            return {"documents": {}, "updated_at": datetime.utcnow().isoformat()}

    def _save_store(self, store: dict[str, Any]) -> None:
        payload = dict(store)
        payload["updated_at"] = datetime.utcnow().isoformat()
        self.store_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


def create_document_graph_registry(root_path: str = "knowledge_base") -> DocumentGraphRegistry:
    """Factory for a document graph registry."""

    return DocumentGraphRegistry(root_path=root_path)
