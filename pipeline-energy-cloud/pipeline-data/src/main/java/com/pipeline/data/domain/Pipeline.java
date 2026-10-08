package com.pipeline.data.domain;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;

import java.io.Serializable;
import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 管道参数实体类
 */
@Data
@TableName("t_pipeline")
public class Pipeline implements Serializable {
    private static final long serialVersionUID = 1L;

    /**
     * 主键ID
     */
    @TableId(type = IdType.AUTO)
    private Long id;

    /**
     * 关联项目ID
     */
    private Long proId;

    /**
     * 管道名称
     */
    private String name;

    /**
     * 管道长度(km)
     */
    private BigDecimal length;

    /**
     * 管道外径(mm)
     */
    private BigDecimal diameter;

    /**
     * 壁厚(mm)
     */
    private BigDecimal thickness;

    /**
     * 设计年输量(万吨)
     */
    private BigDecimal throughput;

    /**
     * 起点高程(m)
     */
    private BigDecimal startAltitude;

    /**
     * 终点高程(m)
     */
    private BigDecimal endAltitude;

    /**
     * 当量粗糙度(m)
     */
    private BigDecimal roughness;

    /**
     * 年工作时间(h)
     */
    private BigDecimal workTime;

    /**
     * 创建时间
     */
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    /**
     * 更新时间
     */
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;
}
