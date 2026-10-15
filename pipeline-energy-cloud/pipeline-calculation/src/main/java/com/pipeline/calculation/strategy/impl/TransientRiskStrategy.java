package com.pipeline.calculation.strategy.impl;

import com.pipeline.calculation.core.HydraulicCalculator;
import com.pipeline.calculation.domain.HydraulicAnalysisParams;
import com.pipeline.calculation.domain.HydraulicAnalysisResult;
import com.pipeline.calculation.domain.TransientRiskParams;
import com.pipeline.calculation.domain.TransientRiskResult;
import com.pipeline.calculation.strategy.CalculationStrategy;
import com.pipeline.common.core.domain.Result;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * 基于 Joukowsky 压力波近似的启停/阀门操作冲击筛查。
 * 该模块用于运行前风险筛查，不替代完整瞬态仿真软件。
 */
@Component
public class TransientRiskStrategy implements CalculationStrategy<TransientRiskParams, TransientRiskResult> {

    private static final BigDecimal GRAVITY = new BigDecimal("9.80665");
    private static final BigDecimal DEFAULT_WAVE_SPEED = new BigDecimal("1000");
    private static final BigDecimal DEFAULT_EVENT_DURATION = new BigDecimal("10");
    private static final BigDecimal DEFAULT_CHANGE = new BigDecimal("100");
    private static final BigDecimal ZERO = BigDecimal.ZERO;
    private static final int SCALE = 6;

    private final HydraulicAnalysisStrategy hydraulicAnalysisStrategy;

    public TransientRiskStrategy(HydraulicAnalysisStrategy hydraulicAnalysisStrategy) {
        this.hydraulicAnalysisStrategy = hydraulicAnalysisStrategy;
    }

    @Override
    public Result<TransientRiskResult> calculate(TransientRiskParams params) {
        if (params == null || params.getBaseParams() == null) return Result.fail("基础水力参数不能为空");
        HydraulicAnalysisParams base = params.getBaseParams();
        Result<HydraulicAnalysisResult> baseCalculation = hydraulicAnalysisStrategy.calculate(base);
        if (!baseCalculation.isSuccess()) return Result.fail("基准水力计算失败: " + baseCalculation.getMsg());
        HydraulicAnalysisResult baseResult = baseCalculation.getData();
        if (base.getDensity() == null || base.getLength() == null || base.getDiameter() == null || base.getThickness() == null) {
            return Result.fail("密度、长度、直径和壁厚不能为空");
        }
        BigDecimal waveSpeed = positiveOr(params.getWaveSpeed(), DEFAULT_WAVE_SPEED);
        BigDecimal duration = positiveOr(params.getEventDurationSeconds(), DEFAULT_EVENT_DURATION);
        BigDecimal change = positiveOr(params.getFlowChangePercent(), DEFAULT_CHANGE);
        BigDecimal innerDiameterMm = HydraulicCalculator.calculateInnerDiameter(base.getDiameter(), base.getThickness());
        BigDecimal area = HydraulicCalculator.calculateCrossArea(HydraulicCalculator.convertDiameterToMeter(innerDiameterMm));
        BigDecimal velocity = HydraulicCalculator.calculateVelocity(
                HydraulicCalculator.convertFlowRateToM3PerSec(base.getFlowRate()), area);
        BigDecimal criticalDuration = base.getLength().multiply(new BigDecimal("1000"))
                .multiply(new BigDecimal("2")).divide(waveSpeed, SCALE, RoundingMode.HALF_UP);
        BigDecimal attenuation = duration.compareTo(criticalDuration) < 0
                ? BigDecimal.ONE : criticalDuration.divide(duration, SCALE, RoundingMode.HALF_UP).min(BigDecimal.ONE);
        BigDecimal deltaVelocity = velocity.multiply(change).divide(new BigDecimal("100"), SCALE, RoundingMode.HALF_UP);
        BigDecimal surgeHead = waveSpeed.multiply(deltaVelocity).divide(GRAVITY, SCALE, RoundingMode.HALF_UP).multiply(attenuation);
        BigDecimal maximum = baseResult.getEndStationInPressure().add(surgeHead);
        BigDecimal minimum = baseResult.getEndStationInPressure().subtract(surgeHead);
        BigDecimal minAllowable = params.getMinAllowableHead() == null ? ZERO : params.getMinAllowableHead();
        BigDecimal maxAllowable = params.getMaxAllowableHead();
        boolean exceeded = minimum.compareTo(minAllowable) < 0 || (maxAllowable != null && maximum.compareTo(maxAllowable) > 0);
        String risk = exceeded ? "HIGH" : (surgeHead.compareTo(baseResult.getEndStationInPressure().abs().multiply(new BigDecimal("0.25"))) > 0 ? "MEDIUM" : "LOW");
        String eventType = "VALVE_CLOSURE".equalsIgnoreCase(params.getEventType()) ? "VALVE_CLOSURE" : "PUMP_TRIP";
        String conclusion = String.format("事件将产生约 %.2f m 压头波动，预测范围 %.2f～%.2f m。", surgeHead, minimum, maximum);
        String recommendation = exceeded
                ? "建议延长阀门关闭/泵组停机时间，并校核泄压阀、调压阀和超前保护逻辑。"
                : risk.equals("MEDIUM") ? "建议将该操作纳入启停票据，确认关闭时间不短于临界时间并监视末站压力。"
                : "当前输入下冲击风险较低，仍应按操作规程执行并保留压力趋势记录。";
        return Result.ok(TransientRiskResult.builder().baseResult(baseResult).eventType(eventType)
                .baseVelocity(velocity).waveSpeed(waveSpeed).criticalDurationSeconds(criticalDuration)
                .eventDurationSeconds(duration).flowChangePercent(change).surgeHead(surgeHead)
                .predictedMaximumHead(maximum).predictedMinimumHead(minimum)
                .maxAllowableHead(maxAllowable).minAllowableHead(minAllowable)
                .riskLevel(risk).pressureBoundaryExceeded(exceeded).conclusion(conclusion)
                .recommendation(recommendation).build());
    }

    private BigDecimal positiveOr(BigDecimal value, BigDecimal fallback) {
        return value == null || value.compareTo(ZERO) <= 0 ? fallback : value;
    }

    @Override
    public String getType() { return "TRANSIENT_RISK"; }
}
