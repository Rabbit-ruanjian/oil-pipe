/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PageHeader - 响应式页面头部组件
 *  Design: Apple HIG + Linear + Stripe Light Theme
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { ReactNode } from 'react';
import styles from './PageHeader.module.css';

interface PageHeaderProps {
  /** 页面标题 */
  title: ReactNode;
  /** 页面副标题/描述 */
  subtitle?: ReactNode;
  /** 右侧操作区域 */
  actions?: ReactNode;
  /** 面包屑导航 */
  breadcrumb?: ReactNode;
  /** 标题是否带渐变色 */
  gradient?: boolean;
  /** 自定义类名 */
  className?: string;
}

export default function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
  gradient = false,
  className = '',
}: PageHeaderProps) {
  return (
    <header className={`${styles.header} ${className}`}>
      {breadcrumb && (
        <div className={styles.breadcrumb}>
          {breadcrumb}
        </div>
      )}

      <div className={styles.headerTop}>
        <div className={styles.headerInfo}>
          <h1 className={`${styles.title} ${gradient ? styles.titleGradient : ''}`}>
            {title}
          </h1>
          {subtitle && (
            <p className={styles.subtitle}>{subtitle}</p>
          )}
        </div>

        {actions && (
          <div className={styles.actions}>
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
