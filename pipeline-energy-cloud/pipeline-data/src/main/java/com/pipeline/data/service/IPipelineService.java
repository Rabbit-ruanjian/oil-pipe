package com.pipeline.data.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.pipeline.data.domain.Pipeline;

import java.util.List;

/**
 * 管道参数服务接口
 */
public interface IPipelineService extends IService<Pipeline> {

    /**
     * 删除管道及其关联的计算历史和敏感性分析记录
     *
     * @param pipelineIds 管道ID列表
     * @return 是否删除成功
     */
    boolean removePipelinesCascade(List<Long> pipelineIds);
}
