package com.pipeline.calculation.service;

import java.util.List;

import com.baomidou.mybatisplus.extension.service.IService;
import com.pipeline.calculation.domain.dto.CalculationHistoryQuery;
import com.pipeline.calculation.domain.entity.CalculationHistory;
import com.pipeline.calculation.domain.vo.CalculationHistoryVO;
import com.pipeline.common.core.domain.PageResult;

/**
 * 计算历史服务接口
 * <p>
 * 提供计算历史记录的业务操作，包括查询、保存、统计等功能。
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
public interface ICalculationHistoryService extends IService<CalculationHistory> {

    /**
     * 分页查询计算历史
     *
     * @param query 查询参数
     * @return 分页结果
     */
    PageResult<CalculationHistoryVO> queryPage(CalculationHistoryQuery query);

    /**
     * 根据ID查询详情
     *
     * @param id 记录ID
     * @return 计算历史详情
     */
    CalculationHistoryVO getDetail(Long id);

    /**
     * 查询用户最近的计算记录
     *
     * @param userId 用户ID
     * @param limit  限制数量
     * @return 计算历史列表
     */
    List<CalculationHistoryVO> getRecentByUser(Long userId, int limit);

    /**
     * 查询项目的计算历史
     *
     * @param projectId 项目ID
     * @param query     分页参数
     * @return 分页结果
     */
    PageResult<CalculationHistoryVO> getByProject(Long projectId, CalculationHistoryQuery query);

    /**
     * 创建计算历史记录（计算开始时调用）
     *
     * @param calcType    计算类型
     * @param projectId   项目ID
     * @param projectName 项目名称
     * @param userId      用户ID
     * @param userName    用户名
     * @param inputParams 输入参数JSON
     * @return 创建的记录ID
     */
    Long createHistory(String calcType, Long projectId, String projectName,
                       Long userId, String userName, String inputParams);

    /**
     * 更新计算结果（计算成功时调用）
     *
     * @param id           记录ID
     * @param outputResult 输出结果JSON
     * @param duration     计算耗时（毫秒）
     */
    void updateSuccess(Long id, String outputResult, long duration);

    /**
     * 更新计算失败状态
     *
     * @param id           记录ID
     * @param errorMessage 错误信息
     * @param duration     计算耗时（毫秒）
     */
    void updateFailed(Long id, String errorMessage, long duration);

    /**
     * 删除计算历史（逻辑删除）
     *
     * @param id 记录ID
     * @return 是否成功
     */
    boolean deleteHistory(Long id);

    /**
     * 批量删除计算历史
     *
     * @param ids 记录ID列表
     * @return 删除数量
     */
    int batchDelete(List<Long> ids);

    /**
     * 按项目ID统计计算次数
     *
     * @param projectId 项目ID
     * @return 计算次数
     */
    long countByProject(Long projectId);

    /**
     * 按用户ID统计计算次数
     *
     * @param userId 用户ID
     * @return 计算次数
     */
    long countByUser(Long userId);
}
