/*
 * Knowledge module bootstrap schema
 * Version: v1.3.0
 */

USE `pipeline_cloud`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `t_kb_document` (
    `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
    `title` varchar(200) NOT NULL COMMENT 'Document title',
    `category` varchar(50) NOT NULL COMMENT 'Knowledge category',
    `source_type` varchar(50) DEFAULT NULL COMMENT 'Source type',
    `tags` varchar(500) DEFAULT NULL COMMENT 'Comma separated tags',
    `remark` varchar(1000) DEFAULT NULL COMMENT 'Remark',
    `file_name` varchar(255) NOT NULL COMMENT 'Original file name',
    `file_extension` varchar(20) DEFAULT NULL COMMENT 'File extension',
    `file_size` bigint(20) DEFAULT 0 COMMENT 'File size in bytes',
    `agent_doc_id` varchar(64) DEFAULT NULL COMMENT 'Document id in agent side',
    `chunk_count` int(11) DEFAULT 0 COMMENT 'Chunk count',
    `status` varchar(32) NOT NULL DEFAULT 'PENDING' COMMENT 'Document status',
    `failure_reason` varchar(1000) DEFAULT NULL COMMENT 'Failure reason',
    `create_by` varchar(64) DEFAULT '' COMMENT 'Created by',
    `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Create time',
    `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Update time',
    `is_deleted` tinyint(1) DEFAULT 0 COMMENT 'Logic delete flag',
    PRIMARY KEY (`id`),
    KEY `idx_category` (`category`),
    KEY `idx_status` (`status`),
    KEY `idx_agent_doc_id` (`agent_doc_id`),
    KEY `idx_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Knowledge document metadata';

SET FOREIGN_KEY_CHECKS = 1;

SELECT 'knowledge bootstrap complete' AS message;
