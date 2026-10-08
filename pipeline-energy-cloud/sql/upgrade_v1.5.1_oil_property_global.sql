USE `pipeline_cloud`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

SET @oil_property_index_drop_sql = IF(
    EXISTS (
        SELECT 1
        FROM information_schema.statistics
        WHERE table_schema = 'pipeline_cloud'
          AND table_name = 't_oil_property'
          AND index_name = 'idx_pro_id'
    ),
    'ALTER TABLE `t_oil_property` DROP INDEX `idx_pro_id`',
    'SELECT ''idx_pro_id on t_oil_property does not exist'''
);
PREPARE oil_property_index_drop_stmt FROM @oil_property_index_drop_sql;
EXECUTE oil_property_index_drop_stmt;
DEALLOCATE PREPARE oil_property_index_drop_stmt;

SET @oil_property_column_drop_sql = IF(
    EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'pipeline_cloud'
          AND table_name = 't_oil_property'
          AND column_name = 'pro_id'
    ),
    'ALTER TABLE `t_oil_property` DROP COLUMN `pro_id`',
    'SELECT ''pro_id on t_oil_property does not exist'''
);
PREPARE oil_property_column_drop_stmt FROM @oil_property_column_drop_sql;
EXECUTE oil_property_column_drop_stmt;
DEALLOCATE PREPARE oil_property_column_drop_stmt;

SET FOREIGN_KEY_CHECKS = 1;

SELECT 'oil property global master data upgrade complete' AS message;
