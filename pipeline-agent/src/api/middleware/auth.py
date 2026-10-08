"""Authentication middleware for the local agent API."""

from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.middleware.base import BaseHTTPMiddleware

from src.config import settings


class AuthMiddleware(BaseHTTPMiddleware):
    """Require a bearer token unless the request is explicitly public."""

    PUBLIC_PATHS = {
        "/",
        "/docs",
        "/redoc",
        "/openapi.json",
        "/api/v1/health",
        "/api/v1/health/ready",
        "/api/v1/health/live",
    }

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        if path in self.PUBLIC_PATHS or path.startswith("/api/v1/health"):
            return await call_next(request)

        if not settings.AUTH_REQUIRED_IN_PRODUCTION or settings.DEBUG:
            return await call_next(request)

        auth_header = request.headers.get("Authorization")
        if not auth_header:
            internal_key = request.headers.get("X-Internal-Key")
            if internal_key and self._verify_internal_key(internal_key):
                return await call_next(request)
            raise HTTPException(status_code=401, detail="Missing authorization header")

        try:
            scheme, token = auth_header.split()
        except ValueError as exc:
            raise HTTPException(status_code=401, detail="Invalid authorization header") from exc

        if scheme.lower() != "bearer":
            raise HTTPException(status_code=401, detail="Invalid authentication scheme")

        if not self._verify_token(token):
            raise HTTPException(status_code=401, detail="Invalid token")

        return await call_next(request)

    def _verify_token(self, token: str) -> bool:
        return bool(token)

    def _verify_internal_key(self, key: str) -> bool:
        expected_key = getattr(settings, "INTERNAL_API_KEY", None)
        return bool(expected_key) and key == expected_key


class OptionalAuthBearer(HTTPBearer):
    """Optional bearer auth dependency for route-level use."""

    def __init__(self, auto_error: bool = False):
        super().__init__(auto_error=auto_error)

    async def __call__(self, request: Request) -> Optional[HTTPAuthorizationCredentials]:
        try:
            return await super().__call__(request)
        except HTTPException:
            return None


optional_auth = OptionalAuthBearer()
