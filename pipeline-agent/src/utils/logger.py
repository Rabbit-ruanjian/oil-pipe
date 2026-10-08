"""
日志配置
使用 loguru 提供统一的日志管理
"""

import sys
from pathlib import Path
from loguru import logger

from src.config import settings


def setup_logger():
    """配置日志"""
    # 移除默认处理器
    logger.remove()

    # 日志格式
    log_format = (
        "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
        "<level>{level: <8}</level> | "
        "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
        "<level>{message}</level>"
    )

    # 控制台输出
    logger.add(
        sys.stdout,
        format=log_format,
        level=settings.LOG_LEVEL,
        colorize=True
    )

    # 文件输出
    if settings.LOG_FILE:
        log_path = Path(settings.LOG_FILE)
        log_path.parent.mkdir(parents=True, exist_ok=True)

        logger.add(
            settings.LOG_FILE,
            format=log_format,
            level=settings.LOG_LEVEL,
            rotation="10 MB",
            retention="7 days",
            compression="zip",
            encoding="utf-8"
        )

    return logger


# 初始化日志
setup_logger()

# 导出logger实例
__all__ = ["logger"]
