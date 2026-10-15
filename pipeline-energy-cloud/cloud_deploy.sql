-- ============================================================
-- Pipeline Energy Analysis System - Cloud Deployment Bootstrap
-- Target: MySQL 8.0+
-- Database: pipeline_cloud
--
-- This script is intended for a fresh cloud deployment. It creates
-- the complete current schema, seed dictionaries, the demo admin
-- account, and the current project master data.
-- Default account: admin / admin123
-- Do not run this file against a production database without a backup.
-- ============================================================

CREATE DATABASE IF NOT EXISTS `pipeline_cloud`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_general_ci;

USE `pipeline_cloud`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- Drop tables in dependency order so the script can rebuild a fresh schema.
DROP TABLE IF EXISTS `t_kg_edge`;
DROP TABLE IF EXISTS `t_agent_trace_event`;
DROP TABLE IF EXISTS `t_hitl_record`;
DROP TABLE IF EXISTS `t_kb_ingest_task`;
DROP TABLE IF EXISTS `t_kb_document`;
DROP TABLE IF EXISTS `t_operation_log`;
DROP TABLE IF EXISTS `t_sensitivity_analysis`;
DROP TABLE IF EXISTS `t_calculation_history`;
DROP TABLE IF EXISTS `sys_dict_data`;
DROP TABLE IF EXISTS `sys_dict_type`;
DROP TABLE IF EXISTS `t_agent_trace`;
DROP TABLE IF EXISTS `t_kg_node`;
DROP TABLE IF EXISTS `t_analysis_report`;
DROP TABLE IF EXISTS `t_pump_station`;
DROP TABLE IF EXISTS `t_oil_property`;
DROP TABLE IF EXISTS `t_pipeline`;
DROP TABLE IF EXISTS `t_project`;
DROP TABLE IF EXISTS `sys_user`;

