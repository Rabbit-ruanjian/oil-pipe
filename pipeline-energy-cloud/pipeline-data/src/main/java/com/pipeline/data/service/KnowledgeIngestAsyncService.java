package com.pipeline.data.service;

import java.time.LocalDateTime;
import java.util.Map;

import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriUtils;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.pipeline.data.config.KnowledgeDocumentProperties;
import com.pipeline.data.domain.KnowledgeDocument;
import com.pipeline.data.domain.KnowledgeIngestTask;
import com.pipeline.data.mapper.KnowledgeDocumentMapper;
import com.pipeline.data.mapper.KnowledgeIngestTaskMapper;

import cn.hutool.core.util.StrUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
@RequiredArgsConstructor
public class KnowledgeIngestAsyncService {

    private static final String STATUS_INDEXED = "INDEXED";
    private static final String STATUS_FAILED = "FAILED";
    private static final String STATUS_PROCESSING = "PROCESSING";
    private static final String STATUS_UPLOADED = "UPLOADED";
    private static final String STAGE_QUEUED = "QUEUED";
    private static final String STAGE_INGESTING = "INGESTING";
    private static final String STAGE_DONE = "DONE";
    private static final String STAGE_FAILED = "FAILED";
    private static final String STORAGE_LEGACY = "LEGACY_AGENT";
    private static final String DEFAULT_TAG = "知识库";

    private final KnowledgeDocumentProperties properties;
    private final KnowledgeDocumentMapper documentMapper;
    private final KnowledgeIngestTaskMapper taskMapper;
    private final KnowledgeFileStorageService storageService;

    @Async("knowledgeIngestExecutor")
    public void processTask(Long documentId, Long taskId,
                            String previousAgentDocId,
                            Integer previousChunkCount,
                            String previousStatus,
                            LocalDateTime previousLastIngestTime,
                            String previousIngestStage,
                            Integer previousProgressPercent) {
        KnowledgeDocument document = documentMapper.selectById(documentId);
        KnowledgeIngestTask task = taskMapper.selectById(taskId);
        if (document == null || task == null) {
            log.warn("Skip knowledge ingest task because document or task does not exist, documentId={}, taskId={}",
                    documentId, taskId);
            return;
        }

        ExistingIndexState previous = new ExistingIndexState(
                previousAgentDocId,
                defaultInt(previousChunkCount),
                StrUtil.blankToDefault(previousStatus, STATUS_UPLOADED),
                previousLastIngestTime,
                StrUtil.blankToDefault(previousIngestStage, STAGE_QUEUED),
                defaultInt(previousProgressPercent));
        LocalDateTime startedAt = LocalDateTime.now();
        task.setStatus(STATUS_PROCESSING);
        task.setIngestStage(STAGE_INGESTING);
        task.setProgressPercent(10);
        task.setStartedAt(startedAt);
        taskMapper.updateById(task);

        document.setStatus(STATUS_PROCESSING);
        document.setIngestStage(STAGE_INGESTING);
        document.setProgressPercent(10);
        document.setFailureReason(null);
        documentMapper.updateById(document);

        try {
            byte[] content = storageService.read(document.getStorageType(), document.getStorageBucket(), document.getStorageObjectKey());

            if (STORAGE_LEGACY.equalsIgnoreCase(StrUtil.blankToDefault(document.getStorageType(), ""))) {
                document = migrateLegacyStorage(document, content);
            }

            Map<String, Object> agentResponse = uploadToAgent(document, content);
            boolean success = Boolean.TRUE.equals(agentResponse.get("success"));
            LocalDateTime finishedAt = LocalDateTime.now();
            Map<String, Object> documentPayload = mapValue(agentResponse.get("document"));
            String newAgentDocId = stringValue(documentPayload.get("doc_id"));
            Integer newChunkCount = resolveChunkCount(documentPayload, previous.chunkCount());
            String ingestStage = resolveIngestStage(documentPayload, STAGE_DONE);
            Integer progressPercent = resolveProgressPercent(documentPayload, success ? 100 : 0);
            String message = stringValue(agentResponse.get("message"));

            if (!success) {
                rollbackNewIndexIfNeeded(previous, newAgentDocId);
                String failureDetail = resolveAgentFailureMessage(message, ingestStage);
                applyFailedIngest(document, task, previous, failureDetail, finishedAt, ingestStage, progressPercent);
                return;
            }

            if (StrUtil.isNotBlank(previous.agentDocId()) && !StrUtil.equals(previous.agentDocId(), newAgentDocId)) {
                boolean oldDeleted = deleteFromAgent(previous.agentDocId());
                if (!oldDeleted) {
                    boolean rolledBack = rollbackNewIndexIfNeeded(previous, newAgentDocId);
                    String detail = rolledBack
                            ? "本次重试失败，已回滚新索引并保留旧索引"
                            : "本次重试失败，旧索引未替换成功且新索引回滚失败，请人工检查向量库";
                    applyFailedIngest(document, task, previous, detail, finishedAt, ingestStage, progressPercent);
                    return;
                }
            }

            document.setAgentDocId(newAgentDocId);
            document.setChunkCount(newChunkCount);
            document.setStatus(STATUS_INDEXED);
            document.setIngestStage(ingestStage);
            document.setProgressPercent(progressPercent);
            document.setFailureReason(null);
            document.setLastIngestTime(finishedAt);
            documentMapper.updateById(document);

            task.setStatus("SUCCESS");
            task.setIngestStage(ingestStage);
            task.setProgressPercent(progressPercent);
            task.setAgentDocId(newAgentDocId);
            task.setChunkCount(newChunkCount);
            task.setFailureReason(null);
            task.setFinishedAt(finishedAt);
            taskMapper.updateById(task);
        } catch (RuntimeException ex) {
            LocalDateTime finishedAt = LocalDateTime.now();
            log.error("Knowledge document ingest failed asynchronously", ex);
            applyFailedIngest(document, task, previous, ex.getMessage(), finishedAt, STAGE_FAILED, 0);
        }
    }

