"""
重排序模块
使用BGE-Reranker对检索结果进行重排序
"""

from typing import List, Optional, Tuple
from dataclasses import dataclass

from src.config import settings, rag_config
from src.utils import logger
from .hybrid_retriever import RetrievalResult


@dataclass
class RerankResult:
    """重排序结果"""
    chunk_id: str
    content: str
    full_text: str
    doc_id: str
    doc_title: str
    source: str
    category: str
    original_score: float
    rerank_score: float
    final_score: float


class Reranker:
    """
    重排序器

    使用Cross-Encoder模型对检索结果重新打分
    默认使用BGE-Reranker
    """

    def __init__(
        self,
        model_name: str = None,
        threshold: float = None,
        use_gpu: bool = False
    ):
        """
        初始化重排序器

        Args:
            model_name: 重排序模型名称
            threshold: 相关性阈值
            use_gpu: 是否使用GPU
        """
        reranker_config = rag_config.reranker
        self.model_name = model_name or reranker_config["model"]
        self.threshold = threshold or reranker_config["threshold"]
        self.use_gpu = use_gpu
        self.enabled = reranker_config["enabled"]

        self._model = None
        self._tokenizer = None

    def _load_model(self):
        """加载重排序模型"""
        if self._model is not None:
            return

        try:
            from transformers import AutoModelForSequenceClassification, AutoTokenizer
            import torch

            device = "cuda" if self.use_gpu and torch.cuda.is_available() else "cpu"

            self._tokenizer = AutoTokenizer.from_pretrained(self.model_name)
            self._model = AutoModelForSequenceClassification.from_pretrained(
                self.model_name
            ).to(device)
            self._model.eval()

            logger.info(f"已加载重排序模型: {self.model_name} on {device}")

        except ImportError:
            logger.warning("transformers未安装，使用简化重排序")
            self.enabled = False
        except Exception as e:
            logger.error(f"重排序模型加载失败: {e}")
            self.enabled = False

    def rerank(
        self,
        query: str,
        results: List[RetrievalResult],
        top_k: int = None
    ) -> List[RerankResult]:
        """
        对检索结果进行重排序

        Args:
            query: 查询文本
            results: 检索结果列表
            top_k: 返回数量

        Returns:
            重排序后的结果
        """
        if not results:
            return []

        top_k = top_k or rag_config.retrieval["final_k"]

        if not self.enabled:
            # 不使用重排序，直接按原分数返回
            return self._convert_results(results)[:top_k]

        self._load_model()

        if self._model is None:
            return self._convert_results(results)[:top_k]

        try:
            import torch

            # 准备输入
            pairs = [(query, r.full_text or r.content) for r in results]

            # 批量编码
            inputs = self._tokenizer(
                pairs,
                padding=True,
                truncation=True,
                max_length=512,
                return_tensors="pt"
            )

            device = next(self._model.parameters()).device
            inputs = {k: v.to(device) for k, v in inputs.items()}

            # 推理
            with torch.no_grad():
                outputs = self._model(**inputs)
                scores = outputs.logits.squeeze(-1).cpu().tolist()

            # 如果是单个结果，确保scores是列表
            if isinstance(scores, float):
                scores = [scores]

            # 构建结果
            rerank_results = []
            for i, (result, rerank_score) in enumerate(zip(results, scores)):
                # 归一化分数到0-1
                normalized_score = 1 / (1 + pow(2.718, -rerank_score))

                if normalized_score >= self.threshold:
                    rerank_results.append(RerankResult(
                        chunk_id=result.chunk_id,
                        content=result.content,
                        full_text=result.full_text,
                        doc_id=result.doc_id,
                        doc_title=result.doc_title,
                        source=result.source,
                        category=result.category,
                        original_score=result.score,
                        rerank_score=normalized_score,
                        final_score=normalized_score
                    ))

            # 按重排序分数排序
            rerank_results.sort(key=lambda x: x.rerank_score, reverse=True)

            logger.info(f"重排序完成: {len(results)} -> {len(rerank_results)} 条结果")
            return rerank_results[:top_k]

        except Exception as e:
            logger.error(f"重排序失败: {e}")
            return self._convert_results(results)[:top_k]

    def _convert_results(self, results: List[RetrievalResult]) -> List[RerankResult]:
        """转换结果格式"""
        return [
            RerankResult(
                chunk_id=r.chunk_id,
                content=r.content,
                full_text=r.full_text,
                doc_id=r.doc_id,
                doc_title=r.doc_title,
                source=r.source,
                category=r.category,
                original_score=r.score,
                rerank_score=r.score,
                final_score=r.score
            )
            for r in results
        ]


