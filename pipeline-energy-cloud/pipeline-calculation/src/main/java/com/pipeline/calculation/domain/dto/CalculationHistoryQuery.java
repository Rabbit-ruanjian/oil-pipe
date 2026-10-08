package com.pipeline.calculation.domain.dto;

import java.io.Serial;
import java.time.LocalDateTime;

import com.pipeline.common.core.domain.PageQuery;

import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 计算历史查询参数
 * <p>
 * 用于分页查询计算历史记录，支持多条件筛选。
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
@Data
@EqualsAndHashCode(callSuper = true)
public class CalculationHistoryQuery extends PageQuery {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 计算类型（HYDRAULIC/OPTIMIZATION）
     */
    private String calcType;

    /**
     * 项目ID
     */
    private Long projectId;

    /**
     * 用户ID
     */
    private Long userId;

    /**
     * 计算状态（0:计算中, 1:成功, 2:失败）
     */
    private Integer status;

    /**
     * 开始时间
     */
    private LocalDateTime startTime;

    /**
     * 结束时间
     */
    private LocalDateTime endTime;

    /**
     * 关键词（项目名称/用户名模糊搜索）
     */
    private String keyword;
}
