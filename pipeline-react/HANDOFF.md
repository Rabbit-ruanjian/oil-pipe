# pipeline-react 前端交付文档

> 交付对象：接手前端开发
> 交付日期：2026-10-12
> 仓库分支：`feature/rag-graph-llm-techdebt`
> 本文档基于代码逐文件审查 + 前后端协议比对 + 生产构建验证（`npm run build` 通过）写成。

---

## 1. 系统概览

本前端是「管道能耗分析系统」的 React 部分，包含两类功能：

| 类别 | 说明 |
|---|---|
| 业务功能 | 登录、仪表盘、项目/管道/泵站/油品 CRUD、水力分析、泵站优化、敏感性分析、报告 |
| AI 功能（LangGraph 前端） | 智能对话（SSE 流式 + 工具调用 + HITL 人工确认）、知识库中枢（图谱看板 / 专家入库 / 多路检索 / LLM 自动路由）、智能报告 |

**技术栈**：React 19 + TypeScript 5.9 + Vite 7 + antd 6 + Zustand 5 + ECharts 6 + react-router 7 + `@microsoft/fetch-event-source`（SSE）。

**上游服务**：

| 服务 | 端口 | 说明 |
|---|---|---|
| pipeline-gateway | 8080 | Java 网关，所有业务 API 走它（`/auth`、`/project`、`/calculation` 等） |
| pipeline-agent | 8100 | Python FastAPI + LangGraph，AI 对话/知识/图谱/报告（`/api/v1`、`/api/v2`） |

---

## 2. 运行与部署

### 开发环境

```bash
cd pipeline-react
npm install
npm run dev        # 5173
```

`vite.config.ts` 的开发代理（网关目标可用 `.env.local` 的 `VITE_GATEWAY_TARGET` 覆盖，默认 `http://localhost:8080`）：

| 前缀 | 代理目标 |
|---|---|
| `/auth`、`/calculation` | `VITE_GATEWAY_TARGET` |
| `/project`、`/pipeline`、`/pump-station`、`/oil-property`、`/knowledge-doc` | `VITE_GATEWAY_TARGET`，并改写加 `/data` 前缀 |
| `/api/v1`、`/api/v2` | **硬编码 `http://127.0.0.1:8100`**（见 §4 问题 P1-1） |

开发前置条件：按根目录 CLAUDE.md 启动 Java 服务（gateway 8080）与 Python 服务（`cd pipeline-agent && python main.py`，8100）。登录账号默认 `admin / admin123`。

### 生产构建与镜像

```bash
npm run build      # tsc -b && vite build（当前可通过）
docker build -t pipeline-react .   # 多阶段：node 构建 → nginx:1.27 托管
```

`nginx/default.conf` 已配好 SPA fallback 与各服务反代（`/api/v1`、`/api/v2` → `http://pipeline-agent:8100`，已关缓冲、300s 读超时，SSE 可用）。需要注入两个环境变量：`INTERNAL_SERVICE_TOKEN`、`INTERNAL_API_KEY`（nginx 模板替换 `NGINX_ENVSUBST_FILTER` 已声明，值要启动容器时传入）。

### 鉴权

- 业务 API：Sa-Token，axios 拦截器带 `satoken` 头（`src/api/request.ts`）。
- AI API：`src/api/agent.ts` 同时带 `satoken` 和 `Authorization: Bearer`；nginx 还额外注入内部服务 token 头。

### 环境变量一览

| 变量 | 位置 | 说明 |
|---|---|---|
| `VITE_GATEWAY_TARGET` | 开发（`.env.local`） | 网关地址，默认 localhost:8080 |
| `VITE_AGENT_API_BASE_URL` | 构建期 | AI 服务基址。**不设置时：dev 用 `/api/v1`（相对），prod 用 `http://127.0.0.1:8100/api/v1`（有坑，见 P1-1）** |
| `VITE_API_BASE_URL` | 构建期 | 业务 API 前缀，默认空（走代理） |

---

## 3. LangGraph（AI）模块地图

