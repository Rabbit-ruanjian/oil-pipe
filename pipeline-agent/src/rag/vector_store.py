"""
Vector store module backed by Milvus.
"""

from __future__ import annotations

import json
import time
from typing import Any, Dict, List, Optional

from src.config import settings
from src.utils import logger

from .contextual_chunker import Chunk


class MilvusVectorStore:
    """Milvus-based vector store for knowledge chunks."""

    FIELDS = {
        "chunk_id": "VARCHAR(64)",
        "content": "VARCHAR(65535)",
        "full_text": "VARCHAR(65535)",
        "doc_id": "VARCHAR(64)",
        "doc_title": "VARCHAR(256)",
        "source": "VARCHAR(512)",
        "category": "VARCHAR(32)",
        "chunk_index": "INT64",
        "embedding": f"FLOAT_VECTOR({settings.EMBEDDING_DIMENSION})",
    }

    def __init__(
        self,
        collection_name: str | None = None,
        host: str | None = None,
        port: int | None = None,
    ) -> None:
        self.collection_name = collection_name or settings.MILVUS_COLLECTION
        self.host = host or settings.MILVUS_HOST
        self.port = port or settings.MILVUS_PORT
        self.dimension = settings.EMBEDDING_DIMENSION

        self._collection = None
        self._connected = False
        self._active_host = self.host

    def _connection_hosts(self) -> List[str]:
        host = str(self.host or "").strip()
        if host.lower() == "localhost":
            # Prefer IPv4 loopback on Windows/Docker to avoid flaky localhost resolution.
            return ["127.0.0.1", "localhost"]
        return [host]

    def connect(self) -> None:
        """Connect to Milvus with lightweight retry/fallback logic."""
        if self._connected:
            return

        from pymilvus import Collection, connections, utility

        hosts = self._connection_hosts()
        max_attempts = 5
        sleep_seconds = 2
        last_error: Optional[Exception] = None

        for attempt in range(1, max_attempts + 1):
            for host in hosts:
                try:
                    try:
                        connections.disconnect("default")
                    except Exception:
                        pass

                    connections.connect(
                        alias="default",
                        host=host,
                        port=self.port,
                    )

                    if utility.has_collection(self.collection_name):
                        self._collection = Collection(self.collection_name)
                        self._collection.load()
                        logger.info(f"Loaded Milvus collection: {self.collection_name}")
                    else:
                        self._collection = None
                        logger.info(
                            f"Milvus collection does not exist yet: {self.collection_name}"
                        )

                    self._connected = True
                    self._active_host = host
                    logger.info(f"Connected to Milvus: {host}:{self.port}")
                    return
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
                    logger.warning(
                        f"Milvus connect attempt {attempt}/{max_attempts} failed: "
                        f"host={host} port={self.port} error={exc}"
                    )

            if attempt < max_attempts:
                time.sleep(sleep_seconds)

        logger.error(f"Milvus connection failed after retries: {last_error}")
        if last_error is not None:
            raise last_error
        raise RuntimeError("Milvus connection failed with unknown error")

    def create_collection(self, recreate: bool = False) -> None:
        """Create the Milvus collection if needed."""
        from pymilvus import Collection, CollectionSchema, DataType, FieldSchema, utility

        self.connect()

        if utility.has_collection(self.collection_name):
            if recreate:
                utility.drop_collection(self.collection_name)
                logger.info(f"Dropped Milvus collection: {self.collection_name}")
            else:
                self._collection = Collection(self.collection_name)
                return

        fields = [
            FieldSchema(
                name="chunk_id",
                dtype=DataType.VARCHAR,
                max_length=64,
                is_primary=True,
                auto_id=False,
            ),
            FieldSchema(name="content", dtype=DataType.VARCHAR, max_length=65535),
            FieldSchema(name="full_text", dtype=DataType.VARCHAR, max_length=65535),
            FieldSchema(name="doc_id", dtype=DataType.VARCHAR, max_length=64),
            FieldSchema(name="doc_title", dtype=DataType.VARCHAR, max_length=256),
            FieldSchema(name="source", dtype=DataType.VARCHAR, max_length=512),
            FieldSchema(name="category", dtype=DataType.VARCHAR, max_length=32),
            FieldSchema(name="chunk_index", dtype=DataType.INT64),
            FieldSchema(
                name="embedding",
                dtype=DataType.FLOAT_VECTOR,
                dim=self.dimension,
            ),
        ]

        schema = CollectionSchema(fields=fields, description="Pipeline Knowledge Base")

        self._collection = Collection(name=self.collection_name, schema=schema)

        index_params = {
            "metric_type": "COSINE",
            "index_type": "IVF_FLAT",
            "params": {"nlist": 128},
        }
        self._collection.create_index(field_name="embedding", index_params=index_params)

        logger.info(f"Created Milvus collection: {self.collection_name}")

    def insert_chunks(self, chunks: List[Chunk], embeddings: List[List[float]]) -> int:
        """Insert chunk embeddings into Milvus."""
        if not chunks or not embeddings:
            return 0

        if len(chunks) != len(embeddings):
            raise ValueError("chunks and embeddings length mismatch")

        self.connect()
        if self._collection is None:
            self.create_collection()

        data = [
            [c.chunk_id for c in chunks],
            [c.content[:65000] for c in chunks],
            [(c.full_text or c.content)[:65000] for c in chunks],
            [c.doc_id for c in chunks],
            [c.doc_title[:250] for c in chunks],
            [c.source[:500] for c in chunks],
            [c.category.value if c.category else "" for c in chunks],
            [c.chunk_index for c in chunks],
            embeddings,
        ]

        self._collection.insert(data)
        self._collection.flush()

        logger.info(f"Inserted {len(chunks)} chunks into Milvus")
        return len(chunks)

    def search(
        self,
        query_embedding: List[float],
        top_k: int = 10,
        category_filter: Optional[str] = None,
        score_threshold: float = 0.0,
    ) -> List[Dict[str, Any]]:
        """Search similar chunks from Milvus."""
        self.connect()
        if self._collection is None:
            logger.warning("Milvus collection is not initialized")
            return []

        expr = None
        if category_filter:
            expr = f'category == "{category_filter}"'

        search_params = {
            "metric_type": "COSINE",
            "params": {"nprobe": 16},
        }

        results = self._collection.search(
            data=[query_embedding],
            anns_field="embedding",
            param=search_params,
            limit=top_k,
            expr=expr,
            output_fields=[
                "chunk_id",
                "content",
                "full_text",
                "doc_id",
                "doc_title",
                "source",
                "category",
                "chunk_index",
            ],
        )

        search_results: List[Dict[str, Any]] = []
        for hits in results:
            for hit in hits:
                score = hit.score
                if score >= score_threshold:
                    search_results.append(
                        {
                            "chunk_id": hit.entity.get("chunk_id"),
                            "content": hit.entity.get("content"),
                            "full_text": hit.entity.get("full_text"),
                            "doc_id": hit.entity.get("doc_id"),
                            "doc_title": hit.entity.get("doc_title"),
                            "source": hit.entity.get("source"),
                            "category": hit.entity.get("category"),
                            "chunk_index": hit.entity.get("chunk_index"),
                            "score": score,
                        }
                    )

        return search_results

    def list_chunks(
        self,
        category_filter: Optional[str] = None,
        doc_id: Optional[str] = None,
        batch_size: int = 1000,
    ) -> List[Dict[str, Any]]:
        """List stored chunks for rebuilding non-vector retrieval state."""
        self.connect()
        if self._collection is None:
            return []

        expr_parts = []
        if category_filter:
            expr_parts.append(f'category == "{category_filter}"')
        if doc_id:
            expr_parts.append(f'doc_id == "{doc_id}"')
        expr = " and ".join(expr_parts) if expr_parts else 'chunk_id != ""'

        output_fields = [
            "chunk_id",
            "content",
            "full_text",
            "doc_id",
            "doc_title",
            "source",
            "category",
            "chunk_index",
        ]

        chunks: List[Dict[str, Any]] = []
        offset = 0
        while True:
            rows = self._collection.query(
                expr=expr,
                output_fields=output_fields,
                limit=batch_size,
                offset=offset,
            )
            if not rows:
                break
            chunks.extend(rows)
            if len(rows) < batch_size:
                break
            offset += batch_size

        return chunks

    def delete_by_doc_id(self, doc_id: str) -> int:
        """Delete all chunks for a document id."""
        self.connect()
        if self._collection is None:
            return 0

        lookup_expr = f'doc_id == {json.dumps(doc_id, ensure_ascii=False)}'
        rows = self._collection.query(expr=lookup_expr, output_fields=["chunk_id"])
        chunk_ids = [
            row.get("chunk_id")
            for row in rows
            if isinstance(row, dict) and row.get("chunk_id")
        ]
        if not chunk_ids:
            logger.warning(f"No Milvus chunks found for document: {doc_id}")
            return 0

        delete_expr = f'chunk_id in {json.dumps(chunk_ids, ensure_ascii=False)}'
        self._collection.delete(delete_expr)
        self._collection.flush()

        logger.info(f"Deleted {len(chunk_ids)} Milvus chunks for document {doc_id}")
        return len(chunk_ids)

    def get_stats(self) -> Dict[str, Any]:
        """Return collection statistics."""
        self.connect()
        if self._collection is None:
            return {"exists": False}

        return {
            "exists": True,
            "name": self.collection_name,
            "num_entities": self._collection.num_entities,
            "description": self._collection.description,
        }

    def close(self) -> None:
        """Close the Milvus connection."""
        if self._connected:
            from pymilvus import connections

            connections.disconnect("default")
            self._connected = False
            self._active_host = self.host
            logger.info("Milvus connection closed")


_vector_store: Optional[MilvusVectorStore] = None


def get_vector_store() -> MilvusVectorStore:
    """Return the singleton vector store."""
    global _vector_store
    if _vector_store is None:
        _vector_store = MilvusVectorStore()
    return _vector_store
