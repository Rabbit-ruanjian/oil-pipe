/*
 * 绠￠亾鑳借€楀垎鏋愮郴缁?- 鏁版嵁搴撳崌绾ц剼鏈? * 鐗堟湰: v1.1.0
 * 鏃ユ湡: 2025-12-28
 * 璇存槑: 鏂板璁＄畻鍘嗗彶銆佸垎鏋愭姤鍛娿€佹晱鎰熸€у垎鏋愩€佹搷浣滄棩蹇楃瓑琛? */

USE `pipeline_cloud`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- 6. 璁＄畻鍘嗗彶璁板綍琛?(t_calculation_history)
-- 鐢ㄩ€? 淇濆瓨姘村姏鍒嗘瀽鍜屼紭鍖栬绠楃殑鍘嗗彶璁板綍锛屾敮鎸佸姣斿垎鏋?-- ============================================================
DROP TABLE IF EXISTS `t_calculation_history`;
CREATE TABLE `t_calculation_history` (
    `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '涓婚敭ID',
    `pro_id` bigint(20) NOT NULL COMMENT '椤圭洰ID',
    `pipeline_id` bigint(20) NOT NULL COMMENT '绠￠亾ID',
    `calc_type` varchar(50) NOT NULL COMMENT '璁＄畻绫诲瀷: HYDRAULIC-姘村姏鍒嗘瀽, OPTIMIZATION-娉电珯浼樺寲',
    `calc_name` varchar(100) DEFAULT NULL COMMENT '璁＄畻鍚嶇О/澶囨敞',

    -- 杈撳叆鍙傛暟(JSON鏍煎紡瀛樺偍瀹屾暣鍙傛暟)
    `input_params` json NOT NULL COMMENT '杈撳叆鍙傛暟JSON',

    -- 鏍稿績璁＄畻缁撴灉
    `flow_rate` decimal(12, 4) DEFAULT NULL COMMENT '娴侀噺(m鲁/h)',
    `flow_velocity` decimal(12, 6) DEFAULT NULL COMMENT '娴侀€?m/s)',
    `reynolds_number` decimal(20, 4) DEFAULT NULL COMMENT '闆疯鏁?,
    `flow_regime` varchar(50) DEFAULT NULL COMMENT '娴佹€? LAMINAR-灞傛祦, TRANSITION-杩囨浮, HYDRAULIC_SMOOTH-姘村姏鍏夋粦, MIXED_FRICTION-娣峰悎鎽╂摝, ROUGH-绮楃硻',
    `friction_factor` decimal(12, 8) DEFAULT NULL COMMENT '鎽╅樆绯绘暟',
    `friction_loss` decimal(16, 4) DEFAULT NULL COMMENT '娌跨▼鎽╅樆鎹熷け(m)',
    `hydraulic_slope` decimal(12, 8) DEFAULT NULL COMMENT '姘村姏鍧￠檷',

    -- 浼樺寲缁撴灉(浠匫PTIMIZATION绫诲瀷)
    `optimal_pump480` int(11) DEFAULT NULL COMMENT '鏈€浼樻柟妗?ZMI480娉垫暟閲?,
    `optimal_pump375` int(11) DEFAULT NULL COMMENT '鏈€浼樻柟妗?ZMI375娉垫暟閲?,
    `total_head` decimal(16, 4) DEFAULT NULL COMMENT '鎬绘壃绋?m)',
    `end_station_pressure` decimal(16, 4) DEFAULT NULL COMMENT '鏈珯杩涚珯鍘嬪姏(m)',
    `energy_consumption` decimal(20, 2) DEFAULT NULL COMMENT '骞磋兘鑰?kWh)',
    `annual_cost` decimal(20, 2) DEFAULT NULL COMMENT '骞磋繍琛岃垂鐢?鍏?',

    -- 瀹屾暣缁撴灉(JSON鏍煎紡)
    `output_result` json DEFAULT NULL COMMENT '瀹屾暣杈撳嚭缁撴灉JSON',

    -- 瀹¤瀛楁
    `create_by` varchar(64) DEFAULT '' COMMENT '鍒涘缓浜?,
    `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '鍒涘缓鏃堕棿',
    `remark` varchar(500) DEFAULT NULL COMMENT '澶囨敞',

    PRIMARY KEY (`id`),
    KEY `idx_pro_id` (`pro_id`),
    KEY `idx_pipeline_id` (`pipeline_id`),
    KEY `idx_calc_type` (`calc_type`),
    KEY `idx_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='璁＄畻鍘嗗彶璁板綍琛?;


-- ============================================================
-- 8. 鏁忔劅鎬у垎鏋愮粨鏋滆〃 (t_sensitivity_analysis)
-- 鐢ㄩ€? 瀛樺偍鍙傛暟鏁忔劅鎬у垎鏋愮粨鏋?-- ============================================================
DROP TABLE IF EXISTS `t_sensitivity_analysis`;
CREATE TABLE `t_sensitivity_analysis` (
    `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '涓婚敭ID',
    `pipeline_id` bigint(20) NOT NULL COMMENT '绠￠亾ID',
    `history_id` bigint(20) DEFAULT NULL COMMENT '鍩哄噯璁＄畻鍘嗗彶ID',

    -- 鍒嗘瀽閰嶇疆
    `analysis_type` varchar(50) NOT NULL COMMENT '鍒嗘瀽绫诲瀷: SINGLE-鍗曞洜绱? CROSS-浜ゅ弶鍒嗘瀽',
    `variable_name` varchar(50) NOT NULL COMMENT '鍒嗘瀽鍙橀噺: FLOW_RATE-娴侀噺, VISCOSITY-绮樺害, ROUGHNESS-绮楃硻搴? DIAMETER-绠″緞',
    `base_value` decimal(20, 6) NOT NULL COMMENT '鍩哄噯鍊?,
    `variation_range` decimal(5, 2) NOT NULL COMMENT '鍙樺寲鑼冨洿(卤鐧惧垎姣?',
    `steps` int(11) NOT NULL DEFAULT 5 COMMENT '鍒嗘瀽姝ユ暟',

    -- 鍒嗘瀽缁撴灉
    `results` json NOT NULL COMMENT '鍒嗘瀽缁撴灉JSON鏁扮粍',
    `conclusion` text DEFAULT NULL COMMENT '鍒嗘瀽缁撹',
    `sensitivity_index` decimal(10, 4) DEFAULT NULL COMMENT '鏁忔劅鎬ф寚鏁?,

    -- 瀹¤瀛楁
    `create_by` varchar(64) DEFAULT '' COMMENT '鍒涘缓浜?,
    `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '鍒涘缓鏃堕棿',

    PRIMARY KEY (`id`),
    KEY `idx_pipeline_id` (`pipeline_id`),
    KEY `idx_variable_name` (`variable_name`),
    KEY `idx_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='鏁忔劅鎬у垎鏋愮粨鏋滆〃';


-- ============================================================
-- 9. 鎿嶄綔鏃ュ織琛?(t_operation_log)
-- 鐢ㄩ€? 璁板綍鐢ㄦ埛鎿嶄綔鏃ュ織锛岀敤浜庡璁″拰闂鎺掓煡
-- ============================================================
DROP TABLE IF EXISTS `t_operation_log`;
CREATE TABLE `t_operation_log` (
    `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '涓婚敭ID',

    -- 鐢ㄦ埛淇℃伅
    `user_id` bigint(20) DEFAULT NULL COMMENT '鐢ㄦ埛ID',
    `user_name` varchar(64) DEFAULT '' COMMENT '鐢ㄦ埛鍚?,

    -- 鎿嶄綔淇℃伅
    `module` varchar(50) DEFAULT '' COMMENT '妯″潡鍚嶇О',
    `operation` varchar(100) DEFAULT '' COMMENT '鎿嶄綔鎻忚堪',
    `method` varchar(200) DEFAULT '' COMMENT '璇锋眰鏂规硶',
    `request_url` varchar(500) DEFAULT '' COMMENT '璇锋眰URL',
    `request_method` varchar(10) DEFAULT '' COMMENT 'HTTP鏂规硶',
    `request_params` text DEFAULT NULL COMMENT '璇锋眰鍙傛暟',
    `response_result` text DEFAULT NULL COMMENT '鍝嶅簲缁撴灉',

    -- 鎵ц淇℃伅
    `ip` varchar(64) DEFAULT '' COMMENT 'IP鍦板潃',
    `location` varchar(100) DEFAULT '' COMMENT '鎿嶄綔鍦扮偣',
    `cost_time` bigint(20) DEFAULT 0 COMMENT '鑰楁椂(ms)',
    `status` tinyint(4) DEFAULT 0 COMMENT '鐘舵€? 0-鎴愬姛, 1-澶辫触',
    `error_msg` text DEFAULT NULL COMMENT '閿欒淇℃伅',

    -- 鏃堕棿
    `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '鍒涘缓鏃堕棿',

    PRIMARY KEY (`id`),
    KEY `idx_user_id` (`user_id`),
    KEY `idx_module` (`module`),
    KEY `idx_status` (`status`),
    KEY `idx_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='鎿嶄綔鏃ュ織琛?;


-- ============================================================
-- 10. 鏁版嵁瀛楀吀琛?(sys_dict_type)
-- 鐢ㄩ€? 绯荤粺鏁版嵁瀛楀吀绫诲瀷
-- ============================================================
DROP TABLE IF EXISTS `sys_dict_type`;
CREATE TABLE `sys_dict_type` (
    `dict_id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '瀛楀吀涓婚敭',
    `dict_name` varchar(100) NOT NULL COMMENT '瀛楀吀鍚嶇О',
    `dict_type` varchar(100) NOT NULL COMMENT '瀛楀吀绫诲瀷',
    `status` char(1) DEFAULT '0' COMMENT '鐘舵€侊紙0姝ｅ父 1鍋滅敤锛?,
    `create_by` varchar(64) DEFAULT '' COMMENT '鍒涘缓鑰?,
    `create_time` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '鍒涘缓鏃堕棿',
    `update_by` varchar(64) DEFAULT '' COMMENT '鏇存柊鑰?,
    `update_time` datetime DEFAULT NULL COMMENT '鏇存柊鏃堕棿',
    `remark` varchar(500) DEFAULT NULL COMMENT '澶囨敞',
    PRIMARY KEY (`dict_id`),
    UNIQUE KEY `uk_dict_type` (`dict_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='瀛楀吀绫诲瀷琛?;


-- ============================================================
-- 11. 鏁版嵁瀛楀吀鏁版嵁琛?(sys_dict_data)
-- 鐢ㄩ€? 绯荤粺鏁版嵁瀛楀吀鏁版嵁
-- ============================================================
DROP TABLE IF EXISTS `sys_dict_data`;
CREATE TABLE `sys_dict_data` (
    `dict_code` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '瀛楀吀缂栫爜',
    `dict_sort` int(4) DEFAULT 0 COMMENT '瀛楀吀鎺掑簭',
    `dict_label` varchar(100) NOT NULL COMMENT '瀛楀吀鏍囩',
    `dict_value` varchar(100) NOT NULL COMMENT '瀛楀吀閿€?,
    `dict_type` varchar(100) NOT NULL COMMENT '瀛楀吀绫诲瀷',
    `css_class` varchar(100) DEFAULT NULL COMMENT '鏍峰紡灞炴€?,
    `list_class` varchar(100) DEFAULT NULL COMMENT '琛ㄦ牸鍥炴樉鏍峰紡',
    `is_default` char(1) DEFAULT 'N' COMMENT '鏄惁榛樿锛圷鏄?N鍚︼級',
    `status` char(1) DEFAULT '0' COMMENT '鐘舵€侊紙0姝ｅ父 1鍋滅敤锛?,
    `create_by` varchar(64) DEFAULT '' COMMENT '鍒涘缓鑰?,
    `create_time` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '鍒涘缓鏃堕棿',
    `update_by` varchar(64) DEFAULT '' COMMENT '鏇存柊鑰?,
    `update_time` datetime DEFAULT NULL COMMENT '鏇存柊鏃堕棿',
    `remark` varchar(500) DEFAULT NULL COMMENT '澶囨敞',
    PRIMARY KEY (`dict_code`),
    KEY `idx_dict_type` (`dict_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='瀛楀吀鏁版嵁琛?;


-- ============================================================
-- 鍒濆鍖栨暟鎹瓧鍏?-- ============================================================

-- 璁＄畻绫诲瀷瀛楀吀
INSERT INTO `sys_dict_type` (`dict_name`, `dict_type`, `status`, `create_by`, `remark`) VALUES
('璁＄畻绫诲瀷', 'calc_type', '0', 'admin', '璁＄畻绫诲瀷瀛楀吀');

INSERT INTO `sys_dict_data` (`dict_sort`, `dict_label`, `dict_value`, `dict_type`, `is_default`, `status`, `create_by`, `remark`) VALUES
(1, '姘村姏鍒嗘瀽', 'HYDRAULIC', 'calc_type', 'Y', '0', 'admin', '姘村姏鐗规€у垎鏋?),
(2, '娉电珯浼樺寲', 'OPTIMIZATION', 'calc_type', 'N', '0', 'admin', '杩愯鏂规浼樺寲');

-- 娴佹€佺被鍨嬪瓧鍏?INSERT INTO `sys_dict_type` (`dict_name`, `dict_type`, `status`, `create_by`, `remark`) VALUES
('娴佹€佺被鍨?, 'flow_regime', '0', 'admin', '娴佷綋娴佸姩鐘舵€?);

INSERT INTO `sys_dict_data` (`dict_sort`, `dict_label`, `dict_value`, `dict_type`, `is_default`, `status`, `create_by`, `remark`) VALUES
(1, '灞傛祦', 'LAMINAR', 'flow_regime', 'N', '0', 'admin', 'Re < 2300'),
(2, '杩囨浮娴?, 'TRANSITION', 'flow_regime', 'N', '0', 'admin', '2300 鈮?Re < 3000'),
(3, '姘村姏鍏夋粦鍖?, 'HYDRAULIC_SMOOTH', 'flow_regime', 'N', '0', 'admin', '3000 < Re < Re1'),
(4, '娣峰悎鎽╂摝鍖?, 'MIXED_FRICTION', 'flow_regime', 'N', '0', 'admin', 'Re1 鈮?Re < Re2'),
(5, '绮楃硻鍖?, 'ROUGH', 'flow_regime', 'Y', '0', 'admin', 'Re 鈮?Re2');

-- 鎶ュ憡绫诲瀷瀛楀吀
INSERT INTO `sys_dict_type` (`dict_name`, `dict_type`, `status`, `create_by`, `remark`) VALUES
('鎶ュ憡绫诲瀷', 'report_type', '0', 'admin', '鍒嗘瀽鎶ュ憡绫诲瀷');

INSERT INTO `sys_dict_data` (`dict_sort`, `dict_label`, `dict_value`, `dict_type`, `is_default`, `status`, `create_by`, `remark`) VALUES
(1, '姘村姏鍒嗘瀽鎶ュ憡', 'HYDRAULIC', 'report_type', 'Y', '0', 'admin', '姘村姏鍒嗘瀽鎶ュ憡'),
(2, '浼樺寲鏂规鎶ュ憡', 'OPTIMIZATION', 'report_type', 'N', '0', 'admin', '娉电珯浼樺寲鏂规鎶ュ憡'),
(3, '瀵规瘮鍒嗘瀽鎶ュ憡', 'COMPARISON', 'report_type', 'N', '0', 'admin', '澶氭柟妗堝姣旀姤鍛?),
(4, '鏁忔劅鎬у垎鏋愭姤鍛?, 'SENSITIVITY', 'report_type', 'N', '0', 'admin', '鍙傛暟鏁忔劅鎬у垎鏋愭姤鍛?);

-- 鏁忔劅鎬у垎鏋愬彉閲忓瓧鍏?INSERT INTO `sys_dict_type` (`dict_name`, `dict_type`, `status`, `create_by`, `remark`) VALUES
('鏁忔劅鎬у垎鏋愬彉閲?, 'sensitivity_variable', '0', 'admin', '鏁忔劅鎬у垎鏋愬彉閲?);

INSERT INTO `sys_dict_data` (`dict_sort`, `dict_label`, `dict_value`, `dict_type`, `is_default`, `status`, `create_by`, `remark`) VALUES
(1, '娴侀噺', 'FLOW_RATE', 'sensitivity_variable', 'Y', '0', 'admin', '娴侀噺鍙樺寲'),
(2, '绮樺害', 'VISCOSITY', 'sensitivity_variable', 'N', '0', 'admin', '杩愬姩绮樺害鍙樺寲'),
(3, '绮楃硻搴?, 'ROUGHNESS', 'sensitivity_variable', 'N', '0', 'admin', '绠￠亾绮楃硻搴﹀彉鍖?),
(4, '绠″緞', 'DIAMETER', 'sensitivity_variable', 'N', '0', 'admin', '绠￠亾鐩村緞鍙樺寲');


SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- 鍗囩骇瀹屾垚鎻愮ず
-- ============================================================
SELECT '鏁版嵁搴撳崌绾ц嚦 v1.1.0 瀹屾垚!' AS message;

