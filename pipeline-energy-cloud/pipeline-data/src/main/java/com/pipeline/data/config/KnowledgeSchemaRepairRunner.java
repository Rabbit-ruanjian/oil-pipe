package com.pipeline.data.config;

import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import javax.sql.DataSource;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component
@Order(0)
@RequiredArgsConstructor
public class KnowledgeSchemaRepairRunner implements ApplicationRunner {

    private static final String DOCUMENT_TABLE = "t_kb_document";
    private static final String TASK_TABLE = "t_kb_ingest_task";

    private static final String CREATE_DOCUMENT_TABLE_SQL = """
            CREATE TABLE `t_kb_document` (
                `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
                `title` varchar(200) NOT NULL COMMENT 'Document title',
                `category` varchar(50) NOT NULL COMMENT 'Knowledge category',
                `source_type` varchar(50) DEFAULT NULL COMMENT 'Source type',
                `tags` varchar(500) DEFAULT NULL COMMENT 'Comma separated tags',
                `remark` varchar(1000) DEFAULT NULL COMMENT 'Remark',
                `author` varchar(100) DEFAULT NULL COMMENT 'Author',
                `summary` varchar(1000) DEFAULT NULL COMMENT 'Summary',
                `language` varchar(20) DEFAULT 'zh-CN' COMMENT 'Language',
                `version` varchar(50) DEFAULT NULL COMMENT 'Version',
                `external_id` varchar(100) DEFAULT NULL COMMENT 'External id',
                `effective_at` datetime DEFAULT NULL COMMENT 'Effective time',
                `file_name` varchar(255) NOT NULL COMMENT 'Original file name',
                `file_extension` varchar(20) DEFAULT NULL COMMENT 'File extension',
                `file_size` bigint(20) DEFAULT 0 COMMENT 'File size in bytes',
                `file_hash` varchar(64) NOT NULL COMMENT 'File hash',
                `storage_type` varchar(32) NOT NULL DEFAULT 'MINIO' COMMENT 'Storage type',
                `storage_bucket` varchar(128) NOT NULL COMMENT 'Storage bucket',
                `storage_object_key` varchar(500) NOT NULL COMMENT 'Storage object key',
                `agent_doc_id` varchar(64) DEFAULT NULL COMMENT 'Agent document id',
                `chunk_count` int(11) DEFAULT 0 COMMENT 'Chunk count',
                `retry_count` int(11) DEFAULT 0 COMMENT 'Retry count',
                `status` varchar(32) NOT NULL DEFAULT 'UPLOADED' COMMENT 'Document status',
                `ingest_stage` varchar(32) NOT NULL DEFAULT 'QUEUED' COMMENT 'Ingest stage',
                `progress_percent` int(11) NOT NULL DEFAULT 0 COMMENT 'Progress percent',
                `failure_reason` varchar(1000) DEFAULT NULL COMMENT 'Failure reason',
                `last_ingest_time` datetime DEFAULT NULL COMMENT 'Last ingest time',
                `create_by` varchar(64) DEFAULT '' COMMENT 'Created by',
                `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Create time',
                `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Update time',
                `is_deleted` tinyint(1) DEFAULT 0 COMMENT 'Logic delete flag',
                PRIMARY KEY (`id`),
                UNIQUE KEY `uk_file_hash` (`file_hash`),
                KEY `idx_category` (`category`),
                KEY `idx_status` (`status`),
                KEY `idx_agent_doc_id` (`agent_doc_id`),
                KEY `idx_create_time` (`create_time`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Knowledge document metadata'
            """;

