package com.pipeline.data.domain;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;

import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * 项目表实体类
 */
@Data
@TableName("t_project")
public class Project implements Serializable {
    private static final long serialVersionUID = 1L;

    /**
     * 项目ID
     */
    @TableId(type = IdType.AUTO)
    private Long proId;

    /**
     * 项目编号
     */
    private String number;

    /**
     * 项目名称
     */
    private String name;

    /**
     * 负责人
     */
    private String responsible;

    /**
     * 创建日期
     */
    private LocalDateTime buildDate;

    /**
     * 记录创建时间
     */
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    /**
     * 记录更新时间
     */
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;

    /**
     * 逻辑删除(0:正常, 1:删除)
     */
    @TableLogic
    private Integer isDeleted;
}
