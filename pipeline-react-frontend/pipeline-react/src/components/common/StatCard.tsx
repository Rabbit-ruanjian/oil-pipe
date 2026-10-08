/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  StatCard - 响应式统计卡片组件
 *  Design: Apple HIG + Linear + Stripe Light Theme
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { ReactNode, HTMLAttributes } from 'react';
import { RiArrowUpLine, RiArrowDownLine } from 'react-icons/ri';
import styles from './StatCard.module.css';

type TrendType = 'up' | 'down' | 'neutral';
type ColorType = 'blue' | 'cyan' | 'green' | 'amber' | 'red' | 'purple';

interface StatCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** 统计标签 */
  label: string;
  /** 统计值 */
  value: string | number;
  /** 值的单位 */
  unit?: string;
  /** 趋势方向 */
  trend?: TrendType;
  /** 趋势值 */
  trendValue?: string;
  /** 描述文字 */
  description?: string;
  /** 图标 */
  icon?: ReactNode;
  /** 图标颜色主题 */
  color?: ColorType;
  /** 点击事件 */
  onClick?: () => void;
  /** 自定义类名 */
  className?: string;
}

export default function StatCard({
  label,
  value,
  unit,
  trend,
  trendValue,
  description,
  icon,
  color = 'blue',
  onClick,
  className = '',
  ...rest
}: StatCardProps) {
  const cardClasses = [
    styles.card,
    onClick ? styles.clickable : '',
    className,
  ].filter(Boolean).join(' ');

  const getTrendClass = () => {
    if (!trend) return '';
    const trendMap = {
      up: styles.trendUp,
      down: styles.trendDown,
      neutral: styles.trendNeutral,
    };
    return trendMap[trend];
  };

  const getIconColorClass = () => {
    const colorMap: Record<ColorType, string> = {
      blue: styles.iconBlue,
      cyan: styles.iconCyan,
      green: styles.iconGreen,
      amber: styles.iconAmber,
      red: styles.iconRed,
      purple: styles.iconPurple,
    };
    return colorMap[color];
  };

  return (
    <div
      className={cardClasses}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      {...rest}
    >
      <div className={styles.header}>
        <span className={styles.label}>{label}</span>
        {icon && (
          <div className={`${styles.iconWrapper} ${getIconColorClass()}`}>
            {icon}
          </div>
        )}
      </div>

      <div className={styles.valueContainer}>
        <span className={styles.value}>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </span>
        {unit && <span className={styles.unit}>{unit}</span>}
      </div>

      {(trend || description) && (
        <div className={styles.footer}>
          {trend && trendValue && (
            <span className={`${styles.trend} ${getTrendClass()}`}>
              {trend === 'up' && <RiArrowUpLine size={12} />}
              {trend === 'down' && <RiArrowDownLine size={12} />}
              {trendValue}
            </span>
          )}
          {description && (
            <span className={styles.description}>{description}</span>
          )}
        </div>
      )}
    </div>
  );
}
