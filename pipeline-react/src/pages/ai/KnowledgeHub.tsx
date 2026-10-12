import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input, InputNumber, Select, message } from 'antd';
import ReactECharts from 'echarts-for-react';
import AnimatedPage from '../../components/common/AnimatedPage';
import { agentApi } from '../../api/agent';
import type {
  IngestExpertItem,
  IngestKnowledgeResponse,
  KnowledgeDocumentSummary,
  KnowledgeGraphQueryPayload,
  KnowledgeSearchItem,
} from '../../types/agent';
import styles from './KnowledgeHub.module.css';

/* ===== 颜色 / 节点类型(对齐 B4 因果图语义) ===== */
const NODE_COLORS: Record<string, string> = {
  fault: '#f43f5e',
  cause: '#fb923c',
  solution: '#34d399',
  standard: '#a3e635',
  parameter: '#2dd4bf',
};
const TYPE_LABEL: Record<string, string> = {
  fault: '故障',
  cause: '原因',
  solution: '处置',
  standard: '规范',
  parameter: '参数',
};
const KANBAN_COLS: { key: string; label: string }[] = [
  { key: 'fault', label: '故障 fault' },
  { key: 'cause', label: '原因 cause' },
  { key: 'solution', label: '处置 solution' },
  { key: 'standard', label: '规范 standard' },
  { key: 'parameter', label: '参数 parameter' },
];

const QUERY_TYPE_OPTIONS = [
  { label: '自动判定', value: '' },
  { label: '故障原因 (fault_cause)', value: 'fault_cause' },
  { label: '设备链路 (equipment_chain)', value: 'equipment_chain' },
  { label: '一般查询 (general)', value: 'general' },
];

const STATUS_CLASS: Record<string, string> = {
  indexed: 'indexed',
  uploaded: 'uploaded',
  failed: 'failed',
  parsing: 'parsing',
  chunked: 'chunked',
  archived: 'archived',
};

interface ExpertEntry {
  fault: string;
  cause: string;
  prob: number | null;
  solution: string;
}
const EMPTY_ENTRY: ExpertEntry = { fault: '', cause: '', prob: null, solution: '' };

interface ChatMsg {
  role: 'user' | 'bot';
  content: string;
  streaming?: boolean;
}

