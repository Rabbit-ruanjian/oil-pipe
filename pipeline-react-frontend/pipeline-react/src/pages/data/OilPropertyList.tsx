/**
 * OilPropertyList - 油品特性管理页面
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Space,
  Tooltip,
  message,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { oilPropertyApi } from '../../api';
import type { OilProperty } from '../../types';
import AnimatedPage from '../../components/common/AnimatedPage';
import ResponsiveTable from '../../components/common/ResponsiveTable';
import styles from './DataPage.module.css';

function nowrapTitle(text: string) {
  return <span style={{ whiteSpace: 'nowrap' }}>{text}</span>;
}

function formatViscosity(value: number) {
  if (!Number.isFinite(value)) {
    return '-';
  }

  const normalized = value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return normalized || '0';
}

export default function OilPropertyList() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<OilProperty[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<OilProperty | null>(null);
  const [searchText, setSearchText] = useState('');
  const [form] = Form.useForm<OilProperty>();

  useEffect(() => {
    void fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const response = await oilPropertyApi.list();
      setData(Array.isArray(response.data) ? response.data : []);
    } catch {
      setData([]);
      message.error('加载油品数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    setEditingItem(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleEdit = (record: OilProperty) => {
    setEditingItem(record);
    form.setFieldsValue(record);
    setModalVisible(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await oilPropertyApi.delete([id]);
      message.success('删除成功');
      await fetchData();
    } catch {
      message.error('删除失败');
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingItem) {
        await oilPropertyApi.update({ ...editingItem, ...values });
        message.success('修改成功');
      } else {
        await oilPropertyApi.create(values);
        message.success('新增成功');
      }
      setModalVisible(false);
      await fetchData();
    } catch {
      message.error('操作失败');
    }
  };

  const filteredData = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) {
      return data;
    }

    return data.filter((item) => String(item.name ?? '').toLowerCase().includes(keyword));
  }, [data, searchText]);

  const getDensityClass = (density: number) => {
    if (density < 850) return { label: '轻质', color: 'var(--semantic-success)' };
    if (density < 900) return { label: '中质', color: 'var(--accent-primary)' };
    return { label: '重质', color: 'var(--semantic-warning)' };
  };

  const columns: ColumnsType<OilProperty> = [
    {
      title: nowrapTitle('编号'),
      dataIndex: 'id',
      width: 88,
      align: 'center',
    },
    {
      title: nowrapTitle('油品名称'),
      dataIndex: 'name',
      width: 340,
      align: 'center',
      render: (text: string) => (
        <span
          style={{
            fontWeight: 600,
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap',
            letterSpacing: '0.01em',
          }}
        >
          {text}
        </span>
      ),
    },
    {
      title: nowrapTitle('密度(kg/m3)'),
      dataIndex: 'density',
      width: 300,
      align: 'center',
      render: (val: number) => {
        const cls = getDensityClass(val);
        return (
          <span style={{ whiteSpace: 'nowrap' }}>
            <span style={{ color: cls.color, fontWeight: 600 }}>{val}</span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                marginLeft: 10,
                padding: '4px 10px',
                fontSize: 'var(--text-xs)',
                borderRadius: '999px',
                background: `color-mix(in srgb, ${cls.color} 12%, white)`,
                color: cls.color,
                fontWeight: 600,
              }}
            >
              {cls.label}
            </span>
          </span>
        );
      },
    },
    {
      title: nowrapTitle('运动粘度(m²/s)'),
      dataIndex: 'viscosity',
      width: 260,
      align: 'center',
      render: (val: number) => (
        <span
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--text-primary)',
          }}
        >
          {formatViscosity(val)}
        </span>
      ),
    },
    {
      title: nowrapTitle('操作'),
      key: 'action',
      width: 180,
      align: 'center',
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
            description="此操作不可恢复"
            onConfirm={() => void handleDelete(record.id)}
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
      <div className={styles.pageContent} style={{ maxWidth: 1600 }}>
        <header className={styles.header}>
          <div className={styles.headerTop}>
            <div className={styles.headerInfo}>
              <h1 className={styles.title}>
                <span className={styles.titleAccent}>油品特性</span>
              </h1>
              <p className={styles.subtitle}>管理油品物性参数，突出名称、密度与运动粘度等核心指标。</p>
            </div>
            <div className={styles.headerActions}>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} size="middle">
                新增油品
              </Button>
            </div>
          </div>
        </header>

        <Card className={styles.tableCard} bordered={false}>
          <div className={styles.toolbar}>
            <div className={styles.toolbarLeft}>
              <Input
                placeholder="搜索油品名称..."
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
            scroll={{ x: 1168 }}
            pagination={{
              pageSize: 10,
              showSizeChanger: true,
              showQuickJumper: true,
              showTotal: (total) => `共 ${total} 条记录`,
              className: styles.paginationElegant,
            }}
            cardRender={(record) => {
              const cls = getDensityClass(record.density);

              return (
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
                      marginBottom: 12,
                    }}
                  >
                    {record.name}
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        padding: '10px 12px',
                        background: 'var(--bg-base)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-md)',
                      }}
                    >
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>密度</div>
                      <div style={{ color: cls.color, fontWeight: 600 }}>
                        {record.density} <span style={{ fontWeight: 500 }}>{cls.label}</span>
                      </div>
                    </div>
                    <div
                      style={{
                        padding: '10px 12px',
                        background: 'var(--bg-base)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-md)',
                      }}
                    >
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>运动粘度</div>
                      <div
                        style={{
                          color: 'var(--text-primary)',
                          fontWeight: 600,
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {formatViscosity(record.viscosity)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            }}
          />
        </Card>

        <Modal
          title={editingItem ? '编辑油品' : '新增油品'}
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
              label="油品名称"
              rules={[{ required: true, message: '请输入油品名称' }]}
            >
              <Input placeholder="请输入油品名称" />
            </Form.Item>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="density"
                  label="密度(kg/m3)"
                  rules={[{ required: true, message: '请输入密度' }]}
                >
                  <InputNumber min={0} style={{ width: '100%' }} placeholder="0" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="viscosity"
                  label="运动粘度(m²/s)"
                  rules={[{ required: true, message: '请输入粘度' }]}
                >
                  <InputNumber min={0} precision={8} style={{ width: '100%' }} placeholder="0.00002000" />
                </Form.Item>
              </Col>
            </Row>
          </Form>
        </Modal>
      </div>
    </AnimatedPage>
  );
}
