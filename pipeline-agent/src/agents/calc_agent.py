"""
Calc Agent
负责水力学计算
"""

import json
from typing import Optional, Dict, Any

from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_classic.agents import AgentExecutor, create_tool_calling_agent

from src.config import settings
from src.skills import get_skill_runtime
from src.tools.mcp_langchain_adapter import get_mcp_langchain_tools
from src.utils import logger


class CalcAgent:
    SKILL_NAME = "hydraulic-calc"

    """
    Calc Agent

    职责：
    1. 执行本地水力学计算（雷诺数、摩阻等）
    2. 调用Java服务进行复杂计算
    3. 解释计算结果
    """

    def __init__(self):
        """初始化Calc Agent"""
        self._llm = None
        self._agent_executor = None
        self.tools = None
        self._skill_runtime = get_skill_runtime()

    @property
    def llm(self) -> ChatOpenAI:
        """获取LLM实例"""
        if self._llm is None:
            self._llm = ChatOpenAI(
                api_key=settings.OPENAI_API_KEY,
                base_url=settings.OPENAI_API_BASE,
                model=settings.LLM_MODEL,
                temperature=0,
                max_tokens=4096,
            )
        return self._llm

    @property
    def agent_executor(self) -> AgentExecutor:
        """获取Agent执行器"""
        if self._agent_executor is None:
            if self.tools is None:
                self.tools = get_mcp_langchain_tools(
                    ["calculation-mcp"],
                    exclude_tools=["hydraulic_calculation", "run_sensitivity_analysis"],
                )
            prompt = ChatPromptTemplate.from_messages([
                ("system", self._skill_runtime.get_prompt(self.SKILL_NAME, "system")),
                ("human", "{input}"),
                ("placeholder", "{agent_scratchpad}")
            ])

            agent = create_tool_calling_agent(
                llm=self.llm,
                tools=self.tools,
                prompt=prompt
            )

            self._agent_executor = AgentExecutor(
                agent=agent,
                tools=self.tools,
                verbose=True,
                max_iterations=5,
                handle_parsing_errors=True
            )

        return self._agent_executor

    def execute(self, task: str, available_data: Dict = None) -> str:
        """
        执行计算任务

        Args:
            task: 任务描述
            available_data: 已有的数据（如管道参数、油品参数等）

        Returns:
            计算结果
        """
        try:
            logger.info(f"Calc Agent执行任务: {task}")

            # 构建输入
            data_str = ""
            if available_data:
                data_str = json.dumps(available_data, ensure_ascii=False, indent=2, default=str)
            else:
                data_str = "无预置数据，需要从用户输入中提取参数"

            input_text = self._skill_runtime.render_prompt(
                self.SKILL_NAME,
                "task",
                {
                    "task": task,
                    "available_data": data_str,
                },
            )

            result = self.agent_executor.invoke({
                "input": input_text
            })

            output = result.get("output", "")
            logger.info(f"Calc Agent完成，结果长度: {len(output)}")

            return output

        except Exception as e:
            logger.error(f"Calc Agent执行失败: {e}")
            return f"计算失败: {str(e)}"

    def calculate_reynolds(
        self,
        flow_rate: float,
        diameter: float,
        viscosity: float
    ) -> str:
        """直接计算雷诺数"""
        from src.tools.calculation_tools import calculate_reynolds_number

        return calculate_reynolds_number.invoke({
            "flow_rate": flow_rate,
            "diameter": diameter,
            "viscosity": viscosity
        })

    def calculate_hydraulics(
        self,
        flow_rate: float,
        diameter: float,
        length: float,
        density: float,
        viscosity: float,
        roughness: float = 0.03,
        start_elevation: float = 0,
        end_elevation: float = 0
    ) -> str:
        """直接执行水力分析"""
        from src.tools.calculation_tools import calculate_hydraulic_analysis

        return calculate_hydraulic_analysis.invoke({
            "flow_rate": flow_rate,
            "diameter": diameter,
            "length": length,
            "density": density,
            "viscosity": viscosity,
            "roughness": roughness,
            "start_elevation": start_elevation,
            "end_elevation": end_elevation
        })

    def call_java_hydraulics(
        self,
        flow_rate: float,
        density: float,
        viscosity: float,
        length: float,
        diameter: float,
        thickness: float,
        **kwargs
    ) -> str:
        """调用Java水力分析服务"""
        from src.tools.java_service_tools import call_hydraulic_analysis

        return call_hydraulic_analysis.invoke({
            "flow_rate": flow_rate,
            "density": density,
            "viscosity": viscosity,
            "length": length,
            "diameter": diameter,
            "thickness": thickness,
            **kwargs
        })


# 全局实例
_calc_agent: Optional[CalcAgent] = None


def get_calc_agent() -> CalcAgent:
    """获取Calc Agent实例"""
    global _calc_agent
    if _calc_agent is None:
        _calc_agent = CalcAgent()
    return _calc_agent
