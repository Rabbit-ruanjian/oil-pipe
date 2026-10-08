/*
 * 管道能耗分析系统 - 数据库升级脚本
 * 版本: v1.2.0
 * 日期: 2026-02-08
 * 说明: Agent v4.0 图谱、追踪、HITL 能力所需表
 */

USE `pipeline_cloud`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ===== 知识图谱相关 =====
CREATE TABLE IF NOT EXISTS `t_kg_node` (
    `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
    `node_id` VARCHAR(64) NOT NULL UNIQUE COMMENT '节点唯一标识',
    `node_type` VARCHAR(32) NOT NULL COMMENT '节点类型',
    `name` VARCHAR(128) NOT NULL COMMENT '节点名称',
    `description` TEXT COMMENT '节点描述',
    `properties` JSON COMMENT '节点属性(JSON)',
    `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_node_type` (`node_type`),
    INDEX `idx_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='知识图谱节点表';

CREATE TABLE IF NOT EXISTS `t_kg_edge` (
    `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
    `source_id` VARCHAR(64) NOT NULL COMMENT '源节点ID',
    `target_id` VARCHAR(64) NOT NULL COMMENT '目标节点ID',
    `edge_type` VARCHAR(32) NOT NULL COMMENT '关系类型',
    `weight` DECIMAL(5,4) DEFAULT 1.0 COMMENT '关系权重',
    `properties` JSON COMMENT '关系属性(JSON)',
    `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX `idx_source` (`source_id`),
    INDEX `idx_target` (`target_id`),
    INDEX `idx_edge_type` (`edge_type`),
    CONSTRAINT `fk_kg_edge_source` FOREIGN KEY (`source_id`) REFERENCES `t_kg_node` (`node_id`),
    CONSTRAINT `fk_kg_edge_target` FOREIGN KEY (`target_id`) REFERENCES `t_kg_node` (`node_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='知识图谱关系表';

-- ===== Agent 追踪相关 =====
CREATE TABLE IF NOT EXISTS `t_agent_trace` (
    `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
    `trace_id` VARCHAR(64) NOT NULL UNIQUE COMMENT '追踪ID',
    `session_id` VARCHAR(64) NOT NULL COMMENT '会话ID',
    `user_id` BIGINT COMMENT '用户ID',
    `user_input` TEXT NOT NULL COMMENT '用户输入',
    `final_response` TEXT COMMENT '最终响应',
    `plan_json` JSON COMMENT '执行计划(JSON)',
    `status` VARCHAR(16) DEFAULT 'running' COMMENT 'running/completed/failed',
    `total_duration_ms` INT COMMENT '总耗时(毫秒)',
    `llm_calls` INT DEFAULT 0 COMMENT 'LLM调用次数',
    `tool_calls` INT DEFAULT 0 COMMENT '工具调用次数',
    `total_tokens` INT DEFAULT 0 COMMENT 'Token总消耗',
    `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX `idx_session` (`session_id`),
    INDEX `idx_status` (`status`),
    INDEX `idx_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Agent执行追踪表';

CREATE TABLE IF NOT EXISTS `t_agent_trace_event` (
    `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
    `trace_id` VARCHAR(64) NOT NULL COMMENT '追踪ID',
    `event_type` VARCHAR(32) NOT NULL COMMENT '事件类型',
    `step_number` INT COMMENT '步骤编号',
    `agent` VARCHAR(32) COMMENT 'Agent名称',
    `data` JSON COMMENT '事件数据',
    `duration_ms` INT COMMENT '耗时(毫秒)',
    `token_count` INT COMMENT 'Token消耗',
    `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX `idx_trace_id` (`trace_id`),
    INDEX `idx_event_type` (`event_type`),
    CONSTRAINT `fk_trace_event_trace` FOREIGN KEY (`trace_id`) REFERENCES `t_agent_trace` (`trace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Agent执行事件表';

-- ===== HITL 相关 =====
CREATE TABLE IF NOT EXISTS `t_hitl_record` (
    `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
    `request_id` VARCHAR(64) NOT NULL UNIQUE COMMENT '请求ID',
    `trace_id` VARCHAR(64) NOT NULL COMMENT '关联追踪ID',
    `session_id` VARCHAR(64) NOT NULL COMMENT '会话ID',
    `hitl_type` VARCHAR(32) NOT NULL COMMENT '交互类型',
    `request_data` JSON NOT NULL COMMENT '请求数据',
    `response_data` JSON COMMENT '用户响应数据',
    `status` VARCHAR(16) DEFAULT 'pending' COMMENT 'pending/responded/timeout',
    `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `response_time` DATETIME COMMENT '用户响应时间',
    INDEX `idx_hitl_trace` (`trace_id`),
    INDEX `idx_hitl_session` (`session_id`),
    INDEX `idx_hitl_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='人机交互记录表';

SET FOREIGN_KEY_CHECKS = 1;

SELECT '数据库升级至 v1.2.0 (Agent v4.0) 完成!' AS message;
