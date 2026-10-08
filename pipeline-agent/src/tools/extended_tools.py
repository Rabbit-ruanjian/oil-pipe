"""
Extended tool set for sensitivity, statistics, and history queries.
"""

from typing import Optional

import httpx
from langchain_core.tools import tool

from src.tools.java_service_tools import get_java_client
from src.utils import logger


@tool
def call_sensitivity_analysis(
    flow_rate: float,
    pipe_diameter: float,
    pipe_length: float,
    oil_density: float,
    oil_viscosity: float,
    roughness: float,
    start_elevation: float,
    end_elevation: float,
    inlet_pressure: float,
    pump_480_num: int,
    pump_375_num: int,
    pump_480_head: float,
    pump_375_head: float,
    variable_type: str,
    start_percent: float = -20.0,
    end_percent: float = 20.0,
    step_percent: float = 5.0,
) -> str:
    """Call Java sensitivity analysis API for a single variable."""

    try:
        client = get_java_client()
        request_data = {
            "baseParams": {
                "flowRate": flow_rate,
                "diameter": pipe_diameter,
                "thickness": 10,
                "length": pipe_length,
                "density": oil_density,
                "viscosity": oil_viscosity,
                "roughness": roughness,
                "startAltitude": start_elevation,
                "endAltitude": end_elevation,
                "inletPressure": inlet_pressure,
                "pump480Num": pump_480_num,
                "pump375Num": pump_375_num,
                "pump480Head": pump_480_head,
                "pump375Head": pump_375_head,
            },
            "variables": [
                {
                    "variableType": variable_type,
                    "startPercent": start_percent,
                    "endPercent": end_percent,
                    "stepPercent": step_percent,
                }
            ],
            "analysisType": "SINGLE",
        }

        response = client.call_api("/calculation/sensitivity/analyze", method="POST", data=request_data)
        if response.get("code") != 200:
            return f"分析失败: {response.get('msg', '未知错误')}"

        result = response.get("data", {})
        var_results = result.get("variableResults", [])
        lines = ["敏感性分析结果", ""]
        for var_result in var_results:
            lines.append(f"[{var_result.get('variableName', variable_type)}]")
            lines.append(f"敏感系数: {var_result.get('sensitivityCoefficient', 'N/A')}")
            lines.append(f"影响趋势: {var_result.get('trend', 'N/A')}")
            lines.append(f"最大影响: {var_result.get('maxImpactPercent', 'N/A')}%")
            points = var_result.get("dataPoints", [])
            if points:
                lines.append("样例点:")
                for point in points[:5]:
                    lines.append(
                        f"{point.get('changePercent', 0):+.0f}% -> 摩阻变化 {point.get('frictionChangePercent', 0):+.2f}%"
                    )
            lines.append("")

        lines.append(f"总计算次数: {result.get('totalCalculations', 'N/A')}")
        lines.append(f"耗时: {result.get('duration', 'N/A')} ms")
        return "\n".join(lines)
    except httpx.ConnectError:
        logger.error("Unable to connect to Java calculation service")
        return "错误: 无法连接到 Java 计算服务"
    except Exception as exc:  # noqa: BLE001
        logger.error("Sensitivity analysis failed: %s", exc)
        return f"分析失败: {exc}"


@tool
def get_supported_sensitivity_variables() -> str:
    """Get supported sensitivity variables from Java service."""

    try:
        client = get_java_client()
        response = client.call_api("/calculation/sensitivity/variables", method="GET")
        if response.get("code") != 200:
            return f"查询失败: {response.get('msg', '未知错误')}"

        variables = response.get("data", [])
        lines = ["支持的敏感性变量", ""]
        for item in variables:
            lines.append(f"{item.get('code')}: {item.get('name')}")
            lines.append(f"单位: {item.get('unit', 'N/A')}")
            lines.append(
                f"变化范围: {item.get('minChangePercent', -20)}% ~ {item.get('maxChangePercent', 20)}%"
            )
            lines.append("")
        return "\n".join(lines)
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to get sensitivity variables: %s", exc)
        return f"查询失败: {exc}"


