package com.pipeline.auth.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.pipeline.auth.domain.SysUser;
import org.apache.ibatis.annotations.Mapper;

/**
 * 用户表 数据层
 */
@Mapper
public interface SysUserMapper extends BaseMapper<SysUser> {
}
