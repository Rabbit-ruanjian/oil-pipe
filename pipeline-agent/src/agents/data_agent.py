"""
Data Agent
负责数据库查询操作
"""

import json
from typing import Optional, Dict, Any

from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_classic.agents import AgentExecutor, create_tool_calling_agent

from src.config import settings
from src.skills import get_skill_runtime
from src.tools.database_tools import get_database_schema_guide
from src.tools.mcp_langchain_adapter import get_mcp_langchain_tools
from src.utils import logger


class DataAgent:
    SKILL_NAME = "data-query"

    """
    Data Agent

    职责：
    1. 查询项目、管道、泵站、油品数据
    2. 执行安全的SQL查询
    3. 格式化返回结果
    """

    def __init__(self):
        """初始化Data Agent"""
        self._llm = None
        self._agent_executor = None
        self._skill_runtime = get_skill_runtime()

    def _build_system_prompt(self) -> str:
        base_prompt = self._skill_runtime.get_prompt(self.SKILL_NAME, "system")
        schema_prompt = get_database_schema_guide()
        retry_rules = (
            "\n\n补充规则：\n"
            "1. 只能使用真实表名和真实字段名，绝不允许编造 projects、pipelines 之类的英文复数表名。\n"
            "2. 能用现成查询工具时，优先用现成工具；只有筛选、聚合、排序等现成工具不覆盖时，才调用 execute_safe_sql。\n"
            "3. 如果 SQL 返回表不存在、字段不存在、unknown table、unknown column，必须根据下面 schema 立即改写并重试一次。\n"
            "4. 用户问“负责人是王军的项目有哪些”这类问题时，应查询 t_project.responsible，而不是猜测 projects.owner 之类字段。\n\n"
            f"{schema_prompt}"
        )
        return f"{base_prompt}{retry_rules}"

    @property
    def llm(self) -> ChatOpenAI:
        """获取LLM实例"""
        if self._llm is None:
            model_name = settings.tool_calling_model_name
            if model_name != settings.router_model_name:
                logger.warning(
                    "Router model '{}' does not support tool calling, fallback to '{}'",
                    settings.router_model_name,
                    model_name,
                )
            self._llm = ChatOpenAI(
                api_key=settings.OPENAI_API_KEY,
                base_url=settings.OPENAI_API_BASE,
                model=model_name,
                temperature=0,
                max_tokens=4096,
            )
        return self._llm

    @property
    def agent_executor(self) -> AgentExecutor:
        """获取Agent执行器"""
        if self._agent_executor is None:
            prompt = ChatPromptTemplate.from_messages([
                ("system", self._build_system_prompt()),
                ("human", "{input}"),
                ("placeholder", "{agent_scratchpad}")
            ])
            tools = get_mcp_langchain_tools(
                ["database-mcp"],
                exclude_tools=["query_database"],
            )

            agent = create_tool_calling_agent(
                llm=self.llm,
                tools=tools,
                prompt=prompt
            )

            self._agent_executor = AgentExecutor(
                agent=agent,
                tools=tools,
                verbose=True,
                max_iterations=5,
                handle_parsing_errors=True
            )

        return self._agent_executor

    def execute(self, task: str) -> str:
        """
        执行数据查询任务

        Args:
            task: 任务描述

        Returns:
            查询结果（尽量返回JSON格式字符串）
        """
        try:
            logger.info(f"Data Agent执行任务: {task}")

            task_input = self._skill_runtime.render_prompt(
                self.SKILL_NAME,
                "task",
                {"task": task},
            )

            result = self.agent_executor.invoke({
                "input": task_input
            })

            output = result.get("output", "")
            logger.info(f"Data Agent完成，结果长度: {len(output)}")

            try:
                json.loads(output)
                return output
            except (json.JSONDecodeError, ValueError):
                pass

            start = output.find("{")
            end = output.rfind("}")
            if start != -1 and end > start:
                candidate = output[start:end + 1]
                try:
                    json.loads(candidate)
                    return candidate
                except (json.JSONDecodeError, ValueError):
                    pass

            return json.dumps({"raw": output}, ensure_ascii=False, default=str)

        except Exception as e:
            logger.error(f"Data Agent执行失败: {e}")
            return json.dumps(
                {"success": False, "message": f"数据查询失败: {str(e)}"},
                ensure_ascii=False,
                default=str,
            )

    def query_by_type(self, query_type: str, **kwargs) -> str:
        """
        按类型执行预定义查询

        Args:
            query_type: 查询类型
            **kwargs: 查询参数

        Returns:
            查询结果
        """
        from src.tools.database_tools import (
            query_projects,
            query_project_by_id,
            query_pipelines,
            query_pipeline_detail,
            query_pump_stations,
            query_oil_properties,
            get_calculation_parameters
        )

        try:
            if query_type == "projects":
                return query_projects.invoke(kwargs)
            elif query_type == "project":
                return query_project_by_id.invoke(kwargs)
            elif query_type == "pipelines":
                return query_pipelines.invoke(kwargs)
            elif query_type == "pipeline_detail":
                return query_pipeline_detail.invoke(kwargs)
            elif query_type == "pump_stations":
                pump_args = {"limit": kwargs.get("limit", 20)}
                return query_pump_stations.invoke(pump_args)
            elif query_type == "oil_properties":
                return query_oil_properties.invoke(kwargs)
            elif query_type == "calc_params":
                return get_calculation_parameters.invoke(kwargs)
            else:
                return f"未知的查询类型: {query_type}"

        except Exception as e:
            logger.error(f"预定义查询失败: {e}")
            return f"查询失败: {str(e)}"


# 全局实例
_data_agent: Optional[DataAgent] = None


def get_data_agent() -> DataAgent:
    """获取Data Agent实例"""
    global _data_agent
    if _data_agent is None:
        _data_agent = DataAgent()
    return _data_agent
