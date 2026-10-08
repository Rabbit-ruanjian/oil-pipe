/**
 * PumpStationList - 泵站参数管理页面
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
import { pumpStationApi } from '../../api';
import type { PumpStation } from '../../types';
import AnimatedPage from '../../components/common/AnimatedPage';
import ResponsiveTable from '../../components/common/ResponsiveTable';
import styles from './DataPage.module.css';

function nowrapTitle(text: string) {
  return <span style={{ whiteSpace: 'nowrap' }}>{text}</span>;
}

function formatNumber(value: number | undefined, precision?: number) {
  if (typeof value !== 'number') {
    return '-';
  }

  return typeof precision === 'number' ? value.toFixed(precision) : value;
}

const PUMP_STATION_TABLE_SCROLL_X = 1350;

export default function PumpStationList() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PumpStation[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<PumpStation | null>(null);
  const [searchText, setSearchText] = useState('');
  const [form] = Form.useForm<PumpStation>();

  useEffect(() => {
    void fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const response = await pumpStationApi.list();
      setData(Array.isArray(response.data) ? response.data : []);
    } catch {
      setData([]);
      message.error('加载泵站数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    setEditingItem(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleEdit = (record: PumpStation) => {
    setEditingItem(record);
    form.setFieldsValue(record);
    setModalVisible(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await pumpStationApi.delete([id]);
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
        await pumpStationApi.update({ ...editingItem, ...values });
        message.success('泵站已更新');
      } else {
        await pumpStationApi.create(values);
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

    return data.filter((item) => String(item.name ?? '').toLowerCase().includes(keyword));
  }, [data, searchText]);

  const columns: ColumnsType<PumpStation> = [
    {
      title: nowrapTitle('ID'),
      dataIndex: 'id',
      width: 90,
      align: 'center',
    },
    {
      title: nowrapTitle('泵站名称'),
      dataIndex: 'name',
      width: 180,
      align: 'center',
      render: (text: string) => (
        <span style={{ fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
          {text}
        </span>
      ),
    },
    {
      title: nowrapTitle('泵效率 (%)'),
      dataIndex: 'pumpEfficiency',
      width: 140,
      align: 'center',
      render: (val: number) => (
        <span style={{ color: 'var(--accent-primary)', fontWeight: 500 }}>
          {formatNumber(val)}
        </span>
      ),
    },
    {
      title: nowrapTitle('电效率 (%)'),
      dataIndex: 'electricEfficiency',
      width: 140,
      align: 'center',
      render: (val: number) => formatNumber(val),
    },
    {
      title: nowrapTitle('排量(m3/h)'),
      dataIndex: 'displacement',
      width: 150,
      align: 'center',
      render: (val: number) => formatNumber(val),
    },
    {
      title: nowrapTitle('来压 (MPa)'),
      dataIndex: 'comePower',
      width: 130,
      align: 'center',
      render: (val: number) => formatNumber(val, 2),
    },
    {
      title: nowrapTitle('ZMI480 扬程 (m)'),
      dataIndex: 'zmi480Lift',
      width: 160,
      align: 'center',
      render: (val: number) => formatNumber(val),
    },
    {
      title: nowrapTitle('ZMI375 扬程 (m)'),
      dataIndex: 'zmi375Lift',
      width: 160,
      align: 'center',
      render: (val: number) => formatNumber(val),
    },
    {
      title: nowrapTitle('操作'),
      key: 'action',
      width: 200,
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
      <div className={styles.pageContent} style={{ maxWidth: 1760 }}>
        <header className={styles.header}>
          <div className={styles.headerTop}>
            <div className={styles.headerInfo}>
              <h1 className={styles.title}>
                <span className={styles.titleAccent}>泵站参数</span>
              </h1>
              <p className={styles.subtitle}>
                管理共享泵站设备参数信息，集中维护关键运行指标。
              </p>
            </div>
            <div className={styles.headerActions}>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} size="middle">
                新增泵站
              </Button>
            </div>
          </div>
        </header>

        <Card className={styles.tableCard} bordered={false}>
          <div className={styles.toolbar}>
            <div className={styles.toolbarLeft}>
              <Input
                placeholder="搜索泵站名称..."
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
            scroll={{ x: PUMP_STATION_TABLE_SCROLL_X }}
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
                  <span>
                    泵效率：{formatNumber(record.pumpEfficiency)}% | 电效率：
                    {formatNumber(record.electricEfficiency)}%
                  </span>
                  <span>
                    排量：{formatNumber(record.displacement)} m3/h | 来压：
                    {formatNumber(record.comePower, 2)} MPa
                  </span>
                  <span>
                    ZMI480：{formatNumber(record.zmi480Lift)} m | ZMI375：
                    {formatNumber(record.zmi375Lift)} m
                  </span>
                </div>
              </div>
            )}
          />
        </Card>

        <Modal
          title={editingItem ? '编辑泵站' : '新增泵站'}
          open={modalVisible}
          onOk={() => void handleSubmit()}
          onCancel={() => setModalVisible(false)}
          destroyOnClose
          className={styles.modal}
          okText="保存"
          cancelText="取消"
          width={600}
        >
          <Form form={form} layout="vertical">
            <Form.Item
              name="name"
              label="泵站名称"
              rules={[{ required: true, message: '请输入泵站名称' }]}
            >
              <Input placeholder="请输入泵站名称" />
            </Form.Item>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="pumpEfficiency" label="泵效率(%)">
                  <InputNumber min={0} max={100} precision={1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="electricEfficiency" label="电效率(%)">
                  <InputNumber min={0} max={100} precision={1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="displacement" label="排量(m3/h)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="comePower" label="来压(MPa)">
                  <InputNumber min={0} precision={2} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="zmi480Lift" label="ZMI480扬程(m)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="zmi375Lift" label="ZMI375扬程(m)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          </Form>
        </Modal>
      </div>
    </AnimatedPage>
  );
}
