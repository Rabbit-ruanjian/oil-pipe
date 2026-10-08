"""Knowledge base registry service for stage-1 ingestion workflows."""

from __future__ import annotations

import json
import re
import socket
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from src.config import get_settings
from src.knowledge_graph import create_document_graph_registry, get_knowledge_graph_builder
from src.models import (
    KnowledgeDocumentMetadata,
    KnowledgeDocumentStatus,
    KnowledgeFileType,
    KnowledgeSourceType,
    build_stage0_baseline,
)
from src.models.enums import KnowledgeCategory
from src.utils import logger

from .document_processor import DocumentProcessor
from .pipeline import get_rag_pipeline


class KnowledgeBaseRegistry:
    """Manage stage-1 knowledge documents, metadata, and file registry."""

    REGISTRY_DIR_NAME = ".registry"
    REGISTRY_FILE_NAME = "documents.json"
    SPARSE_STATE_FILE_NAME = "sparse_state.json"

    def __init__(self, root_path: str = "knowledge_base") -> None:
        self.root_path = Path(root_path)
        self.registry_dir = self.root_path / self.REGISTRY_DIR_NAME
        self.registry_path = self.registry_dir / self.REGISTRY_FILE_NAME
        self._sparse_refresh_lock = threading.Lock()
        self._sparse_refresh_thread: Optional[threading.Thread] = None
        self._sparse_refresh_pending = False

    def get_baseline(self) -> dict[str, Any]:
        """Return the resolved stage-0 baseline as JSON-serializable data."""

        return build_stage0_baseline().model_dump(mode="json")

    def sync_registry(self) -> dict[str, Any]:
        """Sync registry entries with on-disk documents."""

        self._ensure_store()
        registry = self._load_registry()
        documents = registry.setdefault("documents", {})
        processor = DocumentProcessor(str(self.root_path))
        seen_doc_ids: set[str] = set()

        for file_path in self._iter_document_files():
            document = processor.load_document(str(file_path))
            if document is None:
                continue

            sidecar = self._load_sidecar_payload(file_path)
            metadata = self._metadata_from_sidecar_or_document(sidecar, document)
            doc_id = document.doc_id
            seen_doc_ids.add(doc_id)

            existing = documents.get(doc_id, {})
            created_at = existing.get("created_at") or self._iso_now()
            existing_status = str(existing.get("status") or "").strip()
            status = (
                existing_status
                if existing_status in KnowledgeDocumentStatus._value2member_map_
                else KnowledgeDocumentStatus.UPLOADED.value
            )
            ingest_stage = str(existing.get("ingest_stage") or "").strip()
            if not ingest_stage:
                ingest_stage = (
                    "DONE"
                    if status == KnowledgeDocumentStatus.INDEXED.value
                    else "FAILED"
                    if status == KnowledgeDocumentStatus.FAILED.value
                    else "QUEUED"
                )
            progress_percent = int(existing.get("progress_percent", 0) or 0)
            if progress_percent <= 0 and ingest_stage == "DONE":
                progress_percent = 100

            next_item = {
                "doc_id": doc_id,
                "title": metadata.title,
                "source": metadata.source,
                "category": metadata.category.value,
                "tags": metadata.tags,
                "author": metadata.author,
                "summary": metadata.summary,
                "language": metadata.language,
                "version": metadata.version,
                "external_id": metadata.external_id,
                "effective_at": metadata.effective_at.isoformat() if metadata.effective_at else None,
                "file_name": file_path.name,
                "relative_path": self._relative_path(file_path),
                "file_type": file_path.suffix.lower().lstrip("."),
                "file_size_bytes": file_path.stat().st_size,
                "source_type": sidecar.get("source_type", KnowledgeSourceType.LOCAL_FILE.value),
                "status": status,
                "chunk_count": int(existing.get("chunk_count", 0) or 0),
                "ingest_stage": ingest_stage,
                "progress_percent": progress_percent,
                "created_at": created_at,
            }
            existing_comparable = {key: value for key, value in existing.items() if key != "updated_at"}
            next_comparable = {key: value for key, value in next_item.items() if key != "updated_at"}
            next_item["updated_at"] = (
                existing.get("updated_at") or created_at
                if existing_comparable == next_comparable
                else self._iso_now()
            )
            documents[doc_id] = next_item

        stale_doc_ids = [doc_id for doc_id, item in documents.items() if doc_id not in seen_doc_ids and not self._resolve_path(item.get("relative_path", "")).exists()]
        stale_cleanup_performed = False
        for doc_id in stale_doc_ids:
            try:
                get_rag_pipeline().delete_document(doc_id)
                create_document_graph_registry(str(self.root_path)).remove_document(doc_id)
                stale_cleanup_performed = True
            except Exception as exc:  # noqa: BLE001
                logger.warning(f"Knowledge registry stale vector cleanup warning for {doc_id}: {exc}")
            documents.pop(doc_id, None)

        if stale_cleanup_performed:
            try:
                get_rag_pipeline().refresh_sparse_index(str(self.root_path))
                self._reload_knowledge_graph()
                self._bump_sparse_revision("sync:stale_cleanup")
            except Exception as exc:  # noqa: BLE001
                logger.warning(f"Knowledge registry sparse refresh warning after stale cleanup: {exc}")

        self._save_registry(registry)
        return registry

    def list_documents(
        self,
        *,
        category: Optional[str] = None,
        status: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """List registered documents, optionally filtered by category and status."""

        registry = self.sync_registry()
        items = list(registry.get("documents", {}).values())
        if category:
            items = [item for item in items if str(item.get("category")) == category]
        if status:
            items = [item for item in items if str(item.get("status")) == status]
        items.sort(key=lambda item: str(item.get("updated_at", "")), reverse=True)
        return items

    def save_upload(
        self,
        *,
        file_name: str,
        file_bytes: bytes,
        metadata: KnowledgeDocumentMetadata,
    ) -> dict[str, Any]:
        """Save one uploaded file, write metadata sidecar, and index it."""

        settings = get_settings()
        suffix = Path(file_name).suffix.lower().lstrip(".")
        if suffix not in settings.kb_allowed_extensions:
            raise ValueError(f"Unsupported file extension: .{suffix}")

        max_size_bytes = settings.KB_MAX_FILE_SIZE_MB * 1024 * 1024
        if len(file_bytes) > max_size_bytes:
            raise ValueError(f"File exceeds max size limit: {settings.KB_MAX_FILE_SIZE_MB} MB")

        target_dir = self.root_path / metadata.category.value
        target_dir.mkdir(parents=True, exist_ok=True)

        safe_stem = self._safe_stem(Path(file_name).stem or metadata.title)
        stored_name = f"{safe_stem}-{datetime.now().strftime('%Y%m%d%H%M%S%f')}.{suffix}"
        target_path = target_dir / stored_name
        target_path.write_bytes(file_bytes)

        sidecar_payload = {
            "metadata": metadata.model_dump(mode="json"),
            "source_type": KnowledgeSourceType.UPLOAD.value,
        }
        self._write_sidecar_payload(target_path, sidecar_payload)

        processor = DocumentProcessor(str(self.root_path))
        try:
            document = processor.load_document(str(target_path))
            if document is None:
                raise ValueError("Failed to parse uploaded document")
        except Exception:
            self._cleanup_uploaded_files(target_path)
            raise

        indexed = False
        chunk_count = 0
        ingest_stage = "QUEUED"
        progress_percent = 0
        pipeline = get_rag_pipeline()
        document_graph_registry = create_document_graph_registry(str(self.root_path))
        try:
            indexing_report = pipeline.add_document_report(str(target_path))
            indexed = bool(indexing_report.success)
            chunk_count = int(indexing_report.chunk_count or 0)
            ingest_stage = str(indexing_report.ingest_stage or "QUEUED")
            progress_percent = int(indexing_report.progress_percent or 0)
            if indexed:
                document_graph_registry.upsert_document(document)
                self._reload_knowledge_graph()
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"Knowledge upload indexed with warning: {exc}")
            if indexed:
                try:
                    document_graph_registry.remove_document(document.doc_id)
                    pipeline.delete_document(document.doc_id)
                    pipeline.refresh_sparse_index(str(self.root_path))
                    self._reload_knowledge_graph()
                    self._bump_sparse_revision(f"rollback:index:{document.doc_id}")
                except Exception as rollback_exc:  # noqa: BLE001
                    logger.error(f"Knowledge upload rollback failed for {document.doc_id}: {rollback_exc}")
            indexed = False
            ingest_stage = "FAILED"
        try:
            registry = self._load_registry()
            documents = registry.setdefault("documents", {})
            now = self._iso_now()
            documents[document.doc_id] = {
                "doc_id": document.doc_id,
                "title": metadata.title,
                "source": metadata.source,
                "category": metadata.category.value,
                "tags": metadata.tags,
                "author": metadata.author,
                "summary": metadata.summary,
                "language": metadata.language,
                "version": metadata.version,
                "external_id": metadata.external_id,
                "effective_at": metadata.effective_at.isoformat() if metadata.effective_at else None,
                "file_name": target_path.name,
                "relative_path": self._relative_path(target_path),
                "file_type": suffix,
                "file_size_bytes": len(file_bytes),
                "source_type": KnowledgeSourceType.UPLOAD.value,
                "status": (
                    KnowledgeDocumentStatus.INDEXED.value
                    if indexed
                    else KnowledgeDocumentStatus.FAILED.value
                ),
                "chunk_count": chunk_count,
                "ingest_stage": ingest_stage,
                "progress_percent": progress_percent,
                "created_at": now,
                "updated_at": now,
            }
            self._save_registry(registry)
            if indexed:
                self._bump_sparse_revision(f"upload:{target_path.name}")
            return documents[document.doc_id]
        except Exception:
            if indexed:
                try:
                    document_graph_registry.remove_document(document.doc_id)
                    pipeline.delete_document(document.doc_id)
                    pipeline.refresh_sparse_index(str(self.root_path))
                    self._reload_knowledge_graph()
                    self._bump_sparse_revision(f"rollback:registry:{document.doc_id}")
                except Exception as rollback_exc:  # noqa: BLE001
                    logger.error(f"Knowledge registry persistence rollback failed for {document.doc_id}: {rollback_exc}")
            self._cleanup_uploaded_files(target_path)
            raise

    def delete_document(self, doc_id: str) -> dict[str, Any]:
        """Delete one document from registry, disk, and vector index."""

        registry = self.sync_registry()
        documents = registry.setdefault("documents", {})
        item = documents.get(doc_id)
        if item is None:
            raise FileNotFoundError(f"Unknown document id: {doc_id}")

        target_path = self._resolve_path(item.get("relative_path", ""))
        sidecar_path = self._sidecar_path(target_path)
        trash_paths = self._move_document_to_trash(doc_id=doc_id, file_path=target_path, sidecar_path=sidecar_path)

        vector_deleted = False
        graph_deleted = False
        document_graph_registry = create_document_graph_registry(str(self.root_path))
        try:
            vector_deleted = bool(get_rag_pipeline().delete_document(doc_id))
            if not vector_deleted:
                raise RuntimeError(f"Vector delete returned false for document: {doc_id}")
            graph_deleted = document_graph_registry.remove_document(doc_id)
            get_rag_pipeline().refresh_sparse_index(str(self.root_path))
            self._reload_knowledge_graph()
            self._bump_sparse_revision(f"delete:{doc_id}")
        except Exception as exc:  # noqa: BLE001
            self._restore_document_from_trash(trash_paths, target_path, sidecar_path)
            if vector_deleted:
                try:
                    get_rag_pipeline().add_document(str(target_path))
                except Exception as rollback_exc:  # noqa: BLE001
                    logger.error(f"Knowledge delete rollback failed for {doc_id}: {rollback_exc}")
            if graph_deleted:
                try:
                    restored_document = DocumentProcessor(str(self.root_path)).load_document(str(target_path))
                    if restored_document is not None:
                        document_graph_registry.upsert_document(restored_document)
                        self._reload_knowledge_graph()
                except Exception as rollback_exc:  # noqa: BLE001
                    logger.error(f"Knowledge graph rollback failed for {doc_id}: {rollback_exc}")
            raise RuntimeError(f"Delete aborted because index cleanup failed: {exc}") from exc

        documents.pop(doc_id, None)
        self._save_registry(registry)
        self._purge_trash_paths(trash_paths)
        return {
            "doc_id": doc_id,
            "file_deleted": True,
            "index_deleted": True,
        }

    def rebuild_index(self, *, recreate: bool = True) -> dict[str, Any]:
        """Rebuild vector index from current filesystem documents."""

        report = get_rag_pipeline().index_documents_report(
            knowledge_base_path=str(self.root_path),
            recreate=recreate,
        )
        documents = DocumentProcessor(str(self.root_path)).load_all_documents()
        create_document_graph_registry(str(self.root_path)).rebuild_from_documents(documents)
        self._reload_knowledge_graph()
        indexed_doc_ids = set(report.document_ids)
        registry = self.sync_registry()
        for item in registry.get("documents", {}).values():
            doc_id = str(item.get("doc_id") or "")
            indexed = doc_id in indexed_doc_ids
            item["status"] = (
                KnowledgeDocumentStatus.INDEXED.value
                if indexed
                else KnowledgeDocumentStatus.FAILED.value
            )
            item["ingest_stage"] = "DONE" if indexed else "FAILED"
            item["progress_percent"] = 100 if indexed else 0
            item["chunk_count"] = int(report.document_chunk_counts.get(doc_id, 0) if indexed else 0)
            item["updated_at"] = self._iso_now()
        self._save_registry(registry)
        self._bump_sparse_revision(f"reindex:{'recreate' if recreate else 'reuse'}")
        return {
            "documents_indexed": report.documents_indexed,
            "registry_total": len(registry.get("documents", {})),
            "recreate": recreate,
        }

    def _reload_knowledge_graph(self) -> None:
        """Reload static graph data plus persisted document graph snapshots."""

        document_graph_registry = create_document_graph_registry(str(self.root_path))
        get_knowledge_graph_builder().reload_all(
            document_graph_path=document_graph_registry.path(),
        )

    def get_document(self, doc_id: str) -> Optional[dict[str, Any]]:
        """Get one document from registry."""

        registry = self.sync_registry()
        return registry.get("documents", {}).get(doc_id)

    def get_stats(self) -> dict[str, Any]:
        """Get stage-1 ingestion stats plus vector store stats."""

        items = self.list_documents()
        settings = get_settings()
        vector_stats: dict[str, Any]
        if self._is_tcp_endpoint_reachable(settings.MILVUS_HOST, settings.MILVUS_PORT, timeout_seconds=0.5):
            try:
                vector_stats = get_rag_pipeline().get_stats()
            except Exception as exc:  # noqa: BLE001
                logger.warning(f"Knowledge registry vector stats unavailable: {exc}")
                vector_stats = {
                    "name": settings.MILVUS_COLLECTION,
                    "num_entities": 0,
                    "exists": False,
                    "error": str(exc),
                }
        else:
            vector_stats = {
                "name": settings.MILVUS_COLLECTION,
                "num_entities": 0,
                "exists": False,
                "error": f"Milvus unavailable at {settings.MILVUS_HOST}:{settings.MILVUS_PORT}",
            }
        by_category: dict[str, int] = {}
        for item in items:
            category = str(item.get("category", "unknown"))
            by_category[category] = by_category.get(category, 0) + 1

        return {
            "total_documents": len(items),
            "documents_by_category": by_category,
            "collection_name": vector_stats.get("name", "unknown"),
            "total_chunks": vector_stats.get("num_entities", 0),
            "index_exists": vector_stats.get("exists", False),
            "knowledge_root": str(self.root_path),
        }

    def _iter_document_files(self) -> list[Path]:
        self.root_path.mkdir(parents=True, exist_ok=True)
        settings = get_settings()
        allowed = {f".{ext}" for ext in settings.kb_allowed_extensions}
        files: list[Path] = []
        for file_path in self.root_path.rglob("*"):
            if not file_path.is_file():
                continue
            if self.REGISTRY_DIR_NAME in file_path.parts:
                continue
            if file_path.name.endswith(".meta.json"):
                continue
            if file_path.suffix.lower() not in allowed:
                continue
            files.append(file_path)
        return files

    def _ensure_store(self) -> None:
        self.root_path.mkdir(parents=True, exist_ok=True)
        self.registry_dir.mkdir(parents=True, exist_ok=True)
        if not self.registry_path.exists():
            self.registry_path.write_text(
                json.dumps({"documents": {}}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        sparse_state_path = self._sparse_state_path()
        if not sparse_state_path.exists():
            sparse_state_path.write_text(
                json.dumps({"revision": "", "updated_at": ""}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

    def _load_registry(self) -> dict[str, Any]:
        self._ensure_store()
        try:
            return json.loads(self.registry_path.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"Knowledge registry load failed, reset registry: {exc}")
            return {"documents": {}}

    def _save_registry(self, registry: dict[str, Any]) -> None:
        self._ensure_store()
        self.registry_path.write_text(
            json.dumps(registry, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    @staticmethod
    def _iso_now() -> str:
        return datetime.now().isoformat(timespec="seconds")

    def _relative_path(self, file_path: Path) -> str:
        return str(file_path.relative_to(self.root_path))

    def _resolve_path(self, relative_path: str) -> Path:
        return self.root_path / relative_path

    @staticmethod
    def _safe_stem(raw: str) -> str:
        normalized = re.sub(r"[^\w\-]+", "-", raw.strip(), flags=re.UNICODE)
        normalized = normalized.strip("-_")
        return normalized or "document"

    def _sidecar_path(self, file_path: Path) -> Path:
        return file_path.with_name(f"{file_path.name}.meta.json")

    def _sparse_state_path(self) -> Path:
        return self.registry_dir / self.SPARSE_STATE_FILE_NAME

    def _bump_sparse_revision(self, reason: str) -> str:
        self._ensure_store()
        revision = datetime.now().isoformat(timespec="microseconds")
        self._sparse_state_path().write_text(
            json.dumps(
                {
                    "revision": revision,
                    "updated_at": revision,
                    "reason": reason,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        return revision

    def _schedule_sparse_refresh(self, *, reason: str) -> None:
        with self._sparse_refresh_lock:
            if self._sparse_refresh_thread and self._sparse_refresh_thread.is_alive():
                self._sparse_refresh_pending = True
                logger.info(f"Knowledge sparse refresh already running, merged request: {reason}")
                return

            self._sparse_refresh_pending = False
            thread = threading.Thread(
                target=self._run_sparse_refresh_loop,
                name="knowledge-sparse-refresh",
                daemon=True,
            )
            self._sparse_refresh_thread = thread
            thread.start()
            logger.info(f"Knowledge sparse refresh scheduled: {reason}")

    def _run_sparse_refresh_loop(self) -> None:
        while True:
            try:
                refreshed = get_rag_pipeline().refresh_sparse_index(str(self.root_path))
                logger.info(f"Knowledge sparse refresh completed: documents={refreshed}")
            except Exception as exc:  # noqa: BLE001
                logger.warning(f"Knowledge sparse refresh failed: {exc}")

            with self._sparse_refresh_lock:
                if self._sparse_refresh_pending:
                    self._sparse_refresh_pending = False
                    continue
                self._sparse_refresh_thread = None
                break

    @staticmethod
    def _is_tcp_endpoint_reachable(host: str, port: int, *, timeout_seconds: float) -> bool:
        try:
            with socket.create_connection((host, int(port)), timeout=timeout_seconds):
                return True
        except OSError:
            return False

    def _trash_dir(self) -> Path:
        trash_dir = self.registry_dir / ".trash"
        trash_dir.mkdir(parents=True, exist_ok=True)
        return trash_dir

    def _move_document_to_trash(self, *, doc_id: str, file_path: Path, sidecar_path: Path) -> dict[str, Path]:
        trash_dir = self._trash_dir() / doc_id
        trash_dir.mkdir(parents=True, exist_ok=True)
        trashed_file = trash_dir / file_path.name
        trashed_sidecar = trash_dir / sidecar_path.name

        file_moved = False
        sidecar_moved = False
        try:
            if file_path.exists():
                file_path.replace(trashed_file)
                file_moved = True
            if sidecar_path.exists():
                sidecar_path.replace(trashed_sidecar)
                sidecar_moved = True
        except Exception:
            self._restore_document_from_trash(
                {
                    "file": trashed_file,
                    "sidecar": trashed_sidecar,
                    "dir": trash_dir,
                    "file_moved": file_moved,
                    "sidecar_moved": sidecar_moved,
                },
                file_path,
                sidecar_path,
            )
            raise

        return {
            "file": trashed_file,
            "sidecar": trashed_sidecar,
            "dir": trash_dir,
            "file_moved": file_moved,
            "sidecar_moved": sidecar_moved,
        }

    def _restore_document_from_trash(self, trash_paths: dict[str, Path | bool], file_path: Path, sidecar_path: Path) -> None:
        if bool(trash_paths.get("file_moved")) and isinstance(trash_paths.get("file"), Path):
            trashed_file = trash_paths["file"]
            file_path.parent.mkdir(parents=True, exist_ok=True)
            if trashed_file.exists():
                trashed_file.replace(file_path)
        if bool(trash_paths.get("sidecar_moved")) and isinstance(trash_paths.get("sidecar"), Path):
            trashed_sidecar = trash_paths["sidecar"]
            sidecar_path.parent.mkdir(parents=True, exist_ok=True)
            if trashed_sidecar.exists():
                trashed_sidecar.replace(sidecar_path)
        trash_dir = trash_paths.get("dir")
        if isinstance(trash_dir, Path):
            self._safe_rmdir(trash_dir)

    def _purge_trash_paths(self, trash_paths: dict[str, Path | bool]) -> None:
        for key in ("file", "sidecar"):
            path = trash_paths.get(key)
            if isinstance(path, Path):
                self._safe_unlink(path)
        trash_dir = trash_paths.get("dir")
        if isinstance(trash_dir, Path):
            self._safe_rmdir(trash_dir)

    def _cleanup_uploaded_files(self, file_path: Path) -> None:
        """Best-effort cleanup for a failed upload before registry persistence."""

        self._safe_unlink(file_path)
        self._safe_unlink(self._sidecar_path(file_path))

    @staticmethod
    def _safe_unlink(path: Path) -> None:
        try:
            if path.exists():
                path.unlink()
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"Knowledge upload cleanup warning for {path}: {exc}")

    @staticmethod
    def _safe_rmdir(path: Path) -> None:
        try:
            if path.exists():
                path.rmdir()
        except Exception:
            return

    def _write_sidecar_payload(self, file_path: Path, payload: dict[str, Any]) -> None:
        self._sidecar_path(file_path).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _load_sidecar_payload(self, file_path: Path) -> dict[str, Any]:
        sidecar_path = self._sidecar_path(file_path)
        if not sidecar_path.exists():
            return {}
        try:
            return json.loads(sidecar_path.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"Knowledge sidecar load failed for {file_path}: {exc}")
            return {}

    @staticmethod
    def _metadata_from_sidecar_or_document(sidecar: dict[str, Any], document) -> KnowledgeDocumentMetadata:  # noqa: ANN001
        payload = dict(sidecar.get("metadata") or {})
        category_value = payload.get("category") or (document.category.value if document.category else KnowledgeCategory.FAQ.value)
        title = str(payload.get("title") or document.title or Path(document.source).stem)
        source = str(payload.get("source") or "legacy_import")
        tags = payload.get("tags")
        if not isinstance(tags, list) or not tags:
            tags = [str(category_value), "legacy-import"]

        return KnowledgeDocumentMetadata(
            title=title,
            source=source,
            category=KnowledgeCategory(str(category_value)),
            tags=[str(tag).strip() for tag in tags if str(tag).strip()],
            author=payload.get("author"),
            summary=payload.get("summary"),
            language=payload.get("language") or get_settings().KB_DEFAULT_LANGUAGE,
            version=payload.get("version"),
            external_id=payload.get("external_id"),
            effective_at=payload.get("effective_at"),
        )


_REGISTRY: Optional[KnowledgeBaseRegistry] = None


def get_knowledge_registry() -> KnowledgeBaseRegistry:
    """Return singleton knowledge registry service."""

    global _REGISTRY
    if _REGISTRY is None:
        _REGISTRY = KnowledgeBaseRegistry()
    return _REGISTRY
