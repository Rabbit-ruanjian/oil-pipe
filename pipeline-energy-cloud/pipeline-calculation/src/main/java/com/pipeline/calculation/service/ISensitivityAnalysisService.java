package com.pipeline.calculation.service;

import com.pipeline.calculation.domain.SensitivityAnalysisParams;
import com.pipeline.calculation.domain.SensitivityAnalysisResult;
import com.pipeline.common.core.domain.Result;

/**
 * 敏感性分析服务接口
 * <p>
 * 提供敏感性分析的业务操作，包括单因素分析和多因素交叉分析。
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
public interface ISensitivityAnalysisService {

    /**
     * 执行敏感性分析
     *
     * @param params 分析参数
     * @return 分析结果
     */
    Result<SensitivityAnalysisResult> analyze(SensitivityAnalysisParams params);

    /**
     * 执行敏感性分析并保存历史
     *
     * @param params   分析参数
     * @param userId   用户ID
     * @param userName 用户名
     * @return 分析结果
     */
    Result<SensitivityAnalysisResult> analyzeAndSave(
            SensitivityAnalysisParams params, Long userId, String userName);

    /**
     * 快速单因素分析
     * <p>
     * 使用默认的变化范围（-20%到+20%，步长5%）
     * </p>
     *
     * @param params       基准水力参数
     * @param variableType 变量类型
     * @return 分析结果
     */
    Result<SensitivityAnalysisResult> quickSingleAnalysis(
            com.pipeline.calculation.domain.HydraulicAnalysisParams params,
            String variableType);

    /**
     * 获取支持的敏感性变量列表
     *
     * @return 变量列表
     */
    java.util.List<com.pipeline.common.core.enums.SensitivityVariableEnum> getSupportedVariables();
}
