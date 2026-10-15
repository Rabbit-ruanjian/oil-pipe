package com.pipeline.calculation.domain;

import lombok.Builder;
import lombok.Data;

import java.math.BigDecimal;

/** 启停/阀门操作瞬态冲击风险评估结果。 */
@Data
@Builder
public class TransientRiskResult {
    private HydraulicAnalysisResult baseResult;
    private String eventType;
    private BigDecimal baseVelocity;
    private BigDecimal waveSpeed;
    private BigDecimal criticalDurationSeconds;
    private BigDecimal eventDurationSeconds;
    private BigDecimal flowChangePercent;
    private BigDecimal surgeHead;
    private BigDecimal predictedMaximumHead;
    private BigDecimal predictedMinimumHead;
    private BigDecimal maxAllowableHead;
    private BigDecimal minAllowableHead;
    private String riskLevel;
    private Boolean pressureBoundaryExceeded;
    private String conclusion;
    private String recommendation;
}