| 路由 | 页面 | 关键组件 | 后端接口 |
|---|---|---|---|
| `/ai/chat` | 智能对话 `pages/ai/AIChat.tsx` | `features/ai-chat/*`（侧栏/消息/输入区/上下文栏）、`components/agent/HITLDialog` | POST `/api/v2/chat/stream`（SSE）、POST `/api/v2/chat/confirm` |
| `/ai/hub` | 知识库中枢 `pages/ai/KnowledgeHub.tsx`（**未提交新文件**） | ECharts 力导向图 + 看板、专家入库表单、多路检索、自动路由问答 | `/graph/query`、`/knowledge/ingest`、`/knowledge/search`、`/knowledge/auto-route`、`/knowledge/documents*` |
| `/data/knowledge` | `pages/data/KnowledgeBase.tsx`（**未提交大改**） | 同上，功能与 `/ai/hub` 高度重复（见 P1-3） | 同左 |
| `/ai/knowledge` | `pages/ai/KnowledgeEntry.tsx`（旧版 Java 知识库页，内嵌了 `<KnowledgeBase />`） | 文档上传/任务历史（走 Java `/knowledge-doc`） | pipeline-data 服务 |
| `/ai/report` | 智能报告 `pages/ai/ReportPreview.tsx` | `components/reporting/DynamicReportView.tsx` | POST `/reports/generate` |

**核心链路**：`AIChat.tsx` → `useAgentTrace`（`src/hooks/useAgentTrace.ts`，1127 行）→ `useSSE`（fetch-event-source POST 流）→ 后端 `chat_v2.py`（LangGraph `astream_events` → `StreamEventProcessor` 统一封装 SSE 事件）。

### v2 SSE 事件协议速查（后端实际只会发这些）

| 事件 | 触发 | 关键字段 |
|---|---|---|
| `trace_init` | 流开始 | `trace_id`、`session_id`、`sequence`（每个包都有） |
| `tool_search` | 动态工具选择 | `selected_tools`、`selected_scores`、`mode`、`filters` |
| `tool_use_start` | 工具开始 | `tool_id`、`name`、`input` |
| `tool_result` + `tool_use_done` | 工具结束（一次发两个包） | `tool_id`、`output`（截断到 1000 字符） |
| `hitl_request` | HITL 中断等待人工 | `request_id`、`scheme`、`options`、`context`（透传子图 payload） |
| `content_delta` | LLM 文本 token | `content` |
| `content_done` | 最终回复 | `response`（全文，覆盖已流式内容）、`intent` |
| `done` | 流结束 | `status` |
| `error` | 异常 | `error` |

> ⚠️ 前端 `useAgentTrace.ts` 还处理 `plan_created` / `step_started` / `thinking_delta` / `response_chunk` / `hitl_resumed` 等事件，但 v2 后端**从不发送**（它们属于 v1 observability 通道）。相关 UI（`PlanTimeline`、步骤状态）实际不会点亮，见 P1-4。

HITL 流程：`hitl_request` → `HITLDialog` 展示方案 → `submitHITL` POST `/chat/confirm`（`selected_option` / `comment` / `modified_data` / `request_id`）→ 返回 `{response, session_id, ...}`；若仍 `hitl_waiting` 会返回提示文案（此时前端会当作 completed 展示，属已知不完美点）。

---

## 4. 已知问题清单（交付基线）

### P0 —— 交付前必须处理

| # | 问题 | 位置 |
|---|---|---|
| P0-1 | **一批功能代码未提交**：图谱看板/知识库中枢功能在 git 里是半成品状态。`M`：`pages/data/KnowledgeBase.tsx`（802 行改动）、`MainLayout.tsx`、`router.tsx`、`KnowledgeEntry.tsx`、`types/agent.ts`；`??`：`pages/ai/KnowledgeHub.tsx` 及 `.module.css`、两个 prototype html。接手者无法从 git 分辨"已完成"与"在途" | `git status` |
| P0-2 | **README 是 Vite 模板样板**（React Compiler 教程），项目零说明：无启动步骤、无服务依赖、无环境变量说明 | `README.md`（本文档 HANDOFF.md 可替换它） |

### P1 —— 应修（影响功能正确性或维护性）

