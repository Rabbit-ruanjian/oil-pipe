from __future__ import annotations

from statistics import mean, stdev

from src.models.schemas import DynamicReportRequest

from .labeling import optimization_goal_label
from .report_types import (
    AnomalyFinding,
    CauseFinding,
    ConstraintFinding,
    DiagnosisResult,
    IssueFinding,
    MetricSnapshot,
    RecommendationFinding,
    ReportDataBundle,
    TrendFinding,
)


def _to_float(value) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _valid_values(rows: list[dict], key: str) -> list[float]:
    values: list[float] = []
    for row in rows:
        value = _to_float(row.get(key))
        if value is not None:
            values.append(value)
    return values


def _paired_values(rows: list[dict], left_key: str, right_key: str) -> list[tuple[float, float]]:
    pairs: list[tuple[float, float]] = []
    for row in rows:
        left = _to_float(row.get(left_key))
        right = _to_float(row.get(right_key))
        if left is None or right is None:
            continue
        pairs.append((left, right))
    return pairs


def _pearson(pairs: list[tuple[float, float]]) -> float | None:
    if len(pairs) < 5:
        return None
    xs = [item[0] for item in pairs]
    ys = [item[1] for item in pairs]
    mean_x = mean(xs)
    mean_y = mean(ys)
    x_diffs = [x - mean_x for x in xs]
    y_diffs = [y - mean_y for y in ys]
    numerator = sum(x * y for x, y in zip(x_diffs, y_diffs, strict=False))
    denominator_left = sum(x * x for x in x_diffs)
    denominator_right = sum(y * y for y in y_diffs)
    if denominator_left <= 0 or denominator_right <= 0:
        return None
    return numerator / ((denominator_left ** 0.5) * (denominator_right ** 0.5))


