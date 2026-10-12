# 执行报告：pipeline-agent RAG 排查优化（P0 落地）

- 日期：2026-10-08
- 范围：/Users/Admin/Desktop/oil-pipe/pipeline-agent
- 执行团队：Agent Team rag-optimization（team-lead + 4 成员）
- 依据：/Users/Admin/Desktop/pipeline-agent-RAG排查与优化报告.md

## 做了什么

按报告 §4 优先级，用并行子代理完成 P0-③ 基线 + P0-② 检索优化 + P0-① 入库接口：

| 任务 | 内容 | 负责 | 状态 |
|---|---|---|---|
| #1 | P0-③ 可插拔基线：config.py 8 个开关（默认全关）+ src/rag/hooks.py 两处 pre-execution hook + src/llm/llm_client.py 统一 LLM 封装 | t1 | ✅ |
| #2 | B1 多路查询 expand + B2 分解 decompose + 入口自动路由（简单→B1，复杂→B2 再 B1，低置信→HITL） | t2 | ✅ |
| #3 | B5 在线 HyPE 完善问题：question_refiner.py 完整性判断 + HITL 反问补全循环 N 轮 + 规则 C | t3 | ✅ |
| #4 | A 类 /knowledge/ingest：expert_knowledge 直入 + LLM 因果链/步骤/知识点抽取 + 文档图→专家图蒸馏 + HITL 检测 | t4 | ✅ |
| #5 | 一致性回归收尾：全关回归 + 全量测试 | team-lead | ✅ |

## 根因 / 理由

报告 §2 指出：多路查询（multi-query）名不副实（1→1 改写）、无分解、enrichment 只做离线 HyPE、文档图退化成共现表、写入侧无知识抽取。本次落地：

- 检索侧补 B1（横向扩召回）/ B2（纵向拆子问题）/ B3-HyDE 预留 / B5（在线完善问题）
- 入库侧补 A1（/knowledge/ingest 结构化直入 + HITL）/ A2（LLM 抽取因果/步骤/知识点）/ A3（文档图→专家图蒸馏，不新增 Node/Edge 类型）
- 全部遵循 P0-③ 可插拔原则：执行前 hook + 独立开关 + 默认关 + 关闭时逐字节一致 + 降级兜底

## 改了哪些文件

**新增**
- src/llm/__init__.py, src/llm/llm_client.py（LLMClient.complete/chat + LLMClientError + 超时，复用 OPENAI_API_KEY 无新依赖）
- src/rag/hooks.py（PreIngestion/PreRetrieval hook + 注册/执行/降级 + clear_hooks）
- src/rag/question_refiner.py（B5 在线 HyPE 完善问题，~540 行）
- src/rag/knowledge_ingest.py（A 类 ingest 编排，~1030 行）
- tests/test_hooks.py, tests/test_llm_client.py, tests/test_multi_query_decompose.py, tests/test_question_refiner.py, tests/test_knowledge_ingest.py

**修改**
- src/config.py（8 个 P0-③ 开关 + RAGConfig.pluggable property，默认全关）
- src/rag/self_rag.py（QueryRewriter.expand/decompose + _default_llm_call 切点，B1/B2）
- src/rag/pipeline.py（_run_hybrid_route 多路编排 + 去重 RRF 融合 + 低置信 HITL，全关时逐字节等价）
- src/rag/knowledge_registry.py（save_upload 挂入库前 hook 调用点，受开关门控）
- src/rag/__init__.py（导出 + 修复 get_rag_pipeline 导出缺口）
- src/api/routes/knowledge.py（POST /knowledge/ingest + IngestRequest/IngestResponse）

## 验证结果

- 全量 pytest：**69 passed in 1.88s**（含 5 个新增测试文件）
- 全关回归验证（P0-③ 验收点）：
  - 默认不显式设环境变量时 `get_rag_config().pluggable` 全部开关 = False（默认全关）✅
  - #2 `test_all_off_main_loop_equivalent_to_pre_change`：全关时 retriever.retrieve 恰调 1 次、零 LLM 调用、输出与改造前一致 ✅
  - #3 `test_refiner_callable_switch_off_returns_original`：question_refine 关时返回原 query ✅
  - #4 `test_save_upload_noop_when_all_flags_off`：全关时 save_upload hook no-op、不碰 LLM/图 ✅
