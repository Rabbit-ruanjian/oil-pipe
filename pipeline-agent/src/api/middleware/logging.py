"""
日志中间件
记录请求和响应
"""

import time
import uuid
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from src.utils import logger


class LoggingMiddleware(BaseHTTPMiddleware):
    """
    日志中间件

    记录每个请求的详细信息
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # 生成请求ID
        request_id = str(uuid.uuid4())[:8]
        request.state.request_id = request_id

        # 记录请求开始
        start_time = time.perf_counter()

        # 请求信息
        method = request.method
        url = str(request.url)
        client_ip = request.client.host if request.client else "unknown"

        logger.info(
            f"[{request_id}] --> {method} {url} | IP: {client_ip}"
        )

        # 执行请求
        try:
            response = await call_next(request)

            # 计算耗时
            duration = time.perf_counter() - start_time
            duration_ms = int(duration * 1000)

            # 记录响应
            status_code = response.status_code
            logger.info(
                f"[{request_id}] <-- {status_code} | {duration_ms}ms"
            )

            # 添加响应头
            response.headers["X-Request-ID"] = request_id
            response.headers["X-Response-Time"] = f"{duration_ms}ms"

            return response

        except Exception as e:
            # 记录错误
            duration = time.perf_counter() - start_time
            duration_ms = int(duration * 1000)

            logger.error(
                f"[{request_id}] <-- ERROR: {str(e)} | {duration_ms}ms"
            )
            raise
