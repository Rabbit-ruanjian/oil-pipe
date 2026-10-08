package com.pipeline.calculation.domain;

import lombok.Data;
import java.math.BigDecimal;
import java.util.List;

/**
 * 运行方案优化结果
 */
@Data
public class OptimizationResult {
    /**
     * 推荐 ZMI480 泵数量
     */
    private Integer pump480Num;

    /**
     * 推荐 ZMI375 泵数量
     */
    private Integer pump375Num;

    /**
     * 总扬程 (m)
     */
    private BigDecimal totalHead;

    /**
     * 总降压 (m)
     */
    private BigDecimal totalPressureDrop;

    /**
     * 末站进站压力 (m)
     */
    private BigDecimal endStationInPressure;

    /**
     * 方案是否可行
     */
    private Boolean isFeasible;

    /**
     * 预计总能耗 (kW·h)
     */
    private BigDecimal totalEnergyConsumption;

    /**
     * 预计总费用 (元)
     */
    private BigDecimal totalCost;

    /**
     * 方案描述
     */
    private String description;

    /**
     * 所有泵组组合的计算结果，包含可行和不可行方案
     */
    private List<OptimizationCandidateResult> candidates;
}
