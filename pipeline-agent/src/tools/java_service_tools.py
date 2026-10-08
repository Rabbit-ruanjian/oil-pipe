"""
Java服务调用工具
通过HTTP调用Java后端的水力计算和优化服务
"""

import json
import time
from typing import Optional, Dict, Any

import httpx
from langchain_core.tools import tool
from tenacity import retry, stop_after_attempt, wait_exponential

from src.config import settings
from src.utils import logger


class JavaServiceClient:
    """Java服务HTTP客户端"""

    def __init__(self):
        self.base_url = settings.JAVA_GATEWAY_URL
        self.timeout = settings.JAVA_REQUEST_TIMEOUT
        self.token: Optional[str] = None
        self._token_expires_at: float = 0.0

    async def _get_token(self) -> str:
        """获取认证Token"""
        if self.token and time.time() < self._token_expires_at:
            return self.token

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/auth/login",
                json={
                    "username": settings.JAVA_AUTH_USERNAME,
                    "password": settings.JAVA_AUTH_PASSWORD,
                },
            )
            response.raise_for_status()
            data = response.json()
            token_data = data.get("data", {}) if isinstance(data, dict) else {}
            self.token = (
                token_data.get("access_token")
                or token_data.get("token")
                or data.get("access_token")
                or data.get("token")
            )
            self._token_expires_at = time.time() + 7200
            return self.token

    def _get_token_sync(self) -> str:
        """同步获取认证Token"""
        if self.token and time.time() < self._token_expires_at:
            return self.token

        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(
                f"{self.base_url}/auth/login",
                json={
                    "username": settings.JAVA_AUTH_USERNAME,
                    "password": settings.JAVA_AUTH_PASSWORD,
                },
            )
            response.raise_for_status()
            data = response.json()
            token_data = data.get("data", {}) if isinstance(data, dict) else {}
            self.token = (
                token_data.get("access_token")
                or token_data.get("token")
                or data.get("access_token")
                or data.get("token")
            )
            self._token_expires_at = time.time() + 7200
            return self.token

    def _get_headers(self) -> Dict[str, str]:
        """获取请求头"""
        token = self._get_token_sync()
        if not token:
            raise RuntimeError("Failed to obtain authentication token")
        return {
            "Authorization": f"Bearer {token}",
            "satoken": token,
            "Content-Type": "application/json",
        }

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
    def call_api(
        self,
        endpoint: str,
        method: str = "POST",
        data: Dict = None,
        params: Dict = None,
    ) -> Dict[str, Any]:
        """
        调用Java API

        Args:
            endpoint: API端点
            method: HTTP方法
            data: 请求体数据
            params: 查询参数

        Returns:
            API响应数据
        """
        url = f"{self.base_url}{endpoint}"
        headers = self._get_headers()

        with httpx.Client(timeout=self.timeout) as client:
            if method.upper() == "GET":
                response = client.get(url, headers=headers, params=params)
            elif method.upper() == "POST":
                response = client.post(url, headers=headers, json=data)
            else:
                raise ValueError(f"不支持的HTTP方法: {method}")

            response.raise_for_status()
            return response.json()


# 创建全局客户端实例
_java_client: Optional[JavaServiceClient] = None


def get_java_client() -> JavaServiceClient:
    """获取Java客户端单例"""
    global _java_client
    if _java_client is None:
        _java_client = JavaServiceClient()
    return _java_client


# ==================== LangChain Tools ====================


