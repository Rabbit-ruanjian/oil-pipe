package com.pipeline.calculation.service.impl;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.pipeline.calculation.domain.entity.CalculationHistory;
import com.pipeline.calculation.domain.vo.CalculationStatisticsVO;
import com.pipeline.calculation.mapper.CalculationHistoryMapper;
import com.pipeline.calculation.service.ICalculationStatisticsService;
import com.pipeline.common.core.enums.CalcTypeEnum;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 计算统计服务实现类
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CalculationStatisticsServiceImpl implements ICalculationStatisticsService {

    private final CalculationHistoryMapper calculationHistoryMapper;

    private static final DateTimeFormatter DATE_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd");
    private static final int DEFAULT_TREND_DAYS = 7;
    private static final int MAX_TREND_DAYS = 90;

    @Override
    public CalculationStatisticsVO getOverview() {
        // 总数
        long totalCount = calculationHistoryMapper.selectCount(new LambdaQueryWrapper<>());

        // 按类型统计
        long hydraulicCount = calculationHistoryMapper.countByCalcType(CalcTypeEnum.HYDRAULIC.getCode());
        long optimizationCount = calculationHistoryMapper.countByCalcType(CalcTypeEnum.OPTIMIZATION.getCode());

        // 时间段统计
        long todayCount = countToday();
        long weekCount = countThisWeek();
        long monthCount = countThisMonth();

        // 类型分布
        Map<String, Long> typeDistribution = new HashMap<>(4);
        typeDistribution.put(CalcTypeEnum.HYDRAULIC.getCode(), hydraulicCount);
        typeDistribution.put(CalcTypeEnum.OPTIMIZATION.getCode(), optimizationCount);

        // 活跃统计
        long activeUserCount = countActiveUsers(30);
        long activeProjectCount = countActiveProjects(30);

        return CalculationStatisticsVO.builder()
                .totalCount(totalCount)
                .successCount(totalCount)
                .failedCount(0L)
                .calculatingCount(0L)
                .successRate(totalCount > 0 ? 100.0 : 0.0)
                .hydraulicCount(hydraulicCount)
                .optimizationCount(optimizationCount)
                .avgHydraulicDuration(0.0)
                .avgOptimizationDuration(0.0)
                .todayCount(todayCount)
                .weekCount(weekCount)
                .monthCount(monthCount)
                .typeDistribution(typeDistribution)
                .activeUserCount(activeUserCount)
                .activeProjectCount(activeProjectCount)
                .dailyStatistics(getDailyStatisticsList(DEFAULT_TREND_DAYS))
                .build();
    }

    @Override
    public CalculationStatisticsVO getStatisticsByTimeRange(LocalDateTime startTime, LocalDateTime endTime) {
        long totalCount = calculationHistoryMapper.countByTimeRange(startTime, endTime);

        long hydraulicCount = calculationHistoryMapper.countByCalcTypeAndTimeRange(
                CalcTypeEnum.HYDRAULIC.getCode(), startTime, endTime);
        long optimizationCount = calculationHistoryMapper.countByCalcTypeAndTimeRange(
                CalcTypeEnum.OPTIMIZATION.getCode(), startTime, endTime);

        Map<String, Long> typeDistribution = new HashMap<>(4);
        typeDistribution.put(CalcTypeEnum.HYDRAULIC.getCode(), hydraulicCount);
        typeDistribution.put(CalcTypeEnum.OPTIMIZATION.getCode(), optimizationCount);

        return CalculationStatisticsVO.builder()
                .totalCount(totalCount)
                .hydraulicCount(hydraulicCount)
                .optimizationCount(optimizationCount)
                .typeDistribution(typeDistribution)
                .build();
    }

    @Override
    public CalculationStatisticsVO getStatisticsByUser(Long userId) {
        if (userId == null) {
            return CalculationStatisticsVO.builder().build();
        }

        LambdaQueryWrapper<CalculationHistory> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(CalculationHistory::getCreateBy, String.valueOf(userId));

        long totalCount = calculationHistoryMapper.selectCount(wrapper);

        return CalculationStatisticsVO.builder()
                .totalCount(totalCount)
                .successCount(totalCount)
                .successRate(totalCount > 0 ? 100.0 : 0.0)
                .build();
    }

    @Override
    public CalculationStatisticsVO getStatisticsByProject(Long projectId) {
        if (projectId == null) {
            return CalculationStatisticsVO.builder().build();
        }

        LambdaQueryWrapper<CalculationHistory> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(CalculationHistory::getProId, projectId);

        long totalCount = calculationHistoryMapper.selectCount(wrapper);

        return CalculationStatisticsVO.builder()
                .totalCount(totalCount)
                .successCount(totalCount)
                .successRate(totalCount > 0 ? 100.0 : 0.0)
                .build();
    }

    @Override
    public CalculationStatisticsVO getDailyTrend(int days) {
        int safeDays = Math.min(Math.max(days, 1), MAX_TREND_DAYS);
        List<CalculationStatisticsVO.DailyStatistics> dailyStats = getDailyStatisticsList(safeDays);

        return CalculationStatisticsVO.builder()
                .dailyStatistics(dailyStats)
                .build();
    }

    @Override
    public long countToday() {
        LocalDateTime startOfDay = LocalDate.now().atStartOfDay();
        LocalDateTime endOfDay = LocalDate.now().atTime(LocalTime.MAX);
        return calculationHistoryMapper.countByTimeRange(startOfDay, endOfDay);
    }

    @Override
    public long countThisWeek() {
        LocalDate today = LocalDate.now();
        LocalDateTime startOfWeek = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
                .atStartOfDay();
        LocalDateTime endOfWeek = today.with(TemporalAdjusters.nextOrSame(DayOfWeek.SUNDAY))
                .atTime(LocalTime.MAX);
        return calculationHistoryMapper.countByTimeRange(startOfWeek, endOfWeek);
    }

    @Override
    public long countThisMonth() {
        LocalDate today = LocalDate.now();
        LocalDateTime startOfMonth = today.with(TemporalAdjusters.firstDayOfMonth()).atStartOfDay();
        LocalDateTime endOfMonth = today.with(TemporalAdjusters.lastDayOfMonth()).atTime(LocalTime.MAX);
        return calculationHistoryMapper.countByTimeRange(startOfMonth, endOfMonth);
    }

    @Override
    public double calculateSuccessRate() {
        long totalCount = calculationHistoryMapper.selectCount(new LambdaQueryWrapper<>());
        return totalCount > 0 ? 100.0 : 0.0;
    }

    @Override
    public long countActiveUsers(int days) {
        LocalDateTime startTime = LocalDate.now().minusDays(days).atStartOfDay();
        LocalDateTime endTime = LocalDateTime.now();
        return calculationHistoryMapper.countDistinctCreateByInRange(startTime, endTime);
    }

    @Override
    public long countActiveProjects(int days) {
        LocalDateTime startTime = LocalDate.now().minusDays(days).atStartOfDay();
        LocalDateTime endTime = LocalDateTime.now();
        return calculationHistoryMapper.countDistinctProjectInRange(startTime, endTime);
    }

    /**
     * 获取每日统计列表
     */
    private List<CalculationStatisticsVO.DailyStatistics> getDailyStatisticsList(int days) {
        List<CalculationStatisticsVO.DailyStatistics> result = new ArrayList<>();
        LocalDate today = LocalDate.now();

        for (int i = days - 1; i >= 0; i--) {
            LocalDate date = today.minusDays(i);
            LocalDateTime startOfDay = date.atStartOfDay();
            LocalDateTime endOfDay = date.atTime(LocalTime.MAX);

            long dayCount = calculationHistoryMapper.countByTimeRange(startOfDay, endOfDay);

            result.add(CalculationStatisticsVO.DailyStatistics.builder()
                    .date(date.format(DATE_FORMATTER))
                    .count(dayCount)
                    .successCount(dayCount)
                    .failedCount(0L)
                    .build());
        }

        return result;
    }
}
