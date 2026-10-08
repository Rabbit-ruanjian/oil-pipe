package com.pipeline.data.controller;

import java.util.List;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.pipeline.common.core.domain.Result;
import com.pipeline.data.domain.KnowledgeDocument;
import com.pipeline.data.domain.KnowledgeIngestTask;
import com.pipeline.data.service.IKnowledgeDocumentService;

import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/knowledge-doc")
@RequiredArgsConstructor
public class KnowledgeDocumentController {

    private final IKnowledgeDocumentService knowledgeDocumentService;

    @GetMapping("/list")
    public Result<List<KnowledgeDocument>> list() {
        return Result.ok(knowledgeDocumentService.listDocuments());
    }

    @GetMapping("/{id}/tasks")
    public Result<List<KnowledgeIngestTask>> listTasks(@PathVariable("id") Long id) {
        return Result.ok(knowledgeDocumentService.listTasks(id));
    }

    @PostMapping("/upload")
    public Result<KnowledgeDocument> upload(@RequestParam("file") MultipartFile file,
                                            @RequestParam(value = "title", required = false) String title,
                                            @RequestParam(value = "category", required = false) String category,
                                            @RequestParam(value = "sourceType", required = false) String sourceType,
                                            @RequestParam(value = "tags", required = false) String tags,
                                            @RequestParam(value = "remark", required = false) String remark,
                                            @RequestParam(value = "author", required = false) String author,
                                            @RequestParam(value = "summary", required = false) String summary,
                                            @RequestParam(value = "language", required = false) String language,
                                            @RequestParam(value = "version", required = false) String version,
                                            @RequestParam(value = "externalId", required = false) String externalId,
                                            @RequestParam(value = "effectiveAt", required = false) String effectiveAt) {
        KnowledgeDocument document = knowledgeDocumentService.uploadDocument(
                file, title, category, sourceType, tags, remark, author, summary, language, version, externalId, effectiveAt);
        return Result.ok(document, "知识文档已接收，正在后台入库");
    }

    @PostMapping("/{id}/retry")
    public Result<KnowledgeDocument> retry(@PathVariable("id") Long id) {
        KnowledgeDocument document = knowledgeDocumentService.retryDocument(id);
        return Result.ok(document, "已加入重试队列，请稍后刷新任务状态");
    }

    @DeleteMapping("/{id}")
    public Result<Boolean> delete(@PathVariable("id") Long id) {
        return Result.ok(knowledgeDocumentService.deleteDocument(id), "知识文档已删除");
    }
}
