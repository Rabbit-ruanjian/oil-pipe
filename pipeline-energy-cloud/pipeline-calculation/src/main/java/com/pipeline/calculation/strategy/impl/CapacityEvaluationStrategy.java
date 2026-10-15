package com.pipeline.calculation.strategy.impl;

import com.pipeline.calculation.core.HydraulicCalculator;
import com.pipeline.calculation.domain.CapacityEvaluationParams;
import com.pipeline.calculation.domain.CapacityEvaluationResult;
import com.pipeline.calculation.domain.HydraulicAnalysisParams;
import com.pipeline.calculation.domain.HydraulicAnalysisResult;
import com.pipeline.calculation.strategy.CalculationStrategy;
import com.pipeline.common.core.domain.Result;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;

/**
 * 输送能力窗口评估：固定项目当前泵组，扫描流量并识别可行运行区间。
 */
@Component
public class CapacityEvaluationStrategy implements CalculationStrategy<CapacityEvaluationParams, CapacityEvaluationResult> {

    private static final BigDecimal HALF = new BigDecimal("0.5");
    private static final BigDecimal ONE_POINT_FIVE = new BigDecimal("1.5");
    private static final BigDecimal DEFAULT_STEP = new BigDecimal("50");
    private static final BigDecimal ZERO = BigDecimal.ZERO;
    private static final int SCALE = 6;

    private final HydraulicAnalysisStrategy hydraulicAnalysisStrategy;

    public CapacityEvaluationStrategy(HydraulicAnalysisStrategy hydraulicAnalysisStrategy) {
        this.hydraulicAnalysisStrategy = hydraulicAnalysisStrategy;
    }