- 循环导入（早期 t4 引入，已由 t4 修好）：`import src.rag` / `import src.knowledge_graph` / 全量 pytest 收集均通过 ✅
  - t4 重连后补交修法：删 `knowledge_ingest.py` 顶层 `from .knowledge_registry import get_knowledge_registry`（环断点）→ 新增 `_get_registry()` 函数内延迟 import，替换 4 处调用点（`_resolve_file_path`/`read_hitl_history`/`record_hitl_history`/`ingest_structured_knowledge`）
  - 顺带修隐藏 bug：`normalize_expert_knowledge` 的 `seen_nodes` 曾只在 226 行被 add、从未初始化 → 补 `seen_nodes: set[str] = set()`
  - 测试断言修正：`test_low_confidence_triggers_hitl` request_id 实际由生产代码生成 `ingest-<hex>` → 改 `startswith("ingest-")`；`test_history_choice_auto_executes` 未走弹窗分支时 `hitl_triggered` 为 None → 改 `not out.get(...)`
- 降级兜底：LLMClientError / HITL 超时 / hook 异常 → 捕获跳过不阻断，均有测试覆盖 ✅

## 第二轮补全（feature/rag-graph-llm-techdebt 分支）

P0 收口后用户要求继续做 1+2（LLM 切点统一 + B3 HyDE），3+4（B4 + P1/P2）另开分支。已全部落地：

- **第 1 项 LLM 切点统一**：B1/B2（self_rag._default_llm_call）与 B5（question_refiner._judge_completeness）的 LLM 调用从 ChatOpenAI 直连切到 src/llm/llm_client.get_llm_client()，统一超时/降级入口（LLMClientError）；B5 保留 LLM 失败→低置信度兜底（规则 C）降级。
- **第 2 项 B3 在线 HyDE**：QueryRewriter.hyde() 生成假想答案 → 并入 _build_multi_query_list 的多路候选（hyde 开关门控，默认 False 关闭时不触 LLM、行为不变）；_run_hybrid_route 的 multi_query/decompose/hyde 门控加 or hyde。
- **第 3 项 B4 图查询 LLM-in-the-loop**：新增 src/knowledge_graph/graph_traversal.py（GraphTraversalPlanner.plan/traverse，LLM 决策 start_node/edge_types/max_hops 有界遍历，开关 graph_traversal_llm 默认关；LLM 失败/关 → 降级固定遍历，行为不变）；GraphAgent.execute 接入 _maybe_graph_traversal。
- **P1 结构化入参**：/graph/query 暴露 query_type（fault_cause/standards/equipment_chain/general），透传 GraphAgent.execute，缺省 None 行为不变。
- **第 4 项 P2 技术债**：
  1. MySQL t_kg_node/edge 死代码（upsert_kg_node/edge 无业务调用方）→ 加 DEPRECATED 注释 + 从 persistence/__init__.py 移除导出，函数保留待将来接上关系库复用。
  2. auth.py _verify_token 假校验（`return bool(token)`）→ 加 P2 注释说明 placeholder + 生产靠 dispatch() 第 33 行开关兜底，不强行改校验逻辑（报告 P2 单独立项修，需与 Java Sa-Token 对齐，超出本次范围）。

**验证**：第二轮全量 **78 passed**（B4 新增 5 个测试）；默认全关验收通过（含 hyde/graph_traversal_llm 全 False）。

## 遗留项（更新）

1. **auth.py 真校验**：_verify_token 仍是 placeholder，需独立 issue 与 Java 侧 Sa-Token 对齐（签名/白名单/有效期）。
2. **P2 offline 评测集（golden set）**：B1/B2/B3 召回质量证明仍未建，仅实现了离线评测占位，需补 golden set 证明提了召回。
3. **MySQL 图谱表接上关系库**：upsert_kg_node/edge 已标记废弃但未真正接上，真图谱仍走 JSON 文件；将来若需分布式图谱需接上或彻底删除函数。
4. **执行记录卷未挂载**：/Volumes/资料项目整理/Hermes执行记录/ 本环境不可写，本报告先落本地，待卷挂载后迁移。
5. **t4 早标记完成**：t4 在循环导入未修、测试文件未确认时标了 #4 completed，team-lead 在 #5 收尾时发现循环导入（实际 t4 中断前已修好，旧状态残留）并补验，最终全绿。后续团队成员交付需"全量测试绿"再标记。

## 环境备注

- macOS，无系统 venv，t4 建了 .venv（Python 3.11 + requirements + pytest）
- 跑测试需环境变量绕过 config 校验：OPENAI_API_KEY=x EMBEDDING_API_KEY=x DB_PASSWORD=x JAVA_AUTH_PASSWORD=x AUTH_REQUIRED_IN_PRODUCTION=false