@tool
def get_calculation_statistics() -> str:
    """Get calculation overview statistics."""

    try:
        client = get_java_client()
        response = client.call_api("/calculation/statistics/overview", method="GET")
        if response.get("code") != 200:
            return f"查询失败: {response.get('msg', '未知错误')}"

        data = response.get("data", {})
        return "\n".join(
            [
                "计算统计概览",
                "",
                f"总计算次数: {data.get('totalCount', 0)}",
                f"成功次数: {data.get('successCount', 0)}",
                f"失败次数: {data.get('failedCount', 0)}",
                f"成功率: {data.get('successRate', 0):.2f}%",
                f"水力分析次数: {data.get('hydraulicCount', 0)}",
                f"优化分析次数: {data.get('optimizationCount', 0)}",
                f"今日次数: {data.get('todayCount', 0)}",
                f"本周次数: {data.get('weekCount', 0)}",
                f"本月次数: {data.get('monthCount', 0)}",
                f"平均水力分析耗时: {data.get('avgHydraulicDuration', 0):.2f} ms",
                f"平均优化分析耗时: {data.get('avgOptimizationDuration', 0):.2f} ms",
                f"活跃用户数: {data.get('activeUserCount', 0)}",
                f"活跃项目数: {data.get('activeProjectCount', 0)}",
            ]
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to get calculation statistics: %s", exc)
        return f"查询失败: {exc}"


@tool
def get_daily_calculation_trend(days: int = 7) -> str:
    """Get recent daily calculation trend."""

    try:
        client = get_java_client()
        response = client.call_api(
            "/calculation/statistics/trend/daily",
            method="GET",
            params={"days": days},
        )
        if response.get("code") != 200:
            return f"查询失败: {response.get('msg', '未知错误')}"

        data = response.get("data", {})
        daily_stats = data.get("dailyStatistics", [])
        lines = [f"最近 {days} 天计算趋势", "", "日期 | 次数", "-----|-----"]
        for item in daily_stats:
            lines.append(f"{item.get('date', 'N/A')} | {item.get('count', 0)}")
        return "\n".join(lines)
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to get daily trend: %s", exc)
        return f"查询失败: {exc}"


@tool
def get_calculation_history(
    calc_type: Optional[str] = None,
    page_num: int = 1,
    page_size: int = 10,
) -> str:
    """Get calculation history list."""

    try:
        client = get_java_client()
        params = {"pageNum": page_num, "pageSize": page_size}
        if calc_type:
            params["calcType"] = calc_type

        response = client.call_api("/calculation/history/page", method="GET", params=params)
        if response.get("code") != 200:
            return f"查询失败: {response.get('msg', '未知错误')}"

        data = response.get("data", {})
        histories = data.get("list", [])
        total = data.get("total", 0)
        lines = [f"计算历史记录 (共 {total} 条)", ""]
        for item in histories:
            lines.extend(
                [
                    f"ID: {item.get('id')}",
                    f"类型: {item.get('calcTypeName', item.get('calcType', 'N/A'))}",
                    f"项目: {item.get('projectName', 'N/A')}",
                    f"状态: {item.get('statusName', 'N/A')}",
                    f"耗时: {item.get('calcDurationFormatted', 'N/A')}",
                    f"时间: {item.get('createTime', 'N/A')}",
                    "",
                ]
            )
        return "\n".join(lines)
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to get calculation history: %s", exc)
        return f"查询失败: {exc}"


@tool
def get_calculation_history_detail(history_id: int) -> str:
    """Get calculation history detail."""

    try:
        client = get_java_client()
        response = client.call_api(f"/calculation/history/{history_id}", method="GET")
        if response.get("code") != 200:
            return f"查询失败: {response.get('msg', '未知错误')}"

        data = response.get("data", {})
        input_params = str(data.get("inputParams", ""))
        output_result = str(data.get("outputResult", ""))
        if len(input_params) > 200:
            input_params = f"{input_params[:200]}..."
        if len(output_result) > 200:
            output_result = f"{output_result[:200]}..."

        return "\n".join(
            [
                f"计算历史详情 (ID: {history_id})",
                "",
                f"类型: {data.get('calcTypeName', 'N/A')}",
                f"项目: {data.get('projectName', 'N/A')}",
                f"执行人: {data.get('userName', 'N/A')}",
                f"状态: {data.get('statusName', 'N/A')}",
                f"耗时: {data.get('calcDurationFormatted', 'N/A')}",
                f"时间: {data.get('createTime', 'N/A')}",
                f"错误信息: {data.get('errorMessage', '-')}",
                "",
                f"输入参数: {input_params}",
                "",
                f"输出结果: {output_result}",
            ]
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to get calculation history detail: %s", exc)
        return f"查询失败: {exc}"


EXTENDED_TOOLS = [
    call_sensitivity_analysis,
    get_supported_sensitivity_variables,
    get_calculation_statistics,
    get_daily_calculation_trend,
    get_calculation_history,
    get_calculation_history_detail,
]
