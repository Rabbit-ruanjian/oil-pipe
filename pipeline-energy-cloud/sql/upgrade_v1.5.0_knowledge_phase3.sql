/*
 * Knowledge module schema upgrade - phase 3
 * Version: v1.5.0
 */

USE `pipeline_cloud`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE `t_kb_document`
    ADD COLUMN `ingest_stage` varchar(32) NOT NULL DEFAULT 'QUEUED' AFTER `status`;

ALTER TABLE `t_kb_document`
    ADD COLUMN `progress_percent` int(11) NOT NULL DEFAULT 0 AFTER `ingest_stage`;

ALTER TABLE `t_kb_ingest_task`
    ADD COLUMN `ingest_stage` varchar(32) NOT NULL DEFAULT 'QUEUED' AFTER `status`;

ALTER TABLE `t_kb_ingest_task`
    ADD COLUMN `progress_percent` int(11) NOT NULL DEFAULT 0 AFTER `ingest_stage`;

UPDATE `t_kb_document`
SET
    `ingest_stage` = CASE
        WHEN `status` = 'INDEXED' THEN 'DONE'
        WHEN `status` = 'FAILED' THEN 'FAILED'
        WHEN `status` = 'PROCESSING' THEN 'INGESTING'
        ELSE 'QUEUED'
    END,
    `progress_percent` = CASE
        WHEN `status` = 'INDEXED' THEN 100
        WHEN `status` = 'FAILED' THEN 0
        WHEN `status` = 'PROCESSING' THEN 10
        ELSE 0
    END;

UPDATE `t_kb_ingest_task`
SET
    `ingest_stage` = CASE
        WHEN `status` = 'SUCCESS' THEN 'DONE'
        WHEN `status` = 'FAILED' THEN 'FAILED'
        WHEN `status` = 'PROCESSING' THEN 'INGESTING'
        ELSE 'QUEUED'
    END,
    `progress_percent` = CASE
        WHEN `status` = 'SUCCESS' THEN 100
        WHEN `status` = 'FAILED' THEN 0
        WHEN `status` = 'PROCESSING' THEN 10
        ELSE 0
    END;

SET FOREIGN_KEY_CHECKS = 1;

SELECT 'knowledge phase3 upgrade complete' AS message;
