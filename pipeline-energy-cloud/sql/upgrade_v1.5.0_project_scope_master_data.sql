USE `pipeline_cloud`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

SET @pump_station_index_sql = IF(
    EXISTS (
        SELECT 1
        FROM information_schema.statistics
        WHERE table_schema = 'pipeline_cloud'
          AND table_name = 't_pump_station'
          AND index_name = 'idx_pro_id'
    ),
    'ALTER TABLE `t_pump_station` DROP INDEX `idx_pro_id`',
    'SELECT ''idx_pro_id on t_pump_station already removed'''
);
PREPARE pump_station_index_stmt FROM @pump_station_index_sql;
EXECUTE pump_station_index_stmt;
DEALLOCATE PREPARE pump_station_index_stmt;

SET @pump_station_column_sql = IF(
    EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'pipeline_cloud'
          AND table_name = 't_pump_station'
          AND column_name = 'pro_id'
    ),
    'ALTER TABLE `t_pump_station` DROP COLUMN `pro_id`',
    'SELECT ''pro_id on t_pump_station already removed'''
);
PREPARE pump_station_column_stmt FROM @pump_station_column_sql;
EXECUTE pump_station_column_stmt;
DEALLOCATE PREPARE pump_station_column_stmt;

SET FOREIGN_KEY_CHECKS = 1;

SELECT 'pump station shared resource upgrade complete' AS message;
