package com.pipeline.data.config;

import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import lombok.Data;

@Data
@Component
@ConfigurationProperties(prefix = "knowledge.document")
public class KnowledgeDocumentProperties {

    private String agentBaseUrl = "http://localhost:8100";

    private String uploadPath = "/api/v1/knowledge/upload";

    private String deletePath = "/api/v1/knowledge/document/{docId}";

    private String internalToken;

    private String internalKey;

    private Integer connectTimeoutMs = 5000;

    private Integer readTimeoutMs = 120000;

    private String legacyBasePath;

    private List<String> allowedCategories = List.of("standards", "formulas", "operations", "cases", "faq");

    private Minio minio = new Minio();

    @Data
    public static class Minio {

        private String endpoint = "http://localhost:9000";

        private String accessKey = "admin";

        private String secretKey = "password";

        private String bucket = "knowledge-base";
    }
}
