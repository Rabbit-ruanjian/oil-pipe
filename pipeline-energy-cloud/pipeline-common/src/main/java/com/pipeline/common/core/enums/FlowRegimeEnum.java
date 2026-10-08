package com.pipeline.common.core.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 流态类型枚举
 * <p>
 * 根据雷诺数判断流体的流动状态
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
@Getter
@AllArgsConstructor
public enum FlowRegimeEnum {

    /**
     * 层流 (Re < 2300)
     */
    LAMINAR("LAMINAR", "层流", "Re < 2300"),

    /**
     * 过渡流 (2300 ≤ Re < 3000)
     */
    TRANSITION("TRANSITION", "过渡流", "2300 ≤ Re < 3000"),

    /**
     * 水力光滑区 (3000 < Re < Re₁)
     */
    HYDRAULIC_SMOOTH("HYDRAULIC_SMOOTH", "水力光滑区", "3000 < Re < Re₁"),

    /**
     * 混合摩擦区 (Re₁ ≤ Re < Re₂)
     */
    MIXED_FRICTION("MIXED_FRICTION", "混合摩擦区", "Re₁ ≤ Re < Re₂"),

    /**
     * 粗糙区 (Re ≥ Re₂)
     */
    ROUGH("ROUGH", "粗糙区", "Re ≥ Re₂");

    /**
     * 类型编码
     */
    private final String code;

    /**
     * 类型名称
     */
    private final String name;

    /**
     * 雷诺数范围描述
     */
    private final String reynoldsRange;

    /**
     * 根据编码获取枚举
     *
     * @param code 类型编码
     * @return 枚举值，未找到返回null
     */
    public static FlowRegimeEnum fromCode(String code) {
        if (code == null) {
            return null;
        }
        for (FlowRegimeEnum regime : values()) {
            if (regime.getCode().equals(code)) {
                return regime;
            }
        }
        return null;
    }
}