| # | 问题 | 位置 |
|---|---|---|
| P1-1 | 生产构建下 AI 服务地址默认 `http://127.0.0.1:8100`（浏览器直连用户本机，部署必挂）。正确做法是相对路径 `/api/v1`（nginx 已配好）。`V2_BASE_URL` 派生自同一基址，SSE 流同样受影响。除非构建时显式给 `VITE_AGENT_API_BASE_URL` | `src/api/agent.ts:22-24`；`src/hooks/useAgentTrace.ts:32-38,115` |
| P1-2 | HITL 降级路径协议不匹配：`submitHITL` 先打 v2 `/chat/confirm`（平铺字段 ✓），失败后 fallback 到 v1 `agentApi.confirm`，v1 发的是 `{session_id, response:{...}}`，而后端 `HITLConfirmRequest` 期望平铺的 `selected_option` 等 → 422。fallback 形同虚设 | `src/hooks/useAgentTrace.ts:959-985`；`pipeline-agent/src/api/routes/chat.py:188` |
| P1-3 | **同一功能两套并行实现**：`KnowledgeBase.tsx`（data 页，内嵌进 KnowledgeEntry）与 `KnowledgeHub.tsx`（`/ai/hub`）约 90% 逻辑重复（图谱力导向/看板、专家入库、文档列表、自动路由、多路检索），且渲染入口有 3 个（`/data/knowledge`、`/ai/knowledge` 内嵌、`/ai/hub`）。需要定夺唯一实现，另一个删或降级为入口跳转 | 两个文件 + `KnowledgeEntry.tsx` 末尾的 `<KnowledgeBase />` |
| P1-4 | `useAgentTrace` 1127 行单体 hook：一个 `onEvent` 大 switch 处理 ~20 种事件（其中多数 v2 根本不发，见 §3 表后注），且 rAF 缓冲机制（`chunkBufferRef`/`smoothQueueRef`/`flushBuffer`）已变成残留死路径——`content_delta` 现在直接追加不再入缓冲，`flushBuffer` 无人调用。建议按事件族拆子 hook 并清掉死缓冲 | `src/hooks/useAgentTrace.ts` 全文 |
| P1-5 | 「自动路由」开关是**假开关**：`autoRouteOn` 状态存在、Switch UI 存在，但发送逻辑从不读取它，关掉开关仍调用 `autoRouteKnowledge`（两处实现都有） | `KnowledgeBase.tsx:383,388,713`；`KnowledgeHub.tsx:221,236,596` |
| P1-6 | ESLint 现有 **20 error**：`Dashboard.tsx` 渲染期访问 ref（react-hooks/refs，多处）+ 两个 router 文件 fast-refresh 告警。`npm run lint` 目前不过 | `src/pages/dashboard/Dashboard.tsx`、`src/router.tsx`、`src/router-enhanced.tsx` |

### P2 —— 建议修（不影响主链路）

| # | 问题 | 位置 |
|---|---|---|
| P2-1 | 死代码文件（无任何引用）：`router-enhanced.tsx`（218 行）、`components/layout/MainLayoutFixed.tsx`（re-export） | `git grep` 无命中 |
| P2-2 | `components/agent/` 11 个组件中 9 个未被使用（页面实际用的是 `features/ai-chat/components/*`）：TracePanel、PlanTimeline、GraphViewer、SchemeSelector、MetricsBar、ThinkingIndicator、ToolCallCard、ChatMessage、StreamingMarkdown 只从 `index.ts` 导出、无页面引用（`MarkdownRenderer`、`HITLDialog` 在用）；`components/thinking/ThinkingPanel` 同样无人引用 | `src/components/agent/index.ts` |
| P2-3 | 命名混乱：`features/ai-chat/types.ts` 只有一行 `export * from './types-fixed'`，真实类型在 `types-fixed.ts`；建议合并改名 | `src/features/ai-chat/` |
| P2-4 | `KnowledgeHub.tsx` 自动路由"打字机"用 `setInterval` 模拟流式，组件卸载不清理定时器；且 `edge_hits`/`community_hits`/`pagerank` 等新类型字段（`types/agent.ts` 未提交改动）后端已有、前端**全部没接 UI** | `KnowledgeHub.tsx:269-282`；`types/agent.ts:236-292` |
| P2-5 | 图表切换查询未 `notMerge`，旧节点/边可能残留在力导向图（`ReactECharts` 默认 merge） | `KnowledgeHub.tsx:375-390`、`KnowledgeBase.tsx` 同 |
| P2-6 | 删除知识库文档无二次确认（直接调 DELETE） | `KnowledgeHub.tsx:541` |
| P2-7 | `demo.ts`（1892 行完整假数据后端）目前**不可达**：没有任何 UI 路径把 token 设成 `demo-token`（`request.ts` 里 `isDemoModeActive` 永远 false）。要么加演示登录入口，要么整文件删除 | `src/api/demo.ts`、`src/api/request.ts:108+` |
| P2-8 | 看板分列依赖节点 id 前缀（`fault-xxx` / `cause-xxx` …），与后端命名约定强耦合；后端一旦改命名规则看板会静默变空 | `KnowledgeBase.tsx:113-124`、`KnowledgeHub.tsx:113-124` |
| P2-9 | 无任何自动化测试（无 test 脚本、无测试文件）。验收目前只能手工冒烟 | `package.json` |
| P2-10 | 仓库根和 pipeline-react 下散落未跟踪的临时产物：`prototype-knowledge-hifi*.html`、`pipeline-agent/.test-env/`、`pipeline-agent/milvus_lite_data/`、`Hermes执行记录-*.md` 等，交付前应清理或明确归档 | `git status` |

