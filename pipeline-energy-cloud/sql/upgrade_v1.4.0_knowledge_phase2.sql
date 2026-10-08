/*
 * Knowledge module schema upgrade - phase 2
 * Version: v1.4.0
 */

USE `pipeline_cloud`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE `t_kb_document`
    ADD COLUMN `file_hash` varchar(64) DEFAULT NULL AFTER `file_size`;

ALTER TABLE `t_kb_document`
    ADD COLUMN `storage_type` varchar(32) DEFAULT 'MINIO' AFTER `file_hash`;

ALTER TABLE `t_kb_document`
    ADD COLUMN `storage_bucket` varchar(128) DEFAULT NULL AFTER `storage_type`;

ALTER TABLE `t_kb_document`
    ADD COLUMN `storage_object_key` varchar(500) DEFAULT NULL AFTER `storage_bucket`;

ALTER TABLE `t_kb_document`
    ADD COLUMN `retry_count` int(11) DEFAULT 0 AFTER `chunk_count`;

ALTER TABLE `t_kb_document`
    ADD COLUMN `last_ingest_time` datetime DEFAULT NULL AFTER `failure_reason`;

UPDATE `t_kb_document`
SET
    `file_hash` = COALESCE(`file_hash`, SHA2(CONCAT(`id`, '-', `file_name`, '-', COALESCE(`create_time`, NOW())), 256)),
    `storage_type` = COALESCE(`storage_type`, 'LEGACY_AGENT'),
    `storage_bucket` = COALESCE(`storage_bucket`, 'legacy-agent'),
    `storage_object_key` = COALESCE(`storage_object_key`, CONCAT('knowledge_base/', `category`, '/', `file_name`))
WHERE `file_hash` IS NULL
   OR `storage_bucket` IS NULL
   OR `storage_object_key` IS NULL;

ALTER TABLE `t_kb_document`
    MODIFY COLUMN `status` varchar(32) NOT NULL DEFAULT 'UPLOADED',
    MODIFY COLUMN `file_hash` varchar(64) NOT NULL,
    MODIFY COLUMN `storage_type` varchar(32) NOT NULL DEFAULT 'MINIO',
    MODIFY COLUMN `storage_bucket` varchar(128) NOT NULL,
    MODIFY COLUMN `storage_object_key` varchar(500) NOT NULL;

ALTER TABLE `t_kb_document`
    ADD UNIQUE KEY `uk_file_hash` (`file_hash`);

CREATE TABLE IF NOT EXISTS `t_kb_ingest_task` (
    `id` bigint(20) NOT NULL AUTO_INCREMENT,
    `document_id` bigint(20) NOT NULL,
    `task_type` varchar(32) NOT NULL,
    `attempt_no` int(11) NOT NULL DEFAULT 1,
    `status` varchar(32) NOT NULL DEFAULT 'PENDING',
    `agent_doc_id` varchar(64) DEFAULT NULL,
    `chunk_count` int(11) DEFAULT 0,
    `failure_reason` varchar(1000) DEFAULT NULL,
    `create_by` varchar(64) DEFAULT '',
    `started_at` datetime DEFAULT NULL,
    `finished_at` datetime DEFAULT NULL,
    `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_document_id` (`document_id`),
    KEY `idx_task_status` (`status`),
    KEY `idx_task_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Knowledge ingest task';

SET FOREIGN_KEY_CHECKS = 1;

SELECT 'knowledge phase2 upgrade complete' AS message;
