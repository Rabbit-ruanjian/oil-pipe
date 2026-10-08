/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Card - 响应式卡片组件
 *  Design: Apple HIG + Linear + Stripe Light Theme
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { forwardRef } from 'react';
import type { ReactNode, HTMLAttributes } from 'react';
import styles from './Card.module.css';

interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  children: ReactNode;
  /** 卡片标题 */
  title?: ReactNode;
  /** 卡片副标题 */
  subtitle?: ReactNode;
  /** 右侧操作区域 */
  extra?: ReactNode;
  /** 是否显示头部边框 */
  headerBorder?: boolean;
  /** 卡片尺寸 */
  size?: 'default' | 'small' | 'large';
  /** 是否可悬浮 */
  hoverable?: boolean;
  /** 是否无内边距 */
  noPadding?: boolean;
  /** 自定义类名 */
  className?: string;
}

const Card = forwardRef<HTMLDivElement, CardProps>(({
  children,
  title,
  subtitle,
  extra,
  headerBorder = true,
  size = 'default',
  hoverable = false,
  noPadding = false,
  className = '',
  ...rest
}, ref) => {
  const cardClasses = [
    styles.card,
    styles[size],
    hoverable ? styles.hoverable : '',
    noPadding ? styles.noPadding : '',
    className,
  ].filter(Boolean).join(' ');

  const hasHeader = title || subtitle || extra;

  return (
    <div ref={ref} className={cardClasses} {...rest}>
      {hasHeader && (
        <div className={`${styles.header} ${headerBorder ? styles.headerBorder : ''}`}>
          <div className={styles.headerContent}>
            {title && <h3 className={styles.title}>{title}</h3>}
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          {extra && <div className={styles.extra}>{extra}</div>}
        </div>
      )}
      <div className={styles.body}>
        {children}
      </div>
    </div>
  );
});

Card.displayName = 'Card';

export default Card;
