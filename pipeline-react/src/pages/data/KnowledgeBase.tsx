import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Progress,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  NodeIndexOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import ReactECharts from 'echarts-for-react';
import AnimatedPage from '../../components/common/AnimatedPage';
import { agentApi } from '../../api/agent';
import type {
  AutoRouteResponse,
  IngestExpertItem,
  IngestKnowledgeResponse,
  KnowledgeDocumentSummary,
  KnowledgeGraphQueryPayload,
  KnowledgeSearchItem,
} from '../../types/agent';

const { Text } = Typography;

const ACCEPT_TYPES = '.md,.txt,.pdf,.docx';
const DEFAULT_SOURCE = '手动录入';
const DEFAULT_TAGS = ['知识库'];

const CATEGORY_OPTIONS = [
  { label: '标准规范', value: 'standards' },
  { label: '计算公式', value: 'formulas' },
  { label: '操作规程', value: 'operations' },
  { label: '案例经验', value: 'cases' },
  { label: '常见问答', value: 'faq' },
];

const STATUS_COLORS: Record<string, string> = {
  indexed: 'green',
  uploaded: 'blue',
  failed: 'red',
  parsing: 'gold',
  chunked: 'cyan',
  archived: 'default',
  draft: 'default',
};

const NODE_COLORS: Record<string, string> = {
  fault: '#f43f5e',
  cause: '#fb923c',
  solution: '#34d399',
  standard: '#a3e635',
  parameter: '#2dd4bf',
};

const KANBAN_COLUMNS: { key: string; label: string; color: string }[] = [
  { key: 'fault', label: '故障 fault', color: 'red' },
  { key: 'cause', label: '原因 cause', color: 'orange' },
  { key: 'solution', label: '处置 solution', color: 'green' },
  { key: 'standard', label: '规范 standard', color: 'lime' },
  { key: 'parameter', label: '参数 parameter', color: 'cyan' },
];

const QUERY_TYPE_OPTIONS = [
  { label: '自动判定', value: '' },
  { label: '故障原因 (fault_cause)', value: 'fault_cause' },
  { label: '标准规范 (standards)', value: 'standards' },
  { label: '设备链路 (equipment_chain)', value: 'equipment_chain' },
  { label: '一般查询 (general)', value: 'general' },
];

interface UploadFormValues {
  title: string;
  category: string;
}

interface ExpertEntry {
  fault: string;
  cause: string;
  prob: number | null;
  solution: string;
}

const EMPTY_ENTRY: ExpertEntry = { fault: '', cause: '', prob: null, solution: '' };

