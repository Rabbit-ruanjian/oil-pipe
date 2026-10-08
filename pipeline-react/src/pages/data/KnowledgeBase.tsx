import { useEffect, useState } from 'react';
import { Button, Card, Form, Input, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import AnimatedPage from '../../components/common/AnimatedPage';
import { agentApi } from '../../api/agent';
import type { KnowledgeDocumentSummary } from '../../types/agent';

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

interface UploadFormValues {
  title: string;
  category: string;
}

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
