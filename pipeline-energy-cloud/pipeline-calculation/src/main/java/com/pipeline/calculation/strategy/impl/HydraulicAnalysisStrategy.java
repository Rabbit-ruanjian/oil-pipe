package com.pipeline.calculation.strategy.impl;

import com.pipeline.calculation.core.FlowRegime;
import com.pipeline.calculation.core.HydraulicCalculator;
import com.pipeline.calculation.domain.HydraulicAnalysisParams;
import com.pipeline.calculation.domain.HydraulicAnalysisResult;
import com.pipeline.calculation.strategy.CalculationStrategy;
import com.pipeline.common.core.domain.Result;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;

import static com.pipeline.calculation.core.HydraulicConstants.SCALE;

/**
 * 水力特性分析策略实现
 * <p>
 * 基于管道水力学原理，计算管道输送过程中的水力特性参数，包括：
 * <ul>
 *     <li>雷诺数 - 判断流态</li>
 *     <li>沿程摩阻 - 管道摩擦损失</li>
 *     <li>水力坡降 - 单位长度压力损失</li>
 *     <li>首站出站压力</li>
 *     <li>末站进站压力</li>
 * </ul>
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
@Component
public class HydraulicAnalysisStrategy implements CalculationStrategy<HydraulicAnalysisParams, HydraulicAnalysisResult> {

    /**
     * 策略类型标识
     */
    private static final String STRATEGY_TYPE = "HYDRAULIC_ANALYSIS";

    @Override
    public Result<HydraulicAnalysisResult> calculate(HydraulicAnalysisParams params) {
        // 参数校验
        Result<Void> validationResult = validateParams(params);
        if (!validationResult.isSuccess()) {
            return Result.fail(validationResult.getMsg());
        }

        HydraulicAnalysisResult result = new HydraulicAnalysisResult();

        // 1. 基础参数准备
        BigDecimal flowRate = params.getFlowRate();
        BigDecimal outerDiameter = params.getDiameter();
        BigDecimal thickness = params.getThickness();
        BigDecimal viscosity = params.getViscosity();
        BigDecimal roughness = params.getRoughness();
        BigDecimal length = params.getLength();
        BigDecimal elevationDiff = params.getEndAltitude().subtract(params.getStartAltitude());

        // 2. 单位转换
        BigDecimal innerDiameterMm = HydraulicCalculator.calculateInnerDiameter(outerDiameter, thickness);
        BigDecimal innerDiameterMeter = HydraulicCalculator.convertDiameterToMeter(innerDiameterMm);
        BigDecimal flowRateM3PerSec = HydraulicCalculator.convertFlowRateToM3PerSec(flowRate);
        BigDecimal lengthMeter = HydraulicCalculator.convertLengthToMeter(length);

        // 3. 计算流速和截面积
        BigDecimal crossArea = HydraulicCalculator.calculateCrossArea(innerDiameterMeter);
        BigDecimal velocity = HydraulicCalculator.calculateVelocity(flowRateM3PerSec, crossArea);

        // 4. 计算雷诺数
        BigDecimal reynoldsNumber = HydraulicCalculator.calculateReynoldsNumber(
                velocity, innerDiameterMeter, viscosity);
        result.setReynoldsNumber(reynoldsNumber.setScale(SCALE, java.math.RoundingMode.HALF_UP));

        // 5. 计算相对粗糙度
        BigDecimal relativeRoughness = HydraulicCalculator.calculateRelativeRoughness(
                roughness, innerDiameterMm);

        // 6. 判断流态
        FlowRegime flowRegime = HydraulicCalculator.determineFlowRegime(reynoldsNumber, relativeRoughness);
        result.setFlowRegime(flowRegime.getDisplayName());

        // 7. 计算摩阻系数
        BigDecimal[] coefficients = HydraulicCalculator.calculateFrictionCoefficients(
                flowRegime, relativeRoughness, innerDiameterMm, roughness);
        BigDecimal beta = coefficients[0];
        BigDecimal m = coefficients[1];

        // 8. 计算沿程摩阻
        BigDecimal frictionHeadLoss = HydraulicCalculator.calculateFrictionHeadLoss(
                beta, m, flowRateM3PerSec, viscosity, innerDiameterMeter, lengthMeter);
        result.setFrictionHeadLoss(frictionHeadLoss);

        // 9. 计算水力坡降（带1.01校正系数）
        BigDecimal hydraulicSlope = HydraulicCalculator.calculateHydraulicSlopeWithCorrection(
                frictionHeadLoss, lengthMeter);
        result.setHydraulicSlope(hydraulicSlope);

        // 10. 计算总扬程
        BigDecimal totalHead = HydraulicCalculator.calculateTotalHead(
                params.getPump480Num(), params.getPump480Head(),
                params.getPump375Num(), params.getPump375Head());
        result.setTotalHead(totalHead);

        // 11. 计算首站出站压力
        BigDecimal firstStationOutPressure = HydraulicCalculator.calculateFirstStationOutPressure(
                params.getInletPressure(), totalHead, frictionHeadLoss);
        result.setFirstStationOutPressure(firstStationOutPressure);

        // 12. 计算末站进站压力
        // 使用水力坡降计算：H_end = H_out - i × L - Z
        BigDecimal pipelineLoss = hydraulicSlope.multiply(lengthMeter);
        BigDecimal endStationInPressure = firstStationOutPressure.subtract(pipelineLoss).subtract(elevationDiff);
        result.setEndStationInPressure(endStationInPressure);

        return Result.ok(result);
    }

    /**
     * 参数校验
     *
     * @param params 输入参数
     * @return 校验结果
     */
    private Result<Void> validateParams(HydraulicAnalysisParams params) {
        if (params == null) {
            return Result.fail("参数不能为空");
        }
        if (params.getFlowRate() == null || params.getFlowRate().compareTo(BigDecimal.ZERO) <= 0) {
            return Result.fail("流量必须大于0");
        }
        if (params.getDiameter() == null || params.getDiameter().compareTo(BigDecimal.ZERO) <= 0) {
            return Result.fail("管道外径必须大于0");
        }
        if (params.getThickness() == null || params.getThickness().compareTo(BigDecimal.ZERO) <= 0) {
            return Result.fail("管道壁厚必须大于0");
        }
        if (params.getViscosity() == null || params.getViscosity().compareTo(BigDecimal.ZERO) <= 0) {
            return Result.fail("运动粘度必须大于0");
        }
        if (params.getRoughness() == null || params.getRoughness().compareTo(BigDecimal.ZERO) <= 0) {
            return Result.fail("当量粗糙度必须大于0");
        }
        if (params.getLength() == null || params.getLength().compareTo(BigDecimal.ZERO) <= 0) {
            return Result.fail("管道长度必须大于0");
        }
        if (params.getStartAltitude() == null || params.getEndAltitude() == null) {
            return Result.fail("起点和终点高程不能为空");
        }
        if (params.getInletPressure() == null) {
            return Result.fail("首站进站压头不能为空");
        }
        if (params.getPump480Head() == null || params.getPump375Head() == null) {
            return Result.fail("泵扬程参数不能为空");
        }
        if (params.getPump480Num() == null || params.getPump375Num() == null) {
            return Result.fail("泵数量参数不能为空");
        }
        return Result.ok();
    }

    @Override
    public String getType() {
        return STRATEGY_TYPE;
    }
}
