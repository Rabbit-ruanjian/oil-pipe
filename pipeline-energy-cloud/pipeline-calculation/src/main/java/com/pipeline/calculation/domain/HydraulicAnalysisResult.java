package com.pipeline.calculation.domain;

import lombok.Data;
import java.math.BigDecimal;

/**
 * 水力特性分析结果
 */
@Data
public class HydraulicAnalysisResult {
    /**
     * 沿程摩阻 (m) - h
     */
    private BigDecimal frictionHeadLoss;

    /**
     * 雷诺数 - Re
     */
    private BigDecimal reynoldsNumber;

    /**
     * 流态 (层流/紊流/水力光滑/混合摩擦/粗糙)
     */
    private String flowRegime;

    /**
     * 水力坡降 - i
     */
    private BigDecimal hydraulicSlope;

    /**
     * 总扬程 (m)
     */
    private BigDecimal totalHead;

    /**
     * 首站出站压力 (MPa)
     */
    private BigDecimal firstStationOutPressure;

    /**
     * 末站进站压力 (MPa)
     */
    private BigDecimal endStationInPressure;
}
