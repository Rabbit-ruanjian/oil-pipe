"""Redis session snapshot store for HITL recovery."""

from __future__ import annotations

import json
from typing import Optional

import redis

from src.config import get_redis
from src.utils import logger


class SessionSnapshotStore:
    """Store workflow snapshot per session in Redis."""

    def __init__(self):
        self.redis = get_redis()
        self.prefix = "workflow:snapshot:"
        self.ttl_seconds = 3600

    def save(self, session_id: str, state: dict) -> None:
        key = f"{self.prefix}{session_id}"
        try:
            self.redis.setex(key, self.ttl_seconds, json.dumps(state, ensure_ascii=False))
        except Exception as exc:
            logger.debug(f"save snapshot skipped: {exc}")

    def load(self, session_id: str) -> Optional[dict]:
        key = f"{self.prefix}{session_id}"
        try:
            raw = self.redis.get(key)
            if raw is None:
                return None
            return json.loads(raw)
        except Exception as exc:
            logger.debug(f"load snapshot skipped: {exc}")
            return None


_store: Optional[SessionSnapshotStore] = None


def get_session_snapshot_store() -> SessionSnapshotStore:
    """Return singleton snapshot store."""

    global _store
    if _store is None:
        _store = SessionSnapshotStore()
    return _store
