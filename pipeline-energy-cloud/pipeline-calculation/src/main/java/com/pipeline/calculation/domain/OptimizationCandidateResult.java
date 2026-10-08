package com.pipeline.calculation.domain;

import lombok.Data;

import java.math.BigDecimal;

/**
 * 单个泵组组合的计算结果。
 */
@Data
public class OptimizationCandidateResult {

    /** ZMI480 泵数量。 */
    private Integer pump480Num;

    /** ZMI375 泵数量。 */
    private Integer pump375Num;

    /** 组合总扬程 (m)。 */
    private BigDecimal totalHead;

    /** 管道总降压 (m)。 */
    private BigDecimal totalPressureDrop;

    /** 末站进站压力 (m)。 */
    private BigDecimal endStationInPressure;

    /** 该组合是否满足末站压力约束。 */
    private Boolean isFeasible;

    /** 预计年总能耗 (kWh)。 */
    private BigDecimal totalEnergyConsumption;

    /** 预计年总费用 (元)。 */
    private BigDecimal totalCost;

    /** 是否为后端最终推荐组合。 */
    private Boolean recommended;

    /** 该组合的计算说明。 */
    private String description;
}
