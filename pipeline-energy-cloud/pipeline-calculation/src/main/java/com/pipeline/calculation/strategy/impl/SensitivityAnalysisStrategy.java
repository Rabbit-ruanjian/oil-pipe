package com.pipeline.calculation.strategy.impl;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

import com.pipeline.calculation.domain.HydraulicAnalysisParams;
import com.pipeline.calculation.domain.HydraulicAnalysisResult;
import com.pipeline.calculation.domain.SensitivityAnalysisParams;
import com.pipeline.calculation.domain.SensitivityAnalysisParams.AnalysisType;
import com.pipeline.calculation.domain.SensitivityAnalysisParams.SensitivityVariable;
import com.pipeline.calculation.domain.SensitivityAnalysisResult;
import com.pipeline.calculation.domain.SensitivityAnalysisResult.CrossAnalysisResult;
import com.pipeline.calculation.domain.SensitivityAnalysisResult.DataPoint;
import com.pipeline.calculation.domain.SensitivityAnalysisResult.SensitivityRanking;
import com.pipeline.calculation.domain.SensitivityAnalysisResult.VariableSensitivityResult;
import com.pipeline.calculation.strategy.CalculationStrategy;
import com.pipeline.common.core.domain.Result;
import com.pipeline.common.core.enums.SensitivityVariableEnum;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 敏感性分析策略实现
 * <p>
 * 通过改变输入参数，分析各参数对水力计算结果的影响程度，
 * 支持单因素分析和多因素交叉分析。
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SensitivityAnalysisStrategy
        implements CalculationStrategy<SensitivityAnalysisParams, SensitivityAnalysisResult> {

    private static final String STRATEGY_TYPE = "SENSITIVITY_ANALYSIS";
    private static final int SCALE = 6;
    private static final BigDecimal HUNDRED = new BigDecimal("100");

    private final HydraulicAnalysisStrategy hydraulicAnalysisStrategy;

    @Override
    public Result<SensitivityAnalysisResult> calculate(SensitivityAnalysisParams params) {
        long startTime = System.currentTimeMillis();
        int totalCalculations = 0;

        // 参数校验
        if (params == null || params.getBaseParams() == null) {
            return Result.fail("基准参数不能为空");
        }
        if (params.getVariables() == null || params.getVariables().isEmpty()) {
            return Result.fail("敏感性变量不能为空");
        }

        try {
            // 计算基准结果
            Result<HydraulicAnalysisResult> baseCalcResult =
                    hydraulicAnalysisStrategy.calculate(params.getBaseParams());
            if (!baseCalcResult.isSuccess()) {
                return Result.fail("基准计算失败: " + baseCalcResult.getMsg());
            }
            HydraulicAnalysisResult baseResult = baseCalcResult.getData();
            totalCalculations++;

            SensitivityAnalysisResult.SensitivityAnalysisResultBuilder resultBuilder =
                    SensitivityAnalysisResult.builder().baseResult(baseResult);

            List<VariableSensitivityResult> variableResults = new ArrayList<>();
            List<CrossAnalysisResult> crossResults = new ArrayList<>();

            if (params.getAnalysisType() == AnalysisType.SINGLE) {
                // 单因素分析：逐个变量分析
                for (SensitivityVariable variable : params.getVariables()) {
                    VariableSensitivityResult varResult = analyzeSingleVariable(
                            params.getBaseParams(), baseResult, variable);
                    variableResults.add(varResult);
                    totalCalculations += varResult.getDataPoints().size();
                }
            } else {
                // 多因素交叉分析
                crossResults = analyzeCrossVariables(params.getBaseParams(), baseResult, params.getVariables());
                totalCalculations += crossResults.size();

                // 同时也生成单因素分析结果用于对比
                for (SensitivityVariable variable : params.getVariables()) {
                    VariableSensitivityResult varResult = analyzeSingleVariable(
                            params.getBaseParams(), baseResult, variable);
                    variableResults.add(varResult);
                    totalCalculations += varResult.getDataPoints().size();
                }
            }

            // 计算敏感性排序
            List<SensitivityRanking> rankings = calculateSensitivityRanking(variableResults);

            long duration = System.currentTimeMillis() - startTime;

            SensitivityAnalysisResult result = resultBuilder
                    .variableResults(variableResults)
                    .crossResults(crossResults.isEmpty() ? null : crossResults)
                    .sensitivityRanking(rankings)
                    .duration(duration)
                    .totalCalculations(totalCalculations)
                    .build();

            log.info("敏感性分析完成: 变量数={}, 计算次数={}, 耗时={}ms",
                    params.getVariables().size(), totalCalculations, duration);

            return Result.ok(result);

        } catch (Exception e) {
            log.error("敏感性分析异常", e);
            return Result.fail("敏感性分析失败: " + e.getMessage());
        }
    }

    /**
     * 单因素敏感性分析
     */
    private VariableSensitivityResult analyzeSingleVariable(
            HydraulicAnalysisParams baseParams,
            HydraulicAnalysisResult baseResult,
            SensitivityVariable variable) {

        SensitivityVariableEnum varEnum = SensitivityVariableEnum.fromCode(variable.getVariableType());
        String varName = varEnum != null ? varEnum.getName() : variable.getVariableType();
        String unit = varEnum != null ? varEnum.getUnit() : "";

        BigDecimal baseValue = getVariableValue(baseParams, variable.getVariableType());
        List<DataPoint> dataPoints = new ArrayList<>();

        BigDecimal start = variable.getStartPercent();
        BigDecimal end = variable.getEndPercent();
        BigDecimal step = variable.getStepPercent();

        BigDecimal maxImpact = BigDecimal.ZERO;
        BigDecimal sumSensitivity = BigDecimal.ZERO;
        int pointCount = 0;

        // 遍历变化范围
        for (BigDecimal percent = start;
             percent.compareTo(end) <= 0;
             percent = percent.add(step)) {

            // 创建修改后的参数
            HydraulicAnalysisParams modifiedParams = cloneAndModifyParams(
                    baseParams, variable.getVariableType(), percent);

            // 执行计算
            Result<HydraulicAnalysisResult> calcResult = hydraulicAnalysisStrategy.calculate(modifiedParams);

            if (calcResult.isSuccess()) {
                HydraulicAnalysisResult result = calcResult.getData();
                BigDecimal modifiedValue = getVariableValue(modifiedParams, variable.getVariableType());

                // 计算变化率
                BigDecimal frictionChange = calculateChangePercent(
                        baseResult.getFrictionHeadLoss(), result.getFrictionHeadLoss());
                BigDecimal pressureChange = calculateChangePercent(
                        baseResult.getEndStationInPressure(), result.getEndStationInPressure());

                DataPoint point = DataPoint.builder()
                        .changePercent(percent)
                        .variableValue(modifiedValue)
                        .frictionHeadLoss(result.getFrictionHeadLoss())
                        .frictionChangePercent(frictionChange)
                        .endStationPressure(result.getEndStationInPressure())
                        .pressureChangePercent(pressureChange)
                        .hydraulicSlope(result.getHydraulicSlope())
                        .reynoldsNumber(result.getReynoldsNumber())
                        .flowRegime(result.getFlowRegime())
                        .fullResult(result)
                        .build();

                dataPoints.add(point);

                // 更新最大影响
                if (frictionChange.abs().compareTo(maxImpact) > 0) {
                    maxImpact = frictionChange.abs();
                }

                // 累计敏感性系数（用于平均）
                if (percent.compareTo(BigDecimal.ZERO) != 0) {
                    BigDecimal sensitivity = frictionChange.divide(percent, SCALE, RoundingMode.HALF_UP);
                    sumSensitivity = sumSensitivity.add(sensitivity.abs());
                    pointCount++;
                }
            }
        }

        // 计算平均敏感性系数
        BigDecimal avgSensitivity = pointCount > 0
                ? sumSensitivity.divide(BigDecimal.valueOf(pointCount), SCALE, RoundingMode.HALF_UP)
                : BigDecimal.ZERO;

        // 判断趋势
        String trend = determineTrend(dataPoints);

        return VariableSensitivityResult.builder()
                .variableType(variable.getVariableType())
                .variableName(varName)
                .unit(unit)
                .baseValue(baseValue)
                .dataPoints(dataPoints)
                .sensitivityCoefficient(avgSensitivity)
                .trend(trend)
                .maxImpactPercent(maxImpact)
                .build();
    }

    /**
     * 多因素交叉分析
     */
    private List<CrossAnalysisResult> analyzeCrossVariables(
            HydraulicAnalysisParams baseParams,
            HydraulicAnalysisResult baseResult,
            List<SensitivityVariable> variables) {

        List<CrossAnalysisResult> results = new ArrayList<>();

        // 简化实现：使用固定的变化点（-10%, 0%, +10%）
        BigDecimal[] changePoints = {
                new BigDecimal("-10"),
                BigDecimal.ZERO,
                new BigDecimal("10")
        };

        // 对于两个变量的情况，生成3x3的组合矩阵
        if (variables.size() >= 2) {
            SensitivityVariable var1 = variables.get(0);
            SensitivityVariable var2 = variables.get(1);

            for (BigDecimal change1 : changePoints) {
                for (BigDecimal change2 : changePoints) {
                    // 修改参数
                    HydraulicAnalysisParams modifiedParams = cloneParams(baseParams);
                    modifyParamByPercent(modifiedParams, var1.getVariableType(), change1);
                    modifyParamByPercent(modifiedParams, var2.getVariableType(), change2);

                    // 执行计算
                    Result<HydraulicAnalysisResult> calcResult =
                            hydraulicAnalysisStrategy.calculate(modifiedParams);

                    if (calcResult.isSuccess()) {
                        Map<String, BigDecimal> changes = new HashMap<>();
                        changes.put(var1.getVariableType(), change1);
                        changes.put(var2.getVariableType(), change2);

                        BigDecimal overallChange = calculateChangePercent(
                                baseResult.getFrictionHeadLoss(),
                                calcResult.getData().getFrictionHeadLoss());

                        String desc = String.format("%s: %+.0f%%, %s: %+.0f%%",
                                var1.getVariableType(), change1.doubleValue(),
                                var2.getVariableType(), change2.doubleValue());

                        results.add(CrossAnalysisResult.builder()
                                .combinationDesc(desc)
                                .variableChanges(changes)
                                .result(calcResult.getData())
                                .overallChangePercent(overallChange)
                                .build());
                    }
                }
            }
        }

        return results;
    }

    /**
     * 计算敏感性排序
     */
    private List<SensitivityRanking> calculateSensitivityRanking(
            List<VariableSensitivityResult> variableResults) {

        List<SensitivityRanking> rankings = new ArrayList<>();

        // 按敏感性系数排序
        variableResults.stream()
                .sorted(Comparator.comparing(
                        v -> v.getSensitivityCoefficient().abs(),
                        Comparator.reverseOrder()))
                .forEach(v -> {
                    int rank = rankings.size() + 1;
                    String description = generateSensitivityDescription(v);

                    rankings.add(SensitivityRanking.builder()
                            .rank(rank)
                            .variableType(v.getVariableType())
                            .variableName(v.getVariableName())
                            .sensitivityCoefficient(v.getSensitivityCoefficient())
                            .description(description)
                            .build());
                });

        return rankings;
    }

    /**
     * 生成敏感性描述
     */
    private String generateSensitivityDescription(VariableSensitivityResult result) {
        BigDecimal coefficient = result.getSensitivityCoefficient();

        if (coefficient.compareTo(new BigDecimal("1.5")) > 0) {
            return "高敏感性：" + result.getVariableName() + "变化对结果影响显著";
        } else if (coefficient.compareTo(new BigDecimal("0.5")) > 0) {
            return "中敏感性：" + result.getVariableName() + "变化对结果有明显影响";
        } else {
            return "低敏感性：" + result.getVariableName() + "变化对结果影响较小";
        }
    }

    /**
     * 获取变量值
     */
    private BigDecimal getVariableValue(HydraulicAnalysisParams params, String variableType) {
        return switch (variableType) {
            case "FLOW_RATE" -> params.getFlowRate();
            case "OIL_DENSITY" -> params.getDensity();
            case "OIL_VISCOSITY" -> params.getViscosity();
            case "PIPE_DIAMETER" -> params.getDiameter();
            case "PIPE_ROUGHNESS" -> params.getRoughness();
            case "TEMPERATURE" -> BigDecimal.ZERO; // 需要温度-粘度换算
            case "PUMP_EFFICIENCY" -> BigDecimal.ZERO; // 需要扩展
            default -> BigDecimal.ZERO;
        };
    }

    /**
     * 克隆并修改参数
     */
    private HydraulicAnalysisParams cloneAndModifyParams(
            HydraulicAnalysisParams base, String variableType, BigDecimal changePercent) {
        HydraulicAnalysisParams params = cloneParams(base);
        modifyParamByPercent(params, variableType, changePercent);
        return params;
    }

    /**
     * 克隆参数
     */
    private HydraulicAnalysisParams cloneParams(HydraulicAnalysisParams base) {
        HydraulicAnalysisParams params = new HydraulicAnalysisParams();
        params.setPipelineId(base.getPipelineId());
        params.setOilId(base.getOilId());
        params.setFlowRate(base.getFlowRate());
        params.setDensity(base.getDensity());
        params.setViscosity(base.getViscosity());
        params.setLength(base.getLength());
        params.setDiameter(base.getDiameter());
        params.setThickness(base.getThickness());
        params.setRoughness(base.getRoughness());
        params.setStartAltitude(base.getStartAltitude());
        params.setEndAltitude(base.getEndAltitude());
        params.setInletPressure(base.getInletPressure());
        params.setPump480Num(base.getPump480Num());
        params.setPump375Num(base.getPump375Num());
        params.setPump480Head(base.getPump480Head());
        params.setPump375Head(base.getPump375Head());
        return params;
    }

    /**
     * 按百分比修改参数
     */
    private void modifyParamByPercent(HydraulicAnalysisParams params,
                                       String variableType, BigDecimal changePercent) {
        BigDecimal multiplier = BigDecimal.ONE.add(changePercent.divide(HUNDRED, SCALE, RoundingMode.HALF_UP));

        switch (variableType) {
            case "FLOW_RATE" -> params.setFlowRate(
                    params.getFlowRate().multiply(multiplier).setScale(SCALE, RoundingMode.HALF_UP));
            case "OIL_DENSITY" -> params.setDensity(
                    params.getDensity().multiply(multiplier).setScale(SCALE, RoundingMode.HALF_UP));
            case "OIL_VISCOSITY" -> params.setViscosity(
                    params.getViscosity().multiply(multiplier).setScale(SCALE, RoundingMode.HALF_UP));
            case "PIPE_DIAMETER" -> params.setDiameter(
                    params.getDiameter().multiply(multiplier).setScale(SCALE, RoundingMode.HALF_UP));
            case "PIPE_ROUGHNESS" -> params.setRoughness(
                    params.getRoughness().multiply(multiplier).setScale(SCALE, RoundingMode.HALF_UP));
            default -> log.warn("未知的变量类型: {}", variableType);
        }
    }

    /**
     * 计算变化百分比
     */
    private BigDecimal calculateChangePercent(BigDecimal base, BigDecimal current) {
        if (base == null || current == null || base.compareTo(BigDecimal.ZERO) == 0) {
            return BigDecimal.ZERO;
        }
        return current.subtract(base)
                .divide(base, SCALE, RoundingMode.HALF_UP)
                .multiply(HUNDRED)
                .setScale(2, RoundingMode.HALF_UP);
    }

    /**
     * 判断趋势
     */
    private String determineTrend(List<DataPoint> dataPoints) {
        if (dataPoints.size() < 2) {
            return "UNKNOWN";
        }

        boolean allPositive = true;
        boolean allNegative = true;

        for (DataPoint point : dataPoints) {
            BigDecimal change = point.getFrictionChangePercent();
            BigDecimal percent = point.getChangePercent();

            // 判断变化方向是否一致
            boolean sameDirection = (change.compareTo(BigDecimal.ZERO) >= 0)
                    == (percent.compareTo(BigDecimal.ZERO) >= 0);

            if (!sameDirection) {
                allPositive = false;
            }
            if (sameDirection && change.compareTo(BigDecimal.ZERO) != 0) {
                allNegative = false;
            }
        }

        if (allPositive && !allNegative) {
            return "POSITIVE";
        } else if (allNegative && !allPositive) {
            return "NEGATIVE";
        } else {
            return "MIXED";
        }
    }

    @Override
    public String getType() {
        return STRATEGY_TYPE;
    }
}
