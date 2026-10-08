"""Minimal tool search engine for dynamic tool loading."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Sequence, Tuple

from src.utils import logger


class ToolSearchEngine:
    """Hybrid sparse search for selecting relevant tools per query."""

    def __init__(self, tool_registry: Dict[str, Dict[str, Any]]):
        self.tool_registry = tool_registry
        self.tool_names = list(tool_registry.keys())
        self._documents = [self._build_document(name, tool_registry[name]) for name in self.tool_names]
        self._tokenized_docs = [self._tokenize(doc) for doc in self._documents]
        self._bm25 = None
        self._init_bm25()

    def _init_bm25(self) -> None:
        if not self._tokenized_docs:
            return
        try:
            from rank_bm25 import BM25Okapi

            self._bm25 = BM25Okapi(self._tokenized_docs)
        except ImportError:
            logger.warning("rank_bm25 not installed; tool search will run in keyword-only mode")
            self._bm25 = None
        except Exception as exc:
            logger.warning(f"ToolSearchEngine BM25 init failed: {exc}")
            self._bm25 = None

    @staticmethod
    def _build_document(tool_name: str, meta: Dict[str, Any]) -> str:
        description = str(meta.get("description", ""))
        keywords = " ".join(str(k) for k in meta.get("keywords", []))
        category = str(meta.get("category", ""))
        input_examples = meta.get("input_examples", [])
        example_texts: List[str] = []
        if isinstance(input_examples, list):
            for example in input_examples:
                if isinstance(example, dict):
                    example_texts.extend(str(v) for v in example.values())
                else:
                    example_texts.append(str(example))
        examples = " ".join(example_texts)
        return f"{tool_name} {category} {description} {keywords} {examples}".strip()

    @staticmethod
    def _tokenize(text: str) -> List[str]:
        parts = re.split(r"[\s\.,;:!?，。；：！？\(\)\[\]（）【】]+", text.lower())
        tokens: List[str] = []
        for part in parts:
            if not part:
                continue
            if re.search(r"[\u4e00-\u9fff]", part):
                tokens.extend(list(part))
            else:
                tokens.append(part)
        return tokens

    def _bm25_scores(self, query: str) -> Dict[str, float]:
        if self._bm25 is None:
            return {name: 0.0 for name in self.tool_names}

        tokenized_query = self._tokenize(query)
        raw_scores = self._bm25.get_scores(tokenized_query)
        max_score = max(raw_scores) if len(raw_scores) else 0.0
        if max_score <= 0:
            return {name: 0.0 for name in self.tool_names}

        return {
            self.tool_names[idx]: float(raw_scores[idx] / max_score)
            for idx in range(len(self.tool_names))
        }

    def _keyword_scores(self, query: str) -> Dict[str, float]:
        lowered_query = query.lower()
        query_tokens = set(self._tokenize(query))
        scores: Dict[str, float] = {}

        for name in self.tool_names:
            meta = self.tool_registry[name]
            keywords = [str(kw).lower() for kw in meta.get("keywords", [])]
            if not keywords:
                scores[name] = 0.0
                continue

            exact_hits = sum(1 for kw in keywords if kw and kw in lowered_query)
            token_hits = 0
            for kw in keywords:
                kw_tokens = self._tokenize(kw)
                if not kw_tokens:
                    continue
                overlap = len(query_tokens.intersection(kw_tokens))
                if overlap > 0:
                    token_hits += overlap / max(len(kw_tokens), 1)

            exact_score = exact_hits / max(len(keywords), 1)
            token_score = token_hits / max(len(keywords), 1)
            scores[name] = min(1.0, exact_score * 0.7 + token_score * 0.3)

        return scores

    def _usage_scores(self) -> Dict[str, float]:
        return {
            name: float(self.tool_registry[name].get("usage_frequency", 0.0))
            for name in self.tool_names
        }

    def _allow_tool(
        self,
        name: str,
        categories: Sequence[str] | None = None,
        sources: Sequence[str] | None = None,
    ) -> bool:
        meta = self.tool_registry.get(name, {})
        if categories:
            category = str(meta.get("category", "")).strip().lower()
            allowed_categories = {str(item).strip().lower() for item in categories if str(item).strip()}
            if allowed_categories and category not in allowed_categories:
                return False
        if sources:
            source = str(meta.get("source", "")).strip().lower()
            allowed_sources = {str(item).strip().lower() for item in sources if str(item).strip()}
            if allowed_sources and source not in allowed_sources:
                return False
        return True

    def search_with_scores(
        self,
        query: str,
        top_k: int = 3,
        min_score: float = 0.05,
        categories: Sequence[str] | None = None,
        sources: Sequence[str] | None = None,
    ) -> List[Tuple[str, float]]:
        """Return tool names with fused scores."""
        if not query.strip():
            return []

        bm25_scores = self._bm25_scores(query)
        keyword_scores = self._keyword_scores(query)
        usage_scores = self._usage_scores()

        fused: List[Tuple[str, float]] = []
        for name in self.tool_names:
            if not self._allow_tool(name, categories=categories, sources=sources):
                continue
            score = (
                bm25_scores.get(name, 0.0) * 0.65
                + keyword_scores.get(name, 0.0) * 0.30
                + usage_scores.get(name, 0.0) * 0.05
            )
            score = max(0.0, min(1.0, score))
            fused.append((name, score))

        fused.sort(key=lambda item: item[1], reverse=True)
        if min_score > 0:
            fused = [item for item in fused if item[1] >= min_score]

        if top_k <= 0:
            return fused
        return fused[:top_k]

    def search(
        self,
        query: str,
        top_k: int = 3,
        min_score: float = 0.05,
        categories: Sequence[str] | None = None,
        sources: Sequence[str] | None = None,
    ) -> List[str]:
        return [
            name
            for name, _ in self.search_with_scores(
                query,
                top_k=top_k,
                min_score=min_score,
                categories=categories,
                sources=sources,
            )
        ]
