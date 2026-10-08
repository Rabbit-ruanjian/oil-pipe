package com.pipeline.data.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.pipeline.data.domain.Project;
import org.apache.ibatis.annotations.Mapper;

/**
 * 项目表 Mapper 接口
 */
@Mapper
public interface ProjectMapper extends BaseMapper<Project> {
}
