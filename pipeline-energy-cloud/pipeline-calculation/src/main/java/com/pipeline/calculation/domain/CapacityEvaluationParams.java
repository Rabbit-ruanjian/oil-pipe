package com.pipeline.calculation.domain;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.math.BigDecimal;

/**
 * 输油能力窗口评估参数。
 * 固定当前项目泵组，仅扫描流量，不再搜索泵组组合。
 */
@Data
public class CapacityEvaluationParams {

    @Valid
    @NotNull(message = "基础水力参数不能为空")
    private HydraulicAnalysisParams baseParams;

    /** 扫描起始流量，单位 m³/h。为空时取基准流量的 50%。 */
    private BigDecimal minFlowRate;

    /** 扫描终止流量，单位 m³/h。为空时取基准流量的 150%。 */
    private BigDecimal maxFlowRate;

    /** 流量扫描步长，单位 m³/h。 */
    private BigDecimal flowStep;

    /** 末站最低允许压头，单位 m。 */
    private BigDecimal minEndPressure;

    /** 末站最高允许压头，单位 m；为空表示不设上限。 */
    private BigDecimal maxEndPressure;

    /** 管内最大允许流速，单位 m/s；为空表示不设流速上限。 */
    private BigDecimal maxVelocity;

    private Long projectId;
    private String projectName;
}
