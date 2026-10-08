"""
Pipeline Agent 配置管理
版本: 2026年03月
"""

from functools import lru_cache
from typing import Literal, Optional
from urllib.parse import urlparse

import redis as redis_lib
from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """应用配置 - 从环境变量加载"""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ===== 应用配置 =====
    APP_NAME: str = "Pipeline Agent"
    APP_VERSION: str = "4.1.0"
    DEBUG: bool = False

    # ===== LLM 配置 =====
    DASHSCOPE_API_KEY: Optional[str] = Field(default=None)
    OPENAI_API_KEY: str = Field(
        ...,
        validation_alias=AliasChoices("OPENAI_API_KEY", "DASHSCOPE_API_KEY"),
    )
    OPENAI_API_BASE: str = Field(default="https://api.penguinsaichat.dpdns.org/v1")
    LLM_MODEL: str = Field(default="claude-opus-4-6")
    ROUTER_MODEL: Optional[str] = Field(
        default=None,
        description="Lightweight model for routing, intent recognition, and query rewrite",
    )
    ROUTER_MODEL_SUPPORTS_TOOL_CALLING: bool = Field(
        default=True,
        description="Whether ROUTER_MODEL supports native tool calling; fallback to LLM_MODEL when false",
    )
    GRAPH_EXTRACT_MODEL: Optional[str] = Field(
        default=None,
        description="Legacy alias for graph-query extraction model; prefer GRAPH_QUERY_MODEL",
    )
    GRAPH_QUERY_MODEL: Optional[str] = Field(
        default=None,
        description="Model used for graph-query entity extraction and query-time graph parsing",
    )
    FINAL_SYNTHESIS_MODEL: Optional[str] = Field(
        default=None,
        description="High-quality model used for final answer synthesis",
    )
    LLM_TEMPERATURE: float = Field(default=0.1)
    LLM_MAX_TOKENS: int = Field(default=4096)

    # ===== 分层模型路由配置 =====
    LLM_LIGHT_MODEL: str = Field(default="claude-haiku-3-5")
    LLM_MEDIUM_MODEL: str = Field(default="claude-sonnet-4")
    LLM_HEAVY_MODEL: str = Field(default="claude-opus-4-6")

    # ===== Embedding 配置 =====
    EMBEDDING_API_KEY: str = Field(
        ...,
        validation_alias=AliasChoices("EMBEDDING_API_KEY", "DASHSCOPE_API_KEY", "OPENAI_API_KEY"),
    )
    EMBEDDING_API_BASE: str = Field(default="https://dashscope.aliyuncs.com/compatible-mode/v1")
    EMBEDDING_MODEL: str = Field(default="text-embedding-v3")
    EMBEDDING_DIMENSION: int = Field(default=1024)

    # ===== 数据库配置 =====
    DB_HOST: str = Field(default="localhost")
    DB_PORT: int = Field(default=3306)
    DB_USER: str = Field(default="root")
    DB_PASSWORD: str = Field(...)
    DB_NAME: str = Field(default="pipeline_cloud")

    SQL_QUERY_TIMEOUT_SECONDS: int = Field(default=30)
    SQL_CONNECT_TIMEOUT_SECONDS: int = Field(default=10)
    SQL_MAX_LIMIT: int = Field(default=100)
    SQL_ALLOWED_TABLES: str = Field(
        default="t_project,t_pipeline,t_pump_station,t_oil_property,t_calculation_history,t_calculation_result,t_sensitivity_analysis,t_kg_node,t_kg_edge,t_agent_trace,t_agent_trace_event,t_hitl_record"
    )
    SQL_BLOCKED_TABLES: str = Field(
        default="sys_user,sys_role,sys_menu,sys_config,sys_dict_data,sys_dict_type,sys_logininfor,sys_oper_log"
    )

    @property
    def DATABASE_URL(self) -> str:
        return f"mysql+pymysql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    @property
    def ASYNC_DATABASE_URL(self) -> str:
        return f"mysql+aiomysql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    # ===== Redis 配置 =====
    REDIS_HOST: str = Field(default="localhost")
    REDIS_PORT: int = Field(default=6379)
    REDIS_PASSWORD: str = Field(default="")
    REDIS_DB: int = Field(default=0)

    @property
    def REDIS_URL(self) -> str:
        if self.REDIS_PASSWORD:
            return f"redis://:{self.REDIS_PASSWORD}@{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"

    # ===== Milvus 配置 =====
    MILVUS_HOST: str = Field(default="localhost")
    MILVUS_PORT: int = Field(default=19530)
    MILVUS_COLLECTION: str = Field(default="pipeline_knowledge")

    # ===== Java 服务配置 =====
    JAVA_GATEWAY_URL: str = Field(default="http://localhost:8080")
    JAVA_ALLOWED_HOSTS: str = Field(default="localhost,127.0.0.1,::1")
    JAVA_AUTH_USERNAME: str = Field(default="admin")
    JAVA_AUTH_PASSWORD: str = Field(...)
    JAVA_REQUEST_TIMEOUT: int = Field(default=30)

    # ===== Workflow 持久化配置 =====
    CHECKPOINT_BACKEND: Literal["memory", "redis"] = Field(default="memory")
    CHECKPOINT_REDIS_URL: str = Field(default="redis://localhost:6379/1")
    CHECKPOINT_PENDING_TTL_SECONDS: int = Field(default=1800)

    # ===== Agent 配置 =====
    AGENT_MAX_ITERATIONS: int = Field(default=10)
    AGENT_MAX_RETRIES_PER_STEP: int = Field(default=2)
    AGENT_TIMEOUT: int = Field(default=60)

    # ===== Tool Search 配置 =====
    TOOL_SEARCH_ENABLED: bool = Field(default=True)
    TOOL_SEARCH_TOP_K: int = Field(default=3)
    TOOL_SEARCH_MIN_SCORE: float = Field(default=0.05)
    TOOL_SEARCH_ALLOWED_CATEGORIES: str = Field(
        default="",
        description="Comma-separated tool categories allowed in dynamic search",
    )
    TOOL_SEARCH_ALLOWED_SOURCES: str = Field(
        default="",
        description="Comma-separated tool sources allowed in dynamic search",
    )

    # ===== 工具守卫 =====
    TOOL_MAX_CALLS_PER_SESSION: int = Field(default=20)
    TOOL_MAX_CALLS_PER_TOOL: int = Field(default=10)

    # ===== RAG 配置 =====
    RAG_CHUNK_SIZE: int = Field(default=512)
    RAG_CHUNK_OVERLAP: int = Field(default=50)
    RAG_CHUNKING_METHOD: Literal["semantic", "fixed", "sentence"] = Field(default="semantic")
    RAG_TOP_K: int = Field(default=10)
    RAG_FINAL_K: int = Field(default=5)
    RAG_DENSE_WEIGHT: float = Field(default=0.7)
    RAG_SPARSE_WEIGHT: float = Field(default=0.3)
    RAG_USE_HYPE: bool = Field(default=True)
    RAG_ENABLE_EXPERIMENTAL_HYPE: bool = Field(default=False)
    RAG_USE_CONTEXTUAL: bool = Field(default=True)
    RAG_USE_CRAG: bool = Field(default=True)
    RAG_USE_SELF_RAG: bool = Field(default=True)
    RAG_USE_QUERY_REWRITE: bool = Field(default=True)
    RAG_USE_RERANKING: bool = Field(default=True)
    HYPE_QUESTIONS_PER_CHUNK: int = Field(default=3)
    RERANKER_MODEL: str = Field(default="gte-rerank")
    RERANKER_THRESHOLD: float = Field(default=0.5)
    RERANKER_MODE: Literal["api", "local", "llm"] = Field(
        default="api",
        description="api=DashScope gte-rerank; local=本地BGE模型; llm=用LLM打分",
    )

    # ===== Knowledge Base Ingestion =====
    KB_ALLOWED_EXTENSIONS: str = Field(default="md,txt,pdf,docx")
    KB_REQUIRED_METADATA_FIELDS: str = Field(default="title,source,category,tags")
    KB_MAX_FILE_SIZE_MB: int = Field(default=50)
    KB_DEFAULT_LANGUAGE: str = Field(default="zh-CN")

    # ===== API 配置 =====
    API_HOST: str = Field(default="0.0.0.0")
    API_PORT: int = Field(default=8100)
    API_WORKERS: int = Field(default=4)
    CORS_ALLOWED_ORIGINS: str = Field(default="http://localhost:5173,http://127.0.0.1:5173")
    SKIP_STARTUP_WARMUP: bool = Field(default=False)

    # ===== 认证配置 =====
    AUTH_REQUIRED_IN_PRODUCTION: bool = Field(default=True)
    INTERNAL_SERVICE_TOKEN: str = Field(default="")
    INTERNAL_API_KEY: str = Field(default="")
    ALLOWED_BEARER_TOKENS: str = Field(default="")
    TRUSTED_GATEWAY_IPS: str = Field(default="127.0.0.1,::1")

    # ===== 日志配置 =====
    LOG_LEVEL: str = Field(default="INFO")
    LOG_FILE: Optional[str] = Field(default="logs/agent.log")

    # ===== LangSmith 追踪 (可选) =====
    LANGCHAIN_TRACING_V2: bool = Field(default=False)
    LANGCHAIN_API_KEY: Optional[str] = Field(default=None)
    LANGCHAIN_PROJECT: str = Field(default="pipeline-agent")

    @field_validator("OPENAI_API_KEY", "EMBEDDING_API_KEY")
    @classmethod
    def _validate_required_secret(cls, value: str) -> str:
        text = str(value or "").strip()
        invalid_values = {"", "sk-xxx", "password", "changeme", "your-api-key", "sk-your-api-key"}
        if text in invalid_values:
            raise ValueError("必须通过环境变量提供真实凭据，禁止使用占位值或弱默认值")
        return text

    @model_validator(mode="after")
    def _validate_auth_and_url(self):
        weak_local_values = {"", "password", "changeme", "your-api-key", "sk-your-api-key"}
        weak_production_values = weak_local_values | {"root", "admin123"}

        if str(self.DB_PASSWORD or "").strip() in weak_local_values:
            raise ValueError("DB_PASSWORD 必须提供有效值")

        if str(self.JAVA_AUTH_PASSWORD or "").strip() in weak_local_values:
            raise ValueError("JAVA_AUTH_PASSWORD 必须提供有效值")

        if self.AUTH_REQUIRED_IN_PRODUCTION:
            if str(self.DB_PASSWORD or "").strip() in weak_production_values:
                raise ValueError("生产模式下 DB_PASSWORD 不能使用弱默认值")

            if str(self.JAVA_AUTH_PASSWORD or "").strip() in weak_production_values:
                raise ValueError("生产模式下 JAVA_AUTH_PASSWORD 不能使用弱默认值")

        if self.AUTH_REQUIRED_IN_PRODUCTION:
            if not (self.INTERNAL_SERVICE_TOKEN or self.INTERNAL_API_KEY or self.allowed_bearer_tokens):
                raise ValueError(
                    "AUTH_REQUIRED_IN_PRODUCTION=true 时，必须配置 INTERNAL_SERVICE_TOKEN/INTERNAL_API_KEY/ALLOWED_BEARER_TOKENS 中至少一种"
                )

        parsed = urlparse(self.JAVA_GATEWAY_URL)
        host = (parsed.hostname or "").strip().lower()
        if not host:
            raise ValueError("JAVA_GATEWAY_URL 缺少有效主机名")
        if self.java_allowed_hosts and host not in self.java_allowed_hosts:
            raise ValueError(f"JAVA_GATEWAY_URL 主机 {host} 不在白名单中")
        return self

    @property
    def cors_origins(self) -> list[str]:
        raw = str(self.CORS_ALLOWED_ORIGINS or "").strip()
        if not raw:
            return []
        if raw == "*":
            return ["*"]
        return [item.strip() for item in raw.split(",") if item.strip()]

    @property
    def allowed_bearer_tokens(self) -> list[str]:
        return [item.strip() for item in str(self.ALLOWED_BEARER_TOKENS or "").split(",") if item.strip()]

    @property
    def trusted_gateway_ips(self) -> list[str]:
        return [item.strip() for item in str(self.TRUSTED_GATEWAY_IPS or "").split(",") if item.strip()]

    @property
    def java_allowed_hosts(self) -> set[str]:
        return {item.strip().lower() for item in str(self.JAVA_ALLOWED_HOSTS or "").split(",") if item.strip()}

    @property
    def sql_allowed_tables(self) -> set[str]:
        return {item.strip().lower() for item in str(self.SQL_ALLOWED_TABLES or "").split(",") if item.strip()}

    @property
    def sql_blocked_tables(self) -> set[str]:
        return {item.strip().lower() for item in str(self.SQL_BLOCKED_TABLES or "").split(",") if item.strip()}

    @property
    def kb_allowed_extensions(self) -> list[str]:
        return [item.strip().lower() for item in str(self.KB_ALLOWED_EXTENSIONS or "").split(",") if item.strip()]

    @property
    def kb_required_metadata_fields(self) -> list[str]:
        return [item.strip() for item in str(self.KB_REQUIRED_METADATA_FIELDS or "").split(",") if item.strip()]

    @property
    def router_model_name(self) -> str:
        return str(self.ROUTER_MODEL or self.LLM_MODEL)

    @property
    def tool_calling_model_name(self) -> str:
        if self.ROUTER_MODEL_SUPPORTS_TOOL_CALLING:
            return self.router_model_name
        return str(self.LLM_MODEL)

    @property
    def graph_query_model_name(self) -> str:
        return str(self.GRAPH_QUERY_MODEL or self.GRAPH_EXTRACT_MODEL or self.router_model_name)

    @property
    def graph_extract_model_name(self) -> str:
        return self.graph_query_model_name

    @property
    def final_synthesis_model_name(self) -> str:
        return str(self.FINAL_SYNTHESIS_MODEL or self.LLM_MODEL)