    public boolean deleteAgentDocument(String docId) {
        return deleteFromAgent(docId);
    }

    private KnowledgeDocument migrateLegacyStorage(KnowledgeDocument document, byte[] content) {
        KnowledgeFileStorageService.StoredObject storedObject =
                storageService.store(content, document.getFileName(), document.getCategory(), document.getFileHash());

        String legacyStorageType = document.getStorageType();
        String legacyBucket = document.getStorageBucket();
        String legacyObjectKey = document.getStorageObjectKey();

        document.setStorageType(storedObject.storageType());
        document.setStorageBucket(storedObject.bucket());
        document.setStorageObjectKey(storedObject.objectKey());
        documentMapper.updateById(document);

        try {
            storageService.delete(legacyStorageType, legacyBucket, legacyObjectKey);
        } catch (RuntimeException ex) {
            log.warn("Legacy knowledge file cleanup failed after migration, objectKey={}", legacyObjectKey, ex);
        }
        return documentMapper.selectById(document.getId());
    }

    private void applyFailedIngest(KnowledgeDocument document, KnowledgeIngestTask task,
                                   ExistingIndexState previous, String message, LocalDateTime finishedAt,
                                   String failedStage, Integer failedProgressPercent) {
        String normalizedMessage = StrUtil.blankToDefault(message, "入库失败，请稍后重试");
        if (previous.hasAvailableIndex()) {
            document.setAgentDocId(previous.agentDocId());
            document.setChunkCount(previous.chunkCount());
            document.setStatus(previous.status());
            document.setIngestStage(previous.ingestStage());
            document.setProgressPercent(previous.progressPercent());
            document.setFailureReason("本次任务失败，已保留上次可用索引: " + normalizedMessage);
            document.setLastIngestTime(previous.lastIngestTime());
        } else {
            document.setAgentDocId(null);
            document.setChunkCount(0);
            document.setStatus(STATUS_FAILED);
            document.setIngestStage(StrUtil.blankToDefault(failedStage, STAGE_FAILED));
            document.setProgressPercent(defaultInt(failedProgressPercent));
            document.setFailureReason(normalizedMessage);
            document.setLastIngestTime(previous.lastIngestTime());
        }
        documentMapper.updateById(document);

        task.setStatus(STATUS_FAILED);
        task.setIngestStage(StrUtil.blankToDefault(failedStage, STAGE_FAILED));
        task.setProgressPercent(defaultInt(failedProgressPercent));
        task.setChunkCount(previous.hasAvailableIndex() ? previous.chunkCount() : 0);
        task.setFailureReason(normalizedMessage);
        task.setFinishedAt(finishedAt);
        taskMapper.updateById(task);
    }

