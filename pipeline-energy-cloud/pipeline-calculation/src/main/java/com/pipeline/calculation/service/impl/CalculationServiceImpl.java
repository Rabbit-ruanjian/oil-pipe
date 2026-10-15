package com.pipeline.calculation.service.impl;

import com.pipeline.calculation.domain.HydraulicAnalysisParams;
import com.pipeline.calculation.domain.HydraulicAnalysisResult;
import com.pipeline.calculation.domain.CapacityEvaluationParams;
import com.pipeline.calculation.domain.CapacityEvaluationResult;
import com.pipeline.calculation.domain.OptimizationParams;
import com.pipeline.calculation.domain.OptimizationResult;
import com.pipeline.calculation.domain.TransientRiskParams;
import com.pipeline.calculation.domain.TransientRiskResult;
import com.pipeline.calculation.service.ICalculationService;
import com.pipeline.calculation.strategy.impl.HydraulicAnalysisStrategy;
import com.pipeline.calculation.strategy.impl.OptimizationStrategy;
import com.pipeline.calculation.strategy.impl.CapacityEvaluationStrategy;
import com.pipeline.calculation.strategy.impl.TransientRiskStrategy;
import com.pipeline.common.core.domain.Result;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 计算服务实现类
 */
@Service
public class CalculationServiceImpl implements ICalculationService {

    @Autowired
    private HydraulicAnalysisStrategy hydraulicAnalysisStrategy;

    @Autowired
    private OptimizationStrategy optimizationStrategy;

    @Autowired
    private CapacityEvaluationStrategy capacityEvaluationStrategy;

    @Autowired
    private TransientRiskStrategy transientRiskStrategy;

    @Override
    public Result<HydraulicAnalysisResult> analyzeHydraulic(HydraulicAnalysisParams params) {
        // 可以在此处添加前置校验逻辑
        return hydraulicAnalysisStrategy.calculate(params);
    }

    @Override
    public Result<OptimizationResult> optimizeOperation(OptimizationParams params) {
        // 可以在此处添加前置校验逻辑
        return optimizationStrategy.calculate(params);
    }

    @Override
    public Result<CapacityEvaluationResult> evaluateCapacity(CapacityEvaluationParams params) {
        return capacityEvaluationStrategy.calculate(params);
    }

    @Override
    public Result<TransientRiskResult> evaluateTransientRisk(TransientRiskParams params) {
        return transientRiskStrategy.calculate(params);
    }
}
