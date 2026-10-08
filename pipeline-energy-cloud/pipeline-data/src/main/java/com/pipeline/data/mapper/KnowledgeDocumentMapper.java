package com.pipeline.data.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.pipeline.data.domain.KnowledgeDocument;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * 知识库文档 Mapper
 */
@Mapper
public interface KnowledgeDocumentMapper extends BaseMapper<KnowledgeDocument> {

    @Select("""
            SELECT id,title,category,source_type,tags,remark,author,summary,language,version,external_id,effective_at,file_name,file_extension,file_size,file_hash,
                   storage_type,storage_bucket,storage_object_key,agent_doc_id,chunk_count,retry_count,status,
                   ingest_stage,progress_percent,failure_reason,last_ingest_time,create_by,create_time,update_time,is_deleted
            FROM t_kb_document
            WHERE file_hash = #{fileHash}
            LIMIT 1
            """)
    KnowledgeDocument selectAnyByFileHash(@Param("fileHash") String fileHash);

    @Delete("DELETE FROM t_kb_document WHERE id = #{id}")
    int hardDeleteById(@Param("id") Long id);
}
