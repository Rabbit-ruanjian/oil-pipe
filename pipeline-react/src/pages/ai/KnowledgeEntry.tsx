import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UploadFile, UploadProps } from 'antd';
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Popconfirm,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CloudUploadOutlined,
  DeleteOutlined,
  FileSearchOutlined,
  InboxOutlined,
  ReloadOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { knowledgeDocumentApi } from '../../api';
import AnimatedPage from '../../components/common/AnimatedPage';
import type { KnowledgeDocument, KnowledgeIngestTask } from '../../types';
import KnowledgeBase from '../data/KnowledgeBase';

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

const truncateText = (value: string, maxLength: number) => {
  const normalized = value.trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
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
      width: 220,
      render: (_, record) => (
        <Space direction="vertical" size={4} style={{ width: '100%', minWidth: 0 }}>
          <Text
            strong
            title={record.title}
            style={{ display: 'block', maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {truncateText(record.title, 5)}
          </Text>
          <Text
            type="secondary"
            title={record.fileName}
            style={{ display: 'block', maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {truncateText(record.fileName, 14)}
          </Text>
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
      width: 110,
      render: (value: string) => <span style={{ whiteSpace: 'nowrap' }}>{CATEGORY_LABEL_MAP[value] || value}</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (value: string, record) => (
        <Space direction="vertical" size={4} style={{ minWidth: 92 }}>
          <Tag color={STATUS_META[value]?.color || 'default'}>{STATUS_META[value]?.label || value}</Tag>
          {record.failureReason ? <Text type="danger">{record.failureReason}</Text> : null}
        </Space>
      ),
    },
    {
      title: 'Stage Progress',
      dataIndex: 'ingestStage',
      key: 'ingestStage',
      width: 230,
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
      width: 150,
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
      width: 190,
      render: (value?: string) => <div style={{ whiteSpace: 'nowrap' }}>{value || '-'}</div>,
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 290,
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

  const processingCount = documents.filter((item) => item.status === 'PROCESSING' || item.status === 'UPLOADED').length;
  const indexedCount = documents.filter((item) => item.status === 'INDEXED').length;
  const failedCount = documents.filter((item) => item.status === 'FAILED').length;
  const chunkTotal = documents.reduce((sum, item) => sum + (item.chunkCount ?? 0), 0);

  return (
    <AnimatedPage className="ymkb-page">
      <style>{`
        .ymkb-page{--ink:#0c2433;--muted:#557087;--line:#deebf1;--brand:#0e6e8c;--brand2:#0fa3c0;background:#f4f8fa;min-height:100%;padding:0 0 46px;color:var(--ink);font-family:Inter,'PingFang SC','Microsoft YaHei',sans-serif}
        .ymkb-head{max-width:1440px;margin:0 auto;padding:28px 28px 8px}.ymkb-crumb{font-size:12px;color:#87a0b4;margin-bottom:10px}.ymkb-title{margin:0;font:900 31px Georgia,'Noto Serif SC',serif}.ymkb-title em{font:700 12px Inter,'Microsoft YaHei';font-style:normal;color:var(--brand);background:rgba(14,110,140,.1);padding:7px 12px;border-radius:999px;margin-left:10px;vertical-align:middle}.ymkb-desc{max-width:980px;margin:11px 0 0;color:var(--muted);font-size:14px;line-height:1.8}.ymkb-head-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}.ymkb-main{max-width:1440px;margin:0 auto;padding:18px 28px;display:grid;grid-template-columns:350px 1fr;gap:20px;align-items:start}.ymkb-card{background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 8px 24px rgba(12,36,51,.05)}.ymkb-input{position:sticky;top:76px;overflow:hidden}.ymkb-input-head{padding:18px 20px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:10px}.ymkb-input-title{font-weight:800;font-size:16px}.ymkb-input-title:before{content:'';display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--brand);margin-right:9px}.ymkb-format{font-size:10px;color:#7790a4;white-space:nowrap}.ymkb-input-body{padding:18px 20px}.ymkb-input-body .ant-form-item{margin-bottom:13px}.ymkb-drop{border:1.5px dashed #9fc3d0;border-radius:14px;background:#f6fbfd;padding:25px 12px 20px}.ymkb-drop .ant-upload-drag-icon{margin-bottom:8px}.ymkb-drop .ant-upload-drag-icon .anticon{font-size:31px;color:var(--brand)}.ymkb-drop .ant-upload-text{font-weight:700;color:var(--ink);font-size:13px}.ymkb-drop .ant-upload-hint{font-size:11px;color:#7c94a6}.ymkb-pipeline{margin-top:14px;padding:12px;border-radius:12px;background:#f7fafb;border:1px solid var(--line)}.ymkb-pipeline-title{font-size:12px;font-weight:800;margin-bottom:8px}.ymkb-chip-row{display:flex;flex-wrap:wrap;gap:6px}.ymkb-chip{font-size:11px;padding:5px 9px;border-radius:999px;background:#eaf6f8;color:var(--brand);border:1px solid #cce8ed}.ymkb-submit{width:100%;height:43px;margin-top:16px;border:0;border-radius:11px;background:linear-gradient(135deg,var(--brand),var(--brand2));color:#fff;font-weight:800;letter-spacing:.04em}.ymkb-input-foot{border-top:1px solid var(--line);padding:13px 20px;color:#7b93a4;font-size:11px}.ymkb-content{display:flex;flex-direction:column;gap:16px}.ymkb-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.ymkb-step{padding:13px 14px;background:#fff;border:1px solid var(--line);border-radius:13px;display:flex;gap:10px;align-items:flex-start}.ymkb-step-dot{width:24px;height:24px;border-radius:8px;display:grid;place-items:center;background:#eaf1f4;color:#91a7b4;font-size:12px;font-weight:800;flex:0 0 auto}.ymkb-step.done{box-shadow:inset 3px 0 #10a37f}.ymkb-step.done .ymkb-step-dot{background:#10a37f;color:#fff}.ymkb-step.active{box-shadow:inset 3px 0 #f5b942}.ymkb-step.active .ymkb-step-dot{background:#fff3d1;color:#b57a00}.ymkb-step-title{font-size:12px;font-weight:800}.ymkb-step-note{font-size:10px;color:#7890a2;margin-top:3px;line-height:1.5}.ymkb-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.ymkb-stat{padding:15px 17px;background:#fff;border:1px solid var(--line);border-radius:13px}.ymkb-stat-v{font-size:25px;line-height:1;font-weight:900;color:var(--brand);font-variant-numeric:tabular-nums}.ymkb-stat-l{font-size:11px;color:#7c94a6;margin-top:7px}.ymkb-section{padding:18px 20px}.ymkb-section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}.ymkb-section-title{font-weight:800;font-size:15px}.ymkb-section-note{font-size:11px;color:#7890a2}.ymkb-advanced{background:transparent}.ymkb-advanced > .ant-card{border-radius:18px;border-color:var(--line);box-shadow:0 8px 24px rgba(12,36,51,.05)}.ymkb-list-card .ant-card-head{border-bottom-color:var(--line)}.ymkb-list-card .ant-card-body{padding:0}.ymkb-list-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.ymkb-list-tools .ant-input-affix-wrapper{width:240px}.ymkb-list-tools .ant-select{width:145px}.ymkb-empty{padding:30px}.ymkb-alert{max-width:1440px;margin:0 auto;padding:0 28px}.ymkb-drawer-table{min-width:650px}@media(max-width:1100px){.ymkb-main{grid-template-columns:1fr}.ymkb-input{position:static}.ymkb-steps{grid-template-columns:repeat(2,1fr)}}@media(max-width:650px){.ymkb-head,.ymkb-main,.ymkb-alert{padding-left:16px;padding-right:16px}.ymkb-title{font-size:25px}.ymkb-title em{display:inline-block;margin:9px 0 0}.ymkb-stats{grid-template-columns:repeat(2,1fr)}.ymkb-steps{grid-template-columns:1fr}.ymkb-list-tools .ant-input-affix-wrapper,.ymkb-list-tools .ant-select{width:100%}}
      `}</style>
      <section className="ymkb-head">
        <div className="ymkb-crumb">智能助手 / 知识库录入</div>
        <h1 className="ymkb-title">知识库录入 <em>RAG 切片 + 图谱构建</em></h1>
        <p className="ymkb-desc">上传规程、标准、运行手册和案例文档，系统在后台完成解析、切片、向量化、图谱构建和任务追踪；下方同时保留图谱查询、专家知识入库、自动路由与多路检索能力。</p>
        <div className="ymkb-head-actions"><Button icon={<ReloadOutlined />} onClick={() => void loadDocuments()} loading={loading}>刷新状态</Button><Button type="primary" icon={<CloudUploadOutlined />} onClick={() => void handleSubmit()} loading={submitting}>开始录入</Button></div>
      </section>
      {loadError ? <div className="ymkb-alert"><Alert type="error" showIcon message="知识库列表加载失败" description={loadError} /></div> : null}
      <main className="ymkb-main">
        <aside className="ymkb-card ymkb-input">
          <div className="ymkb-input-head"><span className="ymkb-input-title">文档录入</span><span className="ymkb-format">PDF / DOCX / TXT / MD</span></div>
          <div className="ymkb-input-body">
            <Dragger {...uploadProps} className="ymkb-drop"><p className="ant-upload-drag-icon"><InboxOutlined /></p><p className="ant-upload-text">点击选择文档，或拖拽到此处</p><p className="ant-upload-hint">支持单文件后台处理，不阻塞当前页面</p></Dragger>
            <Form<KnowledgeFormValues> form={form} layout="vertical"><Form.Item name="title" label="文档标题"><Input placeholder="不填则默认使用文件名" /></Form.Item><Form.Item name="category" label="知识分类" rules={[{ required: true, message: '请选择知识分类' }]}><Select options={CATEGORY_OPTIONS} /></Form.Item></Form>
            <div className="ymkb-pipeline"><div className="ymkb-pipeline-title">入库处理链路</div><div className="ymkb-chip-row"><span className="ymkb-chip">自动解析</span><span className="ymkb-chip">语义切片</span><span className="ymkb-chip">向量化</span><span className="ymkb-chip">图谱构建</span><span className="ymkb-chip">任务可追踪</span></div></div>
            <button className="ymkb-submit" onClick={() => void handleSubmit()} disabled={submitting || !fileList.length}>{submitting ? '正在提交…' : '开始录入与构建'}</button>
          </div>
          <div className="ymkb-input-foot">文件提交后进入后台任务；可在文档列表查看进度、重试和任务历史。</div>
        </aside>
        <section className="ymkb-content">
          <div className="ymkb-steps">{[['文档解析','识别正文与表格结构'],['语义切片','按语义边界保留上下文'],['向量化','写入稠密/稀疏检索索引'],['图谱构建','实体关系与检索链路']].map(([title,note], index) => { const state = indexedCount > 0 ? 'done' : processingCount > 0 && index > 0 ? 'active' : index === 0 && documents.length > 0 ? 'done' : ''; return <div key={title} className={`ymkb-step ${state}`}><span className="ymkb-step-dot">{state === 'done' ? '✓' : index + 1}</span><div><div className="ymkb-step-title">{title}</div><div className="ymkb-step-note">{note}</div></div></div>; })}</div>
          <div className="ymkb-stats"><div className="ymkb-stat"><div className="ymkb-stat-v">{documents.length}</div><div className="ymkb-stat-l">已录入文档</div></div><div className="ymkb-stat"><div className="ymkb-stat-v">{chunkTotal}</div><div className="ymkb-stat-l">切片总数</div></div><div className="ymkb-stat"><div className="ymkb-stat-v">{indexedCount}</div><div className="ymkb-stat-l">已完成入库</div></div><div className="ymkb-stat"><div className="ymkb-stat-v">{processingCount || failedCount}</div><div className="ymkb-stat-l">处理中 / 失败</div></div></div>
          <section className="ymkb-card ymkb-section"><div className="ymkb-section-head"><span className="ymkb-section-title">知识图谱、专家知识与智能检索</span><span className="ymkb-section-note">所有查询与入库能力均保留真实 Agent 接口</span></div><div className="ymkb-advanced"><KnowledgeBase /></div></section>
          <section className="ymkb-card ymkb-list-card"><div className="ant-card-head"><div className="ant-card-head-wrapper"><div className="ant-card-head-title">已录入文档与任务状态</div><div className="ant-card-extra"><div className="ymkb-list-tools"><Search allowClear placeholder="搜索标题、文件名或标签" value={keyword} onChange={(event) => setKeyword(event.target.value)} /><Select value={categoryFilter} onChange={setCategoryFilter} options={[{ label: '全部分类', value: 'all' }, ...CATEGORY_OPTIONS]} /><Select value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} /></div></div></div></div><div className="ant-card-body">{filteredDocuments.length > 0 ? <Table<KnowledgeDocument> rowKey="id" loading={loading} columns={columns} dataSource={filteredDocuments} pagination={{ pageSize: 8, showSizeChanger: false }} scroll={{ x: 1560 }} /> : <div className="ymkb-empty"><Empty description="当前还没有录入任何知识文档" /></div>}</div></section>
        </section>
      </main>

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
