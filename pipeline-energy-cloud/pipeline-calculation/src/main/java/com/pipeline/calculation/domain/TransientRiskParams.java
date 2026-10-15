package com.pipeline.calculation.domain;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.math.BigDecimal;

/** 输油管道启停/阀门操作瞬态冲击风险评估参数。 */
@Data
public class TransientRiskParams {

    @Valid
    @NotNull(message = "基础水力参数不能为空")
    private HydraulicAnalysisParams baseParams;

    /** PUMP_TRIP 或 VALVE_CLOSURE。 */
    private String eventType;

    /** 流量变化比例，泵跳停默认 100%，阀门关闭默认 100%。 */
    private BigDecimal flowChangePercent;

    /** 操作完成时间，单位 s。 */
    private BigDecimal eventDurationSeconds;

    /** 油品等效压力波速，单位 m/s。 */
    private BigDecimal waveSpeed;

    /** 末站最低允许压头，单位 m。 */
    private BigDecimal minAllowableHead;

    /** 末站最高允许压头，单位 m。 */
    private BigDecimal maxAllowableHead;

    private Long projectId;
    private String projectName;
}
