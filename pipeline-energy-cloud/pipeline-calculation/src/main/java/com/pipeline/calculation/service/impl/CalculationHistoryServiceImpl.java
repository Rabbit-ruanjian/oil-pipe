package com.pipeline.calculation.service.impl;

import java.util.List;
import java.time.LocalDateTime;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.StringUtils;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.pipeline.calculation.domain.converter.CalculationHistoryConverter;
import com.pipeline.calculation.domain.dto.CalculationHistoryQuery;
import com.pipeline.calculation.domain.entity.CalculationHistory;
import com.pipeline.calculation.domain.vo.CalculationHistoryVO;
import com.pipeline.calculation.mapper.CalculationHistoryMapper;
import com.pipeline.calculation.service.ICalculationHistoryService;
import com.pipeline.common.core.domain.PageResult;
import com.pipeline.common.core.exception.BusinessException;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 计算历史服务实现类
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CalculationHistoryServiceImpl
        extends ServiceImpl<CalculationHistoryMapper, CalculationHistory>
        implements ICalculationHistoryService {

    private static final int MAX_RECENT_LIMIT = 50;

    @Override
    public PageResult<CalculationHistoryVO> queryPage(CalculationHistoryQuery query) {
        Page<CalculationHistory> page = new Page<>(query.getPageNum(), query.getPageSize());

        LambdaQueryWrapper<CalculationHistory> wrapper = buildQueryWrapper(query);
        wrapper.orderByDesc(CalculationHistory::getCreateTime);

        IPage<CalculationHistory> result = this.page(page, wrapper);

        List<CalculationHistoryVO> voList = CalculationHistoryConverter.toVOList(result.getRecords());
        return PageResult.build(voList, result.getTotal(), result.getCurrent(), result.getSize());
    }

    @Override
    public CalculationHistoryVO getDetail(Long id) {
        if (id == null) {
            throw new BusinessException("记录ID不能为空");
        }

        CalculationHistory history = this.getById(id);
        if (history == null) {
            throw new BusinessException("计算历史记录不存在");
        }

        return CalculationHistoryConverter.toVO(history);
    }

    @Override
    public List<CalculationHistoryVO> getRecentByUser(Long userId, int limit) {
        if (userId == null) {
            throw new BusinessException("用户ID不能为空");
        }

        int safeLimit = Math.min(Math.max(limit, 1), MAX_RECENT_LIMIT);

        List<CalculationHistory> histories = baseMapper.selectRecentByCreateBy(
                String.valueOf(userId), safeLimit);
        return CalculationHistoryConverter.toVOList(histories);
    }

    @Override
    public PageResult<CalculationHistoryVO> getByProject(Long projectId, CalculationHistoryQuery query) {
        if (projectId == null) {
            throw new BusinessException("项目ID不能为空");
        }

        Page<CalculationHistory> page = new Page<>(query.getPageNum(), query.getPageSize());
        IPage<CalculationHistory> result = baseMapper.selectPageByProId(page, projectId);

        List<CalculationHistoryVO> voList = CalculationHistoryConverter.toVOList(result.getRecords());
        return PageResult.build(voList, result.getTotal(), result.getCurrent(), result.getSize());
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Long createHistory(String calcType, Long projectId, String projectName,
                              Long userId, String userName, String inputParams) {
        CalculationHistory history = new CalculationHistory();
        history.setCalcType(calcType);
        history.setProId(projectId != null ? projectId : 0L);
        history.setPipelineId(0L);
        history.setCalcName(projectName);
        history.setCreateBy(String.valueOf(userId));
        history.setInputParams(inputParams);
        history.setCreateTime(LocalDateTime.now());

        this.save(history);

        log.info("创建计算历史记录: id={}, type={}, proId={}, createBy={}",
                history.getId(), calcType, projectId, userId);

        return history.getId();
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void updateSuccess(Long id, String outputResult, long duration) {
        if (id == null) {
            log.warn("更新计算结果失败：记录ID为空");
            return;
        }

        CalculationHistory history = new CalculationHistory();
        history.setId(id);
        history.setOutputResult(outputResult);
        history.setRemark("计算成功，耗时" + duration + "ms");

        this.updateById(history);

        log.info("计算成功: id={}, duration={}ms", id, duration);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void updateFailed(Long id, String errorMessage, long duration) {
        if (id == null) {
            log.warn("更新计算失败状态失败：记录ID为空");
            return;
        }

        CalculationHistory history = new CalculationHistory();
        history.setId(id);
        history.setRemark("计算失败(" + duration + "ms): " + errorMessage);

        this.updateById(history);

        log.warn("计算失败: id={}, duration={}ms, error={}", id, duration, errorMessage);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public boolean deleteHistory(Long id) {
        if (id == null) {
            throw new BusinessException("记录ID不能为空");
        }

        boolean result = this.removeById(id);

        if (result) {
            log.info("删除计算历史记录: id={}", id);
        }

        return result;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public int batchDelete(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return 0;
        }

        boolean result = this.removeByIds(ids);

        if (result) {
            log.info("批量删除计算历史记录: ids={}", ids);
            return ids.size();
        }

        return 0;
    }

    @Override
    public long countByProject(Long projectId) {
        if (projectId == null) {
            return 0;
        }
        return baseMapper.countByProId(projectId);
    }

    @Override
    public long countByUser(Long userId) {
        if (userId == null) {
            return 0;
        }
        return baseMapper.countByCreateBy(String.valueOf(userId));
    }

    /**
     * 构建查询条件
     */
    private LambdaQueryWrapper<CalculationHistory> buildQueryWrapper(CalculationHistoryQuery query) {
        LambdaQueryWrapper<CalculationHistory> wrapper = new LambdaQueryWrapper<>();

        // 计算类型
        if (StringUtils.isNotBlank(query.getCalcType())) {
            wrapper.eq(CalculationHistory::getCalcType, query.getCalcType());
        }

        // 项目ID → proId
        if (query.getProjectId() != null) {
            wrapper.eq(CalculationHistory::getProId, query.getProjectId());
        }

        // 用户ID → createBy
        if (query.getUserId() != null) {
            wrapper.eq(CalculationHistory::getCreateBy, String.valueOf(query.getUserId()));
        }

        // 时间范围
        if (query.getStartTime() != null) {
            wrapper.ge(CalculationHistory::getCreateTime, query.getStartTime());
        }
        if (query.getEndTime() != null) {
            wrapper.le(CalculationHistory::getCreateTime, query.getEndTime());
        }

        // 关键词搜索（在calcName中搜索）
        if (StringUtils.isNotBlank(query.getKeyword())) {
            wrapper.like(CalculationHistory::getCalcName, query.getKeyword());
        }

        return wrapper;
    }
}
