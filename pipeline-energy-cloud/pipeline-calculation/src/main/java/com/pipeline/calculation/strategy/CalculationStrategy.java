package com.pipeline.calculation.strategy;

import com.pipeline.common.core.domain.Result;

/**
 * 计算策略接口
 * 定义算法的统一执行标准
 */
public interface CalculationStrategy<T, R> {

    /**
     * 执行计算
     * @param params 输入参数
     * @return 计算结果
     */
    Result<R> calculate(T params);

    /**
     * 获取策略类型
     * @return 策略名称
     */
    String getType();
}
