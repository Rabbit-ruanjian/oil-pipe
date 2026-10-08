package com.pipeline.data.domain;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.io.Serializable;
import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 泵站参数实体类
 */
@Data
@TableName("t_pump_station")
public class PumpStation implements Serializable {
    private static final long serialVersionUID = 1L;

    /**
     * 主键ID
     */
    @TableId(type = IdType.AUTO)
    private Long id;

    /**
     * 泵站名称
     */
    private String name;

    /**
     * 泵效率(%)
     */
    private BigDecimal pumpEfficiency;

    /**
     * 电效率(%)
     */
    private BigDecimal electricEfficiency;

    /**
     * 排量(m3/h)
     */
    private BigDecimal displacement;

    /**
     * 来压/进站压力
     */
    private BigDecimal comePower;

    /**
     * ZMI480扬程
     */
    private BigDecimal zmi480Lift;

    /**
     * ZMI375扬程
     */
    private BigDecimal zmi375Lift;

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
