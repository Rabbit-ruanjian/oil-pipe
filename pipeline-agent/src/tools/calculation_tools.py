"""
本地计算工具
实现水力学基础计算，无需调用Java服务
基于设计方案中的水力学公式
"""

import math
from decimal import Decimal, ROUND_HALF_UP
from typing import Tuple
from langchain_core.tools import tool

from src.models.enums import FlowRegime
from src.utils import logger, format_number


def _to_decimal(value) -> Decimal:
    """转换为Decimal类型"""
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _calculate_flow_velocity(flow_rate: Decimal, diameter: Decimal) -> Decimal:
    """
    计算流速

    Args:
        flow_rate: 流量 (m³/h)
        diameter: 管道内径 (mm)

    Returns:
        流速 (m/s)
    """
    # v = Q / (π * d² / 4)
    # Q: m³/h -> m³/s (除以3600)
    # d: mm -> m (除以1000)
    flow_rate_mps = flow_rate / Decimal("3600")
    diameter_m = diameter / Decimal("1000")
    area = Decimal(str(math.pi)) * diameter_m ** 2 / 4
    return flow_rate_mps / area


def _calculate_reynolds(velocity: Decimal, diameter: Decimal, viscosity: Decimal) -> Decimal:
    """
    计算雷诺数

    Args:
        velocity: 流速 (m/s)
        diameter: 管道内径 (mm)
        viscosity: 运动粘度 (m²/s)

    Returns:
        雷诺数
    """
    # Re = v * d / ν
    # d: mm -> m
    diameter_m = diameter / Decimal("1000")
    return velocity * diameter_m / viscosity


def _determine_flow_regime(reynolds: Decimal) -> FlowRegime:
    """
    判断流态

    Args:
        reynolds: 雷诺数

    Returns:
        流态类型
    """
    if reynolds < 2000:
        return FlowRegime.LAMINAR
    elif reynolds <= 3000:
        return FlowRegime.TRANSITIONAL
    else:
        return FlowRegime.SMOOTH_TURBULENT  # 简化处理，默认光滑区


def _calculate_friction_factor(reynolds: Decimal, roughness: Decimal, diameter: Decimal) -> Tuple[Decimal, str]:
    """
    计算摩擦系数

    Args:
        reynolds: 雷诺数
        roughness: 管道粗糙度 (mm)
        diameter: 管道内径 (mm)

    Returns:
        (摩擦系数, 计算方法)
    """
    relative_roughness = roughness / diameter

    if reynolds < 2000:
        # 层流: λ = 64 / Re
        friction = Decimal("64") / reynolds
        method = "层流公式 (λ=64/Re)"
    elif reynolds < 4000:
        # 过渡区: 使用Blasius公式近似
        friction = Decimal(str(0.3164 / (float(reynolds) ** 0.25)))
        method = "过渡区Blasius公式"
    else:
        # 湍流: 使用Colebrook-White公式的显式近似 (Swamee-Jain)
        # 1/√λ = -2*log10(ε/3.7d + 5.74/Re^0.9)
        re_float = float(reynolds)
        rr_float = float(relative_roughness)

        term1 = rr_float / 3.7
        term2 = 5.74 / (re_float ** 0.9)
        inv_sqrt_f = -2 * math.log10(term1 + term2)
        friction = Decimal(str(1 / (inv_sqrt_f ** 2)))
        method = "湍流Swamee-Jain公式"

    return friction, method


def _calculate_head_loss(
    friction: Decimal,
    length: Decimal,
    diameter: Decimal,
    velocity: Decimal
) -> Decimal:
    """
    计算沿程摩阻损失 (Darcy-Weisbach公式)

    Args:
        friction: 摩擦系数
        length: 管道长度 (km)
        diameter: 管道内径 (mm)
        velocity: 流速 (m/s)

    Returns:
        沿程摩阻损失 (m)
    """
    # h = λ * (L/d) * (v²/2g)
    length_m = length * Decimal("1000")
    diameter_m = diameter / Decimal("1000")
    g = Decimal("9.81")

    return friction * (length_m / diameter_m) * (velocity ** 2 / (2 * g))


# ==================== LangChain Tools ====================