    @Override
    public Result<CapacityEvaluationResult> calculate(CapacityEvaluationParams params) {
        if (params == null || params.getBaseParams() == null) {
            return Result.fail("基础水力参数不能为空");
        }
        HydraulicAnalysisParams base = normalizeOperatingParams(params.getBaseParams());
        if (base.getFlowRate() == null || base.getFlowRate().compareTo(ZERO) <= 0) {
            return Result.fail("基准流量必须大于0");
        }

        BigDecimal minFlow = valueOr(params.getMinFlowRate(), base.getFlowRate().multiply(HALF));
        BigDecimal maxFlow = valueOr(params.getMaxFlowRate(), base.getFlowRate().multiply(ONE_POINT_FIVE));
        BigDecimal step = valueOr(params.getFlowStep(), DEFAULT_STEP);
        if (minFlow.compareTo(ZERO) <= 0 || maxFlow.compareTo(minFlow) < 0 || step.compareTo(ZERO) <= 0) {
            return Result.fail("流量扫描范围或步长无效");
        }

        BigDecimal lower = valueOr(params.getMinEndPressure(), ZERO);
        BigDecimal upper = params.getMaxEndPressure();
        List<CapacityEvaluationResult.CapacityPoint> points = new ArrayList<>();
        HydraulicAnalysisResult baseResult;
        Result<HydraulicAnalysisResult> baseCalculation = hydraulicAnalysisStrategy.calculate(base);
        if (!baseCalculation.isSuccess()) return Result.fail("基准水力计算失败: " + baseCalculation.getMsg());
        baseResult = stabilizeResult(base, baseCalculation.getData());

        BigDecimal innerDiameterMm = HydraulicCalculator.calculateInnerDiameter(base.getDiameter(), base.getThickness());
        BigDecimal area = HydraulicCalculator.calculateCrossArea(
                HydraulicCalculator.convertDiameterToMeter(innerDiameterMm));
        int guard = 0;
        for (BigDecimal flow = minFlow; flow.compareTo(maxFlow) <= 0 && guard++ < 500; flow = flow.add(step)) {
            HydraulicAnalysisParams candidate = copy(base);
            candidate.setFlowRate(flow);
            Result<HydraulicAnalysisResult> calculated = hydraulicAnalysisStrategy.calculate(candidate);
            if (!calculated.isSuccess()) continue;
            HydraulicAnalysisResult result = stabilizeResult(candidate, calculated.getData());
            BigDecimal velocity = HydraulicCalculator.calculateVelocity(
                    HydraulicCalculator.convertFlowRateToM3PerSec(flow), area);
            boolean pressureLow = result.getEndStationInPressure().compareTo(lower) < 0;
            boolean pressureHigh = upper != null && result.getEndStationInPressure().compareTo(upper) > 0;
            boolean velocityHigh = params.getMaxVelocity() != null && velocity.compareTo(params.getMaxVelocity()) > 0;
            boolean feasible = !pressureLow && !pressureHigh && !velocityHigh;
            String message = pressureLow ? "末站压头低于下限" : pressureHigh ? "末站压头高于上限" : velocityHigh ? "流速超过上限" : "在约束内";
            points.add(CapacityEvaluationResult.CapacityPoint.builder()
                    .flowRate(flow).velocity(velocity).endStationPressure(result.getEndStationInPressure())
                    .pressureMargin(result.getEndStationInPressure().subtract(lower))
                    .frictionHeadLoss(result.getFrictionHeadLoss()).hydraulicSlope(result.getHydraulicSlope())
                    .reynoldsNumber(result.getReynoldsNumber()).flowRegime(result.getFlowRegime())
                    .feasible(feasible).constraintMessage(message).build());
        }
        List<CapacityEvaluationResult.CapacityPoint> feasiblePoints = points.stream()
                .filter(point -> Boolean.TRUE.equals(point.getFeasible())).toList();
        BigDecimal feasibleMin = feasiblePoints.stream().map(CapacityEvaluationResult.CapacityPoint::getFlowRate)
                .min(BigDecimal::compareTo).orElse(null);
        BigDecimal feasibleMax = feasiblePoints.stream().map(CapacityEvaluationResult.CapacityPoint::getFlowRate)
                .max(BigDecimal::compareTo).orElse(null);
        BigDecimal recommended = chooseRecommended(feasiblePoints, base.getFlowRate());
        String bottleneck = detectBottleneck(points, lower, upper, params.getMaxVelocity());
        String conclusion = feasiblePoints.isEmpty()
                ? "当前泵组与压力/流速约束下没有可行输送区间，请复核边界或泵站数据。"
                : String.format("当前泵组可在 %.0f～%.0f m³/h 范围内运行，建议将 %.0f m³/h 作为基准工况。",
                feasibleMin, feasibleMax, recommended);
        return Result.ok(CapacityEvaluationResult.builder().baseResult(baseResult).points(points)
                .feasibleMinFlow(feasibleMin).feasibleMaxFlow(feasibleMax).recommendedFlow(recommended)
                .minEndPressure(lower).maxEndPressure(upper).maxVelocity(params.getMaxVelocity())
                .totalCalculations(points.size() + 1).bottleneck(bottleneck).conclusion(conclusion).build());
    }

    private BigDecimal chooseRecommended(List<CapacityEvaluationResult.CapacityPoint> points, BigDecimal baseFlow) {
        return points.stream().min((a, b) -> {
            int baseCompare = a.getFlowRate().subtract(baseFlow).abs().compareTo(b.getFlowRate().subtract(baseFlow).abs());
            return baseCompare != 0 ? baseCompare : b.getPressureMargin().compareTo(a.getPressureMargin());
        }).map(CapacityEvaluationResult.CapacityPoint::getFlowRate).orElse(null);
    }

    private String detectBottleneck(List<CapacityEvaluationResult.CapacityPoint> points, BigDecimal lower,
                                    BigDecimal upper, BigDecimal maxVelocity) {
        if (points.stream().anyMatch(point -> point.getEndStationPressure().compareTo(lower) < 0)) return "末站压力下限";
        if (upper != null && points.stream().anyMatch(point -> point.getEndStationPressure().compareTo(upper) > 0)) return "末站压力上限";
        if (maxVelocity != null && points.stream().anyMatch(point -> point.getVelocity().compareTo(maxVelocity) > 0)) return "管内流速上限";
        return "未触发约束";
    }

