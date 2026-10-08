package com.pipeline.calculation.core;

/**
 * 流态枚举类
 * <p>
 * 根据雷诺数划分的管道流动状态
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
public enum FlowRegime {

    /**
     * 层流：Re < 2000
     */
    LAMINAR("层流", "Re < 2000"),

    /**
     * 过渡区：2000 ≤ Re ≤ 3000
     */
    TRANSITION("过渡区", "2000 ≤ Re ≤ 3000"),

    /**
     * 水力光滑区：3000 < Re < 59.5/ε^(8/7)
     */
    HYDRAULIC_SMOOTH("水力光滑区", "3000 < Re < 59.5/ε^(8/7)"),

    /**
     * 混合摩擦区：59.5/ε^(8/7) ≤ Re < 665-765×lg(ε)
     */
    MIXED_FRICTION("混合摩擦区", "59.5/ε^(8/7) ≤ Re < 665-765×lg(ε)"),

    /**
     * 粗糙区：Re ≥ 665-765×lg(ε)
     */
    ROUGH("粗糙区", "Re ≥ 665-765×lg(ε)");

    /**
     * 中文名称
     */
    private final String displayName;

    /**
     * 判断条件描述
     */
    private final String condition;

    FlowRegime(String displayName, String condition) {
        this.displayName = displayName;
        this.condition = condition;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getCondition() {
        return condition;
    }

    @Override
    public String toString() {
        return displayName;
    }
}
