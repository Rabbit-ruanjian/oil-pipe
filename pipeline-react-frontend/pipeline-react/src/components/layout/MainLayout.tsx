/**
 * Main Layout Component
 * Design: Apple HIG + Linear + Stripe Light Theme
 */

import { useState, useEffect, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Avatar, Dropdown, Button } from 'antd';
import type { MenuProps } from 'antd';
import {
  DashboardOutlined,
  DatabaseOutlined,
  CalculatorOutlined,
  ThunderboltOutlined,
  BarChartOutlined,
  UserOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SettingOutlined,
  ProjectOutlined,
  ApiOutlined,
  ControlOutlined,
  ExperimentOutlined,
  BookOutlined,
  MenuOutlined,
  CloseOutlined,
  RobotOutlined,
  DeploymentUnitOutlined,
  SunOutlined,
  MoonOutlined,
} from '@ant-design/icons';
import { useUserStore } from '../../stores/userStore';
import { useResponsive } from '../../hooks/useResponsive';
import { useThemeStore } from '../../stores/themeStore';
import MobileTabBar from './MobileTabBar';
import styles from './MainLayout.module.css';

const { Header, Sider, Content } = Layout;

const menuItems: MenuProps['items'] = [
  {
    key: '/dashboard',
    icon: <DashboardOutlined />,
    label: '首页总览',
  },
  {
    key: 'data',
    icon: <DatabaseOutlined />,
    label: '数据管理',
    children: [
      { key: '/data/project', icon: <ProjectOutlined />, label: '项目管理' },
      { key: '/data/pipeline', icon: <ApiOutlined />, label: '管道参数' },
      { key: '/data/pump', icon: <ControlOutlined />, label: '泵站参数' },
      { key: '/data/oil', icon: <ExperimentOutlined />, label: '油品参数' },
    ],
  },
  {
    key: 'calculation',
    icon: <CalculatorOutlined />,
    label: '计算分析',
    children: [
      { key: '/calculation/hydraulic', icon: <ThunderboltOutlined />, label: '水力分析' },
      { key: '/calculation/optimization', icon: <SettingOutlined />, label: '泵站优化' },
      { key: '/calculation/sensitivity', icon: <BarChartOutlined />, label: '敏感性分析' },
    ],
  },
  {
    key: 'ai',
    icon: <RobotOutlined />,
    label: '智能助手',
    children: [
      { key: '/ai/chat', icon: <DeploymentUnitOutlined />, label: '智能对话' },
      { key: '/ai/trace', icon: <BookOutlined />, label: '知识库录入' },
      { key: '/ai/report', icon: <BarChartOutlined />, label: '智能报告' },
    ],
  },
];

export default function MainLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const isAIRoute = location.pathname.startsWith('/ai');
  const isAIChatRoute = location.pathname === '/ai/chat';
  const { userInfo, logout } = useUserStore();
  const { resolved, setMode } = useThemeStore();
  const { isMobile, isTablet, width } = useResponsive();

  useEffect(() => {
    if (isTablet) {
      setCollapsed(true);
    } else if (!isMobile) {
      setCollapsed(false);
    }
  }, [isMobile, isTablet, width]);

  useEffect(() => {
    if (mobileMenuOpen) {
      setMobileMenuOpen(false);
    }
  }, [location.pathname, mobileMenuOpen]);

  const handleOverlayClick = useCallback(() => {
    setMobileMenuOpen(false);
  }, []);

  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    const targetPath = String(key).replace('/calculation/', '/analysis/');
    navigate(targetPath);
    if (isMobile) {
      setMobileMenuOpen(false);
    }
  };

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: '个人资料',
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: '系统设置',
    },
    {
      type: 'divider',
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      danger: true,
    },
  ];

  const handleUserMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'logout') {
      logout();
      navigate('/login');
    }
  };

  const getSelectedKeys = () => {
    const { pathname } = location;
    if (pathname.startsWith('/ai/report')) return ['/ai/report'];
    if (pathname.startsWith('/analysis/')) {
      return [pathname.replace('/analysis/', '/calculation/')];
    }
    return [pathname];
  };

  const getOpenKeys = () => {
    const { pathname } = location;
    if (pathname.startsWith('/data')) return ['data'];
    if (pathname.startsWith('/analysis') || pathname.startsWith('/calculation')) return ['calculation'];
    if (pathname.startsWith('/ai')) return ['ai'];
    return [];
  };

  const toggleMobileMenu = useCallback(() => {
    setMobileMenuOpen((prev) => !prev);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  const getSiderWidth = () => {
    if (isMobile) return 280;
    if (width < 768) return 200;
    if (width < 1024) return 220;
    return 260;
  };

  return (
    <Layout className={styles.layout}>
      {isMobile && (
        <div
          className={`${styles.overlay} ${mobileMenuOpen ? styles.visible : ''}`}
          onClick={handleOverlayClick}
          aria-hidden="true"
        />
      )}

      <Sider
        trigger={null}
        collapsible
        collapsed={isMobile ? false : collapsed}
        className={`${styles.sider} ${mobileMenuOpen ? styles.mobileOpen : ''}`}
        width={getSiderWidth()}
        collapsedWidth={72}
      >
        <div className={`${styles.logo} ${collapsed && !isMobile ? styles.logoCollapsed : ''}`}>
          <div className={styles.logoBrand}>
          <span className={styles.logoIcon}>P</span>
          {(!collapsed || isMobile) && <span className={styles.logoText}>管道智能助手</span>}
          </div>
          {!isMobile && (
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={toggleCollapsed}
              className={styles.logoTrigger}
              aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
            />
          )}
        </div>

        <Menu
          mode="inline"
          selectedKeys={getSelectedKeys()}
          defaultOpenKeys={collapsed ? [] : getOpenKeys()}
          items={menuItems}
          onClick={handleMenuClick}
          inlineCollapsed={!isMobile && collapsed}
        />
      </Sider>

      <Layout>
        <Header className={styles.header}>
          <div className={styles.headerLeft}>
            {isMobile ? (
              <Button
                type="text"
                icon={mobileMenuOpen ? <CloseOutlined /> : <MenuOutlined />}
                onClick={toggleMobileMenu}
                className={styles.mobileMenuBtn}
                aria-label={mobileMenuOpen ? '关闭菜单' : '打开菜单'}
              />
            ) : (
              <Button
                type="text"
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={toggleCollapsed}
                className={styles.trigger}
                aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
              />
            )}
          </div>

          <div className={styles.headerRight}>
            <Button
              type="text"
              icon={resolved === 'dark' ? <SunOutlined /> : <MoonOutlined />}
              className={styles.headerBtn}
              onClick={() => setMode(resolved === 'dark' ? 'light' : 'dark')}
              aria-label={resolved === 'dark' ? '切换为浅色模式' : '切换为深色模式'}
            />

            <Dropdown
              menu={{ items: userMenuItems, onClick: handleUserMenuClick }}
              placement="bottomRight"
              trigger={['click']}
            >
              <div className={styles.userInfo} role="button" tabIndex={0}>
                <Avatar size="small" icon={<UserOutlined />} />
                <span className={styles.userName}>{userInfo?.nickname || '当前用户'}</span>
              </div>
            </Dropdown>
          </div>
        </Header>

        <Content className={`${styles.content} container-responsive`}>
          {isAIRoute ? (
            <div className={`${styles.aiViewport} ${isAIChatRoute ? styles.aiChatViewport : ''}`}>
              <Outlet />
            </div>
          ) : (
            <Outlet />
          )}
        </Content>

        {isMobile && <MobileTabBar />}
      </Layout>
    </Layout>
  );
}
