"""Human-in-the-loop state manager."""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass
from enum import Enum
from typing import List, Optional

import redis

from src.config import get_redis
from src.persistence import save_hitl_request, save_hitl_response


class HITLType(str, Enum):
    SCHEME_SELECTION = "scheme_selection"
    PARAMETER_CONFIRM = "parameter_confirm"
    RISK_WARNING = "risk_warning"


@dataclass
class HITLRequest:
    request_id: str
    type: HITLType
    title: str
    description: str
    options: List[dict]
    data: dict
    timeout_seconds: int = 300
    default_option: Optional[str] = None


@dataclass
class HITLResponse:
    request_id: str
    selected_option: Optional[str]
    modified_data: Optional[dict]
    comment: Optional[str]


class HITLManager:
    """Persist HITL requests and responses in Redis."""

    def __init__(self, redis_client: redis.Redis):
        self.redis = redis_client
        self.key_prefix = "hitl:"

    def create_request(self, session_id: str, request: HITLRequest, trace_id: str = "") -> str:
        key = f"{self.key_prefix}{session_id}:{request.request_id}"
        payload = {
            "request_id": request.request_id,
            "trace_id": trace_id,
            "type": request.type.value,
            "title": request.title,
            "description": request.description,
            "options": request.options,
            "data": request.data,
            "default_option": request.default_option,
            "status": "pending",
        }
        self.redis.setex(key, request.timeout_seconds, json.dumps(payload, ensure_ascii=False))
        save_hitl_request(
            request_id=request.request_id,
            trace_id=trace_id,
            session_id=session_id,
            hitl_type=request.type.value,
            request_data=payload,
        )
        return request.request_id

    def get_pending_request(self, session_id: str) -> Optional[dict]:
        pattern = f"{self.key_prefix}{session_id}:*"
        for key in self.redis.scan_iter(pattern):
            raw = self.redis.get(key)
            if raw is None:
                continue
            data = json.loads(raw)
            if data.get("status") == "pending":
                return data
        return None

    def submit_response(self, session_id: str, response: HITLResponse) -> None:
        key = f"{self.key_prefix}{session_id}:{response.request_id}"
        raw = self.redis.get(key)
        if raw is None:
            raise ValueError("HITL request not found or expired")

        data = json.loads(raw)
        data["status"] = "responded"
        data["response"] = {
            "selected_option": response.selected_option,
            "modified_data": response.modified_data,
            "comment": response.comment,
        }
        self.redis.setex(key, 300, json.dumps(data, ensure_ascii=False))
        save_hitl_response(request_id=response.request_id, response_data=data["response"], status="responded")

    async def wait_for_response(self, session_id: str, request_id: str, timeout: int = 300) -> Optional[dict]:
        """Async polling wait for HITL response."""

        key = f"{self.key_prefix}{session_id}:{request_id}"
        deadline = time.time() + timeout

        while time.time() < deadline:
            raw = self.redis.get(key)
            if raw is None:
                return None

            data = json.loads(raw)
            if data.get("status") == "responded":
                return data.get("response")

            await asyncio.sleep(1)

        # timeout
        raw = self.redis.get(key)
        if raw is not None:
            data = json.loads(raw)
            data["status"] = "timeout"
            self.redis.setex(key, 30, json.dumps(data, ensure_ascii=False))
            save_hitl_response(request_id=request_id, response_data={}, status="timeout")
        return None


_hitl_manager: Optional[HITLManager] = None


def get_hitl_manager() -> HITLManager:
    """Return singleton HITL manager backed by Redis."""

    global _hitl_manager
    if _hitl_manager is None:
        redis_client = get_redis()
        _hitl_manager = HITLManager(redis_client=redis_client)
    return _hitl_manager
