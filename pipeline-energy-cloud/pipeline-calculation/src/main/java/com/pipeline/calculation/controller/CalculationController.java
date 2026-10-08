package com.pipeline.calculation.controller;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.util.StringUtils;

import com.pipeline.calculation.domain.HydraulicAnalysisParams;
import com.pipeline.calculation.domain.HydraulicAnalysisResult;
import com.pipeline.calculation.domain.OptimizationParams;
import com.pipeline.calculation.domain.OptimizationResult;
import com.pipeline.calculation.service.ICalculationService;
import com.pipeline.calculation.service.ICalculationHistoryService;
import com.pipeline.common.core.domain.Result;
import com.pipeline.common.core.enums.CalcTypeEnum;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 计算引擎控制器
 * <p>
 * 提供水力分析和泵站优化的核心计算服务。
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
@Tag(name = "计算引擎", description = "水力分析和泵站优化核心计算接口")
@Validated
@RestController
@RequestMapping("/calculation")
@RequiredArgsConstructor
@Slf4j
public class CalculationController {

    private final ICalculationService calculationService;
    private final ICalculationHistoryService calculationHistoryService;
    private final ObjectMapper objectMapper;

    /**
     * 水力特性分析接口
     * <p>
     * 计算管道水力特性，包括雷诺数、流态判断、沿程摩阻、水力坡降等。
     * </p>
     */
    @Operation(
            summary = "水力特性分析",
            description = "根据输入的管道参数和油品参数，计算管道的水力特性，" +
                    "包括雷诺数、流态判断、沿程摩阻损失、水力坡降、首末站压力等"
    )
    @PostMapping("/hydraulic-analysis")
    public Result<HydraulicAnalysisResult> hydraulicAnalysis(
            @Parameter(description = "水力分析参数", required = true)
            @RequestBody @Valid HydraulicAnalysisParams params,
            @RequestParam(value = "projectName", required = false) String projectName,
            @RequestParam(value = "userId", required = false, defaultValue = "1") Long userId,
            @RequestParam(value = "userName", required = false, defaultValue = "admin") String userName) {
        long startTime = System.currentTimeMillis();
        Long historyId = createHistory(
                CalcTypeEnum.HYDRAULIC.getCode(),
                params.getProjectId(),
                StringUtils.hasText(projectName) ? projectName : CalcTypeEnum.HYDRAULIC.getDesc(),
                userId,
                userName,
                params);

        Result<HydraulicAnalysisResult> result = calculationService.analyzeHydraulic(params);
        updateHistory(historyId, result, startTime);
        return result;
    }

    /**
     * 运行方案优化接口
     * <p>
     * 遍历多种泵组合，找出满足约束条件的最优运行方案。
     * </p>
     */
    @Operation(
            summary = "泵站运行优化",
            description = "遍历所有可能的泵组合方案，计算每种组合的水力工况，" +
                    "筛选出满足末站压力约束的可行方案，并按能耗排序推荐最优方案"
    )
    @PostMapping("/optimization")
    public Result<OptimizationResult> optimization(
            @Parameter(description = "优化参数", required = true)
            @RequestBody @Valid OptimizationParams params,
            @RequestParam(value = "projectName", required = false) String projectName,
            @RequestParam(value = "userId", required = false, defaultValue = "1") Long userId,
            @RequestParam(value = "userName", required = false, defaultValue = "admin") String userName) {
        long startTime = System.currentTimeMillis();
        Long historyId = createHistory(
                CalcTypeEnum.OPTIMIZATION.getCode(),
                params.getProjectId(),
                StringUtils.hasText(projectName) ? projectName : CalcTypeEnum.OPTIMIZATION.getDesc(),
                userId,
                userName,
                params);

        Result<OptimizationResult> result = calculationService.optimizeOperation(params);
        updateHistory(historyId, result, startTime);
        return result;
    }

    private Long createHistory(
            String calcType,
            Long projectId,
            String calcName,
            Long userId,
            String userName,
            Object inputParams) {
        try {
            String inputJson = objectMapper.writeValueAsString(inputParams);
            return calculationHistoryService.createHistory(
                    calcType, projectId, calcName, userId, userName, inputJson);
        } catch (JsonProcessingException e) {
            log.warn("序列化计算入参失败: type={}", calcType, e);
            return null;
        }
    }

    private void updateHistory(Long historyId, Result<?> result, long startTime) {
        if (historyId == null) {
            return;
        }

        long duration = System.currentTimeMillis() - startTime;
        try {
            if (result.isSuccess()) {
                String outputJson = objectMapper.writeValueAsString(result.getData());
                calculationHistoryService.updateSuccess(historyId, outputJson, duration);
            } else {
                calculationHistoryService.updateFailed(historyId, result.getMsg(), duration);
            }
        } catch (JsonProcessingException e) {
            log.warn("序列化计算结果失败: historyId={}", historyId, e);
        }
    }
}
