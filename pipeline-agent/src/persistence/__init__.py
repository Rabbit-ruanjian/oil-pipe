"""Persistence module exports."""

from .repository import (
    save_trace_start,
    save_trace_end,
    save_trace_event,
    save_hitl_request,
    save_hitl_response,
    load_trace_summary,
    upsert_kg_node,
    upsert_kg_edge,
)

# P2 技术债（报告 §2.6）：upsert_kg_node / upsert_kg_edge 是 MySQL t_kg_node/edge
# 的死代码——全仓无业务调用方，真图谱在 JSON 文件。函数在 repository.py 保留
# （加 DEPRECATED 注释）以给将来接上关系库时复用，但从模块导出移除，避免误用。
__all__ = [
    "save_trace_start",
    "save_trace_end",
    "save_trace_event",
    "save_hitl_request",
    "save_hitl_response",
    "load_trace_summary",
]
