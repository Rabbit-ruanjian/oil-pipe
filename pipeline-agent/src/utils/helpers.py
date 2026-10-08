"""
辅助工具函数
"""

import time
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict
from functools import wraps


def generate_session_id() -> str:
    """生成会话ID"""
    return str(uuid.uuid4())


def generate_task_id() -> str:
    """生成任务ID"""
    return f"task_{uuid.uuid4().hex[:8]}"


def generate_trace_id() -> str:
    """生成追踪ID"""
    return f"trace_{uuid.uuid4().hex[:12]}"


def now_iso() -> str:
    """当前时间ISO字符串"""
    return datetime.now().isoformat()


def timer(func):
    """计时装饰器"""
    @wraps(func)
    async def async_wrapper(*args, **kwargs):
        start = time.perf_counter()
        result = await func(*args, **kwargs)
        elapsed = int((time.perf_counter() - start) * 1000)
        return result, elapsed

    @wraps(func)
    def sync_wrapper(*args, **kwargs):
        start = time.perf_counter()
        result = func(*args, **kwargs)
        elapsed = int((time.perf_counter() - start) * 1000)
        return result, elapsed

    if asyncio_iscoroutinefunction(func):
        return async_wrapper
    return sync_wrapper


def asyncio_iscoroutinefunction(func):
    """检查是否是异步函数"""
    import asyncio
    return asyncio.iscoroutinefunction(func)


def decimal_to_float(obj: Any) -> Any:
    """递归将Decimal转换为float"""
    if isinstance(obj, Decimal):
        return float(obj)
    elif isinstance(obj, dict):
        return {k: decimal_to_float(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [decimal_to_float(item) for item in obj]
    return obj


def format_number(value: float, precision: int = 4) -> str:
    """格式化数字显示"""
    if abs(value) >= 1e6:
        return f"{value:.2e}"
    elif abs(value) >= 1:
        return f"{value:.{precision}f}"
    elif abs(value) >= 0.0001:
        return f"{value:.{precision}f}"
    else:
        return f"{value:.2e}"


def truncate_text(text: str, max_length: int = 500, suffix: str = "...") -> str:
    """截断文本"""
    if len(text) <= max_length:
        return text
    return text[:max_length - len(suffix)] + suffix


def merge_dicts(*dicts: Dict) -> Dict:
    """合并多个字典"""
    result = {}
    for d in dicts:
        if d:
            result.update(d)
    return result


def safe_get(data: dict, *keys, default=None):
    """安全获取嵌套字典值"""
    for key in keys:
        if isinstance(data, dict):
            data = data.get(key, default)
        else:
            return default
    return data


def parse_flow_rate(value: Any) -> Decimal:
    """解析流量值，统一单位为 m³/h"""
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    elif isinstance(value, Decimal):
        return value
    elif isinstance(value, str):
        value = value.strip().lower()
        # 处理不同单位
        if "m3/h" in value or "m³/h" in value:
            num = value.replace("m3/h", "").replace("m³/h", "").strip()
            return Decimal(num)
        elif "l/s" in value:
            num = value.replace("l/s", "").strip()
            return Decimal(num) * Decimal("3.6")  # L/s -> m³/h
        else:
            return Decimal(value)
    raise ValueError(f"无法解析流量值: {value}")


def calculate_inner_diameter(outer_diameter: Decimal, thickness: Decimal) -> Decimal:
    """计算管道内径 (mm)"""
    return outer_diameter - 2 * thickness
