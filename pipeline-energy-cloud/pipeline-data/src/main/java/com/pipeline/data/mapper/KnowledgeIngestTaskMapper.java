package com.pipeline.data.mapper;

import org.apache.ibatis.annotations.Mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.pipeline.data.domain.KnowledgeIngestTask;

@Mapper
public interface KnowledgeIngestTaskMapper extends BaseMapper<KnowledgeIngestTask> {
}
