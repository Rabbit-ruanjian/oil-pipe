package com.pipeline.data.service.impl;

import com.baomidou.mybatisplus.core.toolkit.CollectionUtils;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.pipeline.data.domain.Pipeline;
import com.pipeline.data.mapper.PipelineMapper;
import com.pipeline.data.service.IPipelineService;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 管道参数服务实现类
 */
@Service
public class PipelineServiceImpl extends ServiceImpl<PipelineMapper, Pipeline> implements IPipelineService {

    private final NamedParameterJdbcTemplate namedParameterJdbcTemplate;

    public PipelineServiceImpl(NamedParameterJdbcTemplate namedParameterJdbcTemplate) {
        this.namedParameterJdbcTemplate = namedParameterJdbcTemplate;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public boolean removePipelinesCascade(List<Long> pipelineIds) {
        if (CollectionUtils.isEmpty(pipelineIds)) {
            return false;
        }

        MapSqlParameterSource params = new MapSqlParameterSource("pipelineIds", pipelineIds);
        namedParameterJdbcTemplate.update(
                "DELETE FROM t_sensitivity_analysis WHERE pipeline_id IN (:pipelineIds)",
                params
        );
        namedParameterJdbcTemplate.update(
                "DELETE FROM t_calculation_history WHERE pipeline_id IN (:pipelineIds)",
                params
        );

        return this.removeBatchByIds(pipelineIds);
    }
}
