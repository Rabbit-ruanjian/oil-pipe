import { useState, useEffect, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Avatar, Button, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import {
  ApartmentOutlined,
  BarChartOutlined,
  BookOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  LogoutOutlined,
  MenuOutlined,
  MoonOutlined,
  SettingOutlined,
  SunOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useUserStore } from '../../stores/userStore';
import { useResponsive } from '../../hooks/useResponsive';
import { useThemeStore } from '../../stores/themeStore';
import MobileTabBar from './MobileTabBar';
import styles from './MainLayout.module.css';

type NavItem = { key: string; label: string; icon: React.ReactNode; badge?: string };

const navItems: NavItem[] = [
  { key: '/dashboard', label: '首页总览', icon: <DashboardOutlined /> },
  { key: '/data/project', label: '项目 · 管道 · 泵站 · 油品', icon: <DatabaseOutlined /> },
  { key: '/analysis/hydraulic', label: '水力分析', icon: <ThunderboltOutlined /> },
  { key: '/analysis/sensitivity', label: '敏感性分析', icon: <BarChartOutlined /> },
  { key: '/analysis/optimization', label: '泵站优化', icon: <SettingOutlined /> },
  { key: '/ai/chat', label: '智能助手', icon: <DeploymentUnitOutlined />, badge: 'LIVE' },
  { key: '/ai/report', label: '智能报告', icon: <BookOutlined /> },
  { key: '/ai/trace', label: '知识库', icon: <BookOutlined /> },
  { key: '/ai/hub', label: '知识库中枢', icon: <ApartmentOutlined /> },
];

const pathForNav = (key: string) => key.startsWith('/analysis/') ? key.replace('/analysis/', '/calculation/') : key;

export default function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { userInfo, logout } = useUserStore();
  const { resolved, setMode } = useThemeStore();
  const { isMobile } = useResponsive();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isAIChatRoute = location.pathname === '/ai/chat';

  useEffect(() => {
    document.body.style.overflow = mobileNavOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileNavOpen]);

  const selectedKey = navItems.find((item) => location.pathname === item.key || location.pathname.startsWith(`${item.key}/`))?.key
    ?? (location.pathname.startsWith('/data/') ? '/data/project' : location.pathname);

  const handleNavigate = useCallback((key: string) => {
    navigate(pathForNav(key));
    setMobileNavOpen(false);
  }, [navigate]);

  const userMenuItems: MenuProps['items'] = [
    { key: 'profile', icon: <UserOutlined />, label: '个人资料' },
    { key: 'settings', icon: <SettingOutlined />, label: '系统设置' },
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
  ];

  const handleUserMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'logout') { logout(); navigate('/login'); }
  };

  return (
    <div className={`${styles.layout} ${isAIChatRoute ? styles.aiChatLayout : ''}`}>
      {!isAIChatRoute && (
        <>
          {isMobile && <div className={`${styles.overlay} ${mobileNavOpen ? styles.visible : ''}`} onClick={() => setMobileNavOpen(false)} />}
          <header className={styles.header}>
            <div className={styles.brand} onClick={() => handleNavigate('/dashboard')} role="button" tabIndex={0}>
              <span className={styles.logoIcon} aria-hidden="true">N</span>
              <span className={styles.logoText}><strong>油脉智衡</strong><small>输油管网水力能效决策平台</small></span>
            </div>
            <nav className={`${styles.topNav} ${mobileNavOpen ? styles.topNavOpen : ''}`} aria-label="主导航">
              {navItems.map((item) => (
                <button key={item.key} className={`${styles.navItem} ${selectedKey === item.key ? styles.navItemActive : ''}`} onClick={() => handleNavigate(item.key)}>
                  <span className={styles.navIcon}>{item.icon}</span>
                  <span>{item.label}</span>
                  {item.badge && <small className={styles.liveBadge}>{item.badge}</small>}
                </button>
              ))}
            </nav>
            <div className={styles.headerRight}>
              <span className={styles.engineVersion}>水力计算引擎 v1.0</span>
              <Button type="text" icon={resolved === 'dark' ? <SunOutlined /> : <MoonOutlined />} className={styles.headerBtn} onClick={() => setMode(resolved === 'dark' ? 'light' : 'dark')} aria-label="切换主题" />
              <Dropdown menu={{ items: userMenuItems, onClick: handleUserMenuClick }} placement="bottomRight" trigger={['click']}>
                <div className={styles.userInfo} role="button" tabIndex={0}><Avatar size="small" icon={<UserOutlined />} /><span className={styles.userName}>{userInfo?.nickname || '管'}</span></div>
              </Dropdown>
              {isMobile && <Button type="text" icon={<MenuOutlined />} className={styles.mobileMenuBtn} onClick={() => setMobileNavOpen((value) => !value)} aria-label="打开菜单" />}
            </div>
          </header>
        </>
      )}
      <main className={styles.content}>
        {isAIChatRoute ? <div className={`${styles.aiViewport} ${styles.aiChatViewport}`}><Outlet /></div> : <Outlet />}
      </main>
      {isMobile && <MobileTabBar />}
    </div>
  );
}
