package com.pipeline.data.service.impl;

import com.baomidou.mybatisplus.core.toolkit.CollectionUtils;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.pipeline.data.domain.Project;
import com.pipeline.data.mapper.ProjectMapper;
import com.pipeline.data.service.IProjectService;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 项目表服务实现类
 */
@Service
public class ProjectServiceImpl extends ServiceImpl<ProjectMapper, Project> implements IProjectService {

    private final NamedParameterJdbcTemplate namedParameterJdbcTemplate;

    public ProjectServiceImpl(NamedParameterJdbcTemplate namedParameterJdbcTemplate) {
        this.namedParameterJdbcTemplate = namedParameterJdbcTemplate;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public boolean removeProjectsCascade(List<Long> projectIds) {
        if (CollectionUtils.isEmpty(projectIds)) {
            return false;
        }

        MapSqlParameterSource projectParams = new MapSqlParameterSource("projectIds", projectIds);
        List<Long> pipelineIds = namedParameterJdbcTemplate.queryForList(
                "SELECT id FROM t_pipeline WHERE pro_id IN (:projectIds)",
                projectParams,
                Long.class
        );

        if (CollectionUtils.isNotEmpty(pipelineIds)) {
            MapSqlParameterSource pipelineParams = new MapSqlParameterSource("pipelineIds", pipelineIds);
            namedParameterJdbcTemplate.update(
                    "DELETE FROM t_sensitivity_analysis WHERE pipeline_id IN (:pipelineIds)",
                    pipelineParams
            );
            namedParameterJdbcTemplate.update(
                    "DELETE FROM t_calculation_history WHERE pipeline_id IN (:pipelineIds)",
                    pipelineParams
            );
        }

        namedParameterJdbcTemplate.update(
                "DELETE FROM t_calculation_history WHERE pro_id IN (:projectIds)",
                projectParams
        );
        namedParameterJdbcTemplate.update(
                "DELETE FROM t_pipeline WHERE pro_id IN (:projectIds)",
                projectParams
        );

        return this.removeBatchByIds(projectIds);
    }
}