    private static final String CREATE_TASK_TABLE_SQL = """
            CREATE TABLE `t_kb_ingest_task` (
                `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
                `document_id` bigint(20) NOT NULL COMMENT 'Knowledge document id',
                `task_type` varchar(32) NOT NULL COMMENT 'Task type',
                `attempt_no` int(11) NOT NULL DEFAULT 1 COMMENT 'Attempt number',
                `status` varchar(32) NOT NULL DEFAULT 'PENDING' COMMENT 'Task status',
                `ingest_stage` varchar(32) NOT NULL DEFAULT 'QUEUED' COMMENT 'Ingest stage',
                `progress_percent` int(11) NOT NULL DEFAULT 0 COMMENT 'Progress percent',
                `agent_doc_id` varchar(64) DEFAULT NULL COMMENT 'Agent document id',
                `chunk_count` int(11) DEFAULT 0 COMMENT 'Chunk count',
                `failure_reason` varchar(1000) DEFAULT NULL COMMENT 'Failure reason',
                `create_by` varchar(64) DEFAULT '' COMMENT 'Created by',
                `started_at` datetime DEFAULT NULL COMMENT 'Started at',
                `finished_at` datetime DEFAULT NULL COMMENT 'Finished at',
                `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Create time',
                `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Update time',
                PRIMARY KEY (`id`),
                KEY `idx_document_id` (`document_id`),
                KEY `idx_task_status` (`status`),
                KEY `idx_task_create_time` (`create_time`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Knowledge ingest task'
            """;

    private static final Map<String, String> DOCUMENT_PATCH_COLUMNS = createDocumentPatchColumns();
    private static final Map<String, String> TASK_PATCH_COLUMNS = createTaskPatchColumns();
    private static final Map<String, String> DOCUMENT_INDEXES = createDocumentIndexes();
    private static final Map<String, String> TASK_INDEXES = createTaskIndexes();

    private final DataSource dataSource;

    @Override
    public void run(ApplicationArguments args) throws Exception {
        try (Connection connection = dataSource.getConnection()) {
            ensureKnowledgeDocumentSchema(connection);
            ensureKnowledgeTaskSchema(connection);
            log.info("Knowledge schema repair check completed");
        }
    }

    private void ensureKnowledgeDocumentSchema(Connection connection) throws SQLException {
        ensureTable(connection, DOCUMENT_TABLE, CREATE_DOCUMENT_TABLE_SQL);
        ensureColumns(connection, DOCUMENT_TABLE, DOCUMENT_PATCH_COLUMNS);
        repairLegacyDocumentRows(connection);
        ensureIndexes(connection, DOCUMENT_TABLE, DOCUMENT_INDEXES);
    }

    private void ensureKnowledgeTaskSchema(Connection connection) throws SQLException {
        ensureTable(connection, TASK_TABLE, CREATE_TASK_TABLE_SQL);
        ensureColumns(connection, TASK_TABLE, TASK_PATCH_COLUMNS);
        repairLegacyTaskRows(connection);
        ensureIndexes(connection, TASK_TABLE, TASK_INDEXES);
    }

    private void ensureTable(Connection connection, String tableName, String createTableSql) throws SQLException {
        if (tableExists(connection, tableName)) {
            return;
        }
        execute(connection, createTableSql);
        log.warn("Created missing knowledge table: {}", tableName);
    }

    private void ensureColumns(Connection connection, String tableName, Map<String, String> columns) throws SQLException {
        Set<String> existingColumns = getColumns(connection, tableName);
        for (Map.Entry<String, String> entry : columns.entrySet()) {
            if (existingColumns.contains(normalize(entry.getKey()))) {
                continue;
            }
            execute(connection, "ALTER TABLE `" + tableName + "` ADD COLUMN `" + entry.getKey() + "` " + entry.getValue());
            log.warn("Added missing column {}.{} ", tableName, entry.getKey());
        }
    }

    private void ensureIndexes(Connection connection, String tableName, Map<String, String> indexes) throws SQLException {
        Set<String> existingIndexes = getIndexes(connection, tableName);
        for (Map.Entry<String, String> entry : indexes.entrySet()) {
            if (existingIndexes.contains(normalize(entry.getKey()))) {
                continue;
            }
            execute(connection, entry.getValue());
            log.warn("Added missing index {} on {}", entry.getKey(), tableName);
        }
    }

