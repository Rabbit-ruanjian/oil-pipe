import { Component, type ReactNode } from 'react';
import { Alert, App as AntApp, ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { useThemeStore } from './stores/themeStore';
import './assets/styles/global.css';
import './assets/styles/responsive.css';
import './assets/styles/container-queries.css';
import './assets/styles/design-system-light.css';

class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24 }}>
          <Alert
            message="前端运行时错误"
            description={this.state.error.message}
            type="error"
            showIcon
          />
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  const resolved = useThemeStore((state) => state.resolved);

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: resolved === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#3B82F6',
          borderRadius: 10,
        },
      }}
    >
      <AntApp>
        <RootErrorBoundary>
          <RouterProvider router={router} />
        </RootErrorBoundary>
      </AntApp>
    </ConfigProvider>
  );
}
