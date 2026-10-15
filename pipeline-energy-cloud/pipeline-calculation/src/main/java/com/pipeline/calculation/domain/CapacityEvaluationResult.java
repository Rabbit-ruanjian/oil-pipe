package com.pipeline.calculation.domain;

import lombok.Builder;
import lombok.Data;

import java.math.BigDecimal;
import java.util.List;

/** 输油能力窗口评估结果。 */
@Data
@Builder
public class CapacityEvaluationResult {
    private HydraulicAnalysisResult baseResult;
    private List<CapacityPoint> points;
    private BigDecimal feasibleMinFlow;
    private BigDecimal feasibleMaxFlow;
    private BigDecimal recommendedFlow;
    private BigDecimal minEndPressure;
    private BigDecimal maxEndPressure;
    private BigDecimal maxVelocity;
    private Integer totalCalculations;
    private String bottleneck;
    private String conclusion;

    @Data
    @Builder
    public static class CapacityPoint {
        private BigDecimal flowRate;
        private BigDecimal velocity;
        private BigDecimal endStationPressure;
        private BigDecimal pressureMargin;
        private BigDecimal frictionHeadLoss;
        private BigDecimal hydraulicSlope;
        private BigDecimal reynoldsNumber;
        private String flowRegime;
        private Boolean feasible;
        private String constraintMessage;
    }
}