    private void repairLegacyDocumentRows(Connection connection) throws SQLException {
        execute(connection, """
                UPDATE `t_kb_document`
                SET
                    `file_hash` = COALESCE(`file_hash`, SHA2(CONCAT(`id`, '-', `file_name`, '-', COALESCE(`create_time`, NOW())), 256)),
                    `storage_type` = COALESCE(NULLIF(`storage_type`, ''), 'LEGACY_AGENT'),
                    `storage_bucket` = COALESCE(NULLIF(`storage_bucket`, ''), 'legacy-agent'),
                    `storage_object_key` = COALESCE(
                        NULLIF(`storage_object_key`, ''),
                        CONCAT('knowledge_base/', COALESCE(NULLIF(`category`, ''), 'faq'), '/', `file_name`)
                    ),
                    `retry_count` = COALESCE(`retry_count`, 0),
                    `status` = COALESCE(NULLIF(`status`, ''), 'UPLOADED'),
                    `ingest_stage` = COALESCE(
                        NULLIF(`ingest_stage`, ''),
                        CASE
                            WHEN `status` = 'INDEXED' THEN 'DONE'
                            WHEN `status` = 'FAILED' THEN 'FAILED'
                            WHEN `status` = 'PROCESSING' THEN 'INGESTING'
                            ELSE 'QUEUED'
                        END
                    ),
                    `progress_percent` = COALESCE(
                        `progress_percent`,
                        CASE
                            WHEN `status` = 'INDEXED' THEN 100
                            WHEN `status` = 'FAILED' THEN 0
                            WHEN `status` = 'PROCESSING' THEN 10
                            ELSE 0
                        END
                    ),
                    `language` = COALESCE(NULLIF(`language`, ''), 'zh-CN')
                WHERE `file_hash` IS NULL
                   OR `storage_type` IS NULL
                   OR `storage_type` = ''
                   OR `storage_bucket` IS NULL
                   OR `storage_bucket` = ''
                   OR `storage_object_key` IS NULL
                   OR `storage_object_key` = ''
                   OR `retry_count` IS NULL
                   OR `status` IS NULL
                   OR `status` = ''
                   OR `ingest_stage` IS NULL
                   OR `ingest_stage` = ''
                   OR `progress_percent` IS NULL
                   OR `language` IS NULL
                   OR `language` = ''
                """);
    }

    private void repairLegacyTaskRows(Connection connection) throws SQLException {
        execute(connection, """
                UPDATE `t_kb_ingest_task`
                SET
                    `ingest_stage` = COALESCE(
                        NULLIF(`ingest_stage`, ''),
                        CASE
                            WHEN `status` = 'SUCCESS' THEN 'DONE'
                            WHEN `status` = 'FAILED' THEN 'FAILED'
                            WHEN `status` = 'PROCESSING' THEN 'INGESTING'
                            ELSE 'QUEUED'
                        END
                    ),
                    `progress_percent` = COALESCE(
                        `progress_percent`,
                        CASE
                            WHEN `status` = 'SUCCESS' THEN 100
                            WHEN `status` = 'FAILED' THEN 0
                            WHEN `status` = 'PROCESSING' THEN 10
                            ELSE 0
                        END
                    )
                WHERE `ingest_stage` IS NULL
                   OR `ingest_stage` = ''
                   OR `progress_percent` IS NULL
                """);
    }

    private Set<String> getColumns(Connection connection, String tableName) throws SQLException {
        Set<String> columns = new TreeSet<>();
        DatabaseMetaData metadata = connection.getMetaData();
        try (ResultSet resultSet = metadata.getColumns(connection.getCatalog(), null, tableName, null)) {
            while (resultSet.next()) {
                columns.add(normalize(resultSet.getString("COLUMN_NAME")));
            }
        }
        return columns;
    }

    private Set<String> getIndexes(Connection connection, String tableName) throws SQLException {
        Set<String> indexes = new TreeSet<>();
        DatabaseMetaData metadata = connection.getMetaData();
        try (ResultSet resultSet = metadata.getIndexInfo(connection.getCatalog(), null, tableName, false, false)) {
            while (resultSet.next()) {
                String indexName = resultSet.getString("INDEX_NAME");
                if (indexName != null) {
                    indexes.add(normalize(indexName));
                }
            }
        }
        return indexes;
    }

