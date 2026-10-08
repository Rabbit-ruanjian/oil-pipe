import { useEffect, useState } from 'react';
import { Form, Input, Button, Card, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../../api';
import { clearPersistedUserState, useUserStore } from '../../stores/userStore';
import type { LoginParams } from '../../types';
import styles from './Login.module.css';

export default function Login() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setToken, setUserInfo } = useUserStore();

  useEffect(() => {
    clearPersistedUserState();
  }, []);

  const applyLoginResult = (res: Awaited<ReturnType<typeof authApi.login>>) => {
    if (!res.data) {
      return false;
    }

    setToken(res.data.token);
    setUserInfo({
      userId: res.data.userId,
      username: res.data.username,
      nickname: res.data.nickname,
      roles: ['admin'],
    });
    navigate('/dashboard');
    return true;
  };

  const onFinish = async (values: LoginParams) => {
    setLoading(true);
    try {
      const res = await authApi.login(values);
      if (applyLoginResult(res)) {
        message.success('登录成功');
      }
    } catch {
      // Error is handled by the request interceptor.
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.background}>
        <div className={styles.pipeline}></div>
      </div>

      <Card className={styles.loginCard}>
        <div className={styles.header}>
          <div className={styles.logo}>
            <span className={styles.logoIcon}>⚡</span>
          </div>
          <h1>管道能耗分析系统</h1>
          <p>面向输油管道的能耗分析与优化平台</p>
        </div>

        <Form
          name="login"
          onFinish={onFinish}
          autoComplete="off"
          size="large"
          initialValues={{ username: 'admin', password: 'admin123' }}
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="用户名" />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              className={styles.loginBtn}
            >
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
