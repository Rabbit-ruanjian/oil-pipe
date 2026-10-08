# 知识库阶段 0 基线

## 目标

本阶段只完成知识库路线的基线收口，不直接引入完整 GraphRAG 或 Agentic Workflow。

阶段 0 的目标是把后续开发必须共享的边界先固定下来：

- 本次优先做 `知识库录入 + 可被后续检索链路使用`
- 先不把“录入功能”扩大成完整问答平台
- 后续阶段按 `录入 -> 混合检索 -> 重排 -> 图谱 -> Agent` 逐步演进

## 本阶段确定的录入范围

### 支持文件类型

- `md`
- `txt`
- `pdf`
- `docx`

### 最小元数据

- `title`：文档标题
- `source`：来源标识，例如课程资料、标准规范、项目文档
- `category`：知识分类，沿用现有 `KnowledgeCategory`
- `tags`：标签数组

### 推荐扩展元数据

- `author`
- `summary`
- `language`
- `version`
- `external_id`
- `effective_at`

## 最小链路

后续所有阶段都以这条链路为主线推进：

`上传/导入 -> 元数据校验 -> 文档解析 -> 分块 -> 索引 -> 检索验证`

说明：

- `上传/导入` 属于阶段 1
- `分块 + 索引` 仍沿用现有 `rag` 能力
- `图谱构建` 不进入阶段 0/1 的必做范围
- `Agent 调度` 不进入阶段 0/1 的必做范围

## 模块边界

### 录入层

- `src/models/knowledge_base.py`
  - 放知识库录入相关的数据模型和阶段基线定义
- `src/api/routes/knowledge.py`
  - 后续承接上传、列表、重建索引等接口

### 解析与索引层

- `src/rag/document_processor.py`
  - 文档加载与解析
- `src/rag/contextual_chunker.py`
  - 分块
- `src/rag/vector_store.py`
  - 向量入库
- `src/rag/hybrid_retriever.py`
  - 阶段 2 启用混合检索
- `src/rag/reranker.py`
  - 阶段 3 启用精排

### 图谱增强层

- `src/knowledge_graph/*`
  - 阶段 4 再接入实体关系抽取和图谱查询

### Agent 层

- `src/workflows/*`
- `src/agents/*`
  - 阶段 5 再进入调度、多步推理和模型路由增强

## 前端范围

阶段 0 不新增前端页面，但固定后续页面目标：

- 文档上传页
- 文档列表页
- 文档详情页
- 索引状态页
- 检索测试页

## 阶段 0 完成标准

- 已明确本次首要目标是“知识库录入”
- 已明确支持文件类型与元数据要求
- 已明确最小链路
- 已明确现有代码里各阶段对应的模块归属
- 已补齐后续阶段可以直接复用的录入模型与配置基线
