package com.pipeline.calculation.domain;

import lombok.Data;

import java.math.BigDecimal;

/**
 * 运行方案优化输入参数
 * <p>
 * 包含管道、油品、泵站及经济性计算所需的全部参数
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
@Data
public class OptimizationParams {

    // ==================== 项目标识 ====================

    /**
     * 项目ID
     */
    private Long projectId;

    // ==================== 流量参数 ====================

    /**
     * 体积流量 (m³/h)
     */
    private BigDecimal flowRate;

    // ==================== 油品参数 ====================

    /**
     * 油品密度 (kg/m³)
     */
    private BigDecimal density;

    /**
     * 油品运动粘度 (m²/s)
     */
    private BigDecimal viscosity;

    // ==================== 管道参数 ====================

    /**
     * 管道长度 (km)
     */
    private BigDecimal length;

    /**
     * 管道外径 (mm)
     */
    private BigDecimal diameter;

    /**
     * 管道壁厚 (mm)
     */
    private BigDecimal thickness;

    /**
     * 当量粗糙度 (m)
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

    // ==================== 泵站参数 ====================

    /**
     * 首站进站压头 (m)
     */
    private BigDecimal inletPressure;

    /**
     * ZMI480 单泵扬程 (m)
     */
    private BigDecimal pump480Head;

    /**
     * ZMI375 单泵扬程 (m)
     */
    private BigDecimal pump375Head;

    /**
     * 泵效率 (0-1)，如 0.85 表示 85%
     */
    private BigDecimal pumpEfficiency;

    /**
     * 电机效率 (0-1)，如 0.95 表示 95%
     */
    private BigDecimal motorEfficiency;

    // ==================== 运行参数 ====================

    /**
     * 年运行天数，默认 350 天
     */
    private BigDecimal workingDays;

    // ==================== 经济参数 ====================

    /**
     * 电价 (元/kWh)
     */
    private BigDecimal electricityPrice;

    /**
     * 获取年运行天数，如果未设置则返回默认值 350
     *
     * @return 年运行天数
     */
    public BigDecimal getWorkingDays() {
        if (workingDays == null) {
            return new BigDecimal("350");
        }
        return workingDays;
    }

    /**
     * 获取泵效率，如果未设置则返回默认值 0.80
     *
     * @return 泵效率
     */
    public BigDecimal getPumpEfficiency() {
        if (pumpEfficiency == null) {
            return new BigDecimal("0.80");
        }
        return pumpEfficiency;
    }

    /**
     * 获取电机效率，如果未设置则返回默认值 0.95
     *
     * @return 电机效率
     */
    public BigDecimal getMotorEfficiency() {
        if (motorEfficiency == null) {
            return new BigDecimal("0.95");
        }
        return motorEfficiency;
    }

    /**
     * 获取电价，如果未设置则返回默认值 0.8 元/kWh
     *
     * @return 电价
     */
    public BigDecimal getElectricityPrice() {
        if (electricityPrice == null) {
            return new BigDecimal("0.8");
        }
        return electricityPrice;
    }

    /**
     * 计算质量流量 (kg/s)
     * <p>
     * 公式：M = Q × ρ / 3600
     * </p>
     *
     * @return 质量流量 (kg/s)
     */
    public BigDecimal getMassFlowRate() {
        if (flowRate == null || density == null) {
            return BigDecimal.ZERO;
        }
        return flowRate.multiply(density).divide(new BigDecimal("3600"), 8, java.math.RoundingMode.HALF_UP);
    }
}
