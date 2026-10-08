package com.pipeline.data.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.pipeline.data.domain.PumpStation;
import org.apache.ibatis.annotations.Mapper;

/**
 * 泵站参数 Mapper 接口
 */
@Mapper
public interface PumpStationMapper extends BaseMapper<PumpStation> {
}