@tool
def call_hydraulic_analysis(
    flow_rate: float,
    density: float,
    viscosity: float,
    length: float,
    diameter: float,
    thickness: float,
    roughness: float = 0.03,
    start_altitude: float = 0,
    end_altitude: float = 0,
    inlet_pressure: float = 0,
    pump480_num: int = 0,
    pump375_num: int = 0,
    pump480_head: float = 0,
    pump375_head: float = 0,
    pipeline_id: Optional[int] = None,
    oil_id: Optional[int] = None,
) -> str:
    """
    调用Java服务进行水力特性分析

    Args:
        flow_rate: 流量 (m³/h)
        density: 油品密度 (kg/m³)
        viscosity: 运动粘度 (m²/s)
        length: 管道长度 (km)
        diameter: 管道外径 (mm)
        thickness: 壁厚 (mm)
        roughness: 当量粗糙度 (m)，默认0.03
        start_altitude: 起点高程 (m)
        end_altitude: 终点高程 (m)
        inlet_pressure: 首站进站压头 (m)，默认0
        pump480_num: ZMI480泵数量，默认0
        pump375_num: ZMI375泵数量，默认0
        pump480_head: ZMI480单泵扬程 (m)，默认0
        pump375_head: ZMI375单泵扬程 (m)，默认0
        pipeline_id: 管道ID（可选）
        oil_id: 油品ID（可选）

    Returns:
        水力分析结果（JSON格式）
    """
    try:
        client = get_java_client()

        request_data = {
            "flowRate": flow_rate,
            "density": density,
            "viscosity": viscosity,
            "length": length,
            "diameter": diameter,
            "thickness": thickness,
            "roughness": roughness,
            "startAltitude": start_altitude,
            "endAltitude": end_altitude,
            "inletPressure": inlet_pressure,
            "pump480Num": pump480_num,
            "pump375Num": pump375_num,
            "pump480Head": pump480_head,
            "pump375Head": pump375_head,
        }
        if pipeline_id is not None:
            request_data["pipelineId"] = pipeline_id
        if oil_id is not None:
            request_data["oilId"] = oil_id

        logger.info(f"调用水力分析API: {request_data}")

        response = client.call_api(
            "/calculation/hydraulic-analysis",
            method="POST",
            data=request_data,
        )

        if response.get("code") != 200:
            return json.dumps(
                {"success": False, "message": response.get("msg", "未知错误")},
                ensure_ascii=False,
                default=str,
            )

        result = response.get("data", {})
        return json.dumps(
            {"success": True, "data": result, "input_params": request_data},
            ensure_ascii=False,
            default=str,
        )

    except httpx.ConnectError:
        logger.error("无法连接到Java服务")
        return json.dumps(
            {"success": False, "message": "无法连接到Java计算服务，请确认服务是否启动"},
            ensure_ascii=False,
            default=str,
        )
    except httpx.HTTPStatusError as e:
        logger.error(f"Java服务返回错误: {e}")
        return json.dumps(
            {"success": False, "message": f"Java服务返回 {e.response.status_code}"},
            ensure_ascii=False,
            default=str,
        )
    except Exception as e:
        logger.error(f"水力分析调用失败: {e}")
        return json.dumps(
            {"success": False, "message": f"计算失败: {str(e)}"},
            ensure_ascii=False,
            default=str,
        )


@tool
def call_pump_optimization(
    flow_rate: float,
    density: float,
    viscosity: float,
    length: float,
    diameter: float,
    thickness: float,
    roughness: float,
    start_altitude: float,
    end_altitude: float,
    inlet_pressure: float,
    pump480_head: float,
    pump375_head: float,
    pump_efficiency: float = 0.80,
    motor_efficiency: float = 0.95,
    working_days: float = 350,
    electricity_price: float = 0.8,
    project_id: Optional[int] = None,
) -> str:
    """
    调用Java服务进行泵站组合优化

    遍历所有 ZMI480 × ZMI375 泵组合，找到最优方案。

    Args:
        flow_rate: 流量 (m³/h)
        density: 油品密度 (kg/m³)
        viscosity: 运动粘度 (m²/s)
        length: 管道长度 (km)
        diameter: 管道外径 (mm)
        thickness: 壁厚 (mm)
        roughness: 当量粗糙度 (m)
        start_altitude: 起点高程 (m)
        end_altitude: 终点高程 (m)
        inlet_pressure: 首站进站压头 (m)
        pump480_head: ZMI480单泵扬程 (m)
        pump375_head: ZMI375单泵扬程 (m)
        pump_efficiency: 泵效率 (0-1)，默认0.80
        motor_efficiency: 电机效率 (0-1)，默认0.95
        working_days: 年运行天数，默认350
        electricity_price: 电价 (元/kWh)，默认0.8
        project_id: 项目ID（可选）

    Returns:
        优化结果（JSON格式，包含最优方案和所有可行方案）
    """
    try:
        client = get_java_client()

        request_data = {
            "flowRate": flow_rate,
            "density": density,
            "viscosity": viscosity,
            "length": length,
            "diameter": diameter,
            "thickness": thickness,
            "roughness": roughness,
            "startAltitude": start_altitude,
            "endAltitude": end_altitude,
            "inletPressure": inlet_pressure,
            "pump480Head": pump480_head,
            "pump375Head": pump375_head,
            "pumpEfficiency": pump_efficiency,
            "motorEfficiency": motor_efficiency,
            "workingDays": working_days,
            "electricityPrice": electricity_price,
        }
        if project_id is not None:
            request_data["projectId"] = project_id

        logger.info(f"调用泵站优化API: {request_data}")

        response = client.call_api(
            "/calculation/optimization",
            method="POST",
            data=request_data,
        )

        if response.get("code") != 200:
            return json.dumps(
                {"success": False, "message": response.get("msg", "未知错误")},
                ensure_ascii=False,
                default=str,
            )

        result = response.get("data", {})
        return json.dumps(
            {"success": True, "data": result},
            ensure_ascii=False,
            default=str,
        )

    except httpx.ConnectError:
        logger.error("无法连接到Java服务")
        return json.dumps(
            {"success": False, "message": "无法连接到Java计算服务"},
            ensure_ascii=False,
            default=str,
        )
    except httpx.HTTPStatusError as e:
        logger.error(f"Java服务返回错误: {e}")
        return json.dumps(
            {"success": False, "message": f"Java服务返回 {e.response.status_code}"},
            ensure_ascii=False,
            default=str,
        )
    except Exception as e:
        logger.error(f"泵站优化调用失败: {e}")
        return json.dumps(
            {"success": False, "message": f"优化失败: {str(e)}"},
            ensure_ascii=False,
            default=str,
        )


