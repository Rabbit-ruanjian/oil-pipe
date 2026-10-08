package com.pipeline.calculation.service.impl;

import com.pipeline.calculation.domain.HydraulicAnalysisParams;
import com.pipeline.calculation.domain.HydraulicAnalysisResult;
import com.pipeline.calculation.domain.OptimizationParams;
import com.pipeline.calculation.domain.OptimizationResult;
import com.pipeline.calculation.service.ICalculationService;
import com.pipeline.calculation.strategy.impl.HydraulicAnalysisStrategy;
import com.pipeline.calculation.strategy.impl.OptimizationStrategy;
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
}
