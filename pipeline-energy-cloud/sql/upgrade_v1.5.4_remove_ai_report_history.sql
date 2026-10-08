-- 清理误归档到计算历史表中的智能报告记录
DELETE FROM `t_calculation_history`
WHERE `calc_type` = 'AI_REPORT';
