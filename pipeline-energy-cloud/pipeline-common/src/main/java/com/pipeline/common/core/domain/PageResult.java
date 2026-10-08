package com.pipeline.common.core.domain;

import java.io.Serializable;
import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 分页结果封装类
 *
 * @param <T> 数据类型
 * @author Pipeline Team
 * @since 1.0.0
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class PageResult<T> implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 当前页码
     */
    private long pageNum;

    /**
     * 每页数量
     */
    private long pageSize;

    /**
     * 总记录数
     */
    private long total;

    /**
     * 总页数
     */
    private long pages;

    /**
     * 数据列表
     */
    private List<T> list;

    /**
     * 构建分页结果
     *
     * @param list     数据列表
     * @param total    总记录数
     * @param pageNum  当前页码
     * @param pageSize 每页数量
     * @param <T>      数据类型
     * @return 分页结果
     */
    public static <T> PageResult<T> build(List<T> list, long total, long pageNum, long pageSize) {
        PageResult<T> result = new PageResult<>();
        result.setList(list);
        result.setTotal(total);
        result.setPageNum(pageNum);
        result.setPageSize(pageSize);
        result.setPages(pageSize > 0 ? (total + pageSize - 1) / pageSize : 0);
        return result;
    }

    /**
     * 构建空分页结果
     *
     * @param <T> 数据类型
     * @return 空分页结果
     */
    public static <T> PageResult<T> empty() {
        return build(List.of(), 0, 1, 10);
    }
}
