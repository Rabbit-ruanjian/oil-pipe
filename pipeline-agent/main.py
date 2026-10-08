"""
Pipeline Agent 启动入口
"""

import uvicorn

from src.config import settings


def main():
    """启动服务"""
    print(f"""
    ╔══════════════════════════════════════════════════════════╗
    ║           Pipeline Agent - 管道能耗智能体系统              ║
    ║                      Version 4.0.0                        ║
    ╠══════════════════════════════════════════════════════════╣
    ║  API Server: http://{settings.API_HOST}:{settings.API_PORT}                         ║
    ║  API Docs:   http://{settings.API_HOST}:{settings.API_PORT}/docs                    ║
    ║  Debug Mode: {str(settings.DEBUG):<44} ║
    ╚══════════════════════════════════════════════════════════╝
    """)

    uvicorn.run(
        "src.api.main:app",
        host=settings.API_HOST,
        port=settings.API_PORT,
        reload=settings.DEBUG,
        workers=1 if settings.DEBUG else settings.API_WORKERS,
        log_level="info" if settings.DEBUG else "warning"
    )


if __name__ == "__main__":
    main()
