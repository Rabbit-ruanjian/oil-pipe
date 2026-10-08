package com.pipeline.data.service;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import org.springframework.stereotype.Service;

import com.pipeline.common.core.exception.BusinessException;
import com.pipeline.data.config.KnowledgeDocumentProperties;

import cn.hutool.core.util.StrUtil;
import io.minio.BucketExistsArgs;
import io.minio.GetObjectArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.RemoveObjectArgs;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
@RequiredArgsConstructor
public class KnowledgeFileStorageService {

    private static final String STORAGE_MINIO = "MINIO";
    private static final String STORAGE_LEGACY = "LEGACY_AGENT";

    private final KnowledgeDocumentProperties properties;

    public StoredObject store(byte[] content, String originalFilename, String category, String fileHash) {
        String safeFileName = sanitizeFileName(originalFilename);
        String bucket = properties.getMinio().getBucket();
        String objectKey = "%s/%s/%s-%s".formatted(
                category,
                LocalDate.now(),
                StrUtil.subPre(fileHash, 16),
                safeFileName);

        try {
            MinioClient client = createClient();
            ensureBucket(client, bucket);

            try (InputStream inputStream = new ByteArrayInputStream(content)) {
                client.putObject(
                        PutObjectArgs.builder()
                                .bucket(bucket)
                                .object(objectKey)
                                .stream(inputStream, content.length, -1)
                                .contentType(detectContentType(originalFilename))
                                .build());
            }

            return new StoredObject(STORAGE_MINIO, bucket, objectKey);
        } catch (Exception ex) {
            log.error("Failed to store knowledge file to MinIO", ex);
            throw new BusinessException("知识库原文件保存失败: " + ex.getMessage());
        }
    }

    public byte[] read(String storageType, String bucket, String objectKey) {
        if (STORAGE_LEGACY.equalsIgnoreCase(StrUtil.blankToDefault(storageType, ""))) {
            return readLegacy(objectKey);
        }
        return readFromMinio(bucket, objectKey);
    }

    public void delete(String storageType, String bucket, String objectKey) {
        if (StrUtil.hasBlank(objectKey)) {
            return;
        }

        if (STORAGE_LEGACY.equalsIgnoreCase(StrUtil.blankToDefault(storageType, ""))) {
            deleteLegacy(objectKey);
            return;
        }

        deleteFromMinio(bucket, objectKey);
    }

    public boolean exists(String storageType, String bucket, String objectKey) {
        if (StrUtil.hasBlank(objectKey)) {
            return false;
        }

        if (STORAGE_LEGACY.equalsIgnoreCase(StrUtil.blankToDefault(storageType, ""))) {
            return resolveLegacyPath(objectKey) != null;
        }

        try {
            readFromMinio(bucket, objectKey);
            return true;
        } catch (BusinessException ex) {
            return false;
        }
    }

    private byte[] readFromMinio(String bucket, String objectKey) {
        try {
            MinioClient client = createClient();
            try (InputStream stream = client.getObject(
                    GetObjectArgs.builder().bucket(bucket).object(objectKey).build())) {
                return stream.readAllBytes();
            }
        } catch (Exception ex) {
            log.error("Failed to read knowledge file from MinIO", ex);
            throw new BusinessException("知识库原文件读取失败: " + ex.getMessage());
        }
    }

    private void deleteFromMinio(String bucket, String objectKey) {
        if (StrUtil.hasBlank(bucket, objectKey)) {
            return;
        }

        try {
            MinioClient client = createClient();
            client.removeObject(RemoveObjectArgs.builder().bucket(bucket).object(objectKey).build());
        } catch (Exception ex) {
            log.error("Failed to delete knowledge file from MinIO", ex);
            throw new BusinessException("知识库原文件删除失败: " + ex.getMessage());
        }
    }

    private byte[] readLegacy(String objectKey) {
        Path legacyPath = resolveLegacyPath(objectKey);
        if (legacyPath == null) {
            throw new BusinessException("找不到第一阶段遗留文档原文件: " + objectKey);
        }

        try {
            return Files.readAllBytes(legacyPath);
        } catch (Exception ex) {
            log.error("Failed to read legacy knowledge file", ex);
            throw new BusinessException("读取第一阶段遗留文件失败: " + ex.getMessage());
        }
    }

    private void deleteLegacy(String objectKey) {
        Path legacyPath = resolveLegacyPath(objectKey);
        if (legacyPath == null) {
            return;
        }

        try {
            Files.deleteIfExists(legacyPath);
        } catch (Exception ex) {
            log.error("Failed to delete legacy knowledge file", ex);
            throw new BusinessException("删除第一阶段遗留原文件失败: " + ex.getMessage());
        }
    }

    private Path resolveLegacyPath(String objectKey) {
        String normalizedObjectKey = objectKey.replace("\\", "/");
        List<Path> candidates = new ArrayList<>();

        Path direct = Path.of(normalizedObjectKey);
        candidates.add(direct);

        Path currentDir = Path.of(System.getProperty("user.dir"));
        candidates.add(currentDir.resolve(normalizedObjectKey));
        candidates.add(currentDir.resolve("../pipeline-agent").normalize().resolve(normalizedObjectKey));

        String legacyBasePath = StrUtil.trimToEmpty(properties.getLegacyBasePath());
        if (StrUtil.isNotBlank(legacyBasePath)) {
            Path configuredBase = Path.of(legacyBasePath);
            candidates.add(configuredBase.resolve(normalizedObjectKey));
            if (normalizedObjectKey.startsWith("knowledge_base/")) {
                candidates.add(configuredBase.resolve(normalizedObjectKey.substring("knowledge_base/".length())));
            }
        }

        for (Path candidate : candidates) {
            Path normalized = candidate.normalize();
            if (Files.exists(normalized) && Files.isRegularFile(normalized)) {
                return normalized;
            }
        }
        return null;
    }

    private MinioClient createClient() {
        KnowledgeDocumentProperties.Minio minio = properties.getMinio();
        return MinioClient.builder()
                .endpoint(minio.getEndpoint())
                .credentials(minio.getAccessKey(), minio.getSecretKey())
                .build();
    }

    private void ensureBucket(MinioClient client, String bucket) throws Exception {
        boolean exists = client.bucketExists(BucketExistsArgs.builder().bucket(bucket).build());
        if (!exists) {
            client.makeBucket(MakeBucketArgs.builder().bucket(bucket).build());
        }
    }

    private String sanitizeFileName(String originalFilename) {
        String fileName = StrUtil.blankToDefault(originalFilename, "knowledge.bin");
        return fileName.replaceAll("[^A-Za-z0-9._-]", "_");
    }

    private String detectContentType(String originalFilename) {
        String lower = StrUtil.blankToDefault(originalFilename, "").toLowerCase();
        if (lower.endsWith(".pdf")) {
            return "application/pdf";
        }
        if (lower.endsWith(".docx")) {
            return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        }
        if (lower.endsWith(".md")) {
            return "text/markdown";
        }
        if (lower.endsWith(".txt")) {
            return "text/plain";
        }
        return "application/octet-stream";
    }

    public record StoredObject(String storageType, String bucket, String objectKey) {
    }
}
