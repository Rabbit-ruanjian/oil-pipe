package com.pipeline.data.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.pipeline.data.domain.Project;

import java.util.List;

/**
 * 项目表服务接口
 */
public interface IProjectService extends IService<Project> {

    /**
     * 删除项目及其关联的管道、计算历史和敏感性分析记录
     *
     * @param projectIds 项目ID列表
     * @return 是否删除成功
     */
    boolean removeProjectsCascade(List<Long> projectIds);
}
