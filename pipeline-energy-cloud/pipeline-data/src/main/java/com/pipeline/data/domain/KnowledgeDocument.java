package com.pipeline.data.domain;

import java.io.Serial;
import java.io.Serializable;
import java.time.LocalDateTime;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableLogic;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Data;

@Data
@TableName("t_kb_document")
public class KnowledgeDocument implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @TableId(type = IdType.AUTO)
    private Long id;

    private String title;

    private String category;

    private String sourceType;

    private String tags;

    private String remark;

    private String author;

    private String summary;

    private String language;

    private String version;

    private String externalId;

    private LocalDateTime effectiveAt;

    private String fileName;

    private String fileExtension;

    private Long fileSize;

    private String fileHash;

    private String storageType;

    private String storageBucket;

    private String storageObjectKey;

    private String agentDocId;

    private Integer chunkCount;

    private Integer retryCount;

    private String status;

    private String ingestStage;

    private Integer progressPercent;

    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private String failureReason;

    private LocalDateTime lastIngestTime;

    private String createBy;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;

    @TableLogic
    private Integer isDeleted;
}