export default function KnowledgeBase() {
  // ============ 文档列表（保留原作者能力） ============
  const [form] = Form.useForm<UploadFormValues>();
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [documents, setDocuments] = useState<KnowledgeDocumentSummary[]>([]);

  const loadDocuments = async () => {
    setLoading(true);
    try {
      const result = await agentApi.listKnowledgeDocuments();
      setDocuments(result.documents ?? []);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载知识文档失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpload = async () => {
    try {
      const values = await form.validateFields();
      if (!selectedFile) {
        message.warning('请先选择要上传的文件');
        return;
      }
      setUploading(true);
      const result = await agentApi.uploadKnowledgeDocument({
        file: selectedFile,
        title: values.title.trim(),
        source: DEFAULT_SOURCE,
        category: values.category,
        tags: DEFAULT_TAGS,
      });
      message.success(result.message || '知识文档上传成功');
      form.resetFields();
      setSelectedFile(null);
      setFileInputKey((current) => current + 1);
      await loadDocuments();
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'errorFields' in error) {
        message.warning('请先补全文档标题后再上传');
        return;
      }
      message.error(error instanceof Error ? error.message : '知识文档上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (docId: string) => {
    try {
      const result = await agentApi.deleteKnowledgeDocument(docId);
      message.success(result.message || '文档已删除');
      await loadDocuments();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除文档失败');
    }
  };

  const columns: ColumnsType<KnowledgeDocumentSummary> = [
    {
      title: '文档标题',
      dataIndex: 'title',
      render: (value: string, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{value}</Text>
          <Text type="secondary">{record.file_name}</Text>
        </Space>
      ),
    },
    {
      title: '分类',
      dataIndex: 'category',
      width: 140,
      render: (value: string) => <Tag color="blue">{value}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (value: string) => <Tag color={STATUS_COLORS[value] || 'default'}>{value}</Tag>,
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: 180,
      render: (value?: string | null) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 110,
      render: (_, record) => (
        <Popconfirm
          title="确认删除这份知识文档吗？"
          okText="删除"
          cancelText="取消"
          onConfirm={() => void handleDelete(record.doc_id)}
        >
          <Button danger icon={<DeleteOutlined />}>
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ];

  // ============ ① 图谱（力导向 + 看板） ============
  const [graphQuery, setGraphQuery] = useState('');
  const [graphQueryType, setGraphQueryType] = useState('');
  const [graphResult, setGraphResult] = useState<KnowledgeGraphQueryPayload | null>(null);
  const [graphQuerying, setGraphQuerying] = useState(false);
  const [graphView, setGraphView] = useState<'graph' | 'kanban'>('graph');

  const visual = useMemo(() => graphResult?.result?.visualization ?? null, [graphResult]);

  // 节点大小/边粗细按 PageRank 重要性映射（对标 ragflow：核心实体更大、强关系更粗）
  const rankScale = useMemo(() => {
    const ranks = (visual?.nodes ?? []).map((n) => n.pagerank ?? 0);
    const min = Math.min(0.1, ...ranks);
    const max = Math.max(0.1, ...ranks);
    return (rank: number) => 0.25 + 0.75 * Math.min(1, Math.max(0, (rank - min) / (max - min || 1)));
  }, [visual]);

  const graphNodes = useMemo(
    () =>
      (visual?.nodes ?? []).map((node) => {
        const baseSize =
          node.type === 'fault' ? 54 : node.type === 'cause' ? 40 : node.type === 'solution' ? 36 : 26;
        const strength = node.pagerank != null ? rankScale(node.pagerank) : 0.4;
        return {
          ...node,
          symbolSize: Math.round(baseSize * strength),
          itemStyle: {
            color: NODE_COLORS[node.type ?? ''] ?? '#8b9bb8',
            shadowBlur: node.type === 'fault' ? 28 : 14,
            shadowColor: NODE_COLORS[node.type ?? ''] ?? '#8b9bb8',
          },
        };
      }),
    [visual, rankScale],
  );

  const graphLinks = useMemo(
    () =>
      (visual?.edges ?? []).map((edge) => {
        // 边重要性：有 PageRank 时按其映射粗细（ragflow weight×4 同思路），无则按 weight
        const strength = edge.pagerank != null ? rankScale(edge.pagerank) : 0.3;
        return {
          ...edge,
          lineStyle: {
            color:
              edge.type === 'solved_by'
                ? 'rgba(52,211,153,.55)'
                : edge.type === 'caused_by'
                  ? 'rgba(251,146,60,.55)'
                  : 'rgba(163,230,53,.35)',
            width: 1.4 + strength * 3.5,
            curveness: 0.15,
            opacity: 0.85,
          },
          label: { show: Boolean(edge.type), formatter: edge.type ?? '', fontSize: 10 },
        };
      }),
    [visual, rankScale],
  );

  const reachedByType = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const col of KANBAN_COLUMNS) {
      const reached = graphResult?.result?.reached ?? {};
      const nodes = Object.keys(reached).filter((id) => id.startsWith(col.key));
      if (col.key === 'fault' && graphResult?.result?.plan?.start_node_id?.startsWith('fault')) {
        nodes.unshift(graphResult.result.plan.start_node_id);
      }
      map[col.key] = Array.from(new Set(nodes));
    }
    return map;
  }, [graphResult]);

  const runGraphQuery = async (query: string, queryType?: string) => {
    setGraphQuerying(true);
    try {
      const result = await agentApi.queryGraph(query, queryType || undefined);
      setGraphResult(result);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '图谱查询失败');
    } finally {
      setGraphQuerying(false);
    }
  };

  const handleGraphQuery = () => {
    if (!graphQuery.trim()) {
      message.warning('请输入图谱查询');
      return;
    }
    void runGraphQuery(graphQuery.trim(), graphQueryType);
  };

  // ============ ② A 类专家入库 ============
  const [expertIngesting, setExpertIngesting] = useState(false);
  const [expertTitle, setExpertTitle] = useState('');
  const [expertContent, setExpertContent] = useState('');
  const [expertEntries, setExpertEntries] = useState<ExpertEntry[]>([{ ...EMPTY_ENTRY }]);
  const [ingestResult, setIngestResult] = useState<IngestKnowledgeResponse | null>(null);

  const updateEntry = (index: number, patch: Partial<ExpertEntry>) => {
    setExpertEntries((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
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
      message.success(`入库成功：新增 ${result.expert_nodes_added} 个节点、${result.expert_edges_added} 条边`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '专家知识入库失败');
    } finally {
      setExpertIngesting(false);
    }
  };

  // ============ 多路检索 ============
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

  // ============ ③ 对话自动路由 ============
  const [autoRouteOn, setAutoRouteOn] = useState(true);
  const [autoRouteQuestion, setAutoRouteQuestion] = useState('');
  const [autoRouteResult, setAutoRouteResult] = useState<AutoRouteResponse | null>(null);
  const [autoRouting, setAutoRouting] = useState(false);

  const handleAutoRoute = async () => {
    if (!autoRouteQuestion.trim()) {
      message.warning('请输入问题');
      return;
    }
    setAutoRouting(true);
    try {
      const result = await agentApi.autoRouteKnowledge({ question: autoRouteQuestion.trim() });
      setAutoRouteResult(result);
      if (result.route === 'fault_cause' || result.route === 'equipment_chain') {
        // 判为图查询 → 回填 ① 并联动图谱
        setGraphQuery(autoRouteQuestion.trim());
        setGraphView('kanban');
        void runGraphQuery(autoRouteQuestion.trim());
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '自动路由失败');
    } finally {
      setAutoRouting(false);
    }
  };

  return (
    <AnimatedPage>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {/* ① 图谱:因果链可视化 + B4 查询计划 */}
        <Card
          title="① 图谱 · 因果链可视化（B4 LLM-in-the-loop 遍历）"
          extra={
            <Space>
              <Text type="secondary">视图</Text>
              <Select
                size="small"
                style={{ width: 120 }}
                value={graphView}
                onChange={(value) => setGraphView(value as 'graph' | 'kanban')}
                options={[
                  { label: '力导向', value: 'graph' },
                  { label: '看板', value: 'kanban' },
                ]}
              />
            </Space>
          }
        >
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space wrap style={{ width: '100%' }}>
              <Input
                placeholder="例如：泵站出口压力下降"
                style={{ width: 280 }}
                value={graphQuery}
                onChange={(e) => setGraphQuery(e.target.value)}
                onPressEnter={handleGraphQuery}
              />
              <Select
                style={{ width: 200 }}
                options={QUERY_TYPE_OPTIONS}
                value={graphQueryType}
                onChange={setGraphQueryType}
              />
              <Button
                type="primary"
                icon={<NodeIndexOutlined />}
                loading={graphQuerying}
                onClick={handleGraphQuery}
              >
                查询
              </Button>
            </Space>

            {graphView === 'graph' ? (
              visual && visual.nodes.length > 0 ? (
                <ReactECharts
                  style={{ height: 360 }}
                  option={{
                    tooltip: { trigger: 'item' },
                    legend: { show: false },
                    series: [
                      {
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
                      },
                    ],
                  }}
                />
              ) : (
                <Text type="secondary">
                  执行一次图谱查询后,这里会画出相关因果链拓扑（力导向,可拖拽缩放）
                </Text>
              )
            ) : (
              <div>
                <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                  看板模式:按节点类型分列（fault / cause / solution / standard / parameter）,展示
                  B4 遍历到达的节点
                </Text>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(5, 1fr)',
                    gap: 10,
                    alignItems: 'start',
                  }}
                >
                  {KANBAN_COLUMNS.map((col) => (
                    <div
                      key={col.key}
                      style={{
                        background: '#fafafa',
                        border: '1px solid #f0f0f0',
                        borderRadius: 8,
                        padding: 10,
                        minHeight: 120,
                      }}
                    >
                      <Space
                        style={{
                          justifyContent: 'space-between',
                          width: '100%',
                          marginBottom: 8,
                        }}
                      >
                        <Tag color={col.color}>{col.label}</Tag>
                        <Text type="secondary">{reachedByType[col.key]?.length ?? 0}</Text>
                      </Space>
                      <Space direction="vertical" size={6} style={{ width: '100%' }}>
                        {(reachedByType[col.key] ?? []).map((id) => (
                          <Card key={id} size="small" style={{ width: '100%' }}>
                            <Text strong>{id}</Text>
                          </Card>
                        ))}
                        {!(reachedByType[col.key] ?? []).length && (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            （无）
                          </Text>
                        )}
                      </Space>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {graphResult?.result?.plan && (
              <Space wrap>
                <Text type="secondary">查询计划（LLM 决策 · 失败降级默认）:</Text>
                <Tag>起点 {graphResult.result.plan.start_node_id}</Tag>
                <Tag>边 {graphResult.result.plan.edge_types.join(' / ') || '-'}</Tag>
                <Tag>跳数 {graphResult.result.plan.max_hops}</Tag>
                <Tag>到达 {Object.keys(graphResult.result.reached ?? {}).length} · 路径 {graphResult.result.path_count ?? 0}</Tag>
              </Space>
            )}

            {/* 图语义命中（对标 ragflow relation/社区检索）：本轮 query 与因果边、社区摘要的向量相似度 */}
            {(graphResult?.result?.edge_hits?.length || graphResult?.result?.community_hits?.length) ? (
              <Row gutter={16}>
                {graphResult?.result?.edge_hits?.length ? (
                  <Col span={12}>
                    <Card size="small" title="因果边命中（边描述向量）">
                      <Space direction="vertical" size={6} style={{ width: '100%' }}>
                        {graphResult.result.edge_hits.map((hit, i) => (
                          <Space key={`${hit.edge_type}-${i}`} style={{ width: '100%' }} align="start">
                            <Tag color="orange">{hit.edge_type}</Tag>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <Text style={{ fontSize: 12 }}>{hit.description}</Text>
                              <Progress
                                percent={Math.round(hit.score * 100)}
                                size="small"
                                status={hit.score >= 0.8 ? 'success' : 'normal'}
                              />
                            </div>
                          </Space>
                        ))}
                      </Space>
                    </Card>
                  </Col>
                ) : null}
                {graphResult?.result?.community_hits?.length ? (
                  <Col span={12}>
                    <Card size="small" title="社区摘要命中（社区向量）">
                      <Space direction="vertical" size={6} style={{ width: '100%' }}>
                        {graphResult.result.community_hits.map((hit) => (
                          <div key={hit.community_id}>
                            <Space>
                              <Tag color="purple">{hit.community_id}</Tag>
                              <Text style={{ fontSize: 12 }}>{hit.summary}</Text>
                            </Space>
                            <Progress percent={Math.round(hit.score * 100)} size="small" />
                          </div>
                        ))}
                      </Space>
                    </Card>
                  </Col>
                ) : null}
              </Row>
            ) : null}

            {/* 重要性图例（对标 ragflow：节点大小 = PageRank） */}
            {visual && visual.nodes.length > 0 && (
              <Space wrap size={16}>
                <Tooltip title="节点大小 = PageRank 重要性（核心实体更大）；边粗细 = 两端点 PageRank 短板">
                  <Text type="secondary">
                    节点/边大小粗细 = PageRank 重要性（离线预存,编码进边向量描述）
                  </Text>
                </Tooltip>
                <Space size={4}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: '#8b9bb8',
                    }}
                  />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    弱 → 强
                  </Text>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: '#8b9bb8',
                    }}
                  />
                </Space>
              </Space>
            )}
          </Space>
        </Card>

        {/* ② A 类专家入库 */}
        <Card title="② 添加 · 专家知识入库（因果链直入,A 类）">
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Input
              placeholder="知识标题，例如：泵站出口压力低处置方案"
              value={expertTitle}
              onChange={(e) => setExpertTitle(e.target.value)}
            />
            <Input.TextArea
              rows={2}
              placeholder="可选：补充说明文本（会按文档 chunk 入库）"
              value={expertContent}
              onChange={(e) => setExpertContent(e.target.value)}
            />
            <Text strong>故障 → 原因 → 处置</Text>
            {expertEntries.map((entry, index) => (
              <Space key={index} align="start" wrap style={{ width: '100%' }}>
                <Input
                  placeholder="故障"
                  style={{ width: 180 }}
                  value={entry.fault}
                  onChange={(e) => updateEntry(index, { fault: e.target.value })}
                />
                <Input
                  placeholder="原因"
                  style={{ width: 180 }}
                  value={entry.cause}
                  onChange={(e) => updateEntry(index, { cause: e.target.value })}
                />
                <InputNumber
                  min={0}
                  max={1}
                  step={0.1}
                  placeholder="概率"
                  style={{ width: 90 }}
                  value={entry.prob}
                  onChange={(value) => updateEntry(index, { prob: value })}
                />
                <Input
                  placeholder="处置"
                  style={{ width: 180 }}
                  value={entry.solution}
                  onChange={(e) => updateEntry(index, { solution: e.target.value })}
                />
                {expertEntries.length > 1 && (
                  <Button
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => setExpertEntries((current) => current.filter((_, i) => i !== index))}
                  />
                )}
              </Space>
            ))}
            <Space>
              <Button
                icon={<PlusOutlined />}
                onClick={() => setExpertEntries((current) => [...current, { ...EMPTY_ENTRY }])}
              >
                加一条
              </Button>
              <Button
                type="primary"
                icon={<UploadOutlined />}
                loading={expertIngesting}
                onClick={() => void handleExpertIngest()}
              >
                入库
              </Button>
            </Space>
            {ingestResult && (
              <Text type="success">
                最近一次:新增 {ingestResult.expert_nodes_added} 节点 / {ingestResult.expert_edges_added}{' '}
                边,doc_id={ingestResult.doc_id}
              </Text>
            )}
          </Space>
        </Card>

        {/* ③ 对话自动路由 */}
        <Card
          title="③ 询问 · 对话入口 LLM 自动路由（B4 图 / B1B2B3 检索自选）"
          extra={
            <Space>
              <Text type="secondary">自动路由</Text>
              <Switch checked={autoRouteOn} onChange={setAutoRouteOn} size="small" />
            </Space>
          }
        >
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text type="secondary">
              输入任意问题,LLM 自动判定走 B4 因果链图查询（fault_cause / equipment_chain）还是
              B1/B2/B3 多路检索（retrieve / 默认）。开关关或 LLM 失败时降级默认检索,行为不变。
            </Text>
            <Space wrap style={{ width: '100%' }}>
              <Input
                placeholder="例如:泵站出口压力下降怎么办 / 什么是雷诺数"
                style={{ width: 360 }}
                value={autoRouteQuestion}
                onChange={(e) => setAutoRouteQuestion(e.target.value)}
                onPressEnter={() => void handleAutoRoute()}
              />
              <Button
                type="primary"
                icon={<SearchOutlined />}
                loading={autoRouting}
                onClick={() => void handleAutoRoute()}
              >
                自动路由
              </Button>
            </Space>
            {autoRouteResult && (
              <Card size="small">
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  <Space>
                    <Tag
                      color={
                        autoRouteResult.route === 'fault_cause' ||
                        autoRouteResult.route === 'equipment_chain'
                          ? 'blue'
                          : 'green'
                      }
                    >
                      路由: {autoRouteResult.route}
                    </Tag>
                    <Text type="secondary">{autoRouteResult.reason}</Text>
                  </Space>
                  {(autoRouteResult.route === 'fault_cause' ||
                    autoRouteResult.route === 'equipment_chain') && (
                    <Text type="success">已转入 ① 图谱查询（看板视图联动因果链节点）</Text>
                  )}
                  {autoRouteResult.sources && autoRouteResult.sources.length > 0 && (
                    <Space direction="vertical" size={2}>
                      <Text strong>检索来源（B1/B2/B3）:</Text>
                      {autoRouteResult.sources.slice(0, 5).map((s) => (
                        <Text key={s.doc_id} style={{ fontSize: 12 }}>
                          - {s.doc_title}({s.score.toFixed(4)})
                        </Text>
                      ))}
                    </Space>
                  )}
                </Space>
              </Card>
            )}
          </Space>
        </Card>

        {/* 多路检索（B1/B2/B3） */}
        <Card title="多路检索（B1 扩召回 / B2 分解 / B3 HyDE）">
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space wrap>
              <Input
                placeholder="例如:管道输送阻力偏大怎么办"
                style={{ width: 300 }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onPressEnter={() => void handleSearch()}
              />
              <InputNumber
                min={1}
                max={10}
                value={searchTopK}
                onChange={(value) => setSearchTopK(value ?? 3)}
              />
              <Button
                type="primary"
                icon={<SearchOutlined />}
                loading={searching}
                onClick={() => void handleSearch()}
              >
                检索
              </Button>
            </Space>
            {searchResults.length > 0 && (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {searchResults.map((item) => (
                  <Card key={`${item.doc_id}-${item.score}`} size="small">
                    <Space direction="vertical" size={2}>
                      <Space>
                        <Tag color="blue">{item.category ?? '-'}</Tag>
                        <Text strong>{item.doc_title}</Text>
                        <Text type="secondary">score={item.score.toFixed(4)}</Text>
                      </Space>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {item.content_preview}
                      </Text>
                    </Space>
                  </Card>
                ))}
              </Space>
            )}
          </Space>
        </Card>

        {/* 文档录入（保留原作者能力） */}
        <Card
          title="知识文档录入"
          extra={
            <Button icon={<ReloadOutlined />} onClick={() => void loadDocuments()} loading={loading}>
              刷新
            </Button>
          }
        >
          <Form<UploadFormValues> form={form} layout="vertical" initialValues={{ category: 'faq' }}>
            <Form.Item
              name="title"
              label="文档标题"
              rules={[{ required: true, message: '请输入文档标题' }]}
            >
              <Input placeholder="例如：输油管道启停操作规范" />
            </Form.Item>

            <Form.Item
              name="category"
              label="文档分类"
              rules={[{ required: true, message: '请选择文档分类' }]}
            >
              <Select options={CATEGORY_OPTIONS} placeholder="请选择文档分类" />
            </Form.Item>

            <Form.Item label="上传文件" required>
              <Space direction="vertical" style={{ width: '100%' }}>
                <input
                  key={fileInputKey}
                  type="file"
                  accept={ACCEPT_TYPES}
                  onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                />
                <Text type="secondary">支持格式：md, txt, pdf, docx</Text>
                <Text>{selectedFile ? `已选择：${selectedFile.name}` : '尚未选择文件'}</Text>
              </Space>
            </Form.Item>

            <Button
              type="primary"
              icon={<UploadOutlined />}
              onClick={() => void handleUpload()}
              loading={uploading}
            >
              上传并写入知识库
            </Button>
          </Form>
        </Card>

        {/* 文档列表（保留原作者能力） */}
        <Card title="知识文档列表">
          <Table<KnowledgeDocumentSummary>
            rowKey="doc_id"
            loading={loading}
            columns={columns}
            dataSource={documents}
            pagination={{ pageSize: 8, showSizeChanger: true }}
          />
        </Card>
      </Space>
    </AnimatedPage>
  );
}
