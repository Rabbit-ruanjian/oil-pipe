package com.pipeline.calculation.domain;

import lombok.Data;
import java.math.BigDecimal;

/**
 * 水力特性分析输入参数
 */
@Data
public class HydraulicAnalysisParams {
    /**
     * 项目ID (可选)
     */
    private Long projectId;

    /**
     * 管道ID (可选)
     */
    private Long pipelineId;

    /**
     * 油品ID (可选)
     */
    private Long oilId;

    /**
     * 流量 (m3/h)
     */
    private BigDecimal flowRate;

    /**
     * 油品密度 (kg/m3) - ρ
     */
    private BigDecimal density;

    /**
     * 油品运动粘度 (m2/s) - ν
     */
    private BigDecimal viscosity;

    /**
     * 管道长度 (km) - L
     */
    private BigDecimal length;

    /**
     * 管道外径 (mm) - D
     */
    private BigDecimal diameter;

    /**
     * 管道壁厚 (mm) - δ
     */
    private BigDecimal thickness;

    /**
     * 当量粗糙度 (m) - e
     */
    private BigDecimal roughness;

    /**
     * 起点高程 (m)
     */
    private BigDecimal startAltitude;

    /**
     * 终点高程 (m)
     */
    private BigDecimal endAltitude;

    /**
     * 首站进站压头 (m) - H1
     */
    private BigDecimal inletPressure;

    /**
     * ZMI480 泵数量
     */
    private Integer pump480Num;

    /**
     * ZMI375 泵数量
     */
    private Integer pump375Num;

    /**
     * ZMI480 单泵扬程 (m)
     */
    private BigDecimal pump480Head;

    /**
     * ZMI375 单泵扬程 (m)
     */
    private BigDecimal pump375Head;
}