    private boolean tableExists(Connection connection, String tableName) throws SQLException {
        DatabaseMetaData metadata = connection.getMetaData();
        try (ResultSet resultSet = metadata.getTables(connection.getCatalog(), null, tableName, new String[]{"TABLE"})) {
            while (resultSet.next()) {
                String current = resultSet.getString("TABLE_NAME");
                if (tableName.equalsIgnoreCase(current)) {
                    return true;
                }
            }
        }
        return false;
    }

    private void execute(Connection connection, String sql) throws SQLException {
        try (Statement statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }

    private static Map<String, String> createDocumentPatchColumns() {
        Map<String, String> columns = new LinkedHashMap<>();
        columns.put("author", "varchar(100) DEFAULT NULL COMMENT 'Author'");
        columns.put("summary", "varchar(1000) DEFAULT NULL COMMENT 'Summary'");
        columns.put("language", "varchar(20) DEFAULT 'zh-CN' COMMENT 'Language'");
        columns.put("version", "varchar(50) DEFAULT NULL COMMENT 'Version'");
        columns.put("external_id", "varchar(100) DEFAULT NULL COMMENT 'External id'");
        columns.put("effective_at", "datetime DEFAULT NULL COMMENT 'Effective time'");
        columns.put("file_hash", "varchar(64) DEFAULT NULL COMMENT 'File hash'");
        columns.put("storage_type", "varchar(32) DEFAULT 'MINIO' COMMENT 'Storage type'");
        columns.put("storage_bucket", "varchar(128) DEFAULT NULL COMMENT 'Storage bucket'");
        columns.put("storage_object_key", "varchar(500) DEFAULT NULL COMMENT 'Storage object key'");
        columns.put("retry_count", "int(11) DEFAULT 0 COMMENT 'Retry count'");
        columns.put("ingest_stage", "varchar(32) NOT NULL DEFAULT 'QUEUED' COMMENT 'Ingest stage'");
        columns.put("progress_percent", "int(11) NOT NULL DEFAULT 0 COMMENT 'Progress percent'");
        columns.put("last_ingest_time", "datetime DEFAULT NULL COMMENT 'Last ingest time'");
        return columns;
    }

    private static Map<String, String> createTaskPatchColumns() {
        Map<String, String> columns = new LinkedHashMap<>();
        columns.put("ingest_stage", "varchar(32) NOT NULL DEFAULT 'QUEUED' COMMENT 'Ingest stage'");
        columns.put("progress_percent", "int(11) NOT NULL DEFAULT 0 COMMENT 'Progress percent'");
        return columns;
    }

    private static Map<String, String> createDocumentIndexes() {
        Map<String, String> indexes = new LinkedHashMap<>();
        indexes.put("uk_file_hash", "ALTER TABLE `t_kb_document` ADD UNIQUE KEY `uk_file_hash` (`file_hash`)");
        indexes.put("idx_category", "ALTER TABLE `t_kb_document` ADD KEY `idx_category` (`category`)");
        indexes.put("idx_status", "ALTER TABLE `t_kb_document` ADD KEY `idx_status` (`status`)");
        indexes.put("idx_agent_doc_id", "ALTER TABLE `t_kb_document` ADD KEY `idx_agent_doc_id` (`agent_doc_id`)");
        indexes.put("idx_create_time", "ALTER TABLE `t_kb_document` ADD KEY `idx_create_time` (`create_time`)");
        return indexes;
    }

    private static Map<String, String> createTaskIndexes() {
        Map<String, String> indexes = new LinkedHashMap<>();
        indexes.put("idx_document_id", "ALTER TABLE `t_kb_ingest_task` ADD KEY `idx_document_id` (`document_id`)");
        indexes.put("idx_task_status", "ALTER TABLE `t_kb_ingest_task` ADD KEY `idx_task_status` (`status`)");
        indexes.put("idx_task_create_time", "ALTER TABLE `t_kb_ingest_task` ADD KEY `idx_task_create_time` (`create_time`)");
        return indexes;
    }

    private static String normalize(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT);
    }
}
