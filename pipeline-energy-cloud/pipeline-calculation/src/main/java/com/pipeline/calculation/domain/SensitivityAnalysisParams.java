package com.pipeline.calculation.domain;

import java.io.Serial;
import java.io.Serializable;
import java.math.BigDecimal;
import java.util.List;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 敏感性分析输入参数
 * <p>
 * 用于分析不同参数变化对水力计算结果的影响程度，
 * 支持单因素分析和多因素交叉分析。
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SensitivityAnalysisParams implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 基准水力分析参数
     */
    @NotNull(message = "基准参数不能为空")
    private HydraulicAnalysisParams baseParams;

    /**
     * 敏感性变量列表
     * <p>
     * 支持同时分析多个变量的敏感性
     * </p>
     */
    @NotEmpty(message = "至少需要指定一个敏感性变量")
    @Size(max = 5, message = "最多同时分析5个变量")
    private List<SensitivityVariable> variables;

    /**
     * 分析类型
     * <p>
     * SINGLE: 单因素分析
     * CROSS: 多因素交叉分析
     * </p>
     */
    @NotNull(message = "分析类型不能为空")
    private AnalysisType analysisType;

    /**
     * 项目ID（可选，用于关联记录）
     */
    private Long projectId;

    /**
     * 项目名称
     */
    private String projectName;

    /**
     * 敏感性变量定义
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SensitivityVariable implements Serializable {

        @Serial
        private static final long serialVersionUID = 1L;

        /**
         * 变量类型
         *
         * @see com.pipeline.common.core.enums.SensitivityVariableEnum
         */
        @NotNull(message = "变量类型不能为空")
        private String variableType;

        /**
         * 变化起始百分比
         */
        @NotNull(message = "起始百分比不能为空")
        @DecimalMin(value = "-50", message = "起始百分比不能小于-50%")
        @DecimalMax(value = "50", message = "起始百分比不能大于50%")
        private BigDecimal startPercent;

        /**
         * 变化结束百分比
         */
        @NotNull(message = "结束百分比不能为空")
        @DecimalMin(value = "-50", message = "结束百分比不能小于-50%")
        @DecimalMax(value = "50", message = "结束百分比不能大于50%")
        private BigDecimal endPercent;

        /**
         * 步长（百分比）
         */
        @NotNull(message = "步长不能为空")
        @DecimalMin(value = "1", message = "步长不能小于1%")
        @DecimalMax(value = "20", message = "步长不能大于20%")
        private BigDecimal stepPercent;

        /**
         * 变量名称（用于显示）
         */
        private String variableName;

        /**
         * 变量单位
         */
        private String unit;
    }

    /**
     * 分析类型枚举
     */
    public enum AnalysisType {
        /**
         * 单因素分析：逐个分析每个变量的影响
         */
        SINGLE,

        /**
         * 多因素交叉分析：分析多个变量同时变化的影响
         */
        CROSS
    }
}
