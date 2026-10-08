package com.pipeline.data.service;

import java.util.List;

import org.springframework.web.multipart.MultipartFile;

import com.baomidou.mybatisplus.extension.service.IService;
import com.pipeline.data.domain.KnowledgeDocument;
import com.pipeline.data.domain.KnowledgeIngestTask;

public interface IKnowledgeDocumentService extends IService<KnowledgeDocument> {

    List<KnowledgeDocument> listDocuments();

    List<KnowledgeIngestTask> listTasks(Long documentId);

    KnowledgeDocument uploadDocument(MultipartFile file, String title, String category,
                                     String sourceType, String tags, String remark,
                                     String author, String summary, String language,
                                     String version, String externalId, String effectiveAt);

    KnowledgeDocument retryDocument(Long id);

    boolean deleteDocument(Long id);
}
