package com.pipeline.common.core.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 敏感性分析变量枚举
 * <p>
 * 定义可用于敏感性分析的输入变量类型
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
@Getter
@AllArgsConstructor
public enum SensitivityVariableEnum {

    /**
     * 流量 (m³/h)
     */
    FLOW_RATE("FLOW_RATE", "流量", "m³/h", -20.0, 20.0),

    /**
     * 原油密度 (kg/m³)
     */
    OIL_DENSITY("OIL_DENSITY", "原油密度", "kg/m³", -10.0, 10.0),

    /**
     * 原油粘度 (mm²/s)
     */
    OIL_VISCOSITY("OIL_VISCOSITY", "原油粘度", "mm²/s", -30.0, 30.0),

    /**
     * 管道内径 (mm)
     */
    PIPE_DIAMETER("PIPE_DIAMETER", "管道内径", "mm", -5.0, 5.0),

    /**
     * 管道粗糙度 (mm)
     */
    PIPE_ROUGHNESS("PIPE_ROUGHNESS", "管道粗糙度", "mm", -50.0, 50.0),

    /**
     * 输送温度 (°C)
     */
    TEMPERATURE("TEMPERATURE", "输送温度", "°C", -15.0, 15.0),

    /**
     * 泵效率 (%)
     */
    PUMP_EFFICIENCY("PUMP_EFFICIENCY", "泵效率", "%", -10.0, 10.0);

    /**
     * 变量编码
     */
    private final String code;

    /**
     * 变量名称
     */
    private final String name;

    /**
     * 变量单位
     */
    private final String unit;

    /**
     * 默认最小变化百分比
     */
    private final Double minChangePercent;

    /**
     * 默认最大变化百分比
     */
    private final Double maxChangePercent;

    /**
     * 根据编码获取枚举
     *
     * @param code 变量编码
     * @return 枚举值，未找到返回null
     */
    public static SensitivityVariableEnum fromCode(String code) {
        if (code == null) {
            return null;
        }
        for (SensitivityVariableEnum variable : values()) {
            if (variable.getCode().equals(code)) {
                return variable;
            }
        }
        return null;
    }

    /**
     * 计算变化后的值
     *
     * @param baseValue       基准值
     * @param changePercent   变化百分比
     * @return 变化后的值
     */
    public double calculateChangedValue(double baseValue, double changePercent) {
        return baseValue * (1 + changePercent / 100.0);
    }
}
