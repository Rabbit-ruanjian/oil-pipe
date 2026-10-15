package com.pipeline.calculation.service;

import com.pipeline.calculation.domain.HydraulicAnalysisParams;
import com.pipeline.calculation.domain.HydraulicAnalysisResult;
import com.pipeline.calculation.domain.CapacityEvaluationParams;
import com.pipeline.calculation.domain.CapacityEvaluationResult;
import com.pipeline.calculation.domain.OptimizationParams;
import com.pipeline.calculation.domain.OptimizationResult;
import com.pipeline.calculation.domain.TransientRiskParams;
import com.pipeline.calculation.domain.TransientRiskResult;
import com.pipeline.common.core.domain.Result;

/**
 * 计算服务接口
 */
public interface ICalculationService {

    /**
     * 执行水力特性分析
     */
    Result<HydraulicAnalysisResult> analyzeHydraulic(HydraulicAnalysisParams params);

    /**
     * 执行运行方案优化
     */
    Result<OptimizationResult> optimizeOperation(OptimizationParams params);

    Result<CapacityEvaluationResult> evaluateCapacity(CapacityEvaluationParams params);

    Result<TransientRiskResult> evaluateTransientRisk(TransientRiskParams params);
}
