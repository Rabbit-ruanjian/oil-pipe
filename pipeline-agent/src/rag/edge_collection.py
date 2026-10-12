"""Milvus 边描述向量存储（GraphRAG 2.1 的"边语义"腿，对标 ragflow relation 向量检索）。

独立于 chunk（pipeline_knowledge）与社区（pipeline_knowledge_communities）：
  - collection: pipeline_knowledge_graph_edges
  - 每条 = 一条图边的自然语言描述向量（384 维本地 MiniLM）
  - 字段：edge_key / description / edge_type / source / target / doc_ids / embedding
写入在 edge_vector_store.upsert_edge_vectors；recreate 全量 drop+insert（边数 ≤ 几百）。
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from src.config import settings
from src.utils import logger


class EdgeVectorStore:
    """Milvus 边描述向量存储（COSINE 检索）。"""

    DEFAULT_COLLECTION = "pipeline_knowledge_graph_edges"

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
                self._connected = True
                logger.info("Connected for edge collection: %s:%s", host, self.port)
                return
            last_error = RuntimeError(f"edge collection connect failed attempt {attempt}")
        if last_error:
            raise last_error

    def upsert_all(self, rows: list) -> int:
        """全量重写边 collection（drop+insert；不碰 chunk / community）。

        rows 支持两种形态（与 edge_vector_store.upsert_edge_vectors 对齐）：
          - (record, vector) 元组对：record 是边描述 dict，vector 是 384 维 list
          - record dict（带 "embedding" 键）
        """
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

        # 增量模式：collection 已存在则复用（边 upsert 覆盖同 key 行，不 drop 全量），
        # 只有首次/集合不存在时建 schema。大规模图（千节点级）全量 drop+重建太慢，
        # 每次蒸馏/删文档增量 upsert 秒级完成。
        if utility.has_collection(self.collection_name):
            self._collection = _reopen(self.collection_name)
            self._collection.load()
        else:
            fields = [
                FieldSchema(
                    name="edge_key",
                    dtype=DataType.VARCHAR,
                    max_length=128,
                    is_primary=True,
                    auto_id=False,
                ),
                FieldSchema(name="description", dtype=DataType.VARCHAR, max_length=4096),
                FieldSchema(name="edge_type", dtype=DataType.VARCHAR, max_length=32),
                FieldSchema(name="source", dtype=DataType.VARCHAR, max_length=128),
                FieldSchema(name="target", dtype=DataType.VARCHAR, max_length=128),
                FieldSchema(name="doc_ids", dtype=DataType.VARCHAR, max_length=4096),
                FieldSchema(
                    name="embedding",
                    dtype=DataType.FLOAT_VECTOR,
                    dim=self.dimension,
                ),
            ]
            schema = CollectionSchema(
                fields=fields, description="GraphRAG edge description vectors"
            )
            self._collection = Collection(name=self.collection_name, schema=schema)
            index_params = {
                "metric_type": "COSINE",
                "index_type": "IVF_FLAT",
                "params": {"nlist": 8},
            }
            self._collection.create_index(field_name="embedding", index_params=index_params)
            self._collection.load()

        # 归一化成 (record, vector) 对，兼容两种入参形态
        pairs: List = []
        for row in rows:
            if isinstance(row, dict):
                rec = row
                vec = row.get("embedding")
            else:
                rec, vec = row  # (record, vector) 元组对
            pairs.append((rec, vec))

        # 仅向量化成功的才进 collection（无向量的边只落盘文本，不写 Milvus）
        valid_pairs = [(rec, v) for rec, v in pairs if v]
        data = [
            [str(rec.get("edge_key", ""))[:128] for rec, _v in valid_pairs],
            [str(rec.get("description", ""))[:4096] for rec, _v in valid_pairs],
            [str(rec.get("edge_type", ""))[:32] for rec, _v in valid_pairs],
            [str(rec.get("source", ""))[:128] for rec, _v in valid_pairs],
            [str(rec.get("target", ""))[:128] for rec, _v in valid_pairs],
            [
                json.dumps(rec.get("doc_ids", []), ensure_ascii=False)[:4096]
                for rec, _v in valid_pairs
            ],
            [[float(x) for x in v] for _rec, v in valid_pairs],
        ]
        self._collection.insert(data)
        self._collection.flush()
        logger.info(
            "Inserted %d edge vectors into %s (向量化的 %d / 总 %d)",
            len(valid_pairs),
            self.collection_name,
            len(valid_pairs),
            len(pairs),
        )
        return len(valid_pairs)

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
        self._collection = _reopen(self.collection_name)
        self._collection.load()

        results = self._collection.search(
            data=[query_embedding],
            anns_field="embedding",
            param={"metric_type": "COSINE", "params": {"nprobe": 8}},
            limit=top_k,
            expr=None,
            output_fields=["edge_key", "description", "edge_type", "source", "target", "doc_ids"],
        )
        out: List[Dict[str, Any]] = []
        for hits in results:
            for hit in hits:
                if hit.score >= min_score:
                    e = hit.entity
                    out.append(
                        {
                            "edge_key": e.get("edge_key"),
                            "description": e.get("description"),
                            "edge_type": e.get("edge_type"),
                            "source": e.get("source"),
                            "target": e.get("target"),
                            "doc_ids": _safe_json_list(e.get("doc_ids")),
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


_store: Optional[EdgeVectorStore] = None


def get_edge_collection() -> EdgeVectorStore:
    global _store
    if _store is None:
        _store = EdgeVectorStore()
    return _store
