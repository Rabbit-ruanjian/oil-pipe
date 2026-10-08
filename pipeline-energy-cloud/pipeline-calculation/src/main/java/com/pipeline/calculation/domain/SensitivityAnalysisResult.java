package com.pipeline.calculation.domain;

import java.io.Serial;
import java.io.Serializable;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 敏感性分析结果
 * <p>
 * 包含各变量变化对水力计算结果的影响数据，
 * 支持图表展示和敏感性排序。
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SensitivityAnalysisResult implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 基准计算结果
     */
    private HydraulicAnalysisResult baseResult;

    /**
     * 各变量的敏感性分析结果
     */
    private List<VariableSensitivityResult> variableResults;

    /**
     * 敏感性排序（按影响程度从大到小）
     */
    private List<SensitivityRanking> sensitivityRanking;

    /**
     * 交叉分析结果矩阵（仅CROSS类型）
     */
    private List<CrossAnalysisResult> crossResults;

    /**
     * 分析耗时（毫秒）
     */
    private Long duration;

    /**
     * 总计算次数
     */
    private Integer totalCalculations;

    /**
     * 单变量敏感性分析结果
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class VariableSensitivityResult implements Serializable {

        @Serial
        private static final long serialVersionUID = 1L;

        /**
         * 变量类型
         */
        private String variableType;

        /**
         * 变量名称
         */
        private String variableName;

        /**
         * 变量单位
         */
        private String unit;

        /**
         * 基准值
         */
        private BigDecimal baseValue;

        /**
         * 数据点列表
         */
        private List<DataPoint> dataPoints;

        /**
         * 敏感性系数（相对变化率）
         */
        private BigDecimal sensitivityCoefficient;

        /**
         * 影响趋势（POSITIVE/NEGATIVE/MIXED）
         */
        private String trend;

        /**
         * 最大影响百分比
         */
        private BigDecimal maxImpactPercent;
    }

    /**
     * 数据点
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DataPoint implements Serializable {

        @Serial
        private static final long serialVersionUID = 1L;

        /**
         * 变化百分比
         */
        private BigDecimal changePercent;

        /**
         * 实际变量值
         */
        private BigDecimal variableValue;

        /**
         * 沿程摩阻变化
         */
        private BigDecimal frictionHeadLoss;

        /**
         * 沿程摩阻变化率
         */
        private BigDecimal frictionChangePercent;

        /**
         * 末站压力
         */
        private BigDecimal endStationPressure;

        /**
         * 末站压力变化率
         */
        private BigDecimal pressureChangePercent;

        /**
         * 水力坡降
         */
        private BigDecimal hydraulicSlope;

        /**
         * 雷诺数
         */
        private BigDecimal reynoldsNumber;

        /**
         * 流态
         */
        private String flowRegime;

        /**
         * 完整计算结果
         */
        private HydraulicAnalysisResult fullResult;
    }

    /**
     * 敏感性排序
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SensitivityRanking implements Serializable {

        @Serial
        private static final long serialVersionUID = 1L;

        /**
         * 排名
         */
        private Integer rank;

        /**
         * 变量类型
         */
        private String variableType;

        /**
         * 变量名称
         */
        private String variableName;

        /**
         * 敏感性系数（绝对值）
         */
        private BigDecimal sensitivityCoefficient;

        /**
         * 影响描述
         */
        private String description;
    }

    /**
     * 交叉分析结果
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class CrossAnalysisResult implements Serializable {

        @Serial
        private static final long serialVersionUID = 1L;

        /**
         * 变量组合描述
         */
        private String combinationDesc;

        /**
         * 各变量的变化百分比
         */
        private Map<String, BigDecimal> variableChanges;

        /**
         * 计算结果
         */
        private HydraulicAnalysisResult result;

        /**
         * 相对于基准的综合变化率
         */
        private BigDecimal overallChangePercent;
    }
}
