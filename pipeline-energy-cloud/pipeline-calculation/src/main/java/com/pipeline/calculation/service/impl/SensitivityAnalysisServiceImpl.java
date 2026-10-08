package com.pipeline.calculation.service.impl;

import java.math.BigDecimal;
import java.util.List;

import org.springframework.stereotype.Service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.pipeline.calculation.domain.HydraulicAnalysisParams;
import com.pipeline.calculation.domain.SensitivityAnalysisParams;
import com.pipeline.calculation.domain.SensitivityAnalysisParams.AnalysisType;
import com.pipeline.calculation.domain.SensitivityAnalysisParams.SensitivityVariable;
import com.pipeline.calculation.domain.SensitivityAnalysisResult;
import com.pipeline.calculation.service.ICalculationHistoryService;
import com.pipeline.calculation.service.ISensitivityAnalysisService;
import com.pipeline.calculation.strategy.impl.SensitivityAnalysisStrategy;
import com.pipeline.common.core.domain.Result;
import com.pipeline.common.core.enums.SensitivityVariableEnum;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 敏感性分析服务实现类
 * <p>
 * 提供敏感性分析的业务逻辑实现，整合历史记录保存功能。
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SensitivityAnalysisServiceImpl implements ISensitivityAnalysisService {

    private static final String CALC_TYPE_SENSITIVITY = "SENSITIVITY";

    /**
     * 默认变化起始百分比
     */
    private static final BigDecimal DEFAULT_START_PERCENT = new BigDecimal("-20");

    /**
     * 默认变化结束百分比
     */
    private static final BigDecimal DEFAULT_END_PERCENT = new BigDecimal("20");

    /**
     * 默认步长百分比
     */
    private static final BigDecimal DEFAULT_STEP_PERCENT = new BigDecimal("5");
    private static final List<SensitivityVariableEnum> SUPPORTED_QUICK_SINGLE_VARIABLES = List.of(
            SensitivityVariableEnum.FLOW_RATE,
            SensitivityVariableEnum.OIL_VISCOSITY,
            SensitivityVariableEnum.PIPE_DIAMETER,
            SensitivityVariableEnum.PIPE_ROUGHNESS
    );

    private final SensitivityAnalysisStrategy sensitivityAnalysisStrategy;
    private final ICalculationHistoryService calculationHistoryService;
    private final ObjectMapper objectMapper;

    @Override
    public Result<SensitivityAnalysisResult> analyze(SensitivityAnalysisParams params) {
        log.info("开始敏感性分析: 变量数={}, 分析类型={}",
                params.getVariables().size(), params.getAnalysisType());

        return sensitivityAnalysisStrategy.calculate(params);
    }

    @Override
    public Result<SensitivityAnalysisResult> analyzeAndSave(
            SensitivityAnalysisParams params, Long userId, String userName) {

        long startTime = System.currentTimeMillis();

        // 创建历史记录
        Long historyId = null;
        try {
            String inputJson = objectMapper.writeValueAsString(params);
            historyId = calculationHistoryService.createHistory(
                    CALC_TYPE_SENSITIVITY,
                    params.getProjectId(),
                    params.getProjectName(),
                    userId,
                    userName,
                    inputJson);
        } catch (JsonProcessingException e) {
            log.warn("序列化参数失败", e);
        }

        // 执行分析
        Result<SensitivityAnalysisResult> result = analyze(params);

        long duration = System.currentTimeMillis() - startTime;

        // 更新历史记录
        if (historyId != null) {
            try {
                if (result.isSuccess()) {
                    String outputJson = objectMapper.writeValueAsString(result.getData());
                    calculationHistoryService.updateSuccess(historyId, outputJson, duration);
                } else {
                    calculationHistoryService.updateFailed(historyId, result.getMsg(), duration);
                }
            } catch (JsonProcessingException e) {
                log.warn("序列化结果失败", e);
            }
        }

        return result;
    }

    @Override
    public Result<SensitivityAnalysisResult> quickSingleAnalysis(
            HydraulicAnalysisParams params, String variableType) {

        SensitivityVariableEnum varEnum = SensitivityVariableEnum.fromCode(variableType);
        if (varEnum == null) {
            return Result.fail("不支持的变量类型: " + variableType);
        }
        if (!SUPPORTED_QUICK_SINGLE_VARIABLES.contains(varEnum)) {
            return Result.fail("当前版本暂不支持该变量的快速敏感性分析: " + variableType);
        }

        SensitivityVariable variable = SensitivityVariable.builder()
                .variableType(variableType)
                .variableName(varEnum.getName())
                .unit(varEnum.getUnit())
                .startPercent(DEFAULT_START_PERCENT)
                .endPercent(DEFAULT_END_PERCENT)
                .stepPercent(DEFAULT_STEP_PERCENT)
                .build();

        SensitivityAnalysisParams analysisParams = SensitivityAnalysisParams.builder()
                .baseParams(params)
                .variables(List.of(variable))
                .analysisType(AnalysisType.SINGLE)
                .build();

        return analyze(analysisParams);
    }

    @Override
    public List<SensitivityVariableEnum> getSupportedVariables() {
        return SUPPORTED_QUICK_SINGLE_VARIABLES;
    }
}
