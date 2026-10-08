"""
向量化模块
支持Dense和Sparse Embedding
"""

from typing import List, Optional, Tuple
import numpy as np
from langchain_openai import OpenAIEmbeddings

from src.config import settings
from src.utils import logger


class HybridEmbeddings:
    """
    混合Embedding

    支持：
    1. Dense Embedding - 使用OpenAI/通义千问API
    2. Sparse Embedding - 使用BM25
    """

    def __init__(
        self,
        model: str = None,
        dimension: int = None,
        use_sparse: bool = True
    ):
        """
        初始化混合Embedding

        Args:
            model: Embedding模型名称
            dimension: 向量维度
            use_sparse: 是否启用稀疏向量（BM25）
        """
        self.model = model or settings.EMBEDDING_MODEL
        self.dimension = dimension or settings.EMBEDDING_DIMENSION
        self.use_sparse = use_sparse
        self.max_batch_size = 10

        # Dense Embeddings
        self._dense_embeddings = None

        # Sparse Embeddings (BM25)
        self._bm25 = None
        self._corpus = []
        self._tokenized_corpus = []

    @property
    def dense_embeddings(self) -> OpenAIEmbeddings:
        """获取Dense Embedding模型（懒加载）"""
        if self._dense_embeddings is None:
            self._dense_embeddings = OpenAIEmbeddings(
                api_key=settings.EMBEDDING_API_KEY,
                base_url=settings.EMBEDDING_API_BASE,
                model=self.model,
                check_embedding_ctx_length=False,
                chunk_size=self.max_batch_size,
            )
        return self._dense_embeddings

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """
        对文档列表进行Dense Embedding

        Args:
            texts: 文本列表

        Returns:
            向量列表
        """
        try:
            embeddings: List[List[float]] = []
            for index in range(0, len(texts), self.max_batch_size):
                batch = texts[index:index + self.max_batch_size]
                if not batch:
                    continue
                embeddings.extend(self.dense_embeddings.embed_documents(batch))
            logger.info(f"成功生成 {len(embeddings)} 个文档向量")
            return embeddings
        except Exception as e:
            logger.error(f"文档向量化失败: {e}")
            raise

    def embed_query(self, text: str) -> List[float]:
        """
        对查询进行Dense Embedding

        Args:
            text: 查询文本

        Returns:
            向量
        """
        try:
            embedding = self.dense_embeddings.embed_query(text)
            return embedding
        except Exception as e:
            logger.error(f"查询向量化失败: {e}")
            raise

    def build_sparse_index(self, corpus: List[str]):
        """
        构建BM25稀疏索引

        Args:
            corpus: 文档语料库
        """
        if not self.use_sparse:
            return

        try:
            from rank_bm25 import BM25Okapi

            self._corpus = corpus
            # 简单分词（中文按字，英文按词）
            self._tokenized_corpus = [self._tokenize(doc) for doc in corpus]
            self._bm25 = BM25Okapi(self._tokenized_corpus)
            logger.info(f"BM25索引构建完成，文档数: {len(corpus)}")
        except ImportError:
            logger.warning("rank_bm25未安装，稀疏检索不可用")
            self.use_sparse = False
            self.clear_sparse_index()
        except Exception as e:
            logger.error(f"BM25索引构建失败: {e}")
            self.clear_sparse_index()

    def clear_sparse_index(self):
        """清空BM25稀疏索引状态。"""

        self._bm25 = None
        self._corpus = []
        self._tokenized_corpus = []

    def sparse_search(self, query: str, top_k: int = 10) -> List[Tuple[int, float]]:
        """
        BM25稀疏检索

        Args:
            query: 查询文本
            top_k: 返回数量

        Returns:
            [(doc_index, score), ...]
        """
        if not self.use_sparse or self._bm25 is None:
            return []

        try:
            tokenized_query = self._tokenize(query)
            scores = self._bm25.get_scores(tokenized_query)

            # 获取top_k结果
            top_indices = np.argsort(scores)[::-1][:top_k]
            results = [(int(idx), float(scores[idx])) for idx in top_indices if scores[idx] > 0]

            return results
        except Exception as e:
            logger.error(f"BM25检索失败: {e}")
            return []

    def _tokenize(self, text: str) -> List[str]:
        """
        简单分词

        中文按字符，英文按空格和标点
        """
        import re

        tokens = []
        # 按空格和标点分割
        parts = re.split(r'[\s\.,;:!?，。；：！？\(\)\[\]（）【】]', text.lower())

        for part in parts:
            if not part:
                continue
            # 检查是否包含中文
            if re.search(r'[\u4e00-\u9fff]', part):
                # 中文按字符分
                tokens.extend(list(part))
            else:
                # 英文保持完整
                tokens.append(part)

        return tokens


class EmbeddingCache:
    """Embedding缓存"""

    def __init__(self, max_size: int = 10000):
        """
        初始化缓存

        Args:
            max_size: 最大缓存数量
        """
        self.max_size = max_size
        self._cache = {}

    def get(self, text: str) -> Optional[List[float]]:
        """获取缓存的embedding"""
        import hashlib
        key = hashlib.md5(text.encode()).hexdigest()
        return self._cache.get(key)

    def set(self, text: str, embedding: List[float]):
        """设置embedding缓存"""
        import hashlib

        if len(self._cache) >= self.max_size:
            # 简单LRU：删除第一个
            first_key = next(iter(self._cache))
            del self._cache[first_key]

        key = hashlib.md5(text.encode()).hexdigest()
        self._cache[key] = embedding

    def clear(self):
        """清空缓存"""
        self._cache.clear()


# 全局实例
_embeddings: Optional[HybridEmbeddings] = None
_cache: Optional[EmbeddingCache] = None


def get_embeddings() -> HybridEmbeddings:
    """获取Embedding实例"""
    global _embeddings
    if _embeddings is None:
        _embeddings = HybridEmbeddings()
    return _embeddings


def get_cache() -> EmbeddingCache:
    """获取缓存实例"""
    global _cache
    if _cache is None:
        _cache = EmbeddingCache()
    return _cache
