USE `pipeline_cloud`;

SET NAMES utf8mb4;

SET @backfill_now = NOW();

UPDATE `t_project`
SET `create_time` = COALESCE(`create_time`, `update_time`, `build_date`, @backfill_now),
    `update_time` = COALESCE(`update_time`, `create_time`, `build_date`, @backfill_now)
WHERE `create_time` IS NULL
   OR `update_time` IS NULL;

DROP TRIGGER IF EXISTS `trg_t_project_fill_timestamps_before_insert`;
DROP TRIGGER IF EXISTS `trg_t_project_fill_timestamps_before_update`;

DELIMITER $$

CREATE TRIGGER `trg_t_project_fill_timestamps_before_insert`
BEFORE INSERT ON `t_project`
FOR EACH ROW
BEGIN
    IF NEW.`create_time` IS NULL THEN
        SET NEW.`create_time` = NOW();
    END IF;

    IF NEW.`update_time` IS NULL THEN
        SET NEW.`update_time` = NEW.`create_time`;
    END IF;
END$$

CREATE TRIGGER `trg_t_project_fill_timestamps_before_update`
BEFORE UPDATE ON `t_project`
FOR EACH ROW
BEGIN
    IF NEW.`create_time` IS NULL THEN
        SET NEW.`create_time` = OLD.`create_time`;
    END IF;

    SET NEW.`update_time` = NOW();
END$$

DELIMITER ;

SELECT 'project timestamp repair complete' AS message;