export default function KnowledgeHub() {
  /* ---------- ① 图谱 ---------- */
  const [graphQuery, setGraphQuery] = useState('');
  const [graphQueryType, setGraphQueryType] = useState('');
  const [graphResult, setGraphResult] = useState<KnowledgeGraphQueryPayload | null>(null);
  const [graphQuerying, setGraphQuerying] = useState(false);
  const [graphView, setGraphView] = useState<'graph' | 'kanban'>('graph');

  const visual = graphResult?.result?.visualization ?? null;

  const graphNodes = useMemo(
    () =>
      (visual?.nodes ?? []).map((node) => ({
        ...node,
        symbolSize:
          node.type === 'fault' ? 54 : node.type === 'cause' ? 40 : node.type === 'solution' ? 36 : 26,
        itemStyle: {
          color: NODE_COLORS[node.type ?? ''] ?? '#8b9bb8',
          shadowBlur: node.type === 'fault' ? 28 : 14,
          shadowColor: NODE_COLORS[node.type ?? ''] ?? '#8b9bb8',
        },
      })),
    [visual],
  );

  const graphLinks = useMemo(
    () =>
      (visual?.edges ?? []).map((edge) => ({
        ...edge,
        lineStyle: {
          color:
            edge.type === 'solved_by'
              ? 'rgba(52,211,153,.55)'
              : edge.type === 'caused_by'
                ? 'rgba(251,146,60,.55)'
                : 'rgba(163,230,53,.35)',
          width: 1.4,
          curveness: 0.15,
          opacity: 0.85,
        },
        label: { show: Boolean(edge.type), formatter: edge.type ?? '', fontSize: 10 },
      })),
    [visual],
  );

  const reachedByType = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const col of KANBAN_COLS) {
      const reached = graphResult?.result?.reached ?? {};
      const nodes = Object.keys(reached).filter((id) => id.startsWith(col.key));
      if (col.key === 'fault' && graphResult?.result?.plan?.start_node_id?.startsWith('fault')) {
        nodes.unshift(graphResult.result.plan.start_node_id);
      }
      map[col.key] = Array.from(new Set(nodes));
    }
    return map;
  }, [graphResult]);

  const runGraphQuery = useCallback(async (query: string, queryType?: string) => {
    setGraphQuerying(true);
    try {
      const result = await agentApi.queryGraph(query, queryType || undefined);
      setGraphResult(result);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '图谱查询失败');
    } finally {
      setGraphQuerying(false);
    }
  }, []);

  const handleGraphQuery = () => {
    if (!graphQuery.trim()) {
      message.warning('请输入图谱查询');
      return;
    }
    void runGraphQuery(graphQuery.trim(), graphQueryType);
  };

  /* ---------- ② 专家入库 ---------- */
  const [expertTitle, setExpertTitle] = useState('');
  const [expertContent, setExpertContent] = useState('');
  const [expertEntries, setExpertEntries] = useState<ExpertEntry[]>([{ ...EMPTY_ENTRY }]);
  const [ingestResult, setIngestResult] = useState<IngestKnowledgeResponse | null>(null);
  const [expertIngesting, setExpertIngesting] = useState(false);

  const updateEntry = (index: number, patch: Partial<ExpertEntry>) => {
    setExpertEntries((cur) => cur.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const handleExpertIngest = async () => {
    if (!expertTitle.trim()) {
      message.warning('请填写知识标题');
      return;
    }
    const valid = expertEntries.filter((e) => e.fault.trim());
    if (valid.length === 0) {
      message.warning('至少填写一条故障/原因');
      return;
    }
    const items: IngestExpertItem[] = valid.map((e) => ({
      fault: e.fault.trim(),
      cause: e.cause.trim() || null,
      prob: e.prob,
      solution: e.solution.trim() || null,
    }));
    setExpertIngesting(true);
    try {
      const result = await agentApi.ingestExpertKnowledge({
        title: expertTitle.trim(),
        category: 'cases',
        content: expertContent.trim() || undefined,
        expertKnowledge: items,
      });
      setIngestResult(result);
      message.success(`入库成功：新增 ${result.expert_nodes_added} 节点 / ${result.expert_edges_added} 边`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '专家知识入库失败');
    } finally {
      setExpertIngesting(false);
    }
  };

  /* ---------- ② 文档列表 ---------- */
  const [documents, setDocuments] = useState<KnowledgeDocumentSummary[]>([]);
  const [docLoading, setDocLoading] = useState(false);

  const loadDocuments = useCallback(async () => {
    setDocLoading(true);
    try {
      const result = await agentApi.listKnowledgeDocuments();
      setDocuments(result.documents ?? []);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载知识文档失败');
    } finally {
      setDocLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const handleDeleteDoc = async (docId: string) => {
    try {
      const result = await agentApi.deleteKnowledgeDocument(docId);
      message.success(result.message || '文档已删除');
      await loadDocuments();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除文档失败');
    }
  };

  /* ---------- ③ 对话自动路由 ---------- */
  const [autoRouteOn, setAutoRouteOn] = useState(true);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('泵站出口压力持续下降怎么处置');
  const [routing, setRouting] = useState(false);
  const [activeRoute, setActiveRoute] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    const el = document.getElementById('kbh-msgs');
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  };

  const handleAutoRoute = async () => {
    const q = chatInput.trim();
    if (!q) {
      message.warning('请输入问题');
      return;
    }
    setChat((cur) => [
      ...cur,
      { role: 'user', content: q },
      { role: 'bot', content: '', streaming: true },
    ]);
    setChatInput('');
    setRouting(true);
    setActiveRoute(null);

    try {
      const result = await agentApi.autoRouteKnowledge({ question: q });
      const route = result.route;
      setActiveRoute(route);

      // 判为图查询 → 联动 ① 图谱
      if (route === 'fault_cause' || route === 'equipment_chain') {
        setGraphQuery(q);
        setGraphView('kanban');
        void runGraphQuery(q);
      }

      const fullText = [
        `已判定为 ${route} 路由：${result.reason}`,
        route === 'fault_cause' || route === 'equipment_chain'
          ? '已联动左侧 ① 图谱区（力导向 / 看板）展示因果链。'
          : (result.sources ?? []).length > 0
            ? `命中 ${(result.sources ?? []).length} 篇文档（相关度排序）。`
            : '走默认检索路径。',
      ].join('\n');
      // 简化流式:逐字填充最后一条 bot 消息
      let count = 0;
      const timer = setInterval(() => {
        count += 2;
        setChat((cur) =>
          cur.map((m, idx) =>
            idx === cur.length - 1 && m.role === 'bot'
              ? { ...m, content: fullText.slice(0, count), streaming: count < fullText.length }
              : m,
          ),
        );
        if (count >= fullText.length) {
          clearInterval(timer);
          void scrollToBottom();
        }
      }, 20);
      setTimeout(scrollToBottom, 50);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '自动路由失败');
      setChat((cur) => [...cur, { role: 'bot', content: '自动路由失败：' + (error instanceof Error ? error.message : '') }]);
    } finally {
      setRouting(false);
    }
  };

  const handleChatSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      void handleAutoRoute();
    }
  };

  /* ---------- ③ 多路检索直连 ---------- */
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTopK, setSearchTopK] = useState(3);
  const [searchResults, setSearchResults] = useState<KnowledgeSearchItem[]>([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      message.warning('请输入检索内容');
      return;
    }
    setSearching(true);
    try {
      const result = await agentApi.searchKnowledge({ query: searchQuery.trim(), topK: searchTopK });
      setSearchResults(result.results ?? []);
      if ((result.results ?? []).length === 0) {
        message.info('未检索到相关内容');
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '检索失败');
    } finally {
      setSearching(false);
    }
  };

  const ROUTE_CLASS: Record<string, string> = {
    graph: styles.routeGraph,
    retrieve: styles.routeRetrieve,
    default: styles.route,
  };
  const routeClass =
    activeRoute === 'fault_cause' || activeRoute === 'equipment_chain'
      ? 'graph'
      : activeRoute === 'retrieve'
        ? 'retrieve'
        : activeRoute
          ? 'default'
          : null;

  return (
    <AnimatedPage className={styles.root}>
      <div className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.logo}>KB</span>
          <div>
            <h1>知识库中枢</h1>
            <p>图谱 · 入库 · 检索 · 对话（接 LangGraph 后端）</p>
          </div>
        </div>
        <div className={styles.meta}>
          <span className={styles.badge}>
            文档 <b>{documents.length}</b>
          </span>
          <span className={styles.badge}>{docLoading ? '同步中…' : '已同步'}</span>
        </div>
      </div>

      <div className={styles.trio}>
        {/* ① 图谱 */}
        <div className={styles.col}>
          <div className={styles.colHead}>
            <span className={styles.colNum}>①</span>
            <h2>图 · 因果图谱</h2>
            <span className={styles.colHint}>力导向 / 看板 · LLM 决策起点/边/跳数</span>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <div>因果链拓扑</div>
              <div className={styles.viewToggle}>
                <button className={graphView === 'graph' ? 'on' : ''} onClick={() => setGraphView('graph')}>力导向</button>
                <button className={graphView === 'kanban' ? 'on' : ''} onClick={() => setGraphView('kanban')}>看板</button>
              </div>
            </div>

            {graphView === 'graph' ? (
              visual && visual.nodes.length > 0 ? (
                <ReactECharts style={{ height: 280 }} option={{
                  backgroundColor: 'transparent',
                  tooltip: { trigger: 'item' },
                  series: [{
                    type: 'graph',
                    layout: 'force',
                    roam: true,
                    draggable: true,
                    edgeSymbol: ['none', 'arrow'],
                    force: { repulsion: 260, edgeLength: 90, gravity: 0.08 },
                    label: { show: true, fontSize: 11, position: 'right' },
                    emphasis: { focus: 'adjacency', lineStyle: { width: 3 } },
                    data: graphNodes,
                    links: graphLinks,
                  }],
                }} />
              ) : (
                <div className={styles.empty}>执行一次图谱查询后,这里会画出相关因果链拓扑（可拖拽缩放）</div>
              )
            ) : (
              <div className={styles.kanban}>
                {KANBAN_COLS.map((col) => (
                  <div key={col.key} className={styles.kcol}>
                    <div className={styles.kcolHead}>
                      <span>{col.label}</span>
                      <span>{(reachedByType[col.key] ?? []).length}</span>
                    </div>
                    {(reachedByType[col.key] ?? []).map((id) => (
                      <div key={id} className={styles.kcard} style={{ borderLeftColor: NODE_COLORS[col.key] }}>
                        <div>{id}</div>
                      </div>
                    ))}
                    {!(reachedByType[col.key] ?? []).length && <div className={styles.kcolEmpty}>(无)</div>}
                  </div>
                ))}
              </div>
            )}

            <div className={styles.legend}>
              {Object.entries(TYPE_LABEL).map(([k, v]) => (
                <span key={k}>
                  <i style={{ background: NODE_COLORS[k] }} /> {v}
                </span>
              ))}
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHead}><div>查询计划（LLM 决策 · 失败降级默认）</div></div>
            <div className={styles.plan}>
              <div className={styles.planItem}>
                <span className={styles.k}>起点</span>
                <span className={styles.v}>
                  {graphResult?.result?.center_node ?? graphResult?.result?.plan?.start_node_id ?? '—'}
                </span>
              </div>
              <div className={styles.planItem}>
                <span className={styles.k}>边</span>
                <span className={styles.v}>
                  {Array.from(new Set(((graphResult?.result?.visualization?.edges ?? []) as Array<{ type?: string }>).map((e) => e?.type).filter(Boolean))).slice(0, 4).join('/ ')
                    || (graphResult?.result?.plan?.edge_types ?? []).join('/ ') || '—'}
                </span>
              </div>
              <div className={styles.planItem}>
                <span className={styles.k}>跳数</span>
                <span className={styles.v}>{graphResult?.result?.plan?.max_hops ?? '1'}</span>
              </div>
            </div>
            <div className={styles.stat}>
              到达 <b>{graphResult?.result?.total_matches ?? Object.keys(graphResult?.result?.reached ?? {}).length}</b> · 路径{' '}
              <b>{((graphResult?.result?.visualization?.edges ?? []).length || graphResult?.result?.path_count || 0)}</b>
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHead}><div>图谱查询</div></div>
            <div className={styles.row}>
              <Input
                placeholder="例如:泵站出口压力下降"
                value={graphQuery}
                onChange={(e) => setGraphQuery(e.target.value)}
                onPressEnter={handleGraphQuery}
                allowClear
              />
              <Select style={{ width: 150 }} options={QUERY_TYPE_OPTIONS} value={graphQueryType} onChange={setGraphQueryType} />
              <button className={styles.go} disabled={graphQuerying} onClick={handleGraphQuery}>
                {graphQuerying ? '查询中…' : '查询'}
              </button>
            </div>
          </div>
        </div>

        {/* ② 入库 */}
        <div className={styles.col}>
          <div className={styles.colHead}>
            <span className={styles.colNum}>②</span>
            <h2>添加 · 知识入库</h2>
            <span className={styles.colHint}>专家因果直入(A 类) + 文档列表</span>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHead}><div>专家知识直入（因果链 → 节点+有向边）</div></div>
            <div className={styles.row2}>
              <Input placeholder="知识标题,例如:泵站出口压力低处置方案" value={expertTitle} onChange={(e) => setExpertTitle(e.target.value)} />
              <Input.TextArea
                rows={2}
                placeholder="可选:补充说明文本(会按文档 chunk 入库)"
                value={expertContent}
                onChange={(e) => setExpertContent(e.target.value)}
              />
              <div className={styles.expertHead}>故障 → 原因 → 处置</div>
              {expertEntries.map((entry, index) => (
                <div key={index} className={styles.expertRow}>
                  <Input placeholder="故障" value={entry.fault} onChange={(e) => updateEntry(index, { fault: e.target.value })} />
                  <Input placeholder="原因" value={entry.cause} onChange={(e) => updateEntry(index, { cause: e.target.value })} />
                  <InputNumber
                    min={0}
                    max={1}
                    step={0.1}
                    placeholder="概率"
                    style={{ width: 80 }}
                    value={entry.prob}
                    onChange={(value) => updateEntry(index, { prob: value })}
                  />
                  <Input placeholder="处置" value={entry.solution} onChange={(e) => updateEntry(index, { solution: e.target.value })} />
                  {expertEntries.length > 1 && (
                    <button className={styles.del} onClick={() => setExpertEntries((cur) => cur.filter((_, i) => i !== index))}>
                      删
                    </button>
                  )}
                </div>
              ))}
              <div className={styles.btnRow}>
                <button className={styles.add} onClick={() => setExpertEntries((cur) => [...cur, { ...EMPTY_ENTRY }])}>+ 加一条</button>
                <button className={styles.go} disabled={expertIngesting} onClick={() => void handleExpertIngest()}>
                  {expertIngesting ? '入库中…' : '入库'}
                </button>
              </div>
              {ingestResult && (
                <div className={styles.ingMsg}>
                  ✓ 新增 {ingestResult.expert_nodes_added} 节点 / {ingestResult.expert_edges_added} 边,doc_id={ingestResult.doc_id}
                </div>
              )}
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <div>知识文档列表</div>
              <button className={styles.refresh} onClick={() => void loadDocuments()}>刷新</button>
            </div>
            <div className={styles.docList}>
              <div className={styles.docHead}>
                <span>文档 / 文件</span>
                <span>分类</span>
                <span>状态</span>
                <span>操作</span>
              </div>
              {documents.slice(0, 6).map((doc) => (
                <div key={doc.doc_id} className={styles.docRow}>
                  <div className={styles.docName}>
                    <span className={styles.docFile}>{(doc.file_name || doc.title).slice(-6).toUpperCase()}</span>
                    <div>
                      <div className={styles.docTitle}>{doc.title}</div>
                      <div className={styles.docSub}>{doc.file_name}</div>
                    </div>
                  </div>
                  <span className={styles.docCat}>{doc.category}</span>
                  <span className={`${styles.docSt} ${STATUS_CLASS[doc.status] ?? ''}`}>
                    <i /> {doc.status}
                  </span>
                  <button className={styles.docDel} onClick={() => void handleDeleteDoc(doc.doc_id)}>删除</button>
                </div>
              ))}
              {documents.length === 0 && <div className={styles.empty}>暂无文档</div>}
            </div>
            <div className={styles.fmtLine}>支持格式 .md .txt .pdf .docx · 分类 标准 / 公式 / 规程 / 案例 / 问答</div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHead}><div>文档录入（.md/.txt/.pdf/.docx）</div></div>
            <div className={styles.row2}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.txt,.pdf,.docx"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    void agentApi
                      .uploadKnowledgeDocument({
                        file: f,
                        title: f.name.replace(/\.[^.]+$/, ''),
                        source: '手动录入',
                        category: 'faq',
                        tags: ['知识库'],
                      })
                      .then(() => {
                        message.success('文档已提交,后台入库');
                        void loadDocuments();
                      })
                      .catch((err) => message.error(err instanceof Error ? err.message : '上传失败'));
                  }
                }}
              />
              <div className={styles.ingMsg}>选择文件后自动上传,提交后进入后台任务解析</div>
            </div>
          </div>
        </div>

        {/* ③ 对话 */}
        <div className={styles.col}>
          <div className={styles.colHead}>
            <span className={styles.colNum}>③</span>
            <h2>询问 · 对话问答</h2>
            <span className={styles.colHint}>提问 → LLM 自选 B4图/B1B2B3检索 · 流式打字</span>
          </div>

          <div className={styles.chatPanel}>
            <div className={styles.chatHead}>
              <span className={styles.av}>智</span>
              <div>
                <div className={styles.tt}>智能对话</div>
                <div className={styles.sub}>LLM 自动路由</div>
              </div>
              <span className={styles.chatSt}>{autoRouteOn ? '已连接' : '自动路由关 → 走默认'}</span>
              <button className={styles.switch} onClick={() => setAutoRouteOn((v) => !v)}>
                <span className={autoRouteOn ? styles.tkOn : styles.tk} />
                自动路由
              </button>
            </div>

            <div className={styles.msgs} id="kbh-msgs">
              {chat.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className={styles.msgUser}>
                    <div className={styles.userBubble}>{m.content}</div>
                  </div>
                ) : (
                  <div key={i} className={styles.msgBot}>
                    <span className={styles.bob}>智</span>
                    <div className={styles.botBubble}>
                      <div className={`${styles.route} ${routeClass ? ROUTE_CLASS[routeClass] ?? '' : ''}`}>
                        {activeRoute ? <span className={styles.routeTag}>{activeRoute}</span> : null}
                      </div>
                      <div className={styles.streamBody}>
                        {m.content.split('\n').map((line, li) => (
                          <p key={li}>{line}</p>
                        ))}
                        {m.streaming ? <span className={styles.cursor} /> : null}
                      </div>
                    </div>
                  </div>
                ),
              )}
              {chat.length === 0 && <div className={styles.empty}>在下方输入问题,LLM 自动选择查询方式…</div>}
            </div>

            <div className={styles.inputBar}>
              <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={handleChatSubmit} placeholder="输入问题,LLM 自动选择查询方式…" />
              <button disabled={routing} onClick={() => void handleAutoRoute()}>
                {routing ? '路由中…' : '发送'}
              </button>
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHead}><div>命中来源 + 检索路线（由 ③ 提问触发）</div></div>
            <div className={styles.pipe}>
              <div className={`${styles.pstep} ${activeRoute === 'fault_cause' || activeRoute === 'equipment_chain' ? styles.hit : ''}`}>
                <span className={styles.pnode}>B4</span>
                <div>
                  <div className={styles.pt}>B4 因果链图</div>
                  <div className={styles.ps}>故障排查 / 设备组成</div>
                </div>
              </div>
              <div className={`${styles.pstep} ${activeRoute === 'retrieve' ? styles.hit : ''}`}>
                <span className={styles.pnode}>B1B2B3</span>
                <div>
                  <div className={styles.pt}>B1·B2·B3 混合检索</div>
                  <div className={styles.ps}>概念 / 操作 / 知识</div>
                </div>
              </div>
              <div className={`${styles.pstep} ${activeRoute === 'default' ? styles.hit : ''}`}>
                <span className={styles.pnode}>默认</span>
                <div>
                  <div className={styles.pt}>默认单路</div>
                  <div className={styles.ps}>降级 · 行为不变</div>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHead}><div>多路检索（B1 扩召回 / B2 分解 / B3 HyDE）</div></div>
            <div className={styles.row}>
              <Input placeholder="例如:管道输送阻力偏大怎么办" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onPressEnter={() => void handleSearch()} />
              <InputNumber min={1} max={10} value={searchTopK} onChange={(v) => setSearchTopK(v ?? 3)} style={{ width: 70 }} />
              <button className={styles.go} disabled={searching} onClick={() => void handleSearch()}>{searching ? '检索中…' : '检索'}</button>
            </div>
            <div className={styles.searchResults}>
              {searchResults.map((item) => (
                <div key={`${item.doc_id}-${item.score}`} className={styles.scard}>
                  <div className={styles.scardTop}>
                    <span className={styles.scardCat}>{item.category ?? '-'}</span>
                    <span className={styles.scardTitle}>{item.doc_title}</span>
                    <span className={styles.scardScore}>{item.score.toFixed(2)}</span>
                  </div>
                  <div className={styles.scardPrev}>{item.content_preview}</div>
                </div>
              ))}
              {searchResults.length === 0 && <div className={styles.empty}>检索结果会显示在这里</div>}
            </div>
          </div>
        </div>
      </div>
    </AnimatedPage>
  );
}
