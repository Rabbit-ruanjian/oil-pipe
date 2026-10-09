import { useEffect, useState } from 'react';
import { Button, Card, Collapse, Form, Input, InputNumber, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, NodeIndexOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import AnimatedPage from '../../components/common/AnimatedPage';
import { agentApi } from '../../api/agent';
import type {
  IngestExpertItem,
  IngestKnowledgeResponse,
  KnowledgeDocumentSummary,
  KnowledgeSearchItem,
  KnowledgeGraphQueryPayload,
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
  }, []);

  const handleRefresh = async () => {
    await loadDocuments();
  };

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

  // ---- A 类：专家知识入库（B4 因果链 / /knowledge/ingest）----
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
      message.success(
        `入库成功：新增 ${result.expert_nodes_added} 个节点、${result.expert_edges_added} 条边`,
      );
      await loadDocuments();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '专家知识入库失败');
    } finally {
      setExpertIngesting(false);
    }
  };

  // ---- B4：图谱查询 ----
  const [graphQuery, setGraphQuery] = useState('');
  const [graphQueryType, setGraphQueryType] = useState('');
  const [graphResult, setGraphResult] = useState<KnowledgeGraphQueryPayload | null>(null);
  const [graphQuerying, setGraphQuerying] = useState(false);

  const handleGraphQuery = async () => {
    if (!graphQuery.trim()) {
      message.warning('请输入图谱查询');
      return;
    }
    setGraphQuerying(true);
    try {
      const result = await agentApi.queryGraph(graphQuery.trim(), graphQueryType || undefined);
      setGraphResult(result);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '图谱查询失败');
    } finally {
      setGraphQuerying(false);
    }
  };

  // ---- B1/B2/B3：多路检索 ----
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
      width: 160,
      render: (value: string) => <Tag color="blue">{value}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
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
      width: 120,
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

  return (
    <AnimatedPage>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card
          title="知识文档录入"
          extra={
            <Button icon={<ReloadOutlined />} onClick={() => void handleRefresh()} loading={loading}>
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

        <Card title="专家知识入库（因果链直入，A 类）">
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
                    onClick={() =>
                      setExpertEntries((current) => current.filter((_, i) => i !== index))
                    }
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
                最近一次：新增 {ingestResult.expert_nodes_added} 节点 / {ingestResult.expert_edges_added}{' '}
                边，doc_id={ingestResult.doc_id}
              </Text>
            )}
          </Space>
        </Card>

        <Card title="图谱查询（B4 LLM-in-the-loop 遍历）">
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space wrap style={{ width: '100%' }}>
              <Input
                placeholder="例如：泵站出口压力下降"
                style={{ width: 280 }}
                value={graphQuery}
                onChange={(e) => setGraphQuery(e.target.value)}
                onPressEnter={() => void handleGraphQuery()}
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
                onClick={() => void handleGraphQuery()}
              >
                查询
              </Button>
            </Space>
            {graphResult && (
              <Collapse
                size="small"
                items={[
                  {
                    key: 'plan',
                    label: `遍历计划（起点 ${graphResult.result?.plan?.start_node_id ?? '-'}，${
                      graphResult.result?.path_count ?? 0
                    } 节点）`,
                    children: (
                      <pre style={{ margin: 0, fontSize: 12, color: '#555' }}>
                        {JSON.stringify(graphResult.result?.plan ?? {}, null, 2)}
                      </pre>
                    ),
                  },
                  {
                    key: 'reached',
                    label: `到达节点（${Object.keys(graphResult.result?.reached ?? {}).length} 个）`,
                    children: (
                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        {Object.entries(graphResult.result?.reached ?? {}).map(([node, meta]) => (
                          <Tag key={node}>{node} ← {meta.via ?? '-'}</Tag>
                        ))}
                        {Object.keys(graphResult.result?.reached ?? {}).length === 0 && (
                          <Text type="secondary">未展开（起点无匹配边或 LLM 不可用降级）</Text>
                        )}
                      </Space>
                    ),
                  },
                ]}
              />
            )}
          </Space>
        </Card>

        <Card title="多路检索（B1 扩召回 / B2 分解 / B3 HyDE）">
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space wrap>
              <Input
                placeholder="例如：管道输送阻力偏大怎么办"
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