    private HydraulicAnalysisParams copy(HydraulicAnalysisParams source) {
        HydraulicAnalysisParams target = new HydraulicAnalysisParams();
        target.setProjectId(source.getProjectId()); target.setPipelineId(source.getPipelineId()); target.setOilId(source.getOilId());
        target.setFlowRate(source.getFlowRate()); target.setDensity(source.getDensity()); target.setViscosity(source.getViscosity());
        target.setLength(source.getLength()); target.setDiameter(source.getDiameter()); target.setThickness(source.getThickness());
        target.setRoughness(source.getRoughness()); target.setStartAltitude(source.getStartAltitude()); target.setEndAltitude(source.getEndAltitude());
        target.setInletPressure(source.getInletPressure()); target.setPump480Num(source.getPump480Num()); target.setPump375Num(source.getPump375Num());
        target.setPump480Head(source.getPump480Head()); target.setPump375Head(source.getPump375Head());
        return target;
    }

    /**
     * 运行边界页面兼容历史数据中把粗糙度按 mm 录入的情况。
     * 水力分析页面仍使用原始参数；这里只避免 0.015 这类常见录入值被当成 15 mm。
     */
    private HydraulicAnalysisParams normalizeOperatingParams(HydraulicAnalysisParams source) {
        HydraulicAnalysisParams target = copy(source);
        if (target.getRoughness() != null && target.getRoughness().compareTo(new BigDecimal("0.001")) > 0) {
            target.setRoughness(target.getRoughness().divide(new BigDecimal("1000"), SCALE, RoundingMode.HALF_UP));
        }
        return target;
    }

    /** 用 Darcy-Weisbach 对明显失真的长输管线摩阻结果做运行边界校核。 */
    private HydraulicAnalysisResult stabilizeResult(HydraulicAnalysisParams params, HydraulicAnalysisResult source) {
        double d = (params.getDiameter().doubleValue() - 2 * params.getThickness().doubleValue()) / 1000d;
        double q = params.getFlowRate().doubleValue() / 3600d;
        double area = Math.PI * d * d / 4d;
        double velocity = q / area;
        double re = velocity * d / params.getViscosity().doubleValue();
        double roughness = params.getRoughness().doubleValue();
        double relative = Math.max(roughness / d, 1e-8);
        double frictionFactor = re < 2300 ? 64d / Math.max(re, 1d)
                : 0.25d / Math.pow(Math.log10(relative / 3.7d + 5.74d / Math.pow(re, 0.9d)), 2);
        double practicalLoss = frictionFactor * (params.getLength().doubleValue() * 1000d / d)
                * (velocity * velocity / (2d * 9.80665d));
        if (source.getFrictionHeadLoss().doubleValue() <= practicalLoss * 1.25d) return source;
        BigDecimal loss = BigDecimal.valueOf(practicalLoss).setScale(8, RoundingMode.HALF_UP);
        BigDecimal totalHead = source.getTotalHead();
        BigDecimal first = params.getInletPressure().add(totalHead).subtract(loss.multiply(new BigDecimal("0.01")));
        BigDecimal elevation = params.getEndAltitude().subtract(params.getStartAltitude());
        BigDecimal end = first.subtract(loss).subtract(elevation);
        source.setFrictionHeadLoss(loss);
        source.setHydraulicSlope(loss.divide(params.getLength().multiply(new BigDecimal("1000")).multiply(new BigDecimal("1.01")), SCALE, RoundingMode.HALF_UP));
        source.setFirstStationOutPressure(first);
        source.setEndStationInPressure(end);
        return source;
    }

    private BigDecimal valueOr(BigDecimal value, BigDecimal fallback) {
        return value == null ? fallback : value.setScale(SCALE, RoundingMode.HALF_UP);
    }

    @Override
    public String getType() { return "CAPACITY_EVALUATION"; }
}
