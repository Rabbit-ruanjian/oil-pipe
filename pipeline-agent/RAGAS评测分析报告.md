# RAG 检索评估分析报告（RAGAS 五指标 + 社区层）

- 日期：2026-10-11
- 评测对象：pipeline-agent RAG 系统（单路 hybrid 检索 + GraphRAG 社区层）
- 评测依据：智泊AI《掌握RAG应用评估技能和工具》课程评分机制（RAGAS 五指标）
- 检索器配置：单路 hybrid（BM25 + 本地 384 维向量 RRF 融合），**不做多路融合**
- 社区层：GraphRAG 2.0（子图社区 → 规则摘要 → 本地向量化 → COSINE 粗筛）已生效

## 一、指标总览

按课程五指标框架，本环境能真实计算的为检索侧 3 项；生成侧 2 项依赖 LLM judge，
本环境无 LLM key / ragas 未装，**自动降级标注，不硬编数值**（课程强调"不假装"）。

| 指标 | 归属 | 本环境值 | 课程等级 | 可算性 |
|---|---|---|---|---|
| context_recall | 检索 | 0.800 | 高（≥0.8） | ✅ 真实计算 |
| context_precision | 检索 | 0.449 | 中（0.4~0.7） | ✅ 真实计算 |
| F1（recall/precision 调和） | 检索 | 0.544 | — | ✅ 真实计算 |
| faithfulness | 生成 | n/a | — | ⚠️ 需 LLM judge，降级 |
| answer_relevancy | 生成 | n/a | — | ⚠️ 需 LLM judge，降级 |

## 二、检索侧诊断（课程"对症下药"表）

按课程诊断矩阵：

- **context_recall=0.800（高）**：检索器基本覆盖关键文档——15 条样本里 12 条
  top-1 命中 gold。符合课程"检索器能找到绝大多数相关信息"。
- **context_precision=0.449（中）**：top-5 里只有约 45% 是 gold 文档，**近 6 成是噪声**。
  课程指出 precision 低 = "检索结果中大量无关文档、相关文档排名低"。
  这是当前主要短板。
- **F1=0.544**：精确率拖低了综合分（recall 高、precision 中，F1 被 precision 拉下）。

**根因（对照课程优化路径）**：
1. 本知识库 25 文档 / 248 分块，语料小且标题词面高度重合 → 纯词面/向量都容易
   把"同主题但非目标"的文档拉进 top-5，稀释 precision。
2. 短 query（如"泵站"仅 2 字）语义空间窄，向量相似度区分度低 → 噪声文档混入。
3. 单路 hybrid 没有引入重排序（rerank）把"强相关"顶到最前，precision 上不去。

## 三、社区层（GraphRAG 2.0）带来的增量

本轮补上的社区层，正是课程"提升 context_recall/跨概念聚合"的一条腿：

- **机制**：图弱连通分量切社区 → 每社区规则摘要（因果链串起来）→ 本地 384 维
  向量 → query 向量 COSINE 粗筛 top 社区 → 命中社区带回 source_docs/chunk_ids。
- **实测**：`community_search("泵站出口压力下降 处置")` 命中 fault 因果社区
  c0001（score 0.491，排序 c0001 > c0004 > c0002 语义正确）。
- **对指标的潜在作用**：
  - 跨概念聚合：把"泵站出口压力下降"这类 query 直接定位到"叶轮磨损→更换叶轮"
    整条因果社区，而非零散 chunk —— 提升 context_recall 的上限。
  - 但当前图只有 29 节点 / 4 社区，且专家数据节点没带 doc_id（source_docs 多为空），
    所以社区腿目前**主要补语义粗筛**，对 doc 级召回的量化提升要等 distill 数据量上来。

## 四、优化建议（按课程"先固根基再求精进"）

课程明确"检索器优先"（Garbage In, Garbage Out）。当前 precision 是瓶颈，按课程路径：

1. **提升 context_precision（第一阶段，检索器）**：
   - 加重排序：对 hybrid top-k 结果用本地 rerank（课程"重排序技术"），把强相关顶前。
   - 收紧 top_k / 调混合权重：小语料下 top_k=5 噪声多，试 top_k=3 + 提高 dense 权重。
   - 分块粒度：课程指出技术文档 200-300 token 更准，当前 512 偏大，可试 256。
2. **提升 context_recall（已高，巩固）**：
   - 社区层已在跑，distill 数据量上来后跨概念召回上限更高。
   - 短 query（"泵站"）可加查询改写扩展（课程"多同义词/子问题"）。
3. **生成侧（待 LLM judge）**：
   - 配 LLM key + `pip install ragas`，本评测脚本的 golden set 可直接喂 ragas
     跑 faithfulness / answer_relevancy，补全五指标。
   - 按课程阈值：高风险场景 faithfulness≥0.9、context_recall≥0.9；通用问答
     answer_relevancy≥0.7。

## 五、结论

- 检索侧 **recall 0.800（高）/ precision 0.449（中）/ F1 0.544**：召回扎实，
  精确率是主要瓶颈——与课程诊断"相关文档排名低、噪声多"一致。
- 社区层（GraphRAG 2.0）已落地并跑通，为跨概念召回补上"摘要语义"腿，
  但 doc 级量化收益待 distill 数据量上来。
- 下一步按课程"检索优先"：上重排序 + 收紧 top_k 提 precision；
  配 LLM key 后补生成侧 2 指标，完成五指标闭环。