class RAGConfig:
    """RAG Pipeline 配置类"""

    def __init__(self, settings: Settings):
        self.settings = settings

    @property
    def chunking(self) -> dict:
        return {
            "method": self.settings.RAG_CHUNKING_METHOD,
            "chunk_size": self.settings.RAG_CHUNK_SIZE,
            "chunk_overlap": self.settings.RAG_CHUNK_OVERLAP,
            "separators": ["\n\n", "\n", "。", "；", ".", ";"],
        }

    @property
    def retrieval(self) -> dict:
        return {
            "dense_weight": self.settings.RAG_DENSE_WEIGHT,
            "sparse_weight": self.settings.RAG_SPARSE_WEIGHT,
            "top_k": self.settings.RAG_TOP_K,
            "final_k": self.settings.RAG_FINAL_K,
        }

    @property
    def features(self) -> dict:
        return {
            "hype": self.settings.RAG_USE_HYPE,
            "contextual": self.settings.RAG_USE_CONTEXTUAL,
            "crag": self.settings.RAG_USE_CRAG,
            "self_rag": self.settings.RAG_USE_SELF_RAG,
            "query_rewrite": self.settings.RAG_USE_QUERY_REWRITE,
            "reranking": self.settings.RAG_USE_RERANKING,
        }

    @property
    def hype(self) -> dict:
        return {
            "enabled": self.settings.RAG_USE_HYPE and self.settings.RAG_ENABLE_EXPERIMENTAL_HYPE,
            "questions_per_chunk": self.settings.HYPE_QUESTIONS_PER_CHUNK,
        }

    @property
    def reranker(self) -> dict:
        return {
            "enabled": self.settings.RAG_USE_RERANKING,
            "model": self.settings.RERANKER_MODEL,
            "threshold": self.settings.RERANKER_THRESHOLD,
        }


@lru_cache()
def get_settings() -> Settings:
    """获取配置单例"""
    return Settings()


@lru_cache()
def get_rag_config() -> RAGConfig:
    """获取RAG配置单例"""
    return RAGConfig(get_settings())


settings = get_settings()
rag_config = get_rag_config()


_redis_pool: Optional[redis_lib.ConnectionPool] = None


def get_redis_pool() -> redis_lib.ConnectionPool:
    """Return shared Redis connection pool (max 20 connections)."""
    global _redis_pool
    if _redis_pool is None:
        _redis_pool = redis_lib.ConnectionPool.from_url(
            get_settings().REDIS_URL,
            max_connections=20,
            decode_responses=True,
        )
    return _redis_pool


def get_redis() -> redis_lib.Redis:
    """Return a Redis client backed by the shared connection pool."""
    return redis_lib.Redis(connection_pool=get_redis_pool())
