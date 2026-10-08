package com.pipeline.calculation.mapper;

import java.math.BigDecimal;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface PipelineLookupMapper {

    @Select("SELECT length FROM t_pipeline WHERE id = #{pipelineId}")
    BigDecimal selectLengthById(@Param("pipelineId") Long pipelineId);
}