@tool
def calculate_reynolds_number(
    flow_rate: float,
    diameter: float,
    viscosity: float
) -> str:
    """
    计算雷诺数并判断流态

    Args:
        flow_rate: 流量 (m³/h)
        diameter: 管道内径 (mm)
        viscosity: 运动粘度 (m²/s)

    Returns:
        雷诺数和流态判断结果
    """
    try:
        flow = _to_decimal(flow_rate)
        d = _to_decimal(diameter)
        v = _to_decimal(viscosity)

        velocity = _calculate_flow_velocity(flow, d)
        reynolds = _calculate_reynolds(velocity, d, v)
        regime = _determine_flow_regime(reynolds)

        regime_names = {
            FlowRegime.LAMINAR: "层流 (Re < 2000)",
            FlowRegime.TRANSITIONAL: "过渡区 (2000 ≤ Re ≤ 3000)",
            FlowRegime.SMOOTH_TURBULENT: "湍流 (Re > 3000)"
        }

        return (
            f"雷诺数计算结果:\n"
            f"  - 流量: {flow_rate} m³/h\n"
            f"  - 管径: {diameter} mm\n"
            f"  - 粘度: {viscosity} m²/s\n"
            f"  - 流速: {format_number(float(velocity))} m/s\n"
            f"  - 雷诺数(Re): {format_number(float(reynolds))}\n"
            f"  - 流态: {regime_names.get(regime, '未知')}\n"
            f"\n说明: 雷诺数Re = vd/ν，用于判断流体流动状态"
        )
    except Exception as e:
        logger.error(f"雷诺数计算失败: {e}")
        return f"计算失败: {str(e)}"


@tool
def calculate_friction_head_loss(
    flow_rate: float,
    diameter: float,
    length: float,
    viscosity: float,
    roughness: float = 0.03
) -> str:
    """
    计算沿程摩阻损失

    Args:
        flow_rate: 流量 (m³/h)
        diameter: 管道内径 (mm)
        length: 管道长度 (km)
        viscosity: 运动粘度 (m²/s)
        roughness: 管道粗糙度 (mm)，默认0.03

    Returns:
        摩阻损失计算结果
    """
    try:
        flow = _to_decimal(flow_rate)
        d = _to_decimal(diameter)
        L = _to_decimal(length)
        v = _to_decimal(viscosity)
        eps = _to_decimal(roughness)

        velocity = _calculate_flow_velocity(flow, d)
        reynolds = _calculate_reynolds(velocity, d, v)
        friction, method = _calculate_friction_factor(reynolds, eps, d)
        head_loss = _calculate_head_loss(friction, L, d, velocity)
        hydraulic_slope = head_loss / L  # m/km

        return (
            f"沿程摩阻损失计算结果:\n"
            f"\n【输入参数】\n"
            f"  - 流量: {flow_rate} m³/h\n"
            f"  - 管径: {diameter} mm\n"
            f"  - 管长: {length} km\n"
            f"  - 粘度: {viscosity} m²/s\n"
            f"  - 粗糙度: {roughness} mm\n"
            f"\n【计算结果】\n"
            f"  - 流速: {format_number(float(velocity))} m/s\n"
            f"  - 雷诺数: {format_number(float(reynolds))}\n"
            f"  - 摩擦系数(λ): {format_number(float(friction))}\n"
            f"  - 沿程摩阻损失: {format_number(float(head_loss))} m\n"
            f"  - 水力坡降: {format_number(float(hydraulic_slope))} m/km\n"
            f"  - 计算方法: {method}"
        )
    except Exception as e:
        logger.error(f"摩阻损失计算失败: {e}")
        return f"计算失败: {str(e)}"


@tool
def calculate_hydraulic_analysis(
    flow_rate: float,
    diameter: float,
    length: float,
    density: float,
    viscosity: float,
    roughness: float = 0.03,
    start_elevation: float = 0,
    end_elevation: float = 0
) -> str:
    """
    完整水力特性分析（本地计算，无需Java服务）

    Args:
        flow_rate: 流量 (m³/h)
        diameter: 管道内径 (mm)
        length: 管道长度 (km)
        density: 油品密度 (kg/m³)
        viscosity: 运动粘度 (m²/s)
        roughness: 管道粗糙度 (mm)，默认0.03
        start_elevation: 起点高程 (m)
        end_elevation: 终点高程 (m)

    Returns:
        完整的水力分析结果
    """
    try:
        flow = _to_decimal(flow_rate)
        d = _to_decimal(diameter)
        L = _to_decimal(length)
        rho = _to_decimal(density)
        nu = _to_decimal(viscosity)
        eps = _to_decimal(roughness)
        z1 = _to_decimal(start_elevation)
        z2 = _to_decimal(end_elevation)

        # 基础计算
        velocity = _calculate_flow_velocity(flow, d)
        reynolds = _calculate_reynolds(velocity, d, nu)
        regime = _determine_flow_regime(reynolds)
        friction, method = _calculate_friction_factor(reynolds, eps, d)
        head_loss = _calculate_head_loss(friction, L, d, velocity)
        hydraulic_slope = head_loss / L

        # 高程差引起的压头
        elevation_head = z2 - z1

        # 总压头损失
        total_head = head_loss + elevation_head

        # 流态判断
        regime_names = {
            FlowRegime.LAMINAR: "层流",
            FlowRegime.TRANSITIONAL: "过渡区",
            FlowRegime.SMOOTH_TURBULENT: "光滑区湍流",
            FlowRegime.MIXED_FRICTION: "混合摩擦区",
            FlowRegime.ROUGH_TURBULENT: "粗糙区湍流"
        }

        # 压力计算 (MPa)
        g = Decimal("9.81")
        total_pressure_mpa = total_head * rho * g / Decimal("1000000")

        return (
            f"水力特性分析结果:\n"
            f"\n【基本参数】\n"
            f"  - 流量(Q): {flow_rate} m³/h\n"
            f"  - 管径(d): {diameter} mm\n"
            f"  - 管长(L): {length} km\n"
            f"  - 密度(ρ): {density} kg/m³\n"
            f"  - 粘度(ν): {viscosity} m²/s\n"
            f"\n【流动特性】\n"
            f"  - 流速(v): {format_number(float(velocity))} m/s\n"
            f"  - 雷诺数(Re): {format_number(float(reynolds))}\n"
            f"  - 流态: {regime_names.get(regime, '未知')}\n"
            f"\n【摩阻计算】\n"
            f"  - 摩擦系数(λ): {format_number(float(friction))}\n"
            f"  - 沿程摩阻损失: {format_number(float(head_loss))} m\n"
            f"  - 水力坡降: {format_number(float(hydraulic_slope))} m/km\n"
            f"  - 计算方法: {method}\n"
            f"\n【压头分析】\n"
            f"  - 高程差压头: {format_number(float(elevation_head))} m\n"
            f"  - 总压头损失: {format_number(float(total_head))} m\n"
            f"  - 等效压力: {format_number(float(total_pressure_mpa))} MPa"
        )
    except Exception as e:
        logger.error(f"水力分析计算失败: {e}")
        return f"计算失败: {str(e)}"


