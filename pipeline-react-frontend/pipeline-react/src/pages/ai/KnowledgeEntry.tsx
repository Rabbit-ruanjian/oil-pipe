import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UploadFile, UploadProps } from 'antd';
import {
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Form,
  Input,
  Popconfirm,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ClockCircleOutlined,
  CloudUploadOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  InboxOutlined,
  ReloadOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { knowledgeDocumentApi } from '../../api';
import AnimatedPage from '../../components/common/AnimatedPage';
import PageHeader from '../../components/common/PageHeader';
import type { KnowledgeDocument, KnowledgeIngestTask } from '../../types';

const { Dragger } = Upload;
const { Text } = Typography;
const { Search } = Input;

interface KnowledgeFormValues {
  title?: string;
  category: string;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

const CATEGORY_OPTIONS = [
  { label: '技术标准', value: 'standards' },
  { label: '计算公式', value: 'formulas' },
  { label: '运行操作', value: 'operations' },
  { label: '案例分析', value: 'cases' },
  { label: '常见问答', value: 'faq' },
];


const STATUS_OPTIONS = [
  { label: '全部状态', value: 'all' },
  { label: '已入库', value: 'INDEXED' },
  { label: '处理中', value: 'PROCESSING' },
  { label: '待处理', value: 'UPLOADED' },
  { label: '失败', value: 'FAILED' },
];

const STATUS_META: Record<string, { label: string; color: string }> = {
  INDEXED: { label: '已入库', color: 'green' },
  PROCESSING: { label: '处理中', color: 'blue' },
  UPLOADED: { label: '待处理', color: 'gold' },
  FAILED: { label: '失败', color: 'red' },
};

const TASK_STATUS_META: Record<string, { label: string; color: string }> = {
  PENDING: { label: '排队中', color: 'gold' },
  PROCESSING: { label: '处理中', color: 'blue' },
  SUCCESS: { label: '成功', color: 'green' },
  FAILED: { label: '失败', color: 'red' },
};

const TASK_TYPE_META: Record<string, string> = {
  UPLOAD: '首次入库',
  RETRY: '手动重试',
};

const CATEGORY_LABEL_MAP = Object.fromEntries(CATEGORY_OPTIONS.map((item) => [item.value, item.label]));

const INGEST_STAGE_META: Record<string, { label: string; color: string }> = {
  QUEUED: { label: 'Queued', color: 'gold' },
  INGESTING: { label: 'Ingesting', color: 'blue' },
  DONE: { label: 'Dense + Sparse Ready', color: 'green' },
  FAILED: { label: 'Failed', color: 'red' },
};


const normalizeDisplayStage = (stage?: string, status?: string) => {
  if (stage === 'DONE' || status === 'INDEXED' || status === 'SUCCESS') {
    return 'DONE';
  }
  if (stage === 'FAILED' || status === 'FAILED') {
    return 'FAILED';
  }
  if (stage === 'QUEUED' || status === 'UPLOADED' || status === 'PENDING') {
    return 'QUEUED';
  }
  return 'INGESTING';
};

const resolveDisplayProgress = (stage: string, progressPercent?: number) => {
  if (stage === 'DONE') {
    return 100;
  }
  if (stage === 'FAILED' || stage === 'QUEUED') {
    return 0;
  }
  const normalized = Math.max(0, Math.min(progressPercent ?? 10, 100));
  return normalized > 0 ? normalized : 10;
};

export default function KnowledgeEntry() {
  const [form] = Form.useForm<KnowledgeFormValues>();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [tasks, setTasks] = useState<KnowledgeIngestTask[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<KnowledgeDocument>();
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [taskLoading, setTaskLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actingId, setActingId] = useState<number>();
  const [keyword, setKeyword] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const taskRequestSeqRef = useRef(0);
  const selectedDocumentIdRef = useRef<number | undefined>(undefined);

  const hasRunningTask = useMemo(
    () => documents.some((item) => item.status === 'PROCESSING' || item.status === 'UPLOADED'),
    [documents],
  );

  const loadDocuments = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
    }
    try {
      const response = await knowledgeDocumentApi.list();
      setDocuments(response.data ?? []);
      setLoadError(null);
    } catch (error) {
      setLoadError(getErrorMessage(error, '知识文档加载失败'));
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  const loadTasks = useCallback(async (documentId: number, showLoading = true) => {
    const requestSeq = ++taskRequestSeqRef.current;
    if (showLoading) {
      setTaskLoading(true);
    }
    try {
      const response = await knowledgeDocumentApi.listTasks(documentId);
      if (selectedDocumentIdRef.current === documentId && requestSeq === taskRequestSeqRef.current) {
        setTasks(response.data ?? []);
        setTaskError(null);
      }
    } catch (error) {
      if (selectedDocumentIdRef.current === documentId && requestSeq === taskRequestSeqRef.current) {
        setTaskError(getErrorMessage(error, '任务历史加载失败'));
      }
    } finally {
      if (showLoading && requestSeq === taskRequestSeqRef.current) {
        setTaskLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    form.setFieldsValue({
      category: 'faq',
    });
    void loadDocuments();
  }, [form, loadDocuments]);

  useEffect(() => {
    if (!hasRunningTask) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void loadDocuments(false);
      if (taskDrawerOpen && selectedDocument?.id) {
        void loadTasks(selectedDocument.id, false);
      }
    }, 5000);

    return () => window.clearInterval(timer);
  }, [hasRunningTask, loadDocuments, loadTasks, selectedDocument?.id, taskDrawerOpen]);

  const filteredDocuments = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return documents.filter((item) => {
      const tags = item.tags ?? '';
      const matchesKeyword =
        normalizedKeyword.length === 0 ||
        item.title.toLowerCase().includes(normalizedKeyword) ||
        item.fileName.toLowerCase().includes(normalizedKeyword) ||
        tags.toLowerCase().includes(normalizedKeyword);
      const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter;
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
      return matchesKeyword && matchesCategory && matchesStatus;
    });
  }, [categoryFilter, documents, keyword, statusFilter]);

  const uploadProps: UploadProps = {
    multiple: false,
    beforeUpload: () => false,
    accept: '.pdf,.docx,.md,.txt',
    fileList,
    onChange: ({ fileList: nextFileList }) => setFileList(nextFileList.slice(-1)),
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const selectedFile = fileList[0]?.originFileObj;
      if (!selectedFile) {
        message.warning('请先选择要录入的知识文档');
        return;
      }

      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('title', values.title?.trim() || selectedFile.name.replace(/\.[^.]+$/, ''));
      formData.append('category', values.category);

      setSubmitting(true);
      const response = await knowledgeDocumentApi.upload(formData);
      message.success(response.msg || '知识文档已接收，正在后台入库');
      form.resetFields();
      form.setFieldsValue({ category: 'faq' });
      setFileList([]);
      await loadDocuments();
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'errorFields' in error) {
        return;
      }

      message.error(getErrorMessage(error, '提交入库失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetry = async (record: KnowledgeDocument) => {
    setActingId(record.id);
    try {
      const response = await knowledgeDocumentApi.retry(record.id);
      message.success(response.msg || '已加入重试队列，请稍后刷新');
      await loadDocuments();
      if (taskDrawerOpen && selectedDocument?.id === record.id) {
        await loadTasks(record.id);
      }
    } catch (error) {
      message.error(getErrorMessage(error, '重试失败'));
    } finally {
      setActingId(undefined);
    }
  };

  const handleDelete = async (record: KnowledgeDocument) => {
    setActingId(record.id);
    try {
      await knowledgeDocumentApi.delete(record.id);
      message.success('知识文档已删除');
      if (selectedDocument?.id === record.id) {
        handleCloseTasks();
      }
      await loadDocuments();
    } catch (error) {
      message.error(getErrorMessage(error, '删除失败'));
    } finally {
      setActingId(undefined);
    }
  };

  const handleOpenTasks = async (record: KnowledgeDocument) => {
    selectedDocumentIdRef.current = record.id;
    setSelectedDocument(record);
    setTaskDrawerOpen(true);
    setTaskError(null);
    await loadTasks(record.id);
  };

  const handleCloseTasks = () => {
    taskRequestSeqRef.current += 1;
    selectedDocumentIdRef.current = undefined;
    setTaskDrawerOpen(false);
    setSelectedDocument(undefined);
    setTasks([]);
    setTaskError(null);
    setTaskLoading(false);
  };

  const columns: ColumnsType<KnowledgeDocument> = [
    {
      title: '文档信息',
      dataIndex: 'title',
      key: 'title',
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Text strong>{record.title}</Text>
          <Text type="secondary">{record.fileName}</Text>
          {record.tags ? (
            <Space size={[4, 4]} wrap>
              {record.tags
                .split(',')
                .filter(Boolean)
                .map((tag: string) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
            </Space>
          ) : null}
        </Space>
      ),
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      render: (value: string) => CATEGORY_LABEL_MAP[value] || value,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (value: string, record) => (
        <Space direction="vertical" size={4}>
          <Tag color={STATUS_META[value]?.color || 'default'}>{STATUS_META[value]?.label || value}</Tag>
          {record.failureReason ? <Text type="danger">{record.failureReason}</Text> : null}
        </Space>
      ),
    },
    {
      title: 'Stage Progress',
      dataIndex: 'ingestStage',
      key: 'ingestStage',
      width: 220,
      render: (value: string | undefined, record) => {
        const stage = normalizeDisplayStage(value, record.status);
        const percent = resolveDisplayProgress(stage, record.progressPercent);
        return (
          <Space direction="vertical" size={4} style={{ minWidth: 180 }}>
            <Tag color={INGEST_STAGE_META[stage]?.color || 'default'}>{INGEST_STAGE_META[stage]?.label || stage}</Tag>
            <Progress
              percent={percent}
              size="small"
              showInfo={false}
              status={stage === 'FAILED' ? 'exception' : stage === 'DONE' ? 'success' : 'active'}
            />
          </Space>
        );
      },
    },
    {
      title: '切片 / 重试',
      key: 'chunkCount',
      width: 140,
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Text>{record.chunkCount ?? 0} 个切片</Text>
          <Text type="secondary">重试 {record.retryCount ?? 0} 次</Text>
        </Space>
      ),
    },
    {
      title: '存储',
      key: 'storage',
      width: 260,
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Text>{record.storageType || '-'}</Text>
          <div
            style={{
              maxWidth: 220,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'rgba(0, 0, 0, 0.45)',
              fontSize: 14,
              lineHeight: '22px',
            }}
            title={record.storageObjectKey || '-'}
          >
            {record.storageObjectKey || '-'}
          </div>
        </Space>
      ),
    },
    {
      title: '最近入库',
      dataIndex: 'lastIngestTime',
      key: 'lastIngestTime',
      width: 180,
      render: (value?: string) => <div style={{ whiteSpace: 'nowrap' }}>{value || '-'}</div>,
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 260,
      render: (_, record) => (
        <Space wrap>
          <Button size="small" icon={<FileSearchOutlined />} onClick={() => void handleOpenTasks(record)}>
            任务历史
          </Button>
          <Button
            size="small"
            icon={<SyncOutlined />}
            loading={actingId === record.id}
            disabled={!record.storageObjectKey || record.status === 'PROCESSING' || record.status === 'UPLOADED'}
            onClick={() => void handleRetry(record)}
          >
            {record.status === 'INDEXED' ? '重新入库' : '重试'}
          </Button>
          <Popconfirm
            title="确认删除这条知识文档吗？"
            description="会同时删除向量库记录、原文件和任务历史。"
            okText="删除"
            cancelText="取消"
            onConfirm={() => void handleDelete(record)}
          >
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={actingId === record.id}
              disabled={record.status === 'PROCESSING' || record.status === 'UPLOADED'}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const taskColumns: ColumnsType<KnowledgeIngestTask> = [
    {
      title: '任务',
      dataIndex: 'taskType',
      key: 'taskType',
      render: (value: string, record) => (
        <Space direction="vertical" size={4}>
          <Text strong>{TASK_TYPE_META[value] || value}</Text>
          <Text type="secondary">第 {record.attemptNo ?? 1} 次</Text>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (value: string, record) => (
        <Space direction="vertical" size={4}>
          <Tag color={TASK_STATUS_META[value]?.color || 'default'}>{TASK_STATUS_META[value]?.label || value}</Tag>
          {record.failureReason ? <Text type="danger">{record.failureReason}</Text> : null}
        </Space>
      ),
    },
    {
      title: 'Stage Progress',
      dataIndex: 'ingestStage',
      key: 'ingestStage',
      width: 220,
      render: (value: string | undefined, record) => {
        const stage = normalizeDisplayStage(value, record.status);
        const percent = resolveDisplayProgress(stage, record.progressPercent);
        return (
          <Space direction="vertical" size={4} style={{ minWidth: 180 }}>
            <Tag color={INGEST_STAGE_META[stage]?.color || 'default'}>{INGEST_STAGE_META[stage]?.label || stage}</Tag>
            <Progress
              percent={percent}
              size="small"
              showInfo={false}
              status={stage === 'FAILED' ? 'exception' : stage === 'DONE' ? 'success' : 'active'}
            />
          </Space>
        );
      },
    },
    {
      title: '结果',
      key: 'result',
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Text>{record.chunkCount ?? 0} 个切片</Text>
          <Text type="secondary">{record.agentDocId || '-'}</Text>
        </Space>
      ),
    },
    {
      title: '时间',
      key: 'time',
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Text type="secondary">开始：{record.startedAt || '-'}</Text>
          <Text type="secondary">结束：{record.finishedAt || '-'}</Text>
        </Space>
      ),
    },
  ];

  return (
    <AnimatedPage className="mx-auto flex w-full max-w-[1360px] flex-col gap-6 px-4 py-6 md:px-6">
      <PageHeader
        title="知识库录入"
        actions={
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadDocuments()} loading={loading}>
              刷新状态
            </Button>
            <Button type="primary" icon={<CloudUploadOutlined />} onClick={() => void handleSubmit()} loading={submitting}>
              提交入库
            </Button>
          </Space>
        }
      />

      {loadError ? (
        <Alert
          type="error"
          showIcon
          message="知识库列表加载失败"
          description={loadError}
        />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic title="知识文档总数" value={documents.length} prefix={<FileTextOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              title="后台处理中"
              value={documents.filter((item) => item.status === 'PROCESSING' || item.status === 'UPLOADED').length}
              prefix={<ClockCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              title="已完成入库"
              value={documents.filter((item) => item.status === 'INDEXED').length}
              prefix={<DatabaseOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              title="失败文档"
              value={documents.filter((item) => item.status === 'FAILED').length}
              prefix={<SyncOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} align="stretch">
        <Col xs={24}>
          <Card title="资料上传">
            <Space direction="vertical" size={20} style={{ width: '100%' }}>
              <Dragger {...uploadProps} style={{ padding: 12 }}>
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p className="ant-upload-text">拖拽文件到这里，或点击选择一个文件</p>
                <p className="ant-upload-hint">当前支持 PDF、DOCX、MD、TXT。提交后会进入后台任务，不再阻塞页面等待解析。</p>
              </Dragger>

              <Form<KnowledgeFormValues> form={form} layout="vertical">
                <Row gutter={16}>
                  <Col xs={24} md={12}>
                    <Form.Item name="title" label="文档标题">
                      <Input placeholder="不填则默认使用文件名" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="category" label="知识分类" rules={[{ required: true, message: '请选择知识分类' }]}>
                      <Select options={CATEGORY_OPTIONS} />
                    </Form.Item>
                  </Col>
                </Row>
              </Form>
            </Space>
          </Card>
        </Col>
      </Row>

      <Card
        title="已录入文档"
        extra={
          <Space wrap>
            <Search
              allowClear
              placeholder="搜索标题、文件名或标签"
              style={{ width: 240 }}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <Select
              style={{ width: 160 }}
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={[{ label: '全部分类', value: 'all' }, ...CATEGORY_OPTIONS]}
            />
            <Select style={{ width: 140 }} value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} />
          </Space>
        }
      >
        {filteredDocuments.length > 0 ? (
          <Table<KnowledgeDocument>
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={filteredDocuments}
            pagination={{ pageSize: 8, showSizeChanger: false }}
            scroll={{ x: 1320 }}
          />
        ) : (
          <Empty description="当前还没有录入任何知识文档" />
        )}
      </Card>

      <Drawer
        title={selectedDocument ? `${selectedDocument.title} 的任务历史` : '任务历史'}
        open={taskDrawerOpen}
        onClose={handleCloseTasks}
        width={760}
        extra={
          selectedDocument ? (
            <Button icon={<ReloadOutlined />} onClick={() => void loadTasks(selectedDocument.id)} loading={taskLoading}>
              刷新任务
            </Button>
          ) : null
        }
      >
        {selectedDocument ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {taskError ? (
              <Alert
                type="error"
                showIcon
                message="任务历史加载失败"
                description={taskError}
              />
            ) : null}
            <Table<KnowledgeIngestTask>
              rowKey="id"
              loading={taskLoading}
              columns={taskColumns}
              dataSource={tasks}
              pagination={{ pageSize: 5, showSizeChanger: false }}
            />
          </Space>
        ) : null}
      </Drawer>
    </AnimatedPage>
  );
}
