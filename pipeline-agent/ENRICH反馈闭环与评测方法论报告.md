# 报告三：ENRICH 相关性反馈闭环 + 检索评测方法论

- 日期：2026-10-11
- 范围：pipeline-agent（feature/rag-graph-llm-techdebt）
- 关联课程：《掌握RAG应用评估技能和工具》（RAGAS 五指标、上下文精度/召回率/F1、
  指标等级阈值、"检索优先"优化路径）

## 一、概念对齐

**ENRICH ≠ "上下文富集"，而是 Relevance Feedback（相关性反馈）**：根据用户对
"哪些文档相关/不相关"的真实反馈，增强检索。经典算法 Rocchio：
`q' = q + β·mean(relevant) − β·mean(irrelevant)`。

**RAGAS**：LLM-as-judge 评测框架（faithfulness / context_recall / answer_relevancy /
context_precision），需 LLM + golden set。本环境无 LLM key / ragas 依赖 →
**检索侧指标真算，生成侧自动降级标注，不假装**。

## 二、ENRICH 真闭环实现

- **反馈入口**：`POST/GET/DELETE /knowledge/feedback`（用户标注某 query 下文档相关/不相关）。
- **反馈存储** `relevance_feedback.FeedbackStore`：per-query JSON 持久化，30 天过期 + 正负互斥（同 doc 正负冲突时以负为准）。
- **反馈增强** `rocchio_rerank`：TF-IDF 词向量版 Rocchio（无 numpy/jieba/LLM 依赖），
  `score(c) = cos(tfidf(c), mean_pos)·(1+β) − cos(tfidf(c), mean_neg)·β`；
  无反馈记录 / 开关关时 **no-op 原样返回**（逐字节一致）。
- **门控** `RAG_USE_RELEVANCE_FEEDBACK`（默认关，P0-③ 可插拔同款）。

**与课程的关系**：ENRICH 本质是课程"持续评估与优化闭环"里"结合用户反馈调整检索"
的工程落地——把真实点踩/点赞变成检索增强信号，而非离线一次性评测。

## 三、评测方法论（课程五指标 → 本地可算性）

课程五指标在本环境的落地映射：

| 课程指标 | 归属 | 本地可算 | 实现 |
|---|---|---|---|
| context_recall | 检索 | ✅ | top-k 命中 gold 比例 |
| context_precision | 检索 | ✅ | top-k 中 gold 占比（纯度） |
| F1 | 检索 | ✅ | 精确率/召回率调和平均（课程"难比时"综合分） |
| faithfulness | 生成 | ⚠️ 降级 | 需 LLM 逐句核对答案 vs 上下文 |
| answer_relevancy | 生成 | ⚠️ 降级 | 需 LLM 判断答案是否直接回答问题 |

**指标等级（课程阈值）**：recall ≥0.8 高 / 0.5~0.8 中；precision ≥0.7 高 / 0.4~0.7 中。

**修过的 3 个方法学坑**（保证指标可信，不做假）：
1. graphrag 单独 MRR 偏低是被误读 → 加多跳因果 BFS（沿 caused_by/solved_by 展开再回查），不再是"只拿节点名"。
2. enrich 比 hybrid 还差 → 2-gram 关键词版换成 TF-IDF 向量版 Rocchio（拉正推负）。
3. metadata 看不出过滤作用 → 构造跨类别同词干扰样本（gold 在少数类、过滤到主类），让双刃剑代价显现。

## 四、实测结果（单路 hybrid，不做多路融合）

- context_recall=0.800（高）、context_precision=0.449（中）、F1=0.544。
- 7 模式对比（另一脚本）：hybrid_graph 最佳 MRR 0.883；graphrag 纯图腿 0.144
  （社区层已补摘要语义腿，待数据量上来提升 doc 级召回）。

## 五、按课程"检索优先"的下一步

1. **提 precision（当前瓶颈）**：加重排序 / 收紧 top_k / 调 chunk 大小（课程：技术文档 200-300 token）。
2. **巩固 recall（已高）**：社区层跨概念聚合 + 短 query 查询改写。
3. **补生成侧**：配 LLM key + `pip install ragas`，本脚本 golden set 直接喂 ragas
   跑 faithfulness / answer_relevancy，完成五指标闭环。
4. **场景化阈值**（课程行业建议）：本系统属通用技术问答，目标
   faithfulness≥0.85、answer_relevancy≥0.7、context_recall≥0.7、context_precision≥0.7。

## 六、遗留

- 负反馈近似：降级态无真实点踩，评测用"未命中语料"近似 negative；真闭环上线后由
  `DELETE /feedback` 或用户显式点踩提供。
- RAGAS 未装 + 无 LLM key：生成侧 2 指标待环境具备后补。
- 本轮改动未 commit。