---

## 5. 未提交改动明细（交付方须知）

```
M  pipeline-react/src/pages/data/KnowledgeBase.tsx      # 知识库页加 图谱/专家入库/多路检索/自动路由
M  pipeline-react/src/components/layout/MainLayout.tsx  # 侧边栏加「知识库中枢」菜单
M  pipeline-react/src/router.tsx                         # 加 /ai/hub 路由
M  pipeline-react/src/pages/ai/KnowledgeEntry.tsx        # 内嵌 <KnowledgeBase/>
M  pipeline-react/src/types/agent.ts                      # 图谱 edge_hits/community_hits/pagerank 类型
?? pipeline-react/src/pages/ai/KnowledgeHub.tsx          # 知识库中枢独立页（新）
?? pipeline-react/src/pages/ai/KnowledgeHub.module.css
?? pipeline-react/prototype-knowledge-hifi*.html          # 设计原型，建议移出仓库
```

**建议提交切分**（先提交再交付）：
1. `前端：知识库中枢页（/ai/hub）+ 图谱看板 + 菜单接入`
2. `前端：types/agent.ts 图谱语义命中类型（edge_hits/community_hits）`
3. prototype html 与临时目录移出版本库
4. 修 P1-1（prod AI 基址改相对路径）单独一个提交，附验证说明

后端 `pipeline-agent` 也有一批相关未提交改动（`graph_agent.py`、`knowledge.py`、`config.py`、`src/rag/*`、`src/knowledge_graph/*` 及大量 `knowledge_base/cases`、`scripts/eval_*`），与前端字段对应关系已在 §3 协议速查中列出，**不要单独只交付前端**——前端的图谱新字段（`edge_hits` 等）依赖后端未提交的 `graph_agent.py` 改动。

---

## 6. 验证方法（手工冒烟脚本）

1. 启动 Java 网关/数据服务（8080/9400…）与 `pipeline-agent`（8100，`python main.py`）。
2. `npm run dev`，登录 `admin/admin123`。
3. `/ai/chat`：提问 → 观察侧栏工具调用卡、`content_delta` 逐字流、`done` 后终稿；带 HITL 的复杂任务点确认。
4. `/ai/hub`：图谱查询（如「泵站出口压力下降」，query_type 选 fault_cause）→ 力导向/看板视图；专家入库一条因果链；多路检索；自动路由提问。
5. `/ai/report` 生成一份动态报告。
6. `npm run build` 成功 + `docker build` 跑通（注意 §2 的 env 注入）。

---

## 7. 目录速览

```
src/
├── api/            # request.ts(业务 axios) / agent.ts(AI fetch) / demo.ts(假数据,不可达)
├── hooks/          # useAgentTrace(核心,1127行) / useSSE / useChart* / useScrollToBottom
├── pages/          # ai/(AIChat, KnowledgeHub, KnowledgeEntry, ReportPreview)
│                   # data/ (KnowledgeBase, ProjectList, ...) calculation/ dashboard/ auth/
├── components/     # agent/(大部分死代码) common/ layout/ reporting/ thinking/
├── features/ai-chat/   # 对话页真正在用的组件与 hooks（侧栏/消息/输入/上下文栏）
├── stores/         # userStore(Sa-Token) / themeStore / calculationLinkStore
└── types/          # 业务类型 + agent.ts(AI 类型, 540 行)
```

---

## 8. 交接 Checklist

- [ ] 按 §5 提交切分把未提交功能入 git（含后端配套改动说明）
- [ ] 修 P1-1（prod AI 基址）、P1-5（假开关）；决定 P1-3 双实现的去留
- [ ] 清 P2-1/P2-2 死代码；README 替换为基于 HANDOFF.md 的项目说明
- [ ] 决策 demo.ts（P2-7）去留
- [ ] 补基础测试（至少 AIChat SSE 状态机 + agent.ts 请求层）
- [ ] 走一遍 §6 冒烟脚本