-- ------------------------------------------------------------
-- 1. Core master data
-- ------------------------------------------------------------
CREATE TABLE `t_project` (
  `pro_id` bigint NOT NULL AUTO_INCREMENT,
  `number` varchar(50) DEFAULT NULL,
  `name` varchar(100) DEFAULT NULL,
  `responsible` varchar(50) DEFAULT NULL,
  `build_date` datetime DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`pro_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Project information';

CREATE TABLE `t_pipeline` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `pro_id` bigint NOT NULL,
  `name` varchar(100) DEFAULT NULL,
  `length` decimal(10,2) DEFAULT NULL,
  `diameter` decimal(10,2) DEFAULT NULL,
  `thickness` decimal(10,2) DEFAULT NULL,
  `throughput` decimal(10,2) DEFAULT NULL,
  `start_altitude` decimal(10,2) DEFAULT NULL,
  `end_altitude` decimal(10,2) DEFAULT NULL,
  `roughness` decimal(10,4) DEFAULT NULL,
  `work_time` decimal(10,2) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pipeline_project` (`pro_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Pipeline parameters';

CREATE TABLE `t_pump_station` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `name` varchar(100) DEFAULT NULL,
  `pump_efficiency` decimal(5,2) DEFAULT NULL,
  `electric_efficiency` decimal(5,2) DEFAULT NULL,
  `displacement` decimal(10,2) DEFAULT NULL,
  `come_power` decimal(10,2) DEFAULT NULL,
  `zmi480_lift` decimal(10,2) DEFAULT NULL,
  `zmi375_lift` decimal(10,2) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Pump station master data';

CREATE TABLE `t_oil_property` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `name` varchar(50) DEFAULT NULL,
  `density` decimal(10,2) DEFAULT NULL,
  `viscosity` decimal(10,6) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Oil properties';

-- ------------------------------------------------------------
-- 2. Authentication
-- ------------------------------------------------------------
CREATE TABLE `sys_user` (
  `user_id` bigint NOT NULL AUTO_INCREMENT,
  `dept_id` bigint DEFAULT NULL,
  `user_name` varchar(30) NOT NULL,
  `nick_name` varchar(30) NOT NULL,
  `user_type` varchar(2) DEFAULT '00',
  `email` varchar(50) DEFAULT '',
  `phonenumber` varchar(11) DEFAULT '',
  `sex` char(1) DEFAULT '0',
  `avatar` varchar(100) DEFAULT '',
  `password` varchar(100) DEFAULT '',
  `status` char(1) DEFAULT '0',
  `del_flag` char(1) DEFAULT '0',
  `login_ip` varchar(128) DEFAULT '',
  `login_date` datetime DEFAULT NULL,
  `create_by` varchar(64) DEFAULT '',
  `create_time` datetime DEFAULT NULL,
  `update_by` varchar(64) DEFAULT '',
  `update_time` datetime DEFAULT NULL,
  `remark` varchar(500) DEFAULT NULL,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=100 DEFAULT CHARSET=utf8mb4 COMMENT='System users';

-- BCrypt hash for the initial password admin123.
INSERT INTO `sys_user`
(`user_id`,`dept_id`,`user_name`,`nick_name`,`user_type`,`email`,`phonenumber`,`sex`,`avatar`,`password`,`status`,`del_flag`,`login_ip`,`create_by`,`create_time`,`remark`)
VALUES
(1,103,'admin','管理员','00','admin@pipeline.com','15888888888','0','',
 '$2a$10$7JB720yubVSZvJW8KegC5.ZaL9m6WfC9UwYx4kd8BUPEqVQJqAFFu',
 '0','0','127.0.0.1','admin','2026-01-01 00:00:00','系统管理员');

-- ------------------------------------------------------------
-- 3. Calculation, sensitivity and audit tables
-- ------------------------------------------------------------
CREATE TABLE `t_calculation_history` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `pro_id` bigint NOT NULL,
  `pipeline_id` bigint NOT NULL,
  `calc_type` varchar(50) NOT NULL,
  `calc_name` varchar(100) DEFAULT NULL,
  `input_params` json NOT NULL,
  `flow_rate` decimal(12,4) DEFAULT NULL,
  `flow_velocity` decimal(12,6) DEFAULT NULL,
  `reynolds_number` decimal(20,4) DEFAULT NULL,
  `flow_regime` varchar(50) DEFAULT NULL,
  `friction_factor` decimal(12,8) DEFAULT NULL,
  `friction_loss` decimal(16,4) DEFAULT NULL,
  `hydraulic_slope` decimal(12,8) DEFAULT NULL,
  `optimal_pump480` int DEFAULT NULL,
  `optimal_pump375` int DEFAULT NULL,
  `total_head` decimal(16,4) DEFAULT NULL,
  `end_station_pressure` decimal(16,4) DEFAULT NULL,
  `energy_consumption` decimal(20,2) DEFAULT NULL,
  `annual_cost` decimal(20,2) DEFAULT NULL,
  `output_result` json DEFAULT NULL,
  `create_by` varchar(64) DEFAULT '',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `remark` varchar(500) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_calc_project` (`pro_id`),
  KEY `idx_calc_pipeline` (`pipeline_id`),
  KEY `idx_calc_type` (`calc_type`),
  KEY `idx_calc_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Calculation history';

CREATE TABLE `t_sensitivity_analysis` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `pipeline_id` bigint NOT NULL,
  `history_id` bigint DEFAULT NULL,
  `analysis_type` varchar(50) NOT NULL,
  `variable_name` varchar(50) NOT NULL,
  `base_value` decimal(20,6) NOT NULL,
  `variation_range` decimal(5,2) NOT NULL,
  `steps` int NOT NULL DEFAULT 5,
  `results` json NOT NULL,
  `conclusion` text,
  `sensitivity_index` decimal(10,4) DEFAULT NULL,
  `create_by` varchar(64) DEFAULT '',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sensitivity_pipeline` (`pipeline_id`),
  KEY `idx_sensitivity_variable` (`variable_name`),
  KEY `idx_sensitivity_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Sensitivity analysis results';

CREATE TABLE `t_operation_log` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint DEFAULT NULL,
  `user_name` varchar(64) DEFAULT '',
  `module` varchar(50) DEFAULT '',
  `operation` varchar(100) DEFAULT '',
  `method` varchar(200) DEFAULT '',
  `request_url` varchar(500) DEFAULT '',
  `request_method` varchar(10) DEFAULT '',
  `request_params` text,
  `response_result` text,
  `ip` varchar(64) DEFAULT '',
  `location` varchar(100) DEFAULT '',
  `cost_time` bigint DEFAULT 0,
  `status` tinyint DEFAULT 0,
  `error_msg` text,
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_operation_user` (`user_id`),
  KEY `idx_operation_module` (`module`),
  KEY `idx_operation_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Operation logs';

-- ------------------------------------------------------------
-- 4. Dictionaries
-- ------------------------------------------------------------
CREATE TABLE `sys_dict_type` (
  `dict_id` bigint NOT NULL AUTO_INCREMENT,
  `dict_name` varchar(100) NOT NULL,
  `dict_type` varchar(100) NOT NULL,
  `status` char(1) DEFAULT '0',
  `create_by` varchar(64) DEFAULT '',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_by` varchar(64) DEFAULT '',
  `update_time` datetime DEFAULT NULL,
  `remark` varchar(500) DEFAULT NULL,
  PRIMARY KEY (`dict_id`),
  UNIQUE KEY `uk_dict_type` (`dict_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Dictionary types';

CREATE TABLE `sys_dict_data` (
  `dict_code` bigint NOT NULL AUTO_INCREMENT,
  `dict_sort` int DEFAULT 0,
  `dict_label` varchar(100) NOT NULL,
  `dict_value` varchar(100) NOT NULL,
  `dict_type` varchar(100) NOT NULL,
  `css_class` varchar(100) DEFAULT NULL,
  `list_class` varchar(100) DEFAULT NULL,
  `is_default` char(1) DEFAULT 'N',
  `status` char(1) DEFAULT '0',
  `create_by` varchar(64) DEFAULT '',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_by` varchar(64) DEFAULT NULL,
  `update_time` datetime DEFAULT NULL,
  `remark` varchar(500) DEFAULT NULL,
  PRIMARY KEY (`dict_code`),
  KEY `idx_dict_type` (`dict_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Dictionary data';

INSERT INTO `sys_dict_type` (`dict_id`,`dict_name`,`dict_type`,`status`,`create_by`,`remark`) VALUES
(1,'计算类型','calc_type','0','admin','计算类型字典'),
(2,'流态类型','flow_regime','0','admin','管道流态字典'),
(3,'报告类型','report_type','0','admin','分析报告类型字典'),
(4,'敏感性分析变量','sensitivity_variable','0','admin','敏感性分析变量字典');

INSERT INTO `sys_dict_data` (`dict_code`,`dict_sort`,`dict_label`,`dict_value`,`dict_type`,`is_default`,`status`,`create_by`,`remark`) VALUES
(1,1,'水力分析','HYDRAULIC','calc_type','Y','0','admin','水力特性分析'),
(2,2,'泵站优化','OPTIMIZATION','calc_type','N','0','admin','运行方案优化'),
(3,1,'层流','LAMINAR','flow_regime','N','0','admin','Re < 2300'),
(4,2,'过渡流','TRANSITION','flow_regime','N','0','admin','2300 <= Re < 3000'),
(5,3,'水力光滑区','HYDRAULIC_SMOOTH','flow_regime','N','0','admin','3000 < Re < Re1'),
(6,4,'混合摩擦区','MIXED_FRICTION','flow_regime','N','0','admin','Re1 <= Re < Re2'),
(7,5,'粗糙区','ROUGH','flow_regime','Y','0','admin','Re >= Re2'),
(8,1,'水力分析报告','HYDRAULIC','report_type','Y','0','admin','水力分析报告'),
(9,2,'优化方案报告','OPTIMIZATION','report_type','N','0','admin','泵站优化方案报告'),
(10,3,'对比分析报告','COMPARISON','report_type','N','0','admin','多方案对比报告'),
(11,4,'敏感性分析报告','SENSITIVITY','report_type','N','0','admin','参数敏感性分析报告'),
(12,1,'流量','FLOW_RATE','sensitivity_variable','Y','0','admin','流量变化'),
(13,2,'黏度','VISCOSITY','sensitivity_variable','N','0','admin','运动黏度变化'),
(14,3,'粗糙度','ROUGHNESS','sensitivity_variable','N','0','admin','管道粗糙度变化'),
(15,4,'管径','DIAMETER','sensitivity_variable','N','0','admin','管道直径变化');

-- ------------------------------------------------------------
-- 5. Knowledge graph and Agent trace tables
-- ------------------------------------------------------------
CREATE TABLE `t_kg_node` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `node_id` varchar(64) NOT NULL,
  `node_type` varchar(32) NOT NULL,
  `name` varchar(128) NOT NULL,
  `description` text,
  `properties` json,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_kg_node_id` (`node_id`),
  KEY `idx_kg_node_type` (`node_type`),
  KEY `idx_kg_node_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Knowledge graph nodes';

CREATE TABLE `t_kg_edge` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `source_id` varchar(64) NOT NULL,
  `target_id` varchar(64) NOT NULL,
  `edge_type` varchar(32) NOT NULL,
  `weight` decimal(5,4) DEFAULT 1.0,
  `properties` json,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_kg_edge_source` (`source_id`),
  KEY `idx_kg_edge_target` (`target_id`),
  KEY `idx_kg_edge_type` (`edge_type`),
  CONSTRAINT `fk_kg_edge_source` FOREIGN KEY (`source_id`) REFERENCES `t_kg_node` (`node_id`),
  CONSTRAINT `fk_kg_edge_target` FOREIGN KEY (`target_id`) REFERENCES `t_kg_node` (`node_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Knowledge graph edges';

CREATE TABLE `t_agent_trace` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `trace_id` varchar(64) NOT NULL,
  `session_id` varchar(64) NOT NULL,
  `user_id` bigint DEFAULT NULL,
  `user_input` text NOT NULL,
  `final_response` text,
  `plan_json` json,
  `status` varchar(16) DEFAULT 'running',
  `total_duration_ms` int DEFAULT NULL,
  `llm_calls` int DEFAULT 0,
  `tool_calls` int DEFAULT 0,
  `total_tokens` int DEFAULT 0,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agent_trace_id` (`trace_id`),
  KEY `idx_agent_session` (`session_id`),
  KEY `idx_agent_status` (`status`),
  KEY `idx_agent_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Agent traces';

CREATE TABLE `t_agent_trace_event` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `trace_id` varchar(64) NOT NULL,
  `event_type` varchar(32) NOT NULL,
  `step_number` int DEFAULT NULL,
  `agent` varchar(32) DEFAULT NULL,
  `data` json,
  `duration_ms` int DEFAULT NULL,
  `token_count` int DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_trace_event_trace` (`trace_id`),
  KEY `idx_trace_event_type` (`event_type`),
  CONSTRAINT `fk_trace_event_trace` FOREIGN KEY (`trace_id`) REFERENCES `t_agent_trace` (`trace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Agent trace events';

CREATE TABLE `t_hitl_record` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `request_id` varchar(64) NOT NULL,
  `trace_id` varchar(64) NOT NULL,
  `session_id` varchar(64) NOT NULL,
  `hitl_type` varchar(32) NOT NULL,
  `request_data` json NOT NULL,
  `response_data` json,
  `status` varchar(16) DEFAULT 'pending',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `response_time` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_hitl_request_id` (`request_id`),
  KEY `idx_hitl_trace` (`trace_id`),
  KEY `idx_hitl_session` (`session_id`),
  KEY `idx_hitl_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Human-in-the-loop records';

-- ------------------------------------------------------------
-- 6. Knowledge base metadata
-- ------------------------------------------------------------
CREATE TABLE `t_kb_document` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `title` varchar(200) NOT NULL,
  `category` varchar(50) NOT NULL,
  `source_type` varchar(50) DEFAULT NULL,
  `tags` varchar(500) DEFAULT NULL,
  `remark` varchar(1000) DEFAULT NULL,
  `author` varchar(100) DEFAULT NULL,
  `summary` varchar(1000) DEFAULT NULL,
  `language` varchar(20) DEFAULT 'zh-CN',
  `version` varchar(50) DEFAULT NULL,
  `external_id` varchar(100) DEFAULT NULL,
  `effective_at` datetime DEFAULT NULL,
  `file_name` varchar(255) NOT NULL,
  `file_extension` varchar(20) DEFAULT NULL,
  `file_size` bigint DEFAULT 0,
  `file_hash` varchar(64) NOT NULL,
  `storage_type` varchar(32) NOT NULL DEFAULT 'MINIO',
  `storage_bucket` varchar(128) NOT NULL,
  `storage_object_key` varchar(500) NOT NULL,
  `agent_doc_id` varchar(64) DEFAULT NULL,
  `chunk_count` int DEFAULT 0,
  `retry_count` int DEFAULT 0,
  `status` varchar(32) NOT NULL DEFAULT 'UPLOADED',
  `ingest_stage` varchar(32) NOT NULL DEFAULT 'QUEUED',
  `progress_percent` int NOT NULL DEFAULT 0,
  `failure_reason` varchar(1000) DEFAULT NULL,
  `last_ingest_time` datetime DEFAULT NULL,
  `create_by` varchar(64) DEFAULT '',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_kb_file_hash` (`file_hash`),
  KEY `idx_kb_category` (`category`),
  KEY `idx_kb_status` (`status`),
  KEY `idx_kb_agent_doc` (`agent_doc_id`),
  KEY `idx_kb_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Knowledge document metadata';

CREATE TABLE `t_kb_ingest_task` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `document_id` bigint NOT NULL,
  `task_type` varchar(32) NOT NULL,
  `attempt_no` int NOT NULL DEFAULT 1,
  `status` varchar(32) NOT NULL DEFAULT 'PENDING',
  `ingest_stage` varchar(32) NOT NULL DEFAULT 'QUEUED',
  `progress_percent` int NOT NULL DEFAULT 0,
  `agent_doc_id` varchar(64) DEFAULT NULL,
  `chunk_count` int DEFAULT 0,
  `failure_reason` varchar(1000) DEFAULT NULL,
  `create_by` varchar(64) DEFAULT '',
  `started_at` datetime DEFAULT NULL,
  `finished_at` datetime DEFAULT NULL,
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ingest_document` (`document_id`),
  KEY `idx_ingest_status` (`status`),
  KEY `idx_ingest_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Knowledge ingestion tasks';

-- ------------------------------------------------------------
-- 7. Current master data used by the project demo
-- ------------------------------------------------------------
INSERT INTO `t_project` (`pro_id`,`number`,`name`,`responsible`,`build_date`,`create_time`,`update_time`,`is_deleted`) VALUES
(1,'GD-2024-001','西部成品油管道项目1','李伟','2024-01-02 08:00:00','2026-03-09 18:07:07','2026-03-09 18:07:07',0),
(2,'GD-2024-002','南部天然气管道项目2','王磊','2024-01-03 08:00:00','2026-03-09 18:07:07','2026-03-09 18:07:07',0),
(3,'GD-2024-003','北部输油管道项目3','刘洋','2024-01-04 08:00:00','2026-03-09 18:07:07','2026-09-30 22:31:27',0),
(4,'GD-2024-004','中部原油管道项目4','陈杰','2024-01-05 08:00:00','2026-03-09 18:07:07','2026-03-09 18:07:07',0),
(5,'GD-2024-005','东部成品油管道项目5','赵峰','2024-01-06 08:00:00','2026-03-09 18:07:07','2026-03-09 18:07:07',0),
(6,'GD-2024-006','西部天然气管道项目6','孙浩','2024-01-07 08:00:00','2026-03-09 18:07:07','2026-03-09 18:07:07',0),
(7,'GD-2024-007','南部输油管道项目7','周凯','2024-01-08 08:00:00','2026-03-09 18:07:07','2026-03-09 18:07:07',0),
(8,'GD-2024-008','北部原油管道项目8','张明','2024-01-09 08:00:00','2026-03-09 18:07:07','2026-03-09 18:07:07',0),
(9,'GD-2024-009','中部成品油管道项目9','李伟','2024-01-10 08:00:00','2026-03-09 18:07:07','2026-03-09 18:07:07',0),
(10,'GD-2024-010','东部天然气管道项目10','王磊','2024-01-11 08:00:00','2026-03-09 18:07:07','2026-03-09 18:07:07',0);

INSERT INTO `t_pipeline` (`id`,`pro_id`,`name`,`length`,`diameter`,`thickness`,`throughput`,`start_altitude`,`end_altitude`,`roughness`,`work_time`,`create_time`,`update_time`) VALUES
(1,1,'西部原油主管道',1200.50,813.00,12.70,5200.00,1050.00,860.00,0.0150,24.00,'2026-03-09 17:42:07','2026-03-09 17:42:07'),
(10,9,'西部输油管道9',66.20,426.00,14.00,102.50,107.20,96.30,0.0190,NULL,'2026-03-09 18:43:49','2026-03-09 18:43:49'),
(15,8,'东部天然气管道8',64.40,325.00,12.00,100.00,106.40,95.60,0.0180,NULL,'2026-03-09 18:43:49','2026-03-09 18:43:49'),
(2,2,'东部成品油输送管道',860.30,610.00,10.50,3100.00,520.00,430.00,0.0150,24.00,'2026-03-09 17:42:07','2026-03-09 17:42:07'),
(20,7,'平原成品油管道7',62.60,273.00,10.00,97.50,105.60,94.90,0.0170,NULL,'2026-03-09 18:43:49','2026-03-09 18:43:49');

INSERT INTO `t_pump_station` (`id`,`name`,`pump_efficiency`,`electric_efficiency`,`displacement`,`come_power`,`zmi480_lift`,`zmi375_lift`,`create_time`,`update_time`) VALUES
(1,'西部1号泵站',88.50,94.20,5200.00,8.60,480.00,375.00,'2026-03-09 17:46:55','2026-03-09 17:46:55'),
(2,'西部2号泵站',87.80,93.60,5000.00,8.20,470.00,365.00,'2026-03-09 17:46:55','2026-03-09 17:46:55'),
(3,'东部1号泵站',89.10,94.80,3100.00,6.40,430.00,340.00,'2026-03-09 17:46:55','2026-03-09 17:46:55'),
(5,'南部泵站10',78.00,86.00,235.00,3.00,112.00,90.00,'2026-03-09 18:44:23','2026-03-09 18:44:23'),
(6,'山区泵站110',78.00,83.00,585.00,4.50,232.00,190.00,'2026-03-09 18:44:23','2026-03-09 18:44:23');

INSERT INTO `t_oil_property` (`id`,`name`,`density`,`viscosity`,`create_time`,`update_time`) VALUES
(1,'0#柴油',835.00,3.500000,'2026-03-09 17:48:52','2026-03-09 17:48:52'),
(2,'92#汽油',725.00,0.800000,'2026-03-09 17:48:52','2026-03-09 17:48:52'),
(3,'原油A',890.00,12.600000,'2026-03-09 17:48:52','2026-03-09 17:48:52');

-- Keep project timestamps valid when data is inserted by the API.
DELIMITER $$
CREATE TRIGGER `trg_t_project_fill_timestamps_before_insert`
BEFORE INSERT ON `t_project`
FOR EACH ROW
BEGIN
  IF NEW.`create_time` IS NULL THEN SET NEW.`create_time` = NOW(); END IF;
  IF NEW.`update_time` IS NULL THEN SET NEW.`update_time` = NEW.`create_time`; END IF;
END$$

CREATE TRIGGER `trg_t_project_fill_timestamps_before_update`
BEFORE UPDATE ON `t_project`
FOR EACH ROW
BEGIN
  IF NEW.`create_time` IS NULL THEN SET NEW.`create_time` = OLD.`create_time`; END IF;
  SET NEW.`update_time` = NOW();
END$$
DELIMITER ;

SET FOREIGN_KEY_CHECKS = 1;

SELECT 'pipeline_cloud schema and seed data initialized successfully' AS message;
