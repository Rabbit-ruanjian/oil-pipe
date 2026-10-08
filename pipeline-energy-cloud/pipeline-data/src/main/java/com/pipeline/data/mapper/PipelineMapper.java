package com.pipeline.data.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.pipeline.data.domain.Pipeline;
import org.apache.ibatis.annotations.Mapper;

/**
 * 管道参数 Mapper 接口
 */
@Mapper
public interface PipelineMapper extends BaseMapper<Pipeline> {
}