@tool
def get_pipeline_hydraulics(pipeline_id: int, flow_rate: float) -> str:
    """
    根据管道ID自动获取参数并执行水力计算

    先从Java data服务获取管道和油品参数，然后调用水力分析API。

    Args:
        pipeline_id: 管道ID
        flow_rate: 流量 (m³/h)

    Returns:
        完整的水力计算结果（JSON格式）
    """
    try:
        client = get_java_client()

        # 获取管道参数
        pipeline_resp = client.call_api(f"/data/pipeline/{pipeline_id}", method="GET")
        if pipeline_resp.get("code") != 200:
            return json.dumps(
                {"success": False, "message": f"获取管道参数失败: {pipeline_resp.get('msg')}"},
                ensure_ascii=False,
                default=str,
            )

        pipeline = pipeline_resp.get("data", {}) or {}

        # 获取油品参数
        oil_resp = client.call_api("/data/oil-property/list", method="GET")
        oil_data = oil_resp.get("data", []) if isinstance(oil_resp.get("data"), list) else []
        oil = oil_data[0] if oil_data else {}

        # 获取泵站参数
        pump_resp = client.call_api("/data/pump-station/list", method="GET")
        pump_data = pump_resp.get("data", []) if isinstance(pump_resp.get("data"), list) else []
        pump = pump_data[0] if pump_data else {}

        diameter = float(pipeline.get("diameter") or 0)
        thickness = float(pipeline.get("thickness") or 0)

        request_data = {
            "pipelineId": pipeline_id,
            "flowRate": flow_rate,
            "density": float(oil.get("density") or 850),
            "viscosity": float(oil.get("viscosity") or 0.00004),
            "length": float(pipeline.get("length") or 100),
            "diameter": diameter,
            "thickness": thickness,
            "roughness": float(pipeline.get("roughness") or 0.03),
            "startAltitude": float(pipeline.get("startAltitude") or pipeline.get("start_altitude") or 0),
            "endAltitude": float(pipeline.get("endAltitude") or pipeline.get("end_altitude") or 0),
            "inletPressure": float(pump.get("comePower") or pump.get("come_power") or 0),
            "pump480Head": float(pump.get("zmi480Lift") or pump.get("zmi480_lift") or 0),
            "pump375Head": float(pump.get("zmi375Lift") or pump.get("zmi375_lift") or 0),
            "pump480Num": 0,
            "pump375Num": 0,
        }

        response = client.call_api(
            "/calculation/hydraulic-analysis",
            method="POST",
            data=request_data,
        )

        if response.get("code") != 200:
            return json.dumps(
                {"success": False, "message": response.get("msg", "未知错误")},
                ensure_ascii=False,
                default=str,
            )

        result = response.get("data", {})
        return json.dumps(
            {
                "success": True,
                "data": result,
                "pipeline_name": pipeline.get("name", ""),
                "input_params": request_data,
            },
            ensure_ascii=False,
            default=str,
        )

    except Exception as e:
        logger.error(f"管道水力计算失败: {e}")
        return json.dumps(
            {"success": False, "message": f"计算失败: {str(e)}"},
            ensure_ascii=False,
            default=str,
        )


@tool
def check_java_service_health() -> str:
    """
    检查Java计算服务是否可用

    Returns:
        服务状态信息（JSON格式）
    """
    try:
        client = get_java_client()

        response = client.call_api(
            "/actuator/health",
            method="GET",
        )

        status = response.get("status", "UNKNOWN")
        if status == "UP":
            return json.dumps(
                {"success": True, "message": "Java计算服务运行正常", "data": response},
                ensure_ascii=False,
                default=str,
            )
        return json.dumps(
            {"success": False, "message": f"Java计算服务状态异常: {status}", "data": response},
            ensure_ascii=False,
            default=str,
        )

    except httpx.ConnectError:
        return json.dumps(
            {"success": False, "message": "Java计算服务无法连接，请检查服务是否启动"},
            ensure_ascii=False,
            default=str,
        )
    except Exception as e:
        return json.dumps(
            {"success": False, "message": f"健康检查失败: {str(e)}"},
            ensure_ascii=False,
            default=str,
        )


# ==================== 工具集合 ====================

JAVA_SERVICE_TOOLS = [
    call_hydraulic_analysis,
    call_pump_optimization,
    get_pipeline_hydraulics,
    check_java_service_health,
]
