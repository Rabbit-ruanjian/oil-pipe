import { useLocation, useNavigate } from 'react-router-dom';
import {
  CalculatorOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  RobotOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import styles from './MobileTabBar.module.css';

const tabs = [
  { key: 'dashboard', label: '首页', icon: <DashboardOutlined />, path: '/dashboard', matchPrefix: '/dashboard' },
  { key: 'data', label: '数据', icon: <DatabaseOutlined />, path: '/data/project', matchPrefix: '/data' },
  { key: 'calculation', label: '计算', icon: <CalculatorOutlined />, path: '/calculation/hydraulic', matchPrefix: '/calculation' },
  { key: 'ai', label: 'AI', icon: <RobotOutlined />, path: '/ai/report', matchPrefix: '/ai' },
  { key: 'settings', label: '设置', icon: <SettingOutlined />, path: '/settings', matchPrefix: '/settings' },
];

export default function MobileTabBar() {
  const navigate = useNavigate();
  const location = useLocation();

  const activeTab =
    tabs.find((tab) => location.pathname.startsWith(tab.matchPrefix))?.key ||
    (location.pathname.startsWith('/analysis') || location.pathname.startsWith('/calculation') ? 'calculation' : 'dashboard');

  return (
    <nav className={styles.tabBar} aria-label="主导航">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          className={`${styles.tabItem} ${activeTab === tab.key ? styles.tabItemActive : ''}`}
          onClick={() => navigate(tab.path.replace('/calculation/', '/analysis/'))}
          aria-label={tab.label}
        >
          <span className={styles.tabIcon}>{tab.icon}</span>
          <span className={styles.tabLabel}>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
