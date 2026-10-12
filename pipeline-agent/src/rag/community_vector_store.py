"""Milvus 社区摘要向量存储（GraphRAG 2.0 的"摘要语义"腿）。

独立于 chunk 的 pipeline_knowledge collection：
  - collection: pipeline_knowledge_communities
  - 每条 = 一个社区摘要向量（384 维本地 MiniLM）
  - 字段：community_id / summary / node_ids / doc_ids / chunk_ids / embedding
写入在 community.upsert_community_vectors；recreate 全量 drop+insert（社区数 ≤ 几百）。
连接/降级模式与 MilvusVectorStore 一致（连接失败抛错由调用方降级）。
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from src.config import settings
from src.utils import logger


class CommunityVectorStore:
    """Milvus 社区摘要向量存储（COSINE 检索）。"""

    DEFAULT_COLLECTION = "pipeline_knowledge_communities"

    def __init__(
        self,
        collection_name: str | None = None,
        host: str | None = None,
        port: int | None = None,
        dimension: int | None = None,
    ) -> None:
        self.collection_name = collection_name or self.DEFAULT_COLLECTION
        self.host = host or settings.MILVUS_HOST
        self.port = port or settings.MILVUS_PORT
        # 维度跟随当前 embedding 模型（本地 384）；显式传优先
        self.dimension = dimension or self._current_embedding_dim()
        self._collection = None
        self._connected = False

    @staticmethod
    def _current_embedding_dim() -> int:
        try:
            from src.rag.embeddings import get_embeddings

            return int(get_embeddings().dimension)
        except Exception:  # noqa: BLE001
            return 384

    def _connection_hosts(self) -> List[str]:
        host = str(self.host or "").strip()
        if host.lower() in ("localhost", "127.0.0.1"):
            return ["127.0.0.1", "localhost"]
        return [host]

    def connect(self) -> None:
        if self._connected:
            return
        from pymilvus import connections, utility

        last_error: Optional[Exception] = None
        for attempt in range(1, 4):
            for host in self._connection_hosts():
                try:
                    connections.disconnect("default")
                except Exception:  # noqa: BLE001
                    pass
                connections.connect(alias="default", host=host, port=self.port)
                if utility.has_collection(self.collection_name):
                    self._collection = None  # recreate 分支处理
                else:
                    self._collection = None
                self._connected = True
                logger.info("Connected for community collection: %s:%s", host, self.port)
                return
            last_error = RuntimeError(f"community collection connect failed attempt {attempt}")
        if last_error:
            raise last_error

    def upsert_all(self, rows: List[Dict[str, Any]]) -> int:
        """全量重写社区 collection（drop+insert；不碰 chunk collection）。"""
        if not rows:
            return 0
        from pymilvus import (
            Collection,
            CollectionSchema,
            DataType,
            FieldSchema,
            utility,
        )

        self.connect()

        if utility.has_collection(self.collection_name):
            utility.drop_collection(self.collection_name)
            logger.info("Dropped community collection: %s", self.collection_name)

        fields = [
            FieldSchema(
                name="community_id",
                dtype=DataType.VARCHAR,
                max_length=32,
                is_primary=True,
                auto_id=False,
            ),
            FieldSchema(name="summary", dtype=DataType.VARCHAR, max_length=65535),
            FieldSchema(name="node_ids", dtype=DataType.VARCHAR, max_length=4096),
            FieldSchema(name="doc_ids", dtype=DataType.VARCHAR, max_length=4096),
            FieldSchema(name="chunk_ids", dtype=DataType.VARCHAR, max_length=8192),
            FieldSchema(
                name="embedding",
                dtype=DataType.FLOAT_VECTOR,
                dim=self.dimension,
            ),
        ]
        schema = CollectionSchema(
            fields=fields, description="GraphRAG community summary vectors"
        )
        self._collection = Collection(name=self.collection_name, schema=schema)
        index_params = {
            "metric_type": "COSINE",
            "index_type": "IVF_FLAT",
            "params": {"nlist": 8},
        }
        self._collection.create_index(field_name="embedding", index_params=index_params)
        self._collection.load()

        data = [
            [r["community_id"] for r in rows],
            [str(r.get("summary", ""))[:65535] for r in rows],
            [str(r.get("node_ids", "[]"))[:4096] for r in rows],
            [str(r.get("doc_ids", "[]"))[:4096] for r in rows],
            [str(r.get("chunk_ids", "[]"))[:8192] for r in rows],
            [r["embedding"] for r in rows],
        ]
        self._collection.insert(data)
        self._collection.flush()
        logger.info("Inserted %d community vectors into %s", len(rows), self.collection_name)
        return len(rows)

    def search(
        self,
        query_embedding: List[float],
        top_k: int = 3,
        min_score: float = 0.0,
    ) -> List[Dict[str, Any]]:
        self.connect()
        if self._collection is None:
            return []
        from pymilvus import utility

        if not utility.has_collection(self.collection_name):
            return []
        self._collection = None
        self._collection = _reopen(self.collection_name)
        self._collection.load()

        results = self._collection.search(
            data=[query_embedding],
            anns_field="embedding",
            param={"metric_type": "COSINE", "params": {"nprobe": 8}},
            limit=top_k,
            expr=None,
            output_fields=["community_id", "summary", "node_ids", "doc_ids", "chunk_ids"],
        )
        out: List[Dict[str, Any]] = []
        for hits in results:
            for hit in hits:
                if hit.score >= min_score:
                    e = hit.entity
                    out.append(
                        {
                            "community_id": e.get("community_id"),
                            "summary": e.get("summary"),
                            "node_ids": _safe_json_list(e.get("node_ids")),
                            "doc_ids": _safe_json_list(e.get("doc_ids")),
                            "chunk_ids": _safe_json_list(e.get("chunk_ids")),
                            "score": hit.score,
                        }
                    )
        return out


def _reopen(name: str):
    from pymilvus import Collection

    return Collection(name)


def _safe_json_list(raw: Any) -> List[str]:
    if not raw:
        return []
    try:
        v = json.loads(raw) if isinstance(raw, str) else raw
        return [str(x) for x in (v if isinstance(v, list) else [])]
    except Exception:  # noqa: BLE001
        return []


_csv: Optional[CommunityVectorStore] = None


def get_community_vector_store() -> CommunityVectorStore:
    global _csv
    if _csv is None:
        _csv = CommunityVectorStore()
    return _csv
