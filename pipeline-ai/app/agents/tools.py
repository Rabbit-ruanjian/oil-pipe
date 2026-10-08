import json

import requests
from langchain.tools import Tool
from langchain.utilities import SQLDatabase

from app.config import settings
from app.rag.etl import ETLService

db_uri = (
    f"mysql+pymysql://{settings.DB_USER}:{settings.DB_PASSWORD}"
    f"@{settings.DB_HOST}:{settings.DB_PORT}/{settings.DB_NAME}"
)
db = None
etl_service = ETLService()


def get_db():
    global db
    if db is None:
        db = SQLDatabase.from_uri(db_uri)
    return db


def run_sql_query(query: str) -> str:
    """Execute a SQL query against the business database."""
    try:
        return get_db().run(query)
    except Exception as exc:
        return f"SQL Execution Error: {exc}"


sql_tool = Tool(
    name="SQL_Database",
    func=run_sql_query,
    description="用于查询数据库中的结构化数据，例如项目、管道、泵站等。输入必须是有效 SQL。",
)


def query_knowledge_base(query: str) -> str:
    """Query the RAG knowledge base."""
    try:
        results = etl_service.query_knowledge(query)
        return "\n\n".join(results) if results else "未找到相关知识。"
    except Exception as exc:
        return f"Knowledge Base Error: {exc}"


rag_tool = Tool(
    name="Knowledge_Base",
    func=query_knowledge_base,
    description="用于查询知识库中的非结构化资料，例如说明文档、规范和经验总结。",
)


def call_hydraulic_analysis(params_json: str) -> str:
    """Call the Java hydraulic analysis service."""
    try:
        response = requests.post(
            "http://localhost:9500/calculation/hydraulic-analysis",
            data=params_json,
            headers={"Content-Type": "application/json"},
            timeout=30,
        )
        return json.dumps(response.json(), ensure_ascii=False)
    except Exception as exc:
        return f"Calculation Service Error: {exc}"


calculation_tool = Tool(
    name="Hydraulic_Analysis",
    func=call_hydraulic_analysis,
    description="用于执行水力分析计算。输入必须是包含参数的 JSON 字符串。",
)


ALL_TOOLS = [sql_tool, rag_tool, calculation_tool]
