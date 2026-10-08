package com.pipeline.calculation.domain.vo;

import java.io.Serial;
import java.io.Serializable;
import java.util.List;
import java.util.Map;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 计算统计视图对象
 * <p>
 * 用于展示计算服务的统计数据，包括计算次数、
 * 成功率、平均耗时等关键指标。
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CalculationStatisticsVO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 总计算次数
     */
    private Long totalCount;

    /**
     * 成功次数
     */
    private Long successCount;

    /**
     * 失败次数
     */
    private Long failedCount;

    /**
     * 计算中次数
     */
    private Long calculatingCount;

    /**
     * 成功率（百分比，保留2位小数）
     */
    private Double successRate;

    /**
     * 水力分析次数
     */
    private Long hydraulicCount;

    /**
     * 优化分析次数
     */
    private Long optimizationCount;

    /**
     * 水力分析平均耗时（毫秒）
     */
    private Double avgHydraulicDuration;

    /**
     * 优化分析平均耗时（毫秒）
     */
    private Double avgOptimizationDuration;

    /**
     * 今日计算次数
     */
    private Long todayCount;

    /**
     * 本周计算次数
     */
    private Long weekCount;

    /**
     * 本月计算次数
     */
    private Long monthCount;

    /**
     * 按日期统计（最近7天/30天）
     */
    private List<DailyStatistics> dailyStatistics;

    /**
     * 按计算类型统计
     */
    private Map<String, Long> typeDistribution;

    /**
     * 活跃用户数（有计算记录的用户）
     */
    private Long activeUserCount;

    /**
     * 活跃项目数（有计算记录的项目）
     */
    private Long activeProjectCount;

    /**
     * 每日统计数据
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DailyStatistics implements Serializable {

        @Serial
        private static final long serialVersionUID = 1L;

        /**
         * 日期（格式：yyyy-MM-dd）
         */
        private String date;

        /**
         * 计算次数
         */
        private Long count;

        /**
         * 成功次数
         */
        private Long successCount;

        /**
         * 失败次数
         */
        private Long failedCount;
    }
}
