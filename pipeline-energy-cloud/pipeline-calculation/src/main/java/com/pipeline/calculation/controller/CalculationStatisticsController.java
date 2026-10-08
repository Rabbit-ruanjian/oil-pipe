package com.pipeline.calculation.controller;

import java.time.LocalDateTime;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.pipeline.calculation.domain.vo.CalculationStatisticsVO;
import com.pipeline.calculation.service.ICalculationStatisticsService;
import com.pipeline.common.core.domain.Result;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import lombok.RequiredArgsConstructor;

/**
 * 计算统计控制器
 * <p>
 * 提供计算历史统计数据的RESTful API接口，
 * 用于数据大屏展示和报表生成。
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
@Tag(name = "统计分析", description = "计算服务统计数据接口")
@Validated
@RestController
@RequestMapping("/calculation/statistics")
@RequiredArgsConstructor
public class CalculationStatisticsController {

    private final ICalculationStatisticsService statisticsService;

    /**
     * 获取统计概览
     * <p>
     * 返回计算服务的整体统计数据，包括总计算次数、
     * 成功率、类型分布、时间趋势等。
     * </p>
     *
     * @return 统计概览数据
     */
    @GetMapping("/overview")
    public Result<CalculationStatisticsVO> getOverview() {
        CalculationStatisticsVO statistics = statisticsService.getOverview();
        return Result.ok(statistics);
    }

    /**
     * 获取指定时间范围的统计数据
     *
     * @param startTime 开始时间
     * @param endTime   结束时间
     * @return 统计数据
     */
    @GetMapping("/range")
    public Result<CalculationStatisticsVO> getByTimeRange(
            @RequestParam("startTime")
            @DateTimeFormat(pattern = "yyyy-MM-dd HH:mm:ss") LocalDateTime startTime,
            @RequestParam("endTime")
            @DateTimeFormat(pattern = "yyyy-MM-dd HH:mm:ss") LocalDateTime endTime) {
        CalculationStatisticsVO statistics = statisticsService.getStatisticsByTimeRange(startTime, endTime);
        return Result.ok(statistics);
    }

    /**
     * 获取用户统计数据
     *
     * @param userId 用户ID
     * @return 用户统计数据
     */
    @GetMapping("/user/{userId}")
    public Result<CalculationStatisticsVO> getByUser(
            @PathVariable("userId") @NotNull(message = "用户ID不能为空") Long userId) {
        CalculationStatisticsVO statistics = statisticsService.getStatisticsByUser(userId);
        return Result.ok(statistics);
    }

    /**
     * 获取项目统计数据
     *
     * @param projectId 项目ID
     * @return 项目统计数据
     */
    @GetMapping("/project/{projectId}")
    public Result<CalculationStatisticsVO> getByProject(
            @PathVariable("projectId") @NotNull(message = "项目ID不能为空") Long projectId) {
        CalculationStatisticsVO statistics = statisticsService.getStatisticsByProject(projectId);
        return Result.ok(statistics);
    }

    /**
     * 获取每日计算趋势
     *
     * @param days 统计天数（1-90天）
     * @return 每日趋势数据
     */
    @GetMapping("/trend/daily")
    public Result<CalculationStatisticsVO> getDailyTrend(
            @RequestParam(value = "days", defaultValue = "7")
            @Min(value = 1, message = "天数最小为1")
            @Max(value = 90, message = "天数最大为90") Integer days) {
        CalculationStatisticsVO statistics = statisticsService.getDailyTrend(days);
        return Result.ok(statistics);
    }

    /**
     * 获取今日计算次数
     *
     * @return 今日计算次数
     */
    @GetMapping("/count/today")
    public Result<Long> countToday() {
        long count = statisticsService.countToday();
        return Result.ok(count);
    }

    /**
     * 获取本周计算次数
     *
     * @return 本周计算次数
     */
    @GetMapping("/count/week")
    public Result<Long> countThisWeek() {
        long count = statisticsService.countThisWeek();
        return Result.ok(count);
    }

    /**
     * 获取本月计算次数
     *
     * @return 本月计算次数
     */
    @GetMapping("/count/month")
    public Result<Long> countThisMonth() {
        long count = statisticsService.countThisMonth();
        return Result.ok(count);
    }

    /**
     * 获取计算成功率
     *
     * @return 成功率（百分比）
     */
    @GetMapping("/success-rate")
    public Result<Double> getSuccessRate() {
        double rate = statisticsService.calculateSuccessRate();
        return Result.ok(rate);
    }

    /**
     * 获取活跃用户数
     *
     * @param days 最近N天（默认30天）
     * @return 活跃用户数
     */
    @GetMapping("/active-users")
    public Result<Long> countActiveUsers(
            @RequestParam(value = "days", defaultValue = "30")
            @Min(value = 1, message = "天数最小为1")
            @Max(value = 365, message = "天数最大为365") Integer days) {
        long count = statisticsService.countActiveUsers(days);
        return Result.ok(count);
    }

    /**
     * 获取活跃项目数
     *
     * @param days 最近N天（默认30天）
     * @return 活跃项目数
     */
    @GetMapping("/active-projects")
    public Result<Long> countActiveProjects(
            @RequestParam(value = "days", defaultValue = "30")
            @Min(value = 1, message = "天数最小为1")
            @Max(value = 365, message = "天数最大为365") Integer days) {
        long count = statisticsService.countActiveProjects(days);
        return Result.ok(count);
    }
}
