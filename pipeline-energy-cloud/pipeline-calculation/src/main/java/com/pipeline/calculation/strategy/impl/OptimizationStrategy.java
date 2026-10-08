package com.pipeline.calculation.strategy.impl;

import com.pipeline.calculation.core.FlowRegime;
import com.pipeline.calculation.core.HydraulicCalculator;
import com.pipeline.calculation.domain.OptimizationCandidateResult;
import com.pipeline.calculation.domain.OptimizationParams;
import com.pipeline.calculation.domain.OptimizationResult;
import com.pipeline.calculation.strategy.CalculationStrategy;
import com.pipeline.common.core.domain.Result;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

import static com.pipeline.calculation.core.HydraulicConstants.SCALE;

/**
 * 运行方案优化策略实现
 * <p>
 * 遍历所有可能的泵组合方案，基于"末站进站压力最小化"原则，
 * 选择最优的节能开泵方案。
 * </p>
 * <p>
 * 优化目标：
 * <ul>
 *     <li>方案可行性：末站进站压力 > 0</li>
 *     <li>能量最优：在可行方案中选择末站进站压力最小的方案（能量浪费最少）</li>
 * </ul>
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
@Component
public class OptimizationStrategy implements CalculationStrategy<OptimizationParams, OptimizationResult> {

    private static final Logger log = LoggerFactory.getLogger(OptimizationStrategy.class);

    /**
     * 策略类型标识
     */
    private static final String STRATEGY_TYPE = "OPTIMIZATION";

    /**
     * 泵组合方案：{ZMI480数量, ZMI375数量}
     *
     * 泵站优化必须在至少开启一台泵的运行组合中进行，因此不包含停泵组合 {0, 0}。
     */
    private static final int[][] PUMP_COMBINATIONS = {
            {0, 1}, {0, 2}, {0, 3},
            {1, 0}, {1, 1}, {1, 2}, {1, 3}
    };

    @Override
    public Result<OptimizationResult> calculate(OptimizationParams params) {
        // 参数校验
        Result<Void> validationResult = validateParams(params);
        if (!validationResult.isSuccess()) {
            return Result.fail(validationResult.getMsg());
        }

        log.info("开始执行开泵方案优化，共 {} 种组合", PUMP_COMBINATIONS.length);

        // 存储全部组合以及其中的可行方案
        List<OptimizationResult> allResults = new ArrayList<>();
        List<OptimizationResult> feasibleResults = new ArrayList<>();

        // 遍历所有泵组合
        for (int[] combo : PUMP_COMBINATIONS) {
            int pump480Num = combo[0];
            int pump375Num = combo[1];

            OptimizationResult currentResult = calculateForCombination(params, pump480Num, pump375Num);
            allResults.add(currentResult);

            log.debug("方案 [ZMI480={}, ZMI375={}]: 末站压力={}, 可行={}",
                    pump480Num, pump375Num,
                    currentResult.getEndStationInPressure(),
                    currentResult.getIsFeasible());

            if (Boolean.TRUE.equals(currentResult.getIsFeasible())) {
                feasibleResults.add(currentResult);
            }
        }

        // 检查是否有可行方案
        if (feasibleResults.isEmpty()) {
            log.warn("未找到满足条件的可行开泵方案");
            return Result.fail("未找到满足条件的可行开泵方案，请检查输入参数或增加泵配置");
        }

        // 选择最优方案：末站进站压力最小（能量浪费最少）
        OptimizationResult bestResult = feasibleResults.stream()
                .filter(r -> r.getEndStationInPressure().compareTo(BigDecimal.ZERO) > 0)
                .min(Comparator.comparing(OptimizationResult::getEndStationInPressure))
                .orElse(feasibleResults.get(0));

        // 返回最终推荐结果，同时附带全部组合的真实计算结果供前端切换查看
        String description = buildCombinationDescription(bestResult, true);
        bestResult.setDescription(description);
        bestResult.setCandidates(allResults.stream()
                .map(result -> toCandidateResult(result, isSameCombination(result, bestResult)))
                .toList());

        log.info("优化完成，{}", description);

        return Result.ok(bestResult);
    }

    /**
     * 将内部组合计算结果转换为接口候选项。
     */
    private OptimizationCandidateResult toCandidateResult(OptimizationResult result, boolean recommended) {
        OptimizationCandidateResult candidate = new OptimizationCandidateResult();
        candidate.setPump480Num(result.getPump480Num());
        candidate.setPump375Num(result.getPump375Num());
        candidate.setTotalHead(result.getTotalHead());
        candidate.setTotalPressureDrop(result.getTotalPressureDrop());
        candidate.setEndStationInPressure(result.getEndStationInPressure());
        candidate.setIsFeasible(result.getIsFeasible());
        candidate.setTotalEnergyConsumption(result.getTotalEnergyConsumption());
        candidate.setTotalCost(result.getTotalCost());
        candidate.setRecommended(recommended);
        candidate.setDescription(buildCombinationDescription(result, recommended));
        return candidate;
    }

    private boolean isSameCombination(OptimizationResult left, OptimizationResult right) {
        return left.getPump480Num().equals(right.getPump480Num())
                && left.getPump375Num().equals(right.getPump375Num());
    }

    private String buildCombinationDescription(OptimizationResult result, boolean recommended) {
        if (!Boolean.TRUE.equals(result.getIsFeasible())) {
            return String.format(
                    "不可行方案：ZMI480 开启 %d 台，ZMI375 开启 %d 台。" +
                            "末站进站压力 %.2f m，不满足末站进站压力大于 0 的约束，未计入推荐范围。",
                    result.getPump480Num(),
                    result.getPump375Num(),
                    result.getEndStationInPressure());
        }

        return String.format(
                "%s：ZMI480 开启 %d 台，ZMI375 开启 %d 台。" +
                        "末站进站压力 %.2f m，年能耗 %.2f kWh，年费用 %.2f 元。",
                recommended ? "推荐方案" : "候选方案",
                result.getPump480Num(),
                result.getPump375Num(),
                result.getEndStationInPressure(),
                result.getTotalEnergyConsumption(),
                result.getTotalCost());
    }

    /**
     * 计算特定泵组合的运行结果
     *
     * @param params     输入参数
     * @param pump480Num ZMI480 泵数量
     * @param pump375Num ZMI375 泵数量
     * @return 该组合的运行结果
     */
    private OptimizationResult calculateForCombination(OptimizationParams params,
                                                       int pump480Num,
                                                       int pump375Num) {
        OptimizationResult result = new OptimizationResult();
        result.setPump480Num(pump480Num);
        result.setPump375Num(pump375Num);

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

        // 3. 计算流速
        BigDecimal crossArea = HydraulicCalculator.calculateCrossArea(innerDiameterMeter);
        BigDecimal velocity = HydraulicCalculator.calculateVelocity(flowRateM3PerSec, crossArea);

        // 4. 计算雷诺数
        BigDecimal reynoldsNumber = HydraulicCalculator.calculateReynoldsNumber(
                velocity, innerDiameterMeter, viscosity);

        // 5. 计算相对粗糙度
        BigDecimal relativeRoughness = HydraulicCalculator.calculateRelativeRoughness(
                roughness, innerDiameterMm);

        // 6. 判断流态
        FlowRegime flowRegime = HydraulicCalculator.determineFlowRegime(reynoldsNumber, relativeRoughness);

        // 7. 计算摩阻系数
        BigDecimal[] coefficients = HydraulicCalculator.calculateFrictionCoefficients(
                flowRegime, relativeRoughness, innerDiameterMm, roughness);
        BigDecimal beta = coefficients[0];
        BigDecimal m = coefficients[1];

        // 8. 计算沿程摩阻
        BigDecimal frictionHeadLoss = HydraulicCalculator.calculateFrictionHeadLoss(
                beta, m, flowRateM3PerSec, viscosity, innerDiameterMeter, lengthMeter);

        // 9. 计算总扬程
        BigDecimal totalHead = HydraulicCalculator.calculateTotalHead(
                pump480Num, params.getPump480Head(),
                pump375Num, params.getPump375Head());
        result.setTotalHead(totalHead);

        // 10. 计算总降压
        BigDecimal totalPressureDrop = HydraulicCalculator.calculateTotalPressureDrop(
                frictionHeadLoss, elevationDiff);
        result.setTotalPressureDrop(totalPressureDrop);

        // 11. 计算首站出站压力
        BigDecimal firstStationOutPressure = HydraulicCalculator.calculateFirstStationOutPressure(
                params.getInletPressure(), totalHead, frictionHeadLoss);

        // 12. 计算末站进站压力（使用不带校正系数的水力坡降）
        // 公式：H_end = H_out - h - Z
        BigDecimal endStationInPressure = HydraulicCalculator.calculateEndStationInPressure(
                firstStationOutPressure, frictionHeadLoss, elevationDiff);
        result.setEndStationInPressure(endStationInPressure.setScale(SCALE, RoundingMode.HALF_UP));

        // 13. 判断方案是否可行
        boolean isFeasible = endStationInPressure.compareTo(BigDecimal.ZERO) > 0;
        result.setIsFeasible(isFeasible);

        // 14. 计算能耗和费用（仅对可行方案计算）
        if (isFeasible && totalHead.compareTo(BigDecimal.ZERO) > 0) {
            calculateEnergyAndCost(result, params, totalHead);
        } else {
            result.setTotalEnergyConsumption(BigDecimal.ZERO);
            result.setTotalCost(BigDecimal.ZERO);
        }

        return result;
    }

    /**
     * 计算能耗和费用
     *
     * @param result    结果对象
     * @param params    输入参数
     * @param totalHead 总扬程
     */
    private void calculateEnergyAndCost(OptimizationResult result,
                                        OptimizationParams params,
                                        BigDecimal totalHead) {
        // 获取质量流量
        BigDecimal massFlowRate = params.getMassFlowRate();

        // 计算年能耗 (kWh)
        BigDecimal energyConsumption = HydraulicCalculator.calculateEnergyConsumption(
                totalHead,
                massFlowRate,
                params.getWorkingDays(),
                params.getPumpEfficiency(),
                params.getMotorEfficiency());
        result.setTotalEnergyConsumption(energyConsumption.setScale(2, RoundingMode.HALF_UP));

        // 计算年费用 (元)
        BigDecimal totalCost = HydraulicCalculator.calculatePowerCost(
                totalHead,
                massFlowRate,
                params.getWorkingDays(),
                params.getPumpEfficiency(),
                params.getMotorEfficiency(),
                params.getElectricityPrice());
        result.setTotalCost(totalCost.setScale(2, RoundingMode.HALF_UP));
    }

    /**
     * 参数校验
     *
     * @param params 输入参数
     * @return 校验结果
     */
    private Result<Void> validateParams(OptimizationParams params) {
        if (params == null) {
            return Result.fail("参数不能为空");
        }
        if (params.getFlowRate() == null || params.getFlowRate().compareTo(BigDecimal.ZERO) <= 0) {
            return Result.fail("流量必须大于0");
        }
        if (params.getDensity() == null || params.getDensity().compareTo(BigDecimal.ZERO) <= 0) {
            return Result.fail("油品密度必须大于0");
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
        return Result.ok();
    }

    @Override
    public String getType() {
        return STRATEGY_TYPE;
    }
}