    private boolean rollbackNewIndexIfNeeded(ExistingIndexState previous, String newAgentDocId) {
        if (StrUtil.isBlank(newAgentDocId) || StrUtil.equals(previous.agentDocId(), newAgentDocId)) {
            return true;
        }
        return deleteFromAgent(newAgentDocId);
    }

    private Map<String, Object> uploadToAgent(KnowledgeDocument document, byte[] content) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);

        if (StrUtil.isNotBlank(properties.getInternalToken())) {
            headers.add("X-Internal-Token", properties.getInternalToken().trim());
        }
        if (StrUtil.isNotBlank(properties.getInternalKey())) {
            headers.add("X-Internal-Key", properties.getInternalKey().trim());
        }

        org.springframework.core.io.ByteArrayResource resource = new org.springframework.core.io.ByteArrayResource(content) {
            @Override
            public String getFilename() {
                return StrUtil.blankToDefault(document.getFileName(), "upload.bin");
            }
        };

        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        body.add("file", resource);
        body.add("title", resolveTitle(document));
        body.add("source", resolveSource(document));
        body.add("category", document.getCategory());
        body.add("tags", resolveTags(document));
        appendOptionalField(body, "author", document.getAuthor());
        appendOptionalField(body, "summary", document.getSummary());
        appendOptionalField(body, "language", document.getLanguage());
        appendOptionalField(body, "version", document.getVersion());
        appendOptionalField(body, "external_id", document.getExternalId());
        if (document.getEffectiveAt() != null) {
            body.add("effective_at", document.getEffectiveAt().toString());
        }

        String uploadUrl = properties.getAgentBaseUrl() + properties.getUploadPath();
        HttpEntity<MultiValueMap<String, Object>> requestEntity = new HttpEntity<>(body, headers);
        ResponseEntity<Map> response = createRestTemplate().postForEntity(uploadUrl, requestEntity, Map.class);
        Map<String, Object> bodyMap = response.getBody();
        if (bodyMap == null) {
            throw new RestClientException("Agent 返回了空响应");
        }
        return bodyMap;
    }

    private boolean deleteFromAgent(String docId) {
        try {
            HttpHeaders headers = new HttpHeaders();
            if (StrUtil.isNotBlank(properties.getInternalToken())) {
                headers.add("X-Internal-Token", properties.getInternalToken().trim());
            }
            if (StrUtil.isNotBlank(properties.getInternalKey())) {
                headers.add("X-Internal-Key", properties.getInternalKey().trim());
            }

            String deletePath = properties.getDeletePath()
                    .replace("{docId}", UriUtils.encodePathSegment(docId, java.nio.charset.StandardCharsets.UTF_8));
            String deleteUrl = properties.getAgentBaseUrl() + deletePath;
            ResponseEntity<Map> response = createRestTemplate().exchange(
                    deleteUrl,
                    HttpMethod.DELETE,
                    new HttpEntity<>(null, headers),
                    Map.class);

            if (!response.getStatusCode().is2xxSuccessful()) {
                return false;
            }

            Map<String, Object> body = response.getBody();
            return body == null || !Boolean.FALSE.equals(body.get("success"));
        } catch (RestClientException ex) {
            log.error("Failed to delete document from agent", ex);
            return false;
        }
    }

    private RestTemplate createRestTemplate() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(defaultInt(properties.getConnectTimeoutMs(), 5000));
        factory.setReadTimeout(defaultInt(properties.getReadTimeoutMs(), 300000));
        return new RestTemplate(factory);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> mapValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            return (Map<String, Object>) map;
        }
        return Map.of();
    }

    private Integer intValue(Object value) {
        if (value instanceof Number number) {
            return number.intValue();
        }
        if (value == null) {
            return 0;
        }
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (NumberFormatException ex) {
            return 0;
        }
    }

    private Integer resolveChunkCount(Map<String, Object> documentPayload, int fallback) {
        int chunkCount = intValue(documentPayload.get("chunk_count"));
        return chunkCount > 0 ? chunkCount : fallback;
    }

    private String resolveIngestStage(Map<String, Object> documentPayload, String fallback) {
        return StrUtil.blankToDefault(stringValue(documentPayload.get("ingest_stage")), fallback);
    }

    private Integer resolveProgressPercent(Map<String, Object> documentPayload, int fallback) {
        int value = intValue(documentPayload.get("progress_percent"));
        return value > 0 ? value : fallback;
    }

    private String resolveAgentFailureMessage(String remoteMessage, String ingestStage) {
        String normalizedStage = StrUtil.blankToDefault(StrUtil.trim(ingestStage), STAGE_FAILED);
        String normalizedMessage = StrUtil.trim(remoteMessage);
        String genericMessage = StrUtil.format("Agent indexing failed at stage {}", normalizedStage);

        if (StrUtil.isBlank(normalizedMessage)) {
            return genericMessage;
        }
        if (StrUtil.containsAnyIgnoreCase(normalizedMessage, "uploaded", "indexed successfully", "写入知识库注册表")) {
            return genericMessage;
        }
        return genericMessage + ": " + normalizedMessage;
    }

    private String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private String resolveTitle(KnowledgeDocument document) {
        return StrUtil.blankToDefault(document.getTitle(), stripExtension(document.getFileName()));
    }

    private String resolveSource(KnowledgeDocument document) {
        String normalizedSourceType = StrUtil.blankToDefault(document.getSourceType(), "manual").trim().toLowerCase();
        return switch (normalizedSourceType) {
            case "summary" -> "知识沉淀";
            case "template" -> "模板创建";
            default -> "手动录入";
        };
    }

    private String resolveTags(KnowledgeDocument document) {
        String tags = StrUtil.trimToEmpty(document.getTags());
        return StrUtil.isNotBlank(tags) ? tags : DEFAULT_TAG;
    }

    private void appendOptionalField(MultiValueMap<String, Object> body, String fieldName, String value) {
        String normalized = StrUtil.trimToNull(value);
        if (normalized != null) {
            body.add(fieldName, normalized);
        }
    }

    private String stripExtension(String fileName) {
        if (StrUtil.isBlank(fileName) || !fileName.contains(".")) {
            return StrUtil.blankToDefault(fileName, "未命名文档");
        }
        return fileName.substring(0, fileName.lastIndexOf('.'));
    }

    private int defaultInt(Integer value) {
        return defaultInt(value, 0);
    }

    private int defaultInt(Integer value, int fallback) {
        return value == null || value <= 0 ? fallback : value;
    }

    private record ExistingIndexState(
            String agentDocId,
            int chunkCount,
            String status,
            LocalDateTime lastIngestTime,
            String ingestStage,
            int progressPercent) {

        private boolean hasAvailableIndex() {
            return StrUtil.isNotBlank(agentDocId) && STATUS_INDEXED.equalsIgnoreCase(status);
        }
    }
}