class DashScopeReranker:
    """
    基于阿里云 DashScope gte-rerank API 的重排序器

    一次 API 调用完成批量重排序，无需本地模型。
    """

    def __init__(
        self,
        model_name: str = None,
        threshold: float = None,
    ):
        reranker_config = rag_config.reranker
        self.model_name = model_name or reranker_config["model"]
        self.threshold = threshold or reranker_config["threshold"]
        self.enabled = reranker_config["enabled"]

    def rerank(
        self,
        query: str,
        results: List[RetrievalResult],
        top_k: int = None,
    ) -> List[RerankResult]:
        """调用 DashScope gte-rerank API 重排序。"""
        import httpx

        if not results:
            return []

        top_k = top_k or rag_config.retrieval["final_k"]
        if not self.enabled:
            return self._fallback(results, top_k)

        documents = [
            r.full_text or r.content
            for r in results
        ]

        try:
            resp = httpx.post(
                f"{settings.EMBEDDING_API_BASE.rstrip('/').replace('/compatible-mode/v1', '')}/api/v1/services/rerank/text-rerank/text-rerank",
                headers={
                    "Authorization": f"Bearer {settings.EMBEDDING_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model_name,
                    "input": {
                        "query": query,
                        "documents": documents,
                    },
                    "parameters": {
                        "top_n": top_k,
                    },
                },
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.error(f"DashScope rerank API 调用失败: {e}")
            return self._fallback(results, top_k)

        rerank_results = []
        for item in data.get("output", {}).get("results", []):
            idx = item["index"]
            score = float(item["relevance_score"])
            if score < self.threshold:
                continue
            r = results[idx]
            rerank_results.append(
                RerankResult(
                    chunk_id=r.chunk_id,
                    content=r.content,
                    full_text=r.full_text,
                    doc_id=r.doc_id,
                    doc_title=r.doc_title,
                    source=r.source,
                    category=r.category,
                    original_score=r.score,
                    rerank_score=score,
                    final_score=score,
                )
            )

        rerank_results.sort(key=lambda x: x.rerank_score, reverse=True)
        logger.info(f"DashScope rerank 完成: {len(results)} -> {len(rerank_results)} 条")
        return rerank_results[:top_k]

    @staticmethod
    def _fallback(results: List[RetrievalResult], top_k: int) -> List[RerankResult]:
        return [
            RerankResult(
                chunk_id=r.chunk_id,
                content=r.content,
                full_text=r.full_text,
                doc_id=r.doc_id,
                doc_title=r.doc_title,
                source=r.source,
                category=r.category,
                original_score=r.score,
                rerank_score=r.score,
                final_score=r.score,
            )
            for r in results
        ][:top_k]


class LLMReranker:
    """
    基于LLM的重排序器

    当本地模型不可用时的替代方案
    使用LLM评估查询与文档的相关性
    """

    RERANK_PROMPT = """请评估以下文档与查询的相关性。

查询: {query}

文档: {document}

请给出0-10的相关性评分，10分表示完全相关，0分表示完全不相关。
只输出数字分数，不要输出其他内容。

评分："""

    def __init__(self):
        reranker_config = rag_config.reranker
        self.llm = get_cached_llm("tool_result_format")
        self.threshold = reranker_config["threshold"]
        self.enabled = reranker_config["enabled"]

    def rerank(
        self,
        query: str,
        results: List[RetrievalResult],
        top_k: int = 5
    ) -> List[RerankResult]:
        """使用LLM重排序"""
        from langchain_core.prompts import ChatPromptTemplate

        if not results:
            return []

        if not self.enabled:
            return self._fallback(results, top_k)

        scored_results = []

        for result in results:
            try:
                prompt = ChatPromptTemplate.from_template(self.RERANK_PROMPT)
                chain = prompt | self.llm

                response = chain.invoke({
                    "query": query,
                    "document": (result.full_text or result.content)[:1000]
                })

                # 解析分数
                score_text = response.content.strip()
                score = float(score_text) / 10.0  # 归一化到0-1
                if score < self.threshold:
                    continue

                scored_results.append(RerankResult(
                    chunk_id=result.chunk_id,
                    content=result.content,
                    full_text=result.full_text,
                    doc_id=result.doc_id,
                    doc_title=result.doc_title,
                    source=result.source,
                    category=result.category,
                    original_score=result.score,
                    rerank_score=score,
                    final_score=score
                ))
            except Exception as e:
                logger.warning(f"LLM重排序单条失败: {e}")
                continue

        # 排序
        scored_results.sort(key=lambda x: x.rerank_score, reverse=True)

        return scored_results[:top_k]

    @staticmethod
    def _fallback(results: List[RetrievalResult], top_k: int) -> List[RerankResult]:
        return [
            RerankResult(
                chunk_id=r.chunk_id,
                content=r.content,
                full_text=r.full_text,
                doc_id=r.doc_id,
                doc_title=r.doc_title,
                source=r.source,
                category=r.category,
                original_score=r.score,
                rerank_score=r.score,
                final_score=r.score,
            )
            for r in results
        ][:top_k]


# 全局实例
_reranker: Optional[Reranker] = None


def get_reranker():
    """根据 RERANKER_MODE 配置返回对应的重排序器实例。"""
    global _reranker
    if _reranker is None:
        mode = getattr(settings, "RERANKER_MODE", "api")
        if mode == "local":
            _reranker = Reranker()
        elif mode == "llm":
            _reranker = LLMReranker()
        else:
            _reranker = DashScopeReranker()
        logger.info(f"Reranker 初始化: mode={mode}, class={type(_reranker).__name__}")
    return _reranker
