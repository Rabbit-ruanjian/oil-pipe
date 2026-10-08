"""Cross-session long-term memory."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from typing import Dict, List, Optional

import redis

from src.config import get_redis
from src.utils import now_iso


@dataclass
class LongTermMemoryItem:
    """Persisted long-term memory item."""

    key: str
    value: str
    timestamp: str = field(default_factory=now_iso)
    metadata: dict = field(default_factory=dict)


class LongTermMemoryStore:
    """Simple Redis-backed long-term memory store."""

    def __init__(self):
        self.redis = get_redis()
        self.prefix = "memory:long_term:"

    def upsert(self, session_id: str, item: LongTermMemoryItem) -> None:
        memory_key = f"{self.prefix}{session_id}:{item.key}"
        self.redis.set(memory_key, json.dumps(asdict(item), ensure_ascii=False))

    def get(self, session_id: str, key: str) -> Optional[dict]:
        memory_key = f"{self.prefix}{session_id}:{key}"
        value = self.redis.get(memory_key)
        if value is None:
            return None
        return json.loads(value)

    def list_by_session(self, session_id: str) -> List[dict]:
        pattern = f"{self.prefix}{session_id}:*"
        items: List[dict] = []
        for key in self.redis.scan_iter(pattern):
            raw = self.redis.get(key)
            if raw:
                items.append(json.loads(raw))
        return items


_store: Optional[LongTermMemoryStore] = None


def get_long_term_store() -> LongTermMemoryStore:
    """Return singleton long-term memory store."""

    global _store
    if _store is None:
        _store = LongTermMemoryStore()
    return _store
