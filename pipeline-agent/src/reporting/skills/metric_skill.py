from __future__ import annotations

from typing import Any


def _fmt_number(value: Any, digits: int = 2, suffix: str = "") -> str:
    if value is None:
        return "-"
    if isinstance(value, int):
        return f"{value}{suffix}"
    if isinstance(value, float):
        return f"{value:.{digits}f}{suffix}"
    return f"{value}{suffix}"


def metric_skill(ctx: dict[str, Any]) -> list[str]:
    metrics = ctx.get("metrics", {})

    success_rate = metrics.get("success_rate")
    avg_pump_efficiency = metrics.get("avg_pump_efficiency")
    avg_energy_consumption = metrics.get("avg_energy_consumption")
    latest_end_station_pressure = metrics.get("latest_end_station_pressure")
    target_flow_gap = metrics.get("target_flow_gap")
    min_pressure_gap = metrics.get("min_pressure_gap")
    avg_viscosity = metrics.get("avg_viscosity")

    items: list[str] = []

    if success_rate is not None:
        items.append(f"历史计算成功率 {_fmt_number(success_rate, 1, '%')}。")
    if avg_pump_efficiency is not None:
        items.append(f"平均泵效 {_fmt_number(avg_pump_efficiency, 3)}，可作为当前泵组效率基线。")
    if avg_energy_consumption is not None:
        items.append(f"平均能耗 {_fmt_number(avg_energy_consumption, 2)}，反映当前工况下的整体能耗水平。")
    if latest_end_station_pressure is not None:
        items.append(f"最新末站进站压头 {_fmt_number(latest_end_station_pressure, 2)}，可直接用于压力校核。")

    if target_flow_gap is not None:
        if target_flow_gap < 0:
            items.append(f"平均输量较目标值存在 {_fmt_number(abs(target_flow_gap), 2)} 的缺口，输量兑现能力偏弱。")
        else:
            items.append(f"平均输量较目标值保留 {_fmt_number(target_flow_gap, 2)} 的余量，输量目标基本可达。")

    if min_pressure_gap is not None:
        if min_pressure_gap < 0:
            items.append(f"末站压力较约束下限存在 {_fmt_number(abs(min_pressure_gap), 2)} 的缺口，需优先复核压力保障能力。")
        else:
            items.append(f"末站压力较约束下限仍有 {_fmt_number(min_pressure_gap, 2)} 的余量，当前压力边界相对稳定。")

    if avg_viscosity is not None and avg_viscosity > 12:
        items.append(f"油品平均黏度 {_fmt_number(avg_viscosity, 2)} 偏高，沿程阻力和能耗压力需要同步关注。")

    return items[:6]
