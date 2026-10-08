"""FastAPI application entrypoint."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import settings
from src.utils import logger

from .middleware.auth import AuthMiddleware
from .middleware.logging import LoggingMiddleware
from .routes import health, chat, chat_v2, mcp_v2, knowledge, trace, graph_query, reports


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting %s v%s", settings.APP_NAME, settings.APP_VERSION)
    logger.info("Debug mode: %s", settings.DEBUG)

    try:
        from src.mcp import (
            ensure_builtin_mcp_servers_async,
            get_mcp_hub,
        )

        mcp_hub = get_mcp_hub()
        ready_servers = await ensure_builtin_mcp_servers_async()
        total_tools = 0

        for server_name in ready_servers:
            tool_defs = await mcp_hub.list_tools(server_name)
            total_tools += len(tool_defs)
            logger.info("MCP server ready: %s, tools=%s", server_name, len(tool_defs))

        logger.info("MCP hub initialized: servers=%s, total_tools=%s", mcp_hub.server_names(), total_tools)
    except Exception as exc:  # noqa: BLE001
        logger.warning("MCP hub initialization failed (non-fatal): %s", exc)

    try:
        from src.workflows import get_workflow

        get_workflow()
        logger.info("Agent workflow initialized")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Workflow initialization failed: %s", exc)

    if settings.SKIP_STARTUP_WARMUP:
        logger.info("Skipping startup warmup because SKIP_STARTUP_WARMUP=true")
    else:
        try:
            from src.rag.pipeline import get_rag_pipeline

            rag = get_rag_pipeline()
            stats = rag.get_stats()
            if not stats.get("exists") or stats.get("num_entities", 0) == 0:
                count = rag.index_documents(knowledge_base_path="knowledge_base", recreate=False)
                logger.info("Knowledge base startup index finished, documents=%s", count)
            else:
                sparse_chunks = rag.ensure_retriever_ready()
                logger.info(
                    "Knowledge base collection already exists, skip startup re-index: entities=%s, sparse_chunks=%s",
                    stats.get("num_entities", 0),
                    sparse_chunks,
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Knowledge base initialization failed (non-fatal): %s", exc)

    try:
        from src.knowledge_graph import get_knowledge_graph_builder

        kg = get_knowledge_graph_builder()
        logger.info(
            "Knowledge graph initialized: nodes=%s, edges=%s",
            kg.graph.number_of_nodes(),
            kg.graph.number_of_edges(),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Knowledge graph initialization failed: %s", exc)

    yield

    logger.info("Shutting down...")

    try:
        from src.rag import get_vector_store

        get_vector_store().close()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Cleanup error: %s", exc)


def create_app() -> FastAPI:
    """Create configured FastAPI application."""

    app = FastAPI(
        title=settings.APP_NAME,
        description="管道能耗智能体系统 API",
        version=settings.APP_VERSION,
        docs_url="/docs" if settings.DEBUG else None,
        redoc_url="/redoc" if settings.DEBUG else None,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.add_middleware(LoggingMiddleware)

    if not settings.DEBUG:
        app.add_middleware(AuthMiddleware)

    app.include_router(health.router, prefix="/api/v1")
    app.include_router(chat.router, prefix="/api/v1")
    app.include_router(knowledge.router, prefix="/api/v1")
    app.include_router(trace.router, prefix="/api/v1")
    app.include_router(graph_query.router, prefix="/api/v1")
    app.include_router(reports.router, prefix="/api/v1")
    app.include_router(chat_v2.router, prefix="/api/v2")
    app.include_router(mcp_v2.router, prefix="/api/v2")

    @app.get("/")
    async def root():
        return {
            "name": settings.APP_NAME,
            "version": settings.APP_VERSION,
            "status": "running",
            "docs": "/docs" if settings.DEBUG else "disabled",
        }

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "src.api.main:app",
        host=settings.API_HOST,
        port=settings.API_PORT,
        reload=settings.DEBUG,
        workers=1 if settings.DEBUG else settings.API_WORKERS,
    )
