# P0-③ 可插拔 pre-execution hook 基础设施。
#
# 设计原则（报告 §4 P0-③）：
# - 新增功能只做"可插拔的前置钩子"，不碰 enrich 框架本身。
# - 钩子位置（挂死两处）：
#   1. 入库前（A 类）：save_upload 解析落盘之后、upsert_document 抽实体之前
#   2. 检索前（B 类）：self_rag 主循环改写之后、plan_routes/retriever 执行之前
# - 开关驱动：每个功能独立开关，默认关闭；关闭时走原路径，行为与现状逐字节一致。
# - 降级兜底：任一 hook 内部异常/超时 → 捕获并 logger 记录、跳过该 hook 直接执行，
#   不阻断主流程。
#
# 协议说明：
#   PreIngestionHook:
#     __call__(*, document, pipeline, registry, root_path: str) -> Optional[dict]
#     - document: 解析后的 Document 对象（processor.load_document 的返回值）
#     - pipeline: get_rag_pipeline() 返回的 RAGPipeline 实例
#     - registry: KnowledgeBaseRegistry 实例
#     - root_path: 知识库根路径字符串
#     返回：None 表示"跳过"；dict 表示增强结果；异常由 run_pre_ingestion_hooks 捕获降级。
#
#   PreRetrievalHook:
#     __call__(*, query: str, decision, top_k: int, category_filter) -> str
#     - query: 已改写后的查询串（rewrite 之后）
#     - decision: RetrievalDecision 枚举值
#     - top_k: 当前检索数量
#     - category_filter: 分类过滤条件（可为 None）
#     返回：修改后的查询串；异常由 run_pre_retrieval_hooks 捕获降级。

from __future__ import annotations

import logging
from typing import Any, Callable, Optional, Protocol, runtime_checkable

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Hook 协议（形式化签名，用于注册时做类型检查；运行时靠鸭子类型）
# ---------------------------------------------------------------------------

@runtime_checkable
class PreIngestionHook(Protocol):
    # 入库前 hook 协议。
    # 签名：__call__(*, document, pipeline, registry, root_path: str) -> Optional[dict]
    # 任何异常由 run_pre_ingestion_hooks 统一捕获并降级。

    def __call__(
        self,
        *,
        document: Any,
        pipeline: Any,
        registry: Any,
        root_path: str,
    ) -> Optional[dict[str, Any]]:
        ...


@runtime_checkable
class PreRetrievalHook(Protocol):
    # 检索前 hook 协议。
    # 签名：__call__(*, query: str, decision, top_k: int, category_filter) -> str
    # 返回修改后的查询串；异常由 run_pre_retrieval_hooks 统一捕获并降级。

    def __call__(
        self,
        *,
        query: str,
        decision: Any,
        top_k: int,
        category_filter: Optional[str] = None,
    ) -> str:
        ...


# ---------------------------------------------------------------------------
# Hook 注册表
# ---------------------------------------------------------------------------

_ingestion_hooks: list[Callable[..., Optional[dict[str, Any]]]] = []
_retrieval_hooks: list[Callable[..., str]] = []


def register_pre_ingestion_hook(
    hook: Callable[..., Optional[dict[str, Any]]],
    *,
    name: Optional[str] = None,
) -> None:
    """注册一个入库前 hook。

    Args:
        hook: 符合 PreIngestionHook 协议的可调用对象。
        name: 可选的人类可读名称，用于日志标识。
    """
    label = name or getattr(hook, "__qualname__", "unknown_hook")
    _ingestion_hooks.append(hook)
    logger.debug(f"Registered pre-ingestion hook: {label}")


def register_pre_retrieval_hook(
    hook: Callable[..., str],
    *,
    name: Optional[str] = None,
) -> None:
    """注册一个检索前 hook。

    Args:
        hook: 符合 PreRetrievalHook 协议的可调用对象。
        name: 可选的人类可读名称，用于日志标识。
    """
    label = name or getattr(hook, "__qualname__", "unknown_hook")
    _retrieval_hooks.append(hook)
    logger.debug(f"Registered pre-retrieval hook: {label}")


def clear_hooks() -> None:
    """清空所有已注册的 hooks（测试用）。"""
    _ingestion_hooks.clear()
    _retrieval_hooks.clear()


# ---------------------------------------------------------------------------
# 执行入口（带降级兜底）
# ---------------------------------------------------------------------------

def run_pre_ingestion_hooks(
    *,
    document: Any,
    pipeline: Any,
    registry: Any,
    root_path: str,
) -> list[dict[str, Any]]:
    """按顺序执行所有已注册的入库前 hooks。

    每个 hook 失败（抛异常）时自动降级：记录 warning、跳过该 hook，
    继续执行下一个 hook，绝不阻断主链路。

    Returns:
        各成功执行 hook 的返回结果列表（None 结果被过滤）。
    """
    results: list[dict[str, Any]] = []
    for hook in _ingestion_hooks:
        label = getattr(hook, "__qualname__", "pre_ingestion_hook")
        try:
            result = hook(
                document=document,
                pipeline=pipeline,
                registry=registry,
                root_path=root_path,
            )
            if result is not None:
                results.append(result)
        except Exception as exc:
            logger.warning(
                f"Pre-ingestion hook '{label}' failed, skipping (degraded): {exc}"
            )
    return results


def run_pre_retrieval_hooks(
    *,
    query: str,
    decision: Any,
    top_k: int,
    category_filter: Optional[str] = None,
) -> str:
    """按顺序执行所有已注册的检索前 hooks，返回最终查询串。

    每个 hook 接收当前查询串并返回修改后的查询串。
    每个 hook 失败（抛异常）时自动降级：记录 warning、跳过该 hook，
    查询串保持不变，继续执行下一个 hook，绝不阻断主链路。

    Returns:
        所有 hook 依次处理后最终的查询串（若全部失败则返回原 query）。
    """
    current_query = query
    for hook in _retrieval_hooks:
        label = getattr(hook, "__qualname__", "pre_retrieval_hook")
        try:
            updated = hook(
                query=current_query,
                decision=decision,
                top_k=top_k,
                category_filter=category_filter,
            )
            if isinstance(updated, str) and updated:
                current_query = updated
        except Exception as exc:
            logger.warning(
                f"Pre-retrieval hook '{label}' failed, skipping (degraded): {exc}"
            )
    return current_query
