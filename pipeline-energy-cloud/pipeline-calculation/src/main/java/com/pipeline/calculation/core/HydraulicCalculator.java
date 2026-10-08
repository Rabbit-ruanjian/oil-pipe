package com.pipeline.calculation.core;

import java.math.BigDecimal;
import java.math.RoundingMode;

import static com.pipeline.calculation.core.HydraulicConstants.*;

/**
 * 水力计算核心工具类
 * <p>
 * 提供管道水力计算的核心方法，包括：
 * <ul>
 *     <li>流速计算</li>
 *     <li>雷诺数计算</li>
 *     <li>流态判断</li>
 *     <li>摩阻系数计算</li>
 *     <li>沿程摩阻计算</li>
 *     <li>水力坡降计算</li>
 * </ul>
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
public final class HydraulicCalculator {

    private HydraulicCalculator() {
        throw new UnsupportedOperationException("工具类不允许实例化");
    }

    /**
     * 计算管道内径
     *
     * @param outerDiameter 外径 (mm)
     * @param thickness     壁厚 (mm)
     * @return 内径 (mm)
     */
    public static BigDecimal calculateInnerDiameter(BigDecimal outerDiameter, BigDecimal thickness) {
        // d = D - 2δ
        return outerDiameter.subtract(thickness.multiply(THICKNESS_FACTOR));
    }

    /**
     * 计算管道截面积
     *
     * @param innerDiameterMeter 内径 (m)
     * @return 截面积 (m²)
     */
    public static BigDecimal calculateCrossArea(BigDecimal innerDiameterMeter) {
        // A = π × d² / 4
        return PI.multiply(innerDiameterMeter.pow(2))
                .divide(AREA_DIVISOR, SCALE, RoundingMode.HALF_UP);
    }

    /**
     * 计算流速
     *
     * @param flowRateM3PerSec 体积流量 (m³/s)
     * @param crossArea        截面积 (m²)
     * @return 流速 (m/s)
     */
    public static BigDecimal calculateVelocity(BigDecimal flowRateM3PerSec, BigDecimal crossArea) {
        // v = Q / A
        return flowRateM3PerSec.divide(crossArea, SCALE, RoundingMode.HALF_UP);
    }

    /**
     * 计算雷诺数
     *
     * @param velocity           流速 (m/s)
     * @param innerDiameterMeter 内径 (m)
     * @param viscosity          运动粘度 (m²/s)
     * @return 雷诺数 (无量纲)
     */
    public static BigDecimal calculateReynoldsNumber(BigDecimal velocity,
                                                     BigDecimal innerDiameterMeter,
                                                     BigDecimal viscosity) {
        // Re = v × d / ν
        return velocity.multiply(innerDiameterMeter)
                .divide(viscosity, SCALE, RoundingMode.HALF_UP);
    }

    /**
     * 计算相对粗糙度
     *
     * @param roughness       当量粗糙度 (m)
     * @param innerDiameterMm 内径 (mm)
     * @return 相对粗糙度 (无量纲)
     */
    public static BigDecimal calculateRelativeRoughness(BigDecimal roughness, BigDecimal innerDiameterMm) {
        // ε = 2e/d
        return ROUGHNESS_FACTOR.multiply(roughness)
                .divide(innerDiameterMm, SCALE, RoundingMode.HALF_UP);
    }

    /**
     * 判断流态
     *
     * @param reynoldsNumber    雷诺数
     * @param relativeRoughness 相对粗糙度
     * @return 流态枚举
     */
    public static FlowRegime determineFlowRegime(BigDecimal reynoldsNumber, BigDecimal relativeRoughness) {
        // 层流：Re < 2000
        if (reynoldsNumber.compareTo(RE_LAMINAR_UPPER) < 0) {
            return FlowRegime.LAMINAR;
        }

        // 过渡区：2000 ≤ Re ≤ 3000
        if (reynoldsNumber.compareTo(RE_TRANSITION_UPPER) <= 0) {
            return FlowRegime.TRANSITION;
        }

        // 计算水力光滑区上界限：59.5 / ε^(8/7)
        BigDecimal smoothUpperLimit = calculateSmoothUpperLimit(relativeRoughness);

        // 水力光滑区：3000 < Re < 59.5/ε^(8/7)
        if (reynoldsNumber.compareTo(smoothUpperLimit) < 0) {
            return FlowRegime.HYDRAULIC_SMOOTH;
        }

        // 计算混合摩擦区上界限：665 - 765 × lg(ε)
        BigDecimal mixedUpperLimit = calculateMixedUpperLimit(relativeRoughness);

        // 混合摩擦区：59.5/ε^(8/7) ≤ Re < 665-765×lg(ε)
        if (reynoldsNumber.compareTo(mixedUpperLimit) < 0) {
            return FlowRegime.MIXED_FRICTION;
        }

        // 粗糙区：Re ≥ 665-765×lg(ε)
        return FlowRegime.ROUGH;
    }

    /**
     * 计算水力光滑区上界限
     *
     * @param relativeRoughness 相对粗糙度
     * @return 界限值 59.5/ε^(8/7)
     */
    public static BigDecimal calculateSmoothUpperLimit(BigDecimal relativeRoughness) {
        double epsilonPow = Math.pow(relativeRoughness.doubleValue(), 8.0 / 7.0);
        return SMOOTH_LIMIT_CONST.divide(BigDecimal.valueOf(epsilonPow), SCALE, RoundingMode.HALF_UP);
    }

    /**
     * 计算混合摩擦区上界限
     *
     * @param relativeRoughness 相对粗糙度
     * @return 界限值 665 - 765×lg(ε)
     */
    public static BigDecimal calculateMixedUpperLimit(BigDecimal relativeRoughness) {
        double logEpsilon = Math.log10(relativeRoughness.doubleValue());
        return MIXED_LIMIT_CONST_1.subtract(
                MIXED_LIMIT_CONST_2.multiply(BigDecimal.valueOf(logEpsilon)));
    }

    /**
     * 计算摩阻系数 β 和指数 m
     *
     * @param flowRegime        流态
     * @param relativeRoughness 相对粗糙度
     * @param innerDiameterMm   内径 (mm)
     * @param roughness         当量粗糙度 (m)
     * @return 包含 β 和 m 的数组 [β, m]
     */
    public static BigDecimal[] calculateFrictionCoefficients(FlowRegime flowRegime,
                                                             BigDecimal relativeRoughness,
                                                             BigDecimal innerDiameterMm,
                                                             BigDecimal roughness) {
        BigDecimal beta;
        BigDecimal m;

        switch (flowRegime) {
            case LAMINAR:
                beta = BETA_LAMINAR;
                m = M_LAMINAR;
                break;

            case TRANSITION:
                // 过渡区按粗糙区处理
                beta = calculateRoughBeta(roughness, innerDiameterMm);
                m = M_ROUGH;
                break;

            case HYDRAULIC_SMOOTH:
                beta = BETA_SMOOTH;
                m = M_SMOOTH;
                break;

            case MIXED_FRICTION:
                beta = calculateMixedBeta(relativeRoughness, innerDiameterMm);
                m = M_MIXED;
                break;

            case ROUGH:
            default:
                beta = calculateRoughBeta(roughness, innerDiameterMm);
                m = M_ROUGH;
                break;
        }

        return new BigDecimal[]{beta, m};
    }

    /**
     * 计算混合摩擦区的 β 系数
     * <p>
     * 公式：β = 0.0802 × A，其中 A = 10^(0.127×lg(ε/d) - 0.627)
     * 注意：这里 ε 是相对粗糙度，d 是内径(mm)
     * </p>
     *
     * @param relativeRoughness 相对粗糙度
     * @param innerDiameterMm   内径 (mm)
     * @return β 系数
     */
    private static BigDecimal calculateMixedBeta(BigDecimal relativeRoughness, BigDecimal innerDiameterMm) {
        // A = 10^(0.127 × lg(ε/d) - 0.627)
        double logTerm = Math.log10(relativeRoughness.doubleValue() / innerDiameterMm.doubleValue());
        double aValue = Math.pow(10, 0.127 * logTerm - 0.627);
        return BETA_MIXED_BASE.multiply(BigDecimal.valueOf(aValue));
    }

    /**
     * 计算粗糙区的 β 系数
     * <p>
     * 公式：β = 0.0826 × A，其中 A = 0.11 × (e/d)^0.25
     * 注意：这里 e 是当量粗糙度(m)，d 是内径(mm)
     * </p>
     *
     * @param roughness       当量粗糙度 (m)
     * @param innerDiameterMm 内径 (mm)
     * @return β 系数
     */
    private static BigDecimal calculateRoughBeta(BigDecimal roughness, BigDecimal innerDiameterMm) {
        // A = 0.11 × (e/d)^0.25
        double ratio = roughness.divide(innerDiameterMm, SCALE, RoundingMode.HALF_UP).doubleValue();
        double aValue = ROUGH_A_MULTIPLIER * Math.pow(ratio, 0.25);
        return BETA_ROUGH_BASE.multiply(BigDecimal.valueOf(aValue));
    }

    /**
     * 计算沿程摩阻
     * <p>
     * 公式：h = β × Q^(2-m) × ν^m / d^(5-m) × L
     * </p>
     *
     * @param beta               β 系数
     * @param m                  m 指数
     * @param flowRateM3PerSec   体积流量 (m³/s)
     * @param viscosity          运动粘度 (m²/s)
     * @param innerDiameterMeter 内径 (m)
     * @param lengthMeter        管道长度 (m)
     * @return 沿程摩阻 (m)
     */
    public static BigDecimal calculateFrictionHeadLoss(BigDecimal beta,
                                                       BigDecimal m,
                                                       BigDecimal flowRateM3PerSec,
                                                       BigDecimal viscosity,
                                                       BigDecimal innerDiameterMeter,
                                                       BigDecimal lengthMeter) {
        double mValue = m.doubleValue();
        double numerator = beta.doubleValue()
                * Math.pow(flowRateM3PerSec.doubleValue(), 2 - mValue)
                * Math.pow(viscosity.doubleValue(), mValue);
        double denominator = Math.pow(innerDiameterMeter.doubleValue(), 5 - mValue);
        double result = numerator / denominator * lengthMeter.doubleValue();

        return BigDecimal.valueOf(result).setScale(SCALE, RoundingMode.HALF_UP);
    }

    /**
     * 计算水力坡降（水力特性分析用，带1.01校正系数）
     * <p>
     * 公式：i = h / (L × 1.01)
     * </p>
     *
     * @param frictionHeadLoss 沿程摩阻 (m)
     * @param lengthMeter      管道长度 (m)
     * @return 水力坡降 (无量纲)
     */
    public static BigDecimal calculateHydraulicSlopeWithCorrection(BigDecimal frictionHeadLoss,
                                                                   BigDecimal lengthMeter) {
        BigDecimal correctionFactor = new BigDecimal("1.01");
        return frictionHeadLoss.divide(
                lengthMeter.multiply(correctionFactor),
                SCALE,
                RoundingMode.HALF_UP);
    }

    /**
     * 计算水力坡降（开泵方案优化用，不带校正系数）
     * <p>
     * 公式：i = h / L
     * </p>
     *
     * @param frictionHeadLoss 沿程摩阻 (m)
     * @param lengthMeter      管道长度 (m)
     * @return 水力坡降 (无量纲)
     */
    public static BigDecimal calculateHydraulicSlope(BigDecimal frictionHeadLoss,
                                                     BigDecimal lengthMeter) {
        return frictionHeadLoss.divide(lengthMeter, SCALE, RoundingMode.HALF_UP);
    }

    /**
     * 计算总扬程
     *
     * @param pump480Num  ZMI480 泵数量
     * @param pump480Head ZMI480 单泵扬程 (m)
     * @param pump375Num  ZMI375 泵数量
     * @param pump375Head ZMI375 单泵扬程 (m)
     * @return 总扬程 (m)
     */
    public static BigDecimal calculateTotalHead(int pump480Num, BigDecimal pump480Head,
                                                int pump375Num, BigDecimal pump375Head) {
        return pump480Head.multiply(BigDecimal.valueOf(pump480Num))
                .add(pump375Head.multiply(BigDecimal.valueOf(pump375Num)));
    }

    /**
     * 计算首站出站压力
     * <p>
     * 公式：H_out = H_in + Hi - 0.01 × h
     * </p>
     *
     * @param inletPressure    首站进站压头 (m)
     * @param totalHead        总扬程 (m)
     * @param frictionHeadLoss 沿程摩阻 (m)
     * @return 首站出站压力 (m)
     */
    public static BigDecimal calculateFirstStationOutPressure(BigDecimal inletPressure,
                                                              BigDecimal totalHead,
                                                              BigDecimal frictionHeadLoss) {
        // H_out = H_in + Hi - 0.01 × h
        BigDecimal stationLoss = frictionHeadLoss.multiply(STATION_LOSS_FACTOR);
        return inletPressure.add(totalHead).subtract(stationLoss);
    }

    /**
     * 计算末站进站压力
     * <p>
     * 公式：H_end = H_out - h - Z
     * </p>
     *
     * @param firstStationOutPressure 首站出站压力 (m)
     * @param frictionHeadLoss        沿程摩阻 (m)
     * @param elevationDiff           高程差 (m)，终点高程 - 起点高程
     * @return 末站进站压力 (m)
     */
    public static BigDecimal calculateEndStationInPressure(BigDecimal firstStationOutPressure,
                                                           BigDecimal frictionHeadLoss,
                                                           BigDecimal elevationDiff) {
        // H_end = H_out - h - Z
        return firstStationOutPressure.subtract(frictionHeadLoss).subtract(elevationDiff);
    }

    /**
     * 计算总降压
     * <p>
     * 公式：总降压 = h + h×0.01 + Z = h×1.01 + Z
     * </p>
     *
     * @param frictionHeadLoss 沿程摩阻 (m)
     * @param elevationDiff    高程差 (m)
     * @return 总降压 (m)
     */
    public static BigDecimal calculateTotalPressureDrop(BigDecimal frictionHeadLoss,
                                                        BigDecimal elevationDiff) {
        // 总降压 = h + h×0.01 + Z
        BigDecimal localLoss = frictionHeadLoss.multiply(STATION_LOSS_FACTOR);
        return frictionHeadLoss.add(localLoss).add(elevationDiff);
    }

    /**
     * 计算动力费用
     * <p>
     * 公式：费用 = 电价 × Hi × M × g × D × 24 / (1000 × ηp × ηe)
     * </p>
     *
     * @param totalHead         总扬程 (m)
     * @param massFlowRate      质量流量 (kg/s)
     * @param workingDays       年运行天数
     * @param pumpEfficiency    泵效率 (0-1)
     * @param motorEfficiency   电机效率 (0-1)
     * @param electricityPrice  电价 (元/kWh)
     * @return 年动力费用 (元)
     */
    public static BigDecimal calculatePowerCost(BigDecimal totalHead,
                                                BigDecimal massFlowRate,
                                                BigDecimal workingDays,
                                                BigDecimal pumpEfficiency,
                                                BigDecimal motorEfficiency,
                                                BigDecimal electricityPrice) {
        // 分子：Hi × M × g × D × 24
        BigDecimal numerator = totalHead
                .multiply(massFlowRate)
                .multiply(GRAVITY)
                .multiply(workingDays)
                .multiply(HOURS_PER_DAY);

        // 分母：1000 × ηp × ηe
        BigDecimal denominator = KW_DIVISOR
                .multiply(pumpEfficiency)
                .multiply(motorEfficiency);

        // 能耗 (kWh)
        BigDecimal energyConsumption = numerator.divide(denominator, SCALE, RoundingMode.HALF_UP);

        // 费用 = 电价 × 能耗
        return electricityPrice.multiply(energyConsumption).setScale(SCALE, RoundingMode.HALF_UP);
    }

    /**
     * 计算年能耗
     * <p>
     * 公式：能耗 = Hi × M × g × D × 24 / (1000 × ηp × ηe)
     * </p>
     *
     * @param totalHead       总扬程 (m)
     * @param massFlowRate    质量流量 (kg/s)
     * @param workingDays     年运行天数
     * @param pumpEfficiency  泵效率 (0-1)
     * @param motorEfficiency 电机效率 (0-1)
     * @return 年能耗 (kWh)
     */
    public static BigDecimal calculateEnergyConsumption(BigDecimal totalHead,
                                                        BigDecimal massFlowRate,
                                                        BigDecimal workingDays,
                                                        BigDecimal pumpEfficiency,
                                                        BigDecimal motorEfficiency) {
        // 分子：Hi × M × g × D × 24
        BigDecimal numerator = totalHead
                .multiply(massFlowRate)
                .multiply(GRAVITY)
                .multiply(workingDays)
                .multiply(HOURS_PER_DAY);

        // 分母：1000 × ηp × ηe
        BigDecimal denominator = KW_DIVISOR
                .multiply(pumpEfficiency)
                .multiply(motorEfficiency);

        return numerator.divide(denominator, SCALE, RoundingMode.HALF_UP);
    }

    /**
     * 将流量从 m³/h 转换为 m³/s
     *
     * @param flowRateM3PerHour 流量 (m³/h)
     * @return 流量 (m³/s)
     */
    public static BigDecimal convertFlowRateToM3PerSec(BigDecimal flowRateM3PerHour) {
        return flowRateM3PerHour.divide(SECONDS_PER_HOUR, SCALE, RoundingMode.HALF_UP);
    }

    /**
     * 将长度从 km 转换为 m
     *
     * @param lengthKm 长度 (km)
     * @return 长度 (m)
     */
    public static BigDecimal convertLengthToMeter(BigDecimal lengthKm) {
        return lengthKm.multiply(MM_PER_METER);
    }

    /**
     * 将内径从 mm 转换为 m
     *
     * @param diameterMm 内径 (mm)
     * @return 内径 (m)
     */
    public static BigDecimal convertDiameterToMeter(BigDecimal diameterMm) {
        return diameterMm.divide(MM_PER_METER, SCALE, RoundingMode.HALF_UP);
    }
}
