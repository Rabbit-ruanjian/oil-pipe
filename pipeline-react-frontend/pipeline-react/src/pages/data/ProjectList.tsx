import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Tooltip,
  message,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { projectApi } from '../../api';
import AnimatedPage from '../../components/common/AnimatedPage';
import ResponsiveTable from '../../components/common/ResponsiveTable';
import type { Project, R } from '../../types';
import ProjectCalculationDetailPanel from './ProjectCalculationDetailPanel';
import styles from './DataPage.module.css';

function nowrapTitle(text: string) {
  return <span style={{ whiteSpace: 'nowrap' }}>{text}</span>;
}

const PROJECT_TABLE_SCROLL_X = 1120;

export default function ProjectList() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Project[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<Project | null>(null);
  const [viewingProject, setViewingProject] = useState<Project | null>(null);
  const [searchText, setSearchText] = useState('');
  const [form] = Form.useForm<Project>();
  const detailRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void fetchData();
  }, []);

  useEffect(() => {
    if (!viewingProject || !detailRef.current) {
      return;
    }

    detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [viewingProject]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await projectApi.list();
      setData(Array.isArray(res.data) ? res.data : []);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    setEditingItem(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleEdit = (record: Project) => {
    setEditingItem(record);
    form.setFieldsValue(record);
    setModalVisible(true);
  };

  const handleView = (record: Project) => {
    setViewingProject(record);
  };

  const handleDelete = async (id: number) => {
    try {
      const res = await projectApi.delete([id]);
      if (!res.data) {
        message.error('删除失败，数据库未更新');
        return;
      }

      message.success('删除成功');
      await fetchData();
    } catch {
      // 请求层已统一提示错误，这里不再做本地假删
    }
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();

    try {
      const res: R<boolean> = editingItem
        ? await projectApi.update({ ...editingItem, ...values })
        : await projectApi.create(values);

      if (!res.data) {
        message.error(editingItem ? '修改失败，数据库未更新' : '新增失败，数据库未写入');
        return;
      }

      message.success(editingItem ? '修改成功' : '新增成功');
      setModalVisible(false);
      await fetchData();
    } catch {
      // 请求层已统一提示错误，表单保留给用户继续修改
    }
  };

  const filteredData = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) {
      return data;
    }

    return data.filter((item) =>
      [item.name, item.number, item.responsible]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword)),
    );
  }, [data, searchText]);

  const serialNumberMap = useMemo(() => {
    const map = new Map<number, number>();
    filteredData.forEach((item, index) => {
      map.set(item.proId, index + 1);
    });
    return map;
  }, [filteredData]);

  const columns: ColumnsType<Project> = [
    {
      title: nowrapTitle('编号'),
      key: 'serialNumber',
      width: 90,
      align: 'center',
      render: (_, record) => serialNumberMap.get(record.proId) ?? '-',
    },
    {
      title: nowrapTitle('项目编号'),
      dataIndex: 'number',
      key: 'number',
      width: 170,
      align: 'center',
      render: (text?: string) => <span style={{ whiteSpace: 'nowrap' }}>{text || '-'}</span>,
    },
    {
      title: nowrapTitle('项目名称'),
      dataIndex: 'name',
      key: 'name',
      width: 300,
      align: 'center',
      render: (text: string) => (
        <span
          style={{
            fontWeight: 500,
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap',
          }}
        >
          {text}
        </span>
      ),
    },
    {
      title: nowrapTitle('负责人'),
      dataIndex: 'responsible',
      key: 'responsible',
      width: 120,
      align: 'center',
      render: (text?: string) => <span style={{ whiteSpace: 'nowrap' }}>{text || '-'}</span>,
    },
    {
      title: nowrapTitle('创建时间'),
      dataIndex: 'createTime',
      key: 'createTime',
      width: 200,
      align: 'center',
      render: (text?: string) => (
        <span
          style={{
            color: 'var(--text-tertiary)',
            fontSize: 'var(--text-xs)',
            whiteSpace: 'nowrap',
          }}
        >
          {text || '-'}
        </span>
      ),
    },
    {
      title: nowrapTitle('操作'),
      key: 'action',
      width: 300,
      align: 'center',
      render: (_, record) => (
        <Space size="small" className={styles.projectActionGroup}>
          <Button
            type="text"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleView(record)}
            className={styles.actionBtn}
          >
            查看
          </Button>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
            className={styles.actionBtn}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除吗？"
            description="此操作会删除数据库中的项目记录，且不可恢复。"
            onConfirm={() => handleDelete(record.proId)}
            okText="确定"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              className={styles.actionBtn}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <AnimatedPage className={styles.page}>
      <div className={styles.pageContent} style={{ maxWidth: 1680 }}>
        {!viewingProject ? (
          <header className={styles.header}>
            <div className={styles.headerTop}>
              <div className={styles.headerInfo}>
                <h1 className={styles.title}>
                  <span className={styles.titleAccent}>项目管理</span>
                </h1>
                <p className={styles.subtitle}>
                  管道工程项目的创建、维护与计算分析
                </p>
              </div>
              <div className={styles.headerActions}>
                <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} size="middle">
                  新增项目
                </Button>
              </div>
            </div>
          </header>
        ) : null}

        {!viewingProject ? (
          <Card className={styles.tableCard} bordered={false}>
            <div className={styles.toolbar}>
              <div className={styles.toolbarLeft}>
                <Input
                  placeholder="搜索项目名称或负责人..."
                  prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  className={styles.searchInput}
                  allowClear
                />
              </div>
              <div className={styles.toolbarRight}>
                <Tooltip title="刷新数据">
                  <Button icon={<ReloadOutlined />} onClick={() => void fetchData()} loading={loading} />
                </Tooltip>
              </div>
            </div>

            <ResponsiveTable
              columns={columns}
              dataSource={filteredData}
              rowKey="proId"
              loading={loading}
              scroll={{ x: PROJECT_TABLE_SCROLL_X }}
              pagination={{
                pageSize: 10,
                showSizeChanger: true,
                showQuickJumper: true,
                showTotal: (total) => `共 ${total} 条记录`,
              }}
              cardRender={(record) => (
                <div
                  style={{
                    padding: 'var(--space-4)',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-lg)',
                  }}
                >
                  <div
                    style={{
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      fontSize: 15,
                      marginBottom: 8,
                    }}
                  >
                    {record.name}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--text-tertiary)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <span>项目编号: {record.number || '-'}</span>
                    <span>负责人: {record.responsible || '-'}</span>
                    <span>创建时间: {record.createTime || '-'}</span>
                  </div>
                  <Space wrap style={{ marginTop: 12 }}>
                    <Button
                      type="text"
                      size="small"
                      icon={<EyeOutlined />}
                      onClick={() => handleView(record)}
                      className={styles.actionBtn}
                    >
                      查看
                    </Button>
                    <Button
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => handleEdit(record)}
                      className={styles.actionBtn}
                    >
                      编辑
                    </Button>
                    <Popconfirm
                      title="确定删除吗？"
                      description="此操作会删除数据库中的项目记录，且不可恢复。"
                      onConfirm={() => handleDelete(record.proId)}
                      okText="确定"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                    >
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        className={styles.actionBtn}
                      >
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                </div>
              )}
            />
          </Card>
        ) : null}

        {viewingProject ? (
          <div ref={detailRef}>
            <ProjectCalculationDetailPanel
              project={viewingProject}
              onClose={() => setViewingProject(null)}
            />
          </div>
        ) : null}

        <Modal
          title={editingItem ? '编辑项目' : '新增项目'}
          open={modalVisible}
          onOk={() => void handleSubmit()}
          onCancel={() => setModalVisible(false)}
          destroyOnClose
          className={styles.modal}
          okText="保存"
          cancelText="取消"
          width={520}
        >
          <Form form={form} layout="vertical">
            <Form.Item
              name="name"
              label="项目名称"
              rules={[{ required: true, message: '请输入项目名称' }]}
            >
              <Input placeholder="请输入项目名称" />
            </Form.Item>
            <Form.Item name="number" label="项目编号">
              <Input placeholder="请输入项目编号" />
            </Form.Item>
            <Form.Item name="responsible" label="负责人">
              <Input placeholder="请输入负责人" />
            </Form.Item>
          </Form>
        </Modal>
      </div>
    </AnimatedPage>
  );
}
