package com.pipeline.common.core.domain;

import java.io.Serializable;

import lombok.Data;

/**
 * 分页查询参数基类
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
@Data
public class PageQuery implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 默认页码
     */
    private static final int DEFAULT_PAGE_NUM = 1;

    /**
     * 默认每页数量
     */
    private static final int DEFAULT_PAGE_SIZE = 10;

    /**
     * 最大每页数量
     */
    private static final int MAX_PAGE_SIZE = 100;

    /**
     * 当前页码，从1开始
     */
    private Integer pageNum;

    /**
     * 每页数量
     */
    private Integer pageSize;

    /**
     * 排序字段
     */
    private String orderBy;

    /**
     * 是否升序（默认降序）
     */
    private Boolean isAsc;

    /**
     * 获取安全的页码
     *
     * @return 页码，最小为1
     */
    public Integer getPageNum() {
        if (pageNum == null || pageNum < 1) {
            return DEFAULT_PAGE_NUM;
        }
        return pageNum;
    }

    /**
     * 获取安全的每页数量
     *
     * @return 每页数量，限制在1-100之间
     */
    public Integer getPageSize() {
        if (pageSize == null || pageSize < 1) {
            return DEFAULT_PAGE_SIZE;
        }
        if (pageSize > MAX_PAGE_SIZE) {
            return MAX_PAGE_SIZE;
        }
        return pageSize;
    }

    /**
     * 计算偏移量（用于SQL LIMIT）
     *
     * @return 偏移量
     */
    public int getOffset() {
        return (getPageNum() - 1) * getPageSize();
    }
}
