package com.pipeline.calculation.domain.entity;

import java.io.Serial;
import java.io.Serializable;
import java.math.BigDecimal;
import java.time.LocalDateTime;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Data;

/**
 * 计算历史记录实体类
 * <p>
 * 对齐 t_calculation_history 表结构 (upgrade_v1.1.0.sql)
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
@Data
@TableName("t_calculation_history")
public class CalculationHistory implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("pro_id")
    private Long proId;

    @TableField("pipeline_id")
    private Long pipelineId;

    private String calcType;

    private String calcName;

    private String inputParams;

    private BigDecimal flowRate;

    private BigDecimal flowVelocity;

    private BigDecimal reynoldsNumber;

    private String flowRegime;

    private BigDecimal frictionFactor;

    private BigDecimal frictionLoss;

    private BigDecimal hydraulicSlope;

    @TableField("optimal_pump480")
    private Integer optimalPump480;

    @TableField("optimal_pump375")
    private Integer optimalPump375;

    private BigDecimal totalHead;

    private BigDecimal endStationPressure;

    private BigDecimal energyConsumption;

    private BigDecimal annualCost;

    private String outputResult;

    private String createBy;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    private String remark;
}
