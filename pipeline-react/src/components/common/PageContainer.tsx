/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PageContainer - 响应式页面容器组件
 *  Design: Apple HIG + Linear + Stripe Light Theme
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { ReactNode } from 'react';
import styles from './PageContainer.module.css';

interface PageContainerProps {
  children: ReactNode;
  className?: string;
  /** 是否使用全宽布局 */
  fullWidth?: boolean;
  /** 是否移除内边距 */
  noPadding?: boolean;
}

export default function PageContainer({
  children,
  className = '',
  fullWidth = false,
  noPadding = false,
}: PageContainerProps) {
  const containerClasses = [
    styles.container,
    fullWidth ? styles.fullWidth : '',
    noPadding ? styles.noPadding : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={containerClasses}>
      <div className={styles.content}>
        {children}
      </div>
    </div>
  );
}
