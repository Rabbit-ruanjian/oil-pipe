/**
 * PipelineList - 管道参数管理页面
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card,
  Button,
  Space,
  Modal,
  Form,
  Input,
  InputNumber,
  message,
  Popconfirm,
  Tooltip,
  Row,
  Col,
  Select,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { Pipeline, Project } from '../../types';
import { pipelineApi, projectApi } from '../../api';
import AnimatedPage from '../../components/common/AnimatedPage';
import ResponsiveTable from '../../components/common/ResponsiveTable';
import styles from './DataPage.module.css';

function nowrapTitle(text: string) {
  return <span style={{ whiteSpace: 'nowrap' }}>{text}</span>;
}

const PIPELINE_TABLE_SCROLL_X = 1540;

export default function PipelineList() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Pipeline[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<Pipeline | null>(null);
  const [searchText, setSearchText] = useState('');
  const [form] = Form.useForm<Pipeline>();

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.proId, project.name] as const)),
    [projects],
  );

  const getProjectName = useCallback((proId?: number) => {
    if (typeof proId !== 'number') {
      return '未绑定项目';
    }
    return projectNameById.get(proId) ?? `项目 ${proId}`;
  }, [projectNameById]);

  const fetchData = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) {
      setLoading(true);
    }

    try {
      const projectResult = await projectApi.list();
      const nextProjects = Array.isArray(projectResult.data) ? projectResult.data : [];
      setProjects(nextProjects);

      if (nextProjects.length === 0) {
        setData([]);
        return;
      }

      const pipelineResults = await Promise.allSettled(
        nextProjects.map((project) => pipelineApi.listByProject(project.proId)),
      );

      const nextData = pipelineResults
        .flatMap((result) =>
          result.status === 'fulfilled' && Array.isArray(result.value.data) ? result.value.data : [],
        )
        .sort((left, right) => {
          if (left.proId !== right.proId) {
            return left.proId - right.proId;
          }
          return left.id - right.id;
        });

      setData(nextData);

      if (!silent && pipelineResults.some((result) => result.status !== 'fulfilled')) {
        message.warning('部分项目的管道数据加载失败，当前已显示成功返回的数据。');
      }
    } catch {
      if (!silent) {
        setProjects([]);
        setData([]);
        message.error('加载管道数据失败');
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    let active = true;

    const refresh = (silent = false) => {
      if (!active) {
        return;
      }
      void fetchData({ silent });
    };

    refresh(false);

    const intervalId = window.setInterval(() => {
      refresh(true);
    }, 30000);

    const handleFocus = () => {
      refresh(true);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh(true);
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const handleAdd = () => {
    if (projects.length === 0) {
      message.warning('请先新增项目，再维护管道参数。');
      return;
    }

    setEditingItem(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleEdit = (record: Pipeline) => {
    setEditingItem(record);
    form.setFieldsValue(record);
    setModalVisible(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await pipelineApi.delete([id]);
      message.success('删除成功');
      await fetchData();
    } catch {
      message.error('删除失败，请稍后重试');
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingItem) {
        await pipelineApi.update({ ...editingItem, ...values });
        message.success('管道已更新');
      } else {
        await pipelineApi.create(values);
        message.success('新增成功');
      }
      setModalVisible(false);
      await fetchData();
    } catch {
      message.error('保存失败，请检查表单内容');
    }
  };

  const filteredData = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) {
      return data;
    }

    return data.filter((item) =>
      [item.name, getProjectName(item.proId)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword)),
    );
  }, [data, getProjectName, searchText]);

  const columns: ColumnsType<Pipeline> = [
    {
      title: nowrapTitle('编号'),
      width: 90,
      align: 'center',
      render: (_value, _record, index) => index + 1,
    },
    {
      title: nowrapTitle('所属项目'),
      dataIndex: 'proId',
      width: 240,
      align: 'center',
      render: (proId?: number) => (
        <span className={styles.tableWrapText}>
          {getProjectName(proId)}
        </span>
      ),
    },
    {
      title: nowrapTitle('管道名称'),
      dataIndex: 'name',
      width: 260,
      align: 'center',
      render: (text: string) => (
        <span className={`${styles.tableWrapText} ${styles.tableWrapTextStrong}`}>
          {text}
        </span>
      ),
    },
    {
      title: nowrapTitle('长度 (km)'),
      dataIndex: 'length',
      width: 140,
      align: 'center',
      render: (val: number) => <span style={{ whiteSpace: 'nowrap' }}>{val?.toFixed(1)}</span>,
    },
    {
      title: nowrapTitle('管径 (mm)'),
      dataIndex: 'diameter',
      width: 130,
      align: 'center',
    },
    {
      title: nowrapTitle('壁厚 (mm)'),
      dataIndex: 'thickness',
      width: 130,
      align: 'center',
    },
    {
      title: nowrapTitle('输量 (m³/h)'),
      dataIndex: 'throughput',
      width: 150,
      align: 'center',
    },
    {
      title: nowrapTitle('起点高程 (m)'),
      dataIndex: 'startAltitude',
      width: 150,
      align: 'center',
    },
    {
      title: nowrapTitle('终点高程 (m)'),
      dataIndex: 'endAltitude',
      width: 150,
      align: 'center',
    },
    {
      title: nowrapTitle('操作'),
      key: 'action',
      width: 200,
      align: 'center',
      fixed: 'right',
      render: (_, record) => (
        <Space size="small">
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
            description="此操作不可恢复。"
            onConfirm={() => handleDelete(record.id)}
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
      <div className={styles.pageContent} style={{ maxWidth: 1760 }}>
        <header className={styles.header}>
          <div className={styles.headerTop}>
            <div className={styles.headerInfo}>
              <h1 className={styles.title}>
                <span className={styles.titleAccent}>管道参数</span>
              </h1>
              <p className={styles.subtitle}>
                管理数据库中全部项目的管道参数，并自动同步最新的管径、长度、壁厚、输量与高程数据。
              </p>
            </div>
            <div className={styles.headerActions}>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} size="middle">
                新增管道
              </Button>
            </div>
          </div>
        </header>

        <Card className={styles.tableCard} bordered={false}>
          <div className={styles.toolbar}>
            <div className={styles.toolbarLeft}>
              <Input
                placeholder="搜索管道名称或所属项目..."
                prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
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
            rowKey="id"
            loading={loading}
            scroll={{ x: PIPELINE_TABLE_SCROLL_X }}
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
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15, marginBottom: 8 }}>
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
                  <span>所属项目：{getProjectName(record.proId)}</span>
                  <span>长度：{record.length?.toFixed(1)} km</span>
                  <span>管径/壁厚：{record.diameter} / {record.thickness} mm</span>
                  <span>高程：{record.startAltitude} → {record.endAltitude} m</span>
                  <span>输量：{record.throughput} m³/h</span>
                </div>
              </div>
            )}
          />
        </Card>

        <Modal
          title={editingItem ? '编辑管道' : '新增管道'}
          open={modalVisible}
          onOk={() => void handleSubmit()}
          onCancel={() => setModalVisible(false)}
          width={720}
          destroyOnClose
          className={styles.modal}
          okText="保存"
          cancelText="取消"
        >
          <Form form={form} layout="vertical">
            <Form.Item
              name="proId"
              label="所属项目"
              rules={[{ required: true, message: '请选择所属项目' }]}
            >
              <Select
                placeholder="请选择所属项目"
                showSearch
                optionFilterProp="label"
                options={projects.map((project) => ({
                  value: project.proId,
                  label: project.name || project.number || `项目 ${project.proId}`,
                }))}
              />
            </Form.Item>

            <Form.Item
              name="name"
              label="管道名称"
              rules={[{ required: true, message: '请输入管道名称' }]}
            >
              <Input placeholder="请输入管道名称" />
            </Form.Item>

            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="length" label="长度 (km)" rules={[{ required: true, message: '请输入长度' }]}>
                  <InputNumber min={0} precision={2} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="diameter" label="管径 (mm)" rules={[{ required: true, message: '请输入管径' }]}>
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="thickness" label="壁厚 (mm)" rules={[{ required: true, message: '请输入壁厚' }]}>
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="throughput" label="输量 (m³/h)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="startAltitude" label="起点高程 (m)">
                  <InputNumber style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="endAltitude" label="终点高程 (m)">
                  <InputNumber style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item name="roughness" label="粗糙度">
              <InputNumber min={0} precision={4} style={{ width: '100%' }} />
            </Form.Item>
          </Form>
        </Modal>
      </div>
    </AnimatedPage>
  );
}
