import { useEffect } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  message,
} from 'antd';
import {
  BellOutlined,
  BgColorsOutlined,
  ControlOutlined,
  SaveOutlined,
  SettingOutlined,
  SyncOutlined,
  UndoOutlined,
  UserOutlined,
} from '@ant-design/icons';
import AnimatedPage from '../../components/common/AnimatedPage';
import { useThemeStore } from '../../stores/themeStore';
import { useUserStore } from '../../stores/userStore';

type ThemeMode = 'light' | 'dark' | 'system';

interface SystemSettingsFormValues {
  themeMode: ThemeMode;
  autoRefresh: boolean;
  refreshInterval: number;
  alarmThreshold: number;
  soundEnabled: boolean;
  dataRetentionDays: number;
}

const SETTINGS_STORAGE_KEY = 'system-settings';

const defaultValues: SystemSettingsFormValues = {
  themeMode: 'system',
  autoRefresh: true,
  refreshInterval: 5,
  alarmThreshold: 85,
  soundEnabled: true,
  dataRetentionDays: 30,
};

function persistSettings(values: SystemSettingsFormValues) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(values));
}

function getStoredSettings(): SystemSettingsFormValues {
  if (typeof window === 'undefined') {
    return defaultValues;
  }

  try {
    const rawValue = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!rawValue) {
      return defaultValues;
    }

    return {
      ...defaultValues,
      ...JSON.parse(rawValue),
    };
  } catch {
    return defaultValues;
  }
}

export default function SystemSettings() {
  const [form] = Form.useForm<SystemSettingsFormValues>();
  const { mode, resolved, setMode } = useThemeStore();
  const userInfo = useUserStore((state) => state.userInfo);

  useEffect(() => {
    const storedSettings = getStoredSettings();
    form.setFieldsValue({
      ...storedSettings,
      themeMode: mode,
    });
  }, [form, mode]);

  const handleValuesChange = (changedValues: Partial<SystemSettingsFormValues>, allValues: SystemSettingsFormValues) => {
    if (!changedValues.themeMode) {
      return;
    }

    persistSettings(allValues);
    setMode(changedValues.themeMode);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    persistSettings(values);
    setMode(values.themeMode);
    message.success('系统设置已保存');
  };

  const handleReset = () => {
    window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
    form.setFieldsValue(defaultValues);
    setMode(defaultValues.themeMode);
    message.success('已恢复默认设置');
  };

  return (
    <AnimatedPage>
      <div className="page-header">
        <h2>
          <SettingOutlined /> 系统设置
        </h2>
        <p>管理主题、刷新频率和告警策略，设置保存在当前浏览器。</p>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="当前版本先提供前端本地设置。后续如需接后台配置中心，我可以继续帮你接入。"
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card className="page-card" title={<><ControlOutlined /> 基础配置</>}>
            <Form<SystemSettingsFormValues>
              form={form}
              layout="vertical"
              onValuesChange={handleValuesChange}
              initialValues={{
                ...defaultValues,
                themeMode: mode,
              }}
            >
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item label="主题模式" name="themeMode">
                    <Select
                      options={[
                        { label: '跟随系统', value: 'system' },
                        { label: '浅色模式', value: 'light' },
                        { label: '深色模式', value: 'dark' },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    label="自动刷新间隔(秒)"
                    name="refreshInterval"
                    rules={[{ required: true, message: '请输入刷新间隔' }]}
                  >
                    <InputNumber min={1} max={60} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item label="启用自动刷新" name="autoRefresh" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item label="启用声音告警" name="soundEnabled" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item
                    label="高优先级告警阈值(%)"
                    name="alarmThreshold"
                    rules={[{ required: true, message: '请输入告警阈值' }]}
                  >
                    <InputNumber min={50} max={100} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    label="数据保留天数"
                    name="dataRetentionDays"
                    rules={[{ required: true, message: '请输入保留天数' }]}
                  >
                    <InputNumber min={1} max={365} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>

              <Space>
                <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>
                  保存设置
                </Button>
                <Button icon={<UndoOutlined />} onClick={handleReset}>
                  恢复默认
                </Button>
              </Space>
            </Form>
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card className="page-card" title={<><BgColorsOutlined /> 当前状态</>}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="当前主题">
                <Tag color={resolved === 'dark' ? 'blue' : 'gold'}>
                  {resolved === 'dark' ? '深色' : '浅色'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="主题来源">
                <Tag>{mode === 'system' ? '跟随系统' : mode === 'dark' ? '手动深色' : '手动浅色'}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="当前用户">
                <Space size={6}>
                  <UserOutlined />
                  <span>{userInfo?.nickname || userInfo?.username || '未登录用户'}</span>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="角色">
                <Space wrap>
                  {(userInfo?.roles || ['管理员']).map((role) => (
                    <Tag key={role} color="processing">
                      {role}
                    </Tag>
                  ))}
                </Space>
              </Descriptions.Item>
            </Descriptions>
          </Card>

          <Card
            className="page-card"
            title={<><SyncOutlined /> 运行建议</>}
            style={{ marginTop: 16 }}
          >
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Alert type="success" showIcon message="主题切换立即生效，无需刷新页面。" />
              <Alert type="warning" showIcon message="当前设置保存在浏览器本地，换电脑后不会自动同步。" />
              <Alert
                type="info"
                showIcon
                icon={<BellOutlined />}
                message="如果你要把这些设置同步到后端数据库，可以继续扩展成真实配置中心。"
              />
            </Space>
          </Card>
        </Col>
      </Row>
    </AnimatedPage>
  );
}