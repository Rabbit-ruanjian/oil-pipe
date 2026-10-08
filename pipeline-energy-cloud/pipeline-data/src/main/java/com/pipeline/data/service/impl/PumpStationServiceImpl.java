package com.pipeline.data.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.pipeline.data.domain.PumpStation;
import com.pipeline.data.mapper.PumpStationMapper;
import com.pipeline.data.service.IPumpStationService;
import org.springframework.stereotype.Service;

/**
 * 泵站参数 服务实现类
 */
@Service
public class PumpStationServiceImpl extends ServiceImpl<PumpStationMapper, PumpStation> implements IPumpStationService {
}