@tool
def calculate_pump_head_required(
    total_head_loss: float,
    min_end_pressure: float = 0.3,
    density: float = 850
) -> str:
    """
    计算泵站所需扬程

    Args:
        total_head_loss: 总压头损失 (m)
        min_end_pressure: 最小末站压力 (MPa)，默认0.3
        density: 油品密度 (kg/m³)，默认850

    Returns:
        泵站扬程需求
    """
    try:
        h_loss = _to_decimal(total_head_loss)
        p_end = _to_decimal(min_end_pressure)
        rho = _to_decimal(density)
        g = Decimal("9.81")

        # 末站压力对应的压头 (MPa -> m)
        end_pressure_head = p_end * Decimal("1000000") / (rho * g)

        # 所需总扬程
        required_head = h_loss + end_pressure_head

        return (
            f"泵站扬程需求计算:\n"
            f"  - 总压头损失: {total_head_loss} m\n"
            f"  - 最小末站压力: {min_end_pressure} MPa\n"
            f"  - 末站压力对应压头: {format_number(float(end_pressure_head))} m\n"
            f"  - 所需总扬程: {format_number(float(required_head))} m\n"
            f"\n说明: 泵站需提供足够扬程以克服沿程损失并保证末站压力"
        )
    except Exception as e:
        logger.error(f"泵扬程计算失败: {e}")
        return f"计算失败: {str(e)}"


@tool
def convert_units(value: float, from_unit: str, to_unit: str) -> str:
    """
    常用单位换算

    Args:
        value: 数值
        from_unit: 原单位
        to_unit: 目标单位

    Returns:
        换算结果

    支持的单位:
        - 流量: m3/h, L/s, L/min, bbl/d
        - 压力: MPa, kPa, bar, psi, m (水柱)
        - 长度: m, km, mm, inch, ft
        - 粘度: m2/s, cSt, cP (动力粘度需配合密度)
    """
    conversions = {
        # 流量 -> m3/h
        ("L/s", "m3/h"): 3.6,
        ("m3/h", "L/s"): 1/3.6,
        ("L/min", "m3/h"): 0.06,
        ("m3/h", "L/min"): 1/0.06,
        ("bbl/d", "m3/h"): 0.00662,
        ("m3/h", "bbl/d"): 1/0.00662,

        # 压力 -> MPa
        ("kPa", "MPa"): 0.001,
        ("MPa", "kPa"): 1000,
        ("bar", "MPa"): 0.1,
        ("MPa", "bar"): 10,
        ("psi", "MPa"): 0.00689476,
        ("MPa", "psi"): 145.038,

        # 长度 -> m
        ("km", "m"): 1000,
        ("m", "km"): 0.001,
        ("mm", "m"): 0.001,
        ("m", "mm"): 1000,
        ("inch", "m"): 0.0254,
        ("m", "inch"): 39.3701,
        ("ft", "m"): 0.3048,
        ("m", "ft"): 3.28084,

        # 粘度 -> m2/s
        ("cSt", "m2/s"): 1e-6,
        ("m2/s", "cSt"): 1e6,
    }

    key = (from_unit, to_unit)
    if key in conversions:
        result = value * conversions[key]
        return f"{value} {from_unit} = {format_number(result)} {to_unit}"
    else:
        return f"不支持的单位转换: {from_unit} -> {to_unit}"


# ==================== 工具集合 ====================

CALCULATION_TOOLS = [
    calculate_reynolds_number,
    calculate_friction_head_loss,
    calculate_hydraulic_analysis,
    calculate_pump_head_required,
    convert_units
]
