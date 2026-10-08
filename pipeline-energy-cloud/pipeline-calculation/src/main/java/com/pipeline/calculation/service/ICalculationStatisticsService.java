package com.pipeline.calculation.service;

import java.time.LocalDateTime;

import com.pipeline.calculation.domain.vo.CalculationStatisticsVO;

/**
 * 计算统计服务接口
 * <p>
 * 提供计算历史的统计分析功能，包括计算次数、
 * 成功率、趋势分析等统计数据。
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
public interface ICalculationStatisticsService {

    /**
     * 获取整体统计概览
     *
     * @return 统计数据
     */
    CalculationStatisticsVO getOverview();

    /**
     * 获取指定时间范围的统计数据
     *
     * @param startTime 开始时间
     * @param endTime   结束时间
     * @return 统计数据
     */
    CalculationStatisticsVO getStatisticsByTimeRange(LocalDateTime startTime, LocalDateTime endTime);

    /**
     * 获取用户的统计数据
     *
     * @param userId 用户ID
     * @return 统计数据
     */
    CalculationStatisticsVO getStatisticsByUser(Long userId);

    /**
     * 获取项目的统计数据
     *
     * @param projectId 项目ID
     * @return 统计数据
     */
    CalculationStatisticsVO getStatisticsByProject(Long projectId);

    /**
     * 获取最近N天的每日统计趋势
     *
     * @param days 天数（7/14/30）
     * @return 统计数据（包含dailyStatistics）
     */
    CalculationStatisticsVO getDailyTrend(int days);

    /**
     * 统计今日计算次数
     *
     * @return 今日计算次数
     */
    long countToday();

    /**
     * 统计本周计算次数
     *
     * @return 本周计算次数
     */
    long countThisWeek();

    /**
     * 统计本月计算次数
     *
     * @return 本月计算次数
     */
    long countThisMonth();

    /**
     * 计算成功率
     *
     * @return 成功率（0-100）
     */
    double calculateSuccessRate();

    /**
     * 获取活跃用户数
     *
     * @param days 最近N天
     * @return 活跃用户数
     */
    long countActiveUsers(int days);

    /**
     * 获取活跃项目数
     *
     * @param days 最近N天
     * @return 活跃项目数
     */
    long countActiveProjects(int days);
}