class DiagnosisEngine:
    TREND_METRIC_LABELS = {
        "flow_rate": "输量",
        "energy_consumption": "能耗",
        "pump_efficiency": "泵效",
        "end_station_pressure": "末站进站压头",
        "success_rate": "成功率",
        "avg_duration_ms": "平均计算耗时",
    }

    def run(
        self,
        data: ReportDataBundle,
        metrics: MetricSnapshot,
        request: DynamicReportRequest,
    ) -> DiagnosisResult:
        issues = self.build_issues(metrics, data, request)
        trends = self.analyze_trend(metrics.trend_metrics.get("operation_daily", []))
        anomalies = self.detect_anomalies(metrics, data)
        causes = self.infer_causes(anomalies, metrics, request)
        constraints = self.infer_constraints(metrics, request)
        recommendations = self.generate_recommendations(causes, constraints, request)
        risks = self.build_risks(issues, anomalies, constraints)
        return DiagnosisResult(
            trends=trends,
            issues=issues,
            anomalies=anomalies,
            causes=causes,
            constraints=constraints,
            recommendations=recommendations,
            risks=risks,
            confidence={
                "trend": 0.72 if metrics.data_quality.get("usable_for_trend") else 0.35,
                "anomaly": 0.8 if anomalies else 0.45,
                "cause": 0.76 if causes else 0.4,
            },
        )

    def build_issues(
        self,
        metrics: MetricSnapshot,
        data: ReportDataBundle,
        request: DynamicReportRequest,
    ) -> list[IssueFinding]:
        issues: list[IssueFinding] = []
        pump_rows = metrics.object_metrics.get("pump_stations", [])
        pump_eff_values = [row.get("pump_efficiency") for row in pump_rows if row.get("pump_efficiency") is not None]
        motor_eff_values = [row.get("electric_efficiency") for row in pump_rows if row.get("electric_efficiency") is not None]
        pump_eff_baseline = mean(pump_eff_values) if pump_eff_values else None
        motor_eff_baseline = mean(motor_eff_values) if motor_eff_values else None

        for row in pump_rows:
            name = str(row.get("name") or "-")
            pump_eff = row.get("pump_efficiency")
            motor_eff = row.get("electric_efficiency")
            displacement = row.get("displacement")

            if pump_eff is not None:
                threshold = 0.75 if pump_eff_baseline is None else max(0.75, pump_eff_baseline - 0.05)
                if pump_eff < threshold:
                    level = "high" if pump_eff < 0.7 else "medium"
                    issues.append(
                        IssueFinding(
                            target=name,
                            level=level,
                            issue_type="pump_efficiency_low",
                            message="泵效偏低，低于当前样本基线",
                            evidence={"current_value": round(pump_eff, 3), "baseline": round(pump_eff_baseline or threshold, 3)},
                        )
                    )

            if motor_eff is not None:
                threshold = 0.85 if motor_eff_baseline is None else max(0.85, motor_eff_baseline - 0.04)
                if motor_eff < threshold:
                    level = "high" if motor_eff < 0.8 else "medium"
                    issues.append(
                        IssueFinding(
                            target=name,
                            level=level,
                            issue_type="motor_efficiency_low",
                            message="电机效率偏低，存在能耗损失风险",
                            evidence={"current_value": round(motor_eff, 3), "baseline": round(motor_eff_baseline or threshold, 3)},
                        )
                    )

            if request.target_throughput is not None and displacement is not None and displacement < request.target_throughput * 0.9:
                issues.append(
                    IssueFinding(
                        target=name,
                        level="medium",
                        issue_type="flow_below_target",
                        message="排量低于目标输量，可能无法满足输量要求",
                        evidence={"current_value": round(displacement, 2), "target": request.target_throughput},
                    )
                )

        latest_pressure = metrics.overview_metrics.get("latest_end_station_pressure")
        if request.min_pressure is not None and latest_pressure is not None and latest_pressure < request.min_pressure:
            issues.append(
                IssueFinding(
                    target="末站",
                    level="high",
                    issue_type="min_pressure_unmet",
                    message="末站进站压力低于最低出口压力约束",
                    evidence={"current_value": round(latest_pressure, 3), "min_required": request.min_pressure},
                )
            )

        if request.target_throughput is not None:
            avg_flow_rate = metrics.overview_metrics.get("avg_flow_rate")
            if avg_flow_rate is not None and avg_flow_rate < request.target_throughput * 0.9:
                issues.append(
                    IssueFinding(
                        target="系统",
                        level="medium",
                        issue_type="flow_target_gap",
                        message="平均输量低于目标输量",
                        evidence={"current_value": round(avg_flow_rate, 2), "target": request.target_throughput},
                    )
                )

        pipeline_rows = metrics.object_metrics.get("pipelines", [])
        resistance_scores = []
        for row in pipeline_rows:
            length = row.get("length")
            roughness = row.get("roughness")
            diameter = row.get("diameter")
            if length is None or roughness is None or diameter is None or diameter <= 0:
                continue
            resistance_scores.append(length * roughness / diameter)
        baseline = mean(resistance_scores) if resistance_scores else None
        std = stdev(resistance_scores) if resistance_scores and len(resistance_scores) > 1 else 0.0

        for row in pipeline_rows:
            length = row.get("length")
            roughness = row.get("roughness")
            diameter = row.get("diameter")
            if length is None or roughness is None or diameter is None or diameter <= 0:
                continue
            score = length * roughness / diameter
            if baseline is None:
                continue
            if score > baseline + max(std, baseline * 0.25):
                issues.append(
                    IssueFinding(
                        target=str(row.get("name") or "-"),
                        level="medium",
                        issue_type="pipeline_resistance_high",
                        message="管道输送阻力偏大，可能导致压损升高",
                        evidence={"resistance_index": round(score, 4), "baseline": round(baseline, 4)},
                    )
                )

        avg_viscosity = metrics.overview_metrics.get("avg_viscosity")
        if avg_viscosity is not None and avg_viscosity > 12:
            level = "high" if avg_viscosity > 20 else "medium"
            issues.append(
                IssueFinding(
                    target="油品",
                    level=level,
                    issue_type="viscosity_high",
                    message="油品黏度偏高，输送风险上升",
                    evidence={"current_value": round(avg_viscosity, 2)},
                )
            )

        return issues

    def analyze_trend(self, rows: list[dict]) -> list[TrendFinding]:
        if len(rows) < 7:
            return []

        findings: list[TrendFinding] = []
        for metric in ("flow_rate", "energy_consumption", "pump_efficiency", "end_station_pressure", "success_rate", "avg_duration_ms"):
            values = _valid_values(rows, metric)
            if len(values) < 5:
                continue

            window = max(2, len(values) // 3)
            first = values[:window]
            middle = values[max(0, (len(values) - window) // 2) : max(0, (len(values) - window) // 2) + window]
            last = values[-window:]
            first_avg = mean(first)
            middle_avg = mean(middle) if middle else first_avg
            last_avg = mean(last)
            change_rate = 0.0 if abs(first_avg) < 1e-9 else (last_avg - first_avg) / abs(first_avg)
            volatility = 0.0 if len(values) < 2 or abs(mean(values)) < 1e-9 else stdev(values) / abs(mean(values))

            reversal = (middle_avg - first_avg) * (last_avg - middle_avg) < 0 and abs(change_rate) >= 0.08
            if reversal:
                direction = "reversal"
            elif abs(change_rate) < 0.08 and volatility < 0.12:
                direction = "stable"
            elif volatility >= 0.22:
                direction = "volatile"
            elif change_rate > 0:
                direction = "up"
            else:
                direction = "down"

            metric_label = self.TREND_METRIC_LABELS.get(metric, metric)
            summary_map = {
                "up": f"{metric_label}较前段上升 {change_rate:.1%}",
                "down": f"{metric_label}较前段下降 {abs(change_rate):.1%}",
                "volatile": f"{metric_label}波动率较高，存在明显起伏",
                "stable": f"{metric_label}整体保持稳定",
                "reversal": f"{metric_label}存在趋势反转，前中后段均值方向不一致",
            }
            findings.append(
                TrendFinding(
                    metric=metric,
                    metric_label=metric_label,
                    direction=direction,
                    change_rate=change_rate,
                    volatility=volatility,
                    summary=summary_map[direction],
                    evidence=[
                        f"前段均值 {first_avg:.2f}",
                        f"中段均值 {middle_avg:.2f}",
                        f"后段均值 {last_avg:.2f}",
                        f"波动率 {volatility:.2%}",
                    ],
                )
            )
        return findings

    def detect_anomalies(self, metrics: MetricSnapshot, data: ReportDataBundle) -> list[AnomalyFinding]:
        anomalies: list[AnomalyFinding] = []
        operation_points = metrics.trend_metrics.get("operation_points", [])

        for metric, label in (
            ("flow_rate", "输量"),
            ("energy_consumption", "能耗"),
            ("pump_efficiency", "泵效"),
            ("end_station_pressure", "末站进站压头"),
        ):
            values = _valid_values(operation_points, metric)
            if len(values) < 6:
                continue
            baseline = mean(values)
            deviation = stdev(values) if len(values) > 1 else 0.0
            if deviation <= 0:
                continue
            metric_points = [row for row in operation_points if _to_float(row.get(metric)) is not None]

            for index, row in enumerate(metric_points):
                value = _to_float(row.get(metric))
                if value is None:
                    continue
                z_score = abs((value - baseline) / deviation)
                if z_score >= 2.4:
                    anomalies.append(
                        AnomalyFinding(
                            target=str(row.get("project_name") or "当前分析范围"),
                            target_type="history_series",
                            metric=metric,
                            value=value,
                            baseline=baseline,
                            severity="high" if z_score >= 3 else "medium",
                            summary=f"{label}在 {row.get('timestamp') or row.get('day') or '-'} 出现异常偏离",
                            evidence=[
                                f"当前值 {value:.2f}",
                                f"历史均值 {baseline:.2f}",
                                f"偏离倍数 {z_score:.2f}",
                            ],
                        )
                    )
                    break

                if index > 0:
                    prev_value = _to_float(metric_points[index - 1].get(metric))
                    if prev_value is None or abs(prev_value) < 1e-9:
                        continue
                    change = (value - prev_value) / abs(prev_value)
                    if abs(change) >= 0.35:
                        anomalies.append(
                            AnomalyFinding(
                                target=str(row.get("project_name") or "当前分析范围"),
                                target_type="history_series",
                                metric=f"{metric}_jump",
                                value=value,
                                baseline=prev_value,
                                severity="high" if abs(change) >= 0.5 else "medium",
                                summary=f"{label}在相邻时点出现突变",
                                evidence=[
                                    f"上一时点 {prev_value:.2f}",
                                    f"当前值 {value:.2f}",
                                    f"变化幅度 {change:.1%}",
                                ],
                            )
                        )
                        break

        pump_rows = metrics.object_metrics.get("pump_stations", [])
        eff_values = [row["pump_efficiency"] for row in pump_rows if row.get("pump_efficiency") is not None]
        eff_baseline = mean(eff_values) if eff_values else None
        eff_std = stdev(eff_values) if len(eff_values) > 1 else 0.0

        for row in pump_rows:
            value = row.get("pump_efficiency")
            if value is None or eff_baseline is None:
                continue
            low_by_threshold = value < 0.75
            low_by_distribution = eff_std > 0 and value < eff_baseline - eff_std
            if low_by_threshold or low_by_distribution:
                anomalies.append(
                    AnomalyFinding(
                        target=str(row["name"]),
                        target_type="pump_station",
                        metric="pump_efficiency",
                        value=value,
                        baseline=eff_baseline,
                        severity="high" if value < 0.7 else "medium",
                        summary=f"{row['name']} 泵效偏低，低于当前样本基线",
                        evidence=[
                            f"当前值 {value:.2%}",
                            f"样本均值 {eff_baseline:.2%}",
                        ],
                    )
                )

        return anomalies

    def infer_causes(
        self,
        anomalies: list[AnomalyFinding],
        metrics: MetricSnapshot,
        request: DynamicReportRequest,
    ) -> list[CauseFinding]:
        causes: list[CauseFinding] = []
        operation_points = metrics.trend_metrics.get("operation_points", [])
        avg_viscosity = metrics.overview_metrics.get("avg_viscosity")
        avg_pump_eff = metrics.overview_metrics.get("avg_pump_efficiency")
        avg_pressure = metrics.overview_metrics.get("avg_end_station_pressure")
        flow_energy_corr = _pearson(_paired_values(operation_points, "flow_rate", "energy_consumption"))
        flow_pressure_corr = _pearson(_paired_values(operation_points, "flow_rate", "end_station_pressure"))

        for item in anomalies:
            primary = "当前异常需要结合更多运行记录复核"
            secondary: list[str] = []
            evidence = list(item.evidence)
            confidence = 0.58

            if item.metric in {"energy_consumption", "energy_consumption_jump"}:
                if flow_energy_corr is not None and flow_energy_corr >= 0.65:
                    primary = "输量升高与能耗升高呈显著同向变化，异常更可能由高负荷工况触发"
                    evidence.append(f"输量-能耗相关系数 {flow_energy_corr:.2f}")
                    confidence += 0.16
                if avg_pump_eff is not None and avg_pump_eff < 0.78:
                    secondary.append("泵效整体偏低，放大了单位输量能耗")
                    evidence.append(f"平均泵效 {avg_pump_eff:.2%}")
                    confidence += 0.08
                if avg_viscosity is not None and avg_viscosity > 10:
                    secondary.append("油品黏度偏高，增加了输送阻力")
                    evidence.append(f"平均黏度 {avg_viscosity:.2f}")
                    confidence += 0.06

            elif item.metric in {"end_station_pressure", "end_station_pressure_jump", "pressure_loss_risk"}:
                if flow_pressure_corr is not None and flow_pressure_corr <= -0.45:
                    primary = "输量升高与末站压力下降存在负相关，压力异常可能由高输量工况触发"
                    evidence.append(f"输量-压力相关系数 {flow_pressure_corr:.2f}")
                    confidence += 0.15
                if avg_viscosity is not None and avg_viscosity > 10:
                    secondary.append("高黏度工况增加了沿程压降")
                    evidence.append(f"平均黏度 {avg_viscosity:.2f}")
                    confidence += 0.06
                if not request.allow_pump_adjust:
                    secondary.append("当前禁止调泵，压力补偿手段受限")
                    evidence.append("运行限制：禁止调泵")
                    confidence += 0.08

            elif item.metric in {"pump_efficiency", "pump_efficiency_jump"}:
                primary = "泵效偏低导致单位输量能耗上升，并削弱有效扬程利用率"
                if avg_viscosity is not None and avg_viscosity > 10:
                    secondary.append("高黏度工况放大了低泵效带来的能耗影响")
                    evidence.append(f"平均黏度 {avg_viscosity:.2f}")
                    confidence += 0.06
                if avg_pressure is not None and request.min_pressure is not None and avg_pressure < request.min_pressure:
                    secondary.append("末站压力余量不足，泵效下降更容易触发压力风险")
                    evidence.append(f"平均末站进站压头 {avg_pressure:.2f}")
                    confidence += 0.08

            elif item.metric in {"flow_rate", "flow_rate_jump"}:
                primary = "输量波动较大，可能同时拉动能耗和压力结果变化"
                if flow_energy_corr is not None and flow_energy_corr >= 0.65:
                    secondary.append("输量与能耗呈显著正相关")
                    evidence.append(f"输量-能耗相关系数 {flow_energy_corr:.2f}")
                    confidence += 0.12
                if flow_pressure_corr is not None and flow_pressure_corr <= -0.45:
                    secondary.append("输量与末站压力呈显著负相关")
                    evidence.append(f"输量-压力相关系数 {flow_pressure_corr:.2f}")
                    confidence += 0.12

            causes.append(
                CauseFinding(
                    target=item.target,
                    metric=item.metric,
                    primary_cause=primary,
                    secondary_causes=secondary,
                    evidence=evidence,
                    confidence=min(confidence, 0.95),
                )
            )
        return causes

    def infer_constraints(self, metrics: MetricSnapshot, request: DynamicReportRequest) -> list[ConstraintFinding]:
        constraints: list[ConstraintFinding] = []
        target_flow_gap = metrics.constraint_metrics.get("target_flow_gap")
        min_pressure_gap = metrics.constraint_metrics.get("min_pressure_gap")

        if request.target_throughput is not None:
            if target_flow_gap is None:
                constraints.append(
                    ConstraintFinding(
                        name="输量约束",
                        severity="low",
                        summary="目标输量已设定，但暂缺可用于校核的运行数据。",
                        evidence=[f"目标输量 {request.target_throughput:.2f} m3/h"],
                    )
                )
            elif target_flow_gap < 0:
                constraints.append(
                    ConstraintFinding(
                        name="输量约束",
                        severity="high",
                        summary="平均输量低于目标输量，存在输量缺口。",
                        evidence=[f"缺口 {abs(target_flow_gap):.2f} m3/h"],
                    )
                )
            else:
                constraints.append(
                    ConstraintFinding(
                        name="输量约束",
                        severity="low",
                        summary="平均输量已满足目标要求。",
                        evidence=[f"余量 {target_flow_gap:.2f} m3/h"],
                    )
                )

        if request.min_pressure is not None:
            if min_pressure_gap is None:
                constraints.append(
                    ConstraintFinding(
                        name="压力约束",
                        severity="low",
                        summary="最低出口压力已设定，但暂缺可用于校核的运行数据。",
                        evidence=[f"最低出口压力 {request.min_pressure:.2f} MPa"],
                    )
                )
            elif min_pressure_gap < 0:
                constraints.append(
                    ConstraintFinding(
                        name="压力约束",
                        severity="high",
                        summary="末站压力低于最低出口压力，存在压力缺口。",
                        evidence=[f"缺口 {abs(min_pressure_gap):.2f} MPa"],
                    )
                )
            else:
                constraints.append(
                    ConstraintFinding(
                        name="压力约束",
                        severity="low",
                        summary="末站压力满足最低出口压力要求。",
                        evidence=[f"余量 {min_pressure_gap:.2f} MPa"],
                    )
                )

        constraints.append(
            ConstraintFinding(
                name="运行限制",
                severity="low",
                summary="允许调整泵站组合" if request.allow_pump_adjust else "不允许调整泵站组合",
                evidence=["调泵限制"],
            )
        )
        return constraints

    def generate_recommendations(
        self,
        causes: list[CauseFinding],
        constraints: list[ConstraintFinding],
        request: DynamicReportRequest,
    ) -> list[RecommendationFinding]:
        recommendations: list[RecommendationFinding] = []
        goal_label = optimization_goal_label(request.optimization_goal)

        for item in causes:
            if "泵效偏低" in item.primary_cause or item.metric.startswith("pump_efficiency"):
                action = "优先复核低效率泵组运行组合，并对低负荷泵组做停启优化"
                if goal_label == "压力优先":
                    action = "在满足压力冗余前提下逐步优化低效率泵组运行组合"
                recommendations.append(
                    RecommendationFinding(
                        target=item.target,
                        priority="high",
                        reason=item.primary_cause,
                        action=action,
                        expected="降低单位输量能耗并减少无效扬程",
                    )
                )

            if "压力" in item.primary_cause or item.metric.startswith("end_station_pressure"):
                action = "核查目标输量与泵站组合，必要时提升末站压力裕度"
                if goal_label == "输量优先":
                    action = "在保证最低压力前提下优先校核输量缺口并优化泵站组合"
                recommendations.append(
                    RecommendationFinding(
                        target=item.target,
                        priority="high",
                        reason=item.primary_cause,
                        action=action,
                        expected="提升压力可行性并降低运行风险",
                    )
                )

        for item in constraints:
            if item.severity == "high":
                recommendations.append(
                    RecommendationFinding(
                        target=item.name,
                        priority="high",
                        reason=item.summary,
                        action="优先校核约束边界并重新评估当前方案可行性",
                        expected="降低约束冲突带来的运行风险",
                    )
                )

        return recommendations

    def build_risks(
        self,
        issues: list[IssueFinding],
        anomalies: list[AnomalyFinding],
        constraints: list[ConstraintFinding],
    ) -> list[dict]:
        risks: list[dict] = []
        for item in issues[:4]:
            risks.append(
                {
                    "target": item.target,
                    "riskType": item.issue_type,
                    "level": "高" if item.level == "high" else "中",
                    "reason": item.message,
                    "suggestion": "建议结合目标约束复核对应参数，并评估是否需要调整方案。",
                }
            )

        for item in anomalies[:3]:
            risks.append(
                {
                    "target": item.target,
                    "riskType": item.metric,
                    "level": "高" if item.severity == "high" else "中",
                    "reason": item.summary,
                    "suggestion": "建议复核异常时点的参数配置与运行记录。",
                }
            )

        for item in constraints:
            if item.severity == "high":
                risks.append(
                    {
                        "target": item.name,
                        "riskType": "constraint",
                        "level": "高",
                        "reason": item.summary,
                        "suggestion": "建议优先处理约束缺口，避免方案不可行。",
                    }
                )
        return risks
