package com.pipeline.calculation.core;

import java.math.BigDecimal;

/**
 * 水力计算常量类
 * <p>
 * 定义水力计算中使用的所有物理常量和工程系数
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
public final class HydraulicConstants {

    private HydraulicConstants() {
        throw new UnsupportedOperationException("常量类不允许实例化");
    }

    // ==================== 数学常量 ====================

    /**
     * 圆周率 π
     */
    public static final BigDecimal PI = new BigDecimal("3.14159265358979323846");

    /**
     * 小数保留位数
     */
    public static final int SCALE = 8;

    // ==================== 单位换算系数 ====================

    /**
     * 秒/小时换算系数：1小时 = 3600秒
     */
    public static final BigDecimal SECONDS_PER_HOUR = new BigDecimal("3600");

    /**
     * 毫米/米换算系数：1米 = 1000毫米
     */
    public static final BigDecimal MM_PER_METER = new BigDecimal("1000");

    /**
     * 管道壁厚倍数（计算内径用）：内径 = 外径 - 2×壁厚
     */
    public static final BigDecimal THICKNESS_FACTOR = new BigDecimal("2");

    /**
     * 圆面积计算分母：A = π×d²/4
     */
    public static final BigDecimal AREA_DIVISOR = new BigDecimal("4");

    // ==================== 物理常量 ====================

    /**
     * 重力加速度 (m/s²)
     */
    public static final BigDecimal GRAVITY = new BigDecimal("9.8");

    // ==================== 工程系数 ====================

    /**
     * 站内局部损失系数
     * <p>
     * 站内局部损失 = 沿程损失 × 0.01
     * </p>
     */
    public static final BigDecimal STATION_LOSS_FACTOR = new BigDecimal("0.01");

    /**
     * 相对粗糙度计算系数：ε = 2e/d
     */
    public static final BigDecimal ROUGHNESS_FACTOR = new BigDecimal("2");

    // ==================== 雷诺数流态界限 ====================

    /**
     * 层流上界限：Re < 2000 为层流
     */
    public static final BigDecimal RE_LAMINAR_UPPER = new BigDecimal("2000");

    /**
     * 过渡区上界限：2000 ≤ Re ≤ 3000 为过渡区
     */
    public static final BigDecimal RE_TRANSITION_UPPER = new BigDecimal("3000");

    /**
     * 水力光滑区界限计算常数：59.5 / ε^(8/7)
     */
    public static final BigDecimal SMOOTH_LIMIT_CONST = new BigDecimal("59.5");

    /**
     * 混合摩擦区界限常数1：665
     */
    public static final BigDecimal MIXED_LIMIT_CONST_1 = new BigDecimal("665");

    /**
     * 混合摩擦区界限常数2：765
     */
    public static final BigDecimal MIXED_LIMIT_CONST_2 = new BigDecimal("765");

    // ==================== 流态系数 ====================

    /**
     * 层流区 β 系数
     */
    public static final BigDecimal BETA_LAMINAR = new BigDecimal("4.15");

    /**
     * 层流区 m 指数
     */
    public static final BigDecimal M_LAMINAR = BigDecimal.ONE;

    /**
     * 水力光滑区 β 系数
     */
    public static final BigDecimal BETA_SMOOTH = new BigDecimal("0.0246");

    /**
     * 水力光滑区 m 指数
     */
    public static final BigDecimal M_SMOOTH = new BigDecimal("0.25");

    /**
     * 混合摩擦区 β 基础系数
     */
    public static final BigDecimal BETA_MIXED_BASE = new BigDecimal("0.0802");

    /**
     * 混合摩擦区 m 指数
     */
    public static final BigDecimal M_MIXED = new BigDecimal("0.123");

    /**
     * 粗糙区 β 基础系数
     */
    public static final BigDecimal BETA_ROUGH_BASE = new BigDecimal("0.0826");

    /**
     * 粗糙区 m 指数
     */
    public static final BigDecimal M_ROUGH = BigDecimal.ZERO;

    /**
     * 粗糙区 A 系数的乘数
     */
    public static final double ROUGH_A_MULTIPLIER = 0.11;

    // ==================== 运行参数默认值 ====================

    /**
     * 默认年运行天数
     */
    public static final BigDecimal DEFAULT_WORKING_DAYS = new BigDecimal("350");

    /**
     * 每天小时数
     */
    public static final BigDecimal HOURS_PER_DAY = new BigDecimal("24");

    /**
     * 千瓦换算系数
     */
    public static final BigDecimal KW_DIVISOR = new BigDecimal("1000");
}
