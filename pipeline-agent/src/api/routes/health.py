"""
健康检查路由
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Dict, Any
from sqlalchemy import text

from src.config import settings
from src.utils import logger

router = APIRouter(prefix="/health", tags=["Health"])


class HealthResponse(BaseModel):
    """健康检查响应"""
    status: str
    version: str
    services: Dict[str, Any]


@router.get("", response_model=HealthResponse)
async def health_check():
    """
    健康检查

    检查各服务组件的状态
    """
    services = {}

    # 检查数据库
    try:
        from src.tools.database_tools import get_engine
        engine = get_engine()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        services["database"] = {"status": "up"}
    except Exception as e:
        services["database"] = {"status": "down", "error": str(e)}

    # 检查Redis
    try:
        import redis
        r = redis.from_url(settings.REDIS_URL)
        r.ping()
        services["redis"] = {"status": "up"}
    except Exception as e:
        services["redis"] = {"status": "down", "error": str(e)}

    # 检查Milvus
    try:
        from src.rag import get_vector_store
        vs = get_vector_store()
        stats = vs.get_stats()
        services["milvus"] = {
            "status": "up" if stats.get("exists") else "not_initialized",
            "entities": stats.get("num_entities", 0)
        }
    except Exception as e:
        services["milvus"] = {"status": "down", "error": str(e)}

    # 整体状态
    all_up = all(s.get("status") == "up" for s in services.values())
    status = "healthy" if all_up else "degraded"

    return HealthResponse(
        status=status,
        version=settings.APP_VERSION,
        services=services
    )


@router.get("/ready")
async def readiness_check():
    """
    就绪检查

    用于Kubernetes等容器编排
    """
    return {"ready": True}


@router.get("/live")
async def liveness_check():
    """
    存活检查

    用于Kubernetes等容器编排
    """
    return {"alive": True}
