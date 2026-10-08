/*
 * v1.5.3 升级脚本
 * 删除报告中心遗留表结构
 */

USE `pipeline_cloud`;

SET NAMES utf8mb4;

DROP TABLE IF EXISTS `t_analysis_report`;
