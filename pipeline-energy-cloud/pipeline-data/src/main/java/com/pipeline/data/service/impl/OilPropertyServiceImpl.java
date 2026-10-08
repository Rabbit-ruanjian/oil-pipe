package com.pipeline.data.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.pipeline.data.domain.OilProperty;
import com.pipeline.data.mapper.OilPropertyMapper;
import com.pipeline.data.service.IOilPropertyService;
import org.springframework.stereotype.Service;

/**
 * 油品特性 服务实现类
 */
@Service
public class OilPropertyServiceImpl extends ServiceImpl<OilPropertyMapper, OilProperty> implements IOilPropertyService {
}
