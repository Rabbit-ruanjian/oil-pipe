from __future__ import annotations

from dataclasses import asdict
from itertools import combinations
from statistics import mean

from src.models.schemas import DynamicReportRequest

from .labeling import optimization_goal_label
from .report_types import DecisionOption, DecisionResult, DiagnosisResult, MetricSnapshot, ReportDataBundle


def _clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


def _safe_float(value: float | int | None) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    return float(value)


class DecisionEngine:
    def run(
        self,
        data: ReportDataBundle,
        metrics: MetricSnapshot,
        diagnosis: DiagnosisResult,
        request: DynamicReportRequest,
    ) -> DecisionResult:
        pump_rows = metrics.object_metrics.get("pump_stations", [])
        if not pump_rows:
            return DecisionResult(
                recommended_options=[],
                fallback_options=[],
                rejected_options=[],
                summary="当前无可用泵站对象，无法生成推荐方案。",
                weights=self._weights(request),
            )

        issues_by_target = {}
        for item in diagnosis.issues:
            issues_by_target.setdefault(item.target, []).append(item)

        target_throughput = request.target_throughput
        min_pressure = request.min_pressure
        latest_end_station_pressure = metrics.overview_metrics.get("latest_end_station_pressure")

        options = [
            self._score_option(
                name=row.get("name") or "-",
                pump_eff=row.get("pump_efficiency"),
                motor_eff=row.get("electric_efficiency"),
                displacement=row.get("displacement"),
                target_throughput=target_throughput,
                min_pressure=min_pressure,
                latest_end_station_pressure=latest_end_station_pressure,
                issues=issues_by_target.get(row.get("name") or "-", []),
                request=request,
                option_type="single",
            )
            for row in pump_rows
        ]

        if request.allow_pump_adjust:
            options.extend(
                self._build_combinations(
                    pump_rows=pump_rows,
                    issues_by_target=issues_by_target,
                    target_throughput=target_throughput,
                    min_pressure=min_pressure,
                    latest_end_station_pressure=latest_end_station_pressure,
                    request=request,
                )
            )

        feasible = [opt for opt in options if opt.feasible]
        infeasible = [opt for opt in options if not opt.feasible]
        feasible.sort(key=lambda item: item.score, reverse=True)
        infeasible.sort(key=lambda item: item.score, reverse=True)

        recommended = [opt for opt in feasible if opt.score >= 70][:3]
        fallback = [opt for opt in feasible if opt not in recommended][:3]

        summary = self._build_summary(recommended, fallback, infeasible, request)
        return DecisionResult(
            recommended_options=recommended,
            fallback_options=fallback,
            rejected_options=infeasible[:3],
            summary=summary,
            weights=self._weights(request),
        )

    def _weights(self, request: DynamicReportRequest) -> dict[str, float]:
        goal = (request.optimization_goal or "balanced").lower()
        if goal == "energy":
            return {
                "pump_efficiency": 0.35,
                "motor_efficiency": 0.25,
                "flow_match": 0.15,
                "pressure_match": 0.15,
                "risk_penalty": 0.10,
            }
        if goal == "cost":
            return {
                "pump_efficiency": 0.20,
                "motor_efficiency": 0.15,
                "flow_match": 0.35,
                "pressure_match": 0.20,
                "risk_penalty": 0.10,
            }
        if goal == "safety":
            return {
                "pump_efficiency": 0.20,
                "motor_efficiency": 0.15,
                "flow_match": 0.20,
                "pressure_match": 0.35,
                "risk_penalty": 0.10,
            }
        return {
            "pump_efficiency": 0.25,
            "motor_efficiency": 0.20,
            "flow_match": 0.20,
            "pressure_match": 0.20,
            "risk_penalty": 0.15,
        }

    def _score_option(
        self,
        *,
        name: str,
        pump_eff: float | None,
        motor_eff: float | None,
        displacement: float | None,
        target_throughput: float | None,
        min_pressure: float | None,
        latest_end_station_pressure: float | None,
        issues: list,
        request: DynamicReportRequest,
        option_type: str,
    ) -> DecisionOption:
        pump_eff_score = _clamp(pump_eff or 0.5)
        motor_eff_score = _clamp(motor_eff or 0.5)

        flow_match = 0.5
        violations: list[str] = []
        if target_throughput is not None and displacement is not None and target_throughput > 0:
            flow_match = _clamp(1 - abs(displacement - target_throughput) / target_throughput)
            if displacement < target_throughput * 0.9:
                violations.append("排量低于目标输量")

        pressure_match = 0.5
        if min_pressure is not None and latest_end_station_pressure is not None and min_pressure > 0:
            pressure_match = _clamp(latest_end_station_pressure / min_pressure)
            if latest_end_station_pressure < min_pressure:
                violations.append("最低出口压力不满足")

        issue_penalty = 0.0
        for item in issues:
            if item.level == "high":
                issue_penalty += 0.12
            else:
                issue_penalty += 0.07
        issue_penalty = min(issue_penalty, 0.3)

        weights = self._weights(request)
        base_score = (
            weights["pump_efficiency"] * pump_eff_score
            + weights["motor_efficiency"] * motor_eff_score
            + weights["flow_match"] * flow_match
            + weights["pressure_match"] * pressure_match
        )
        final_score = _clamp(base_score - issue_penalty * weights["risk_penalty"], 0, 1) * 100

        pros: list[str] = []
        cons: list[str] = []
        reasons: list[str] = []

        if pump_eff is not None:
            pros.append(f"泵效 {pump_eff:.2f}")
        if motor_eff is not None:
            pros.append(f"电机效率 {motor_eff:.2f}")
        if target_throughput is not None and displacement is not None:
            reasons.append(f"排量匹配度 {flow_match:.0%}")
        if min_pressure is not None and latest_end_station_pressure is not None:
            reasons.append(f"压力适配度 {pressure_match:.0%}")
        if issue_penalty > 0:
            cons.extend([item.message for item in issues[:2]])

        feasible = not violations
        if violations:
            cons.extend(violations)

        return DecisionOption(
            name=name,
            score=round(final_score, 1),
            feasible=feasible,
            reasons=reasons,
            pros=pros,
            cons=cons,
            violations=violations,
            option_type=option_type,
        )

    def _build_combinations(
        self,
        *,
        pump_rows: list[dict],
        issues_by_target: dict,
        target_throughput: float | None,
        min_pressure: float | None,
        latest_end_station_pressure: float | None,
        request: DynamicReportRequest,
    ) -> list[DecisionOption]:
        if len(pump_rows) < 2:
            return []
        combo_candidates = sorted(pump_rows, key=lambda item: _safe_float(item.get("pump_efficiency")) or 0, reverse=True)[:4]
        options: list[DecisionOption] = []
        for left, right in combinations(combo_candidates, 2):
            name = f"{left.get('name') or '-'} + {right.get('name') or '-'} 组合"
            displacement = sum(filter(None, [_safe_float(left.get("displacement")), _safe_float(right.get("displacement"))]))
            pump_eff = _avg_score([left.get("pump_efficiency"), right.get("pump_efficiency")])
            motor_eff = _avg_score([left.get("electric_efficiency"), right.get("electric_efficiency")])
            issues = (issues_by_target.get(left.get("name") or "-", []) + issues_by_target.get(right.get("name") or "-", []))
            options.append(
                self._score_option(
                    name=name,
                    pump_eff=pump_eff,
                    motor_eff=motor_eff,
                    displacement=displacement if displacement > 0 else None,
                    target_throughput=target_throughput,
                    min_pressure=min_pressure,
                    latest_end_station_pressure=latest_end_station_pressure,
                    issues=issues,
                    request=request,
                    option_type="combination",
                )
            )
        return options

    def _build_summary(
        self,
        recommended: list[DecisionOption],
        fallback: list[DecisionOption],
        rejected: list[DecisionOption],
        request: DynamicReportRequest,
    ) -> str:
        if recommended:
            best = recommended[0]
            goal = optimization_goal_label(request.optimization_goal)
            return f"优化目标为{goal}，推荐 {best.name}（评分 {best.score:.1f}），其余可行方案 {len(fallback)} 个，不推荐方案 {len(rejected)} 个。"
        if fallback:
            return f"当前无高分推荐对象，建议优先复核约束条件后在 {fallback[0].name} 等可行方案中选择。"
        return "当前约束条件过于严格或数据不足，未生成可行推荐方案。"


def _avg_score(values: list[float | None]) -> float | None:
    actual = [value for value in values if value is not None]
    return mean(actual) if actual else None
