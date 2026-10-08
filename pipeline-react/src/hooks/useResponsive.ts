/**
 * useResponsive - 响应式断点检测Hook
 * 提供细粒度的屏幕尺寸检测和响应式状态管理
 */

import { useState, useEffect, useCallback, useMemo } from 'react';

// 断点定义 (与CSS变量保持一致)
export const breakpoints = {
  xs: 375,   // iPhone SE
  sm: 640,   // 大手机/小平板竖屏
  md: 768,   // iPad竖屏
  lg: 1024,  // iPad横屏/小笔记本
  xl: 1280,  // 标准笔记本
  '2xl': 1536, // 大屏幕
  '3xl': 1920, // 全高清显示器
} as const;

export type Breakpoint = keyof typeof breakpoints;

export interface ResponsiveState {
  // 当前断点
  breakpoint: Breakpoint;

  // 屏幕尺寸
  width: number;
  height: number;

  // 设备类型判断
  isMobile: boolean;      // < 768px
  isTablet: boolean;      // 768px - 1023px
  isDesktop: boolean;     // >= 1024px
  isLargeDesktop: boolean; // >= 1536px

  // 方向
  isLandscape: boolean;
  isPortrait: boolean;

  // 断点检测函数
  isAbove: (bp: Breakpoint) => boolean;
  isBelow: (bp: Breakpoint) => boolean;
  isBetween: (min: Breakpoint, max: Breakpoint) => boolean;
}

/**
 * 获取当前断点
 */
function getCurrentBreakpoint(width: number): Breakpoint {
  if (width < breakpoints.sm) return 'xs';
  if (width < breakpoints.md) return 'sm';
  if (width < breakpoints.lg) return 'md';
  if (width < breakpoints.xl) return 'lg';
  if (width < breakpoints['2xl']) return 'xl';
  if (width < breakpoints['3xl']) return '2xl';
  return '3xl';
}

/**
 * useResponsive Hook
 * 监听窗口尺寸变化，提供响应式状态
 */
export function useResponsive(): ResponsiveState {
  const [dimensions, setDimensions] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768,
  });

  useEffect(() => {
    let rafId: number;

    const updateDimensions = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setDimensions({
          width: window.visualViewport?.width ?? window.innerWidth,
          height: window.visualViewport?.height ?? window.innerHeight,
        });
      });
    };

    const viewport = window.visualViewport;
    if (viewport) {
      viewport.addEventListener('resize', updateDimensions);
    } else {
      window.addEventListener('resize', updateDimensions);
    }

    updateDimensions();

    return () => {
      cancelAnimationFrame(rafId);
      if (viewport) {
        viewport.removeEventListener('resize', updateDimensions);
      } else {
        window.removeEventListener('resize', updateDimensions);
      }
    };
  }, []);

  const { width, height } = dimensions;
  const breakpoint = getCurrentBreakpoint(width);

  // 断点检测函数
  const isAbove = useCallback(
    (bp: Breakpoint) => width >= breakpoints[bp],
    [width]
  );

  const isBelow = useCallback(
    (bp: Breakpoint) => width < breakpoints[bp],
    [width]
  );

  const isBetween = useCallback(
    (min: Breakpoint, max: Breakpoint) =>
      width >= breakpoints[min] && width < breakpoints[max],
    [width]
  );

  return useMemo(
    () => ({
      breakpoint,
      width,
      height,
      isMobile: width < breakpoints.md,
      isTablet: width >= breakpoints.md && width < breakpoints.lg,
      isDesktop: width >= breakpoints.lg,
      isLargeDesktop: width >= breakpoints['2xl'],
      isLandscape: width > height,
      isPortrait: width <= height,
      isAbove,
      isBelow,
      isBetween,
    }),
    [breakpoint, width, height, isAbove, isBelow, isBetween]
  );
}

/**
 * useMediaQuery Hook
 * 匹配CSS媒体查询
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia(query).matches;
    }
    return false;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);

    const handleChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    // 初始化
    setMatches(mediaQuery.matches);

    // 监听变化
    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [query]);

  return matches;
}

/**
 * useBreakpoint Hook
 * 检测是否在特定断点范围内
 */
export function useBreakpoint(breakpoint: Breakpoint): boolean {
  const query = useMemo(() => {
    return `(min-width: ${breakpoints[breakpoint]}px)`;
  }, [breakpoint]);

  return useMediaQuery(query);
}

/**
 * 预定义的媒体查询
 */
export const mediaQueries = {
  mobile: '(max-width: 767px)',
  tablet: '(min-width: 768px) and (max-width: 1023px)',
  desktop: '(min-width: 1024px)',
  largeDesktop: '(min-width: 1536px)',
  landscape: '(orientation: landscape)',
  portrait: '(orientation: portrait)',
  dark: '(prefers-color-scheme: dark)',
  light: '(prefers-color-scheme: light)',
  reducedMotion: '(prefers-reduced-motion: reduce)',
  highContrast: '(prefers-contrast: high)',
  touch: '(hover: none) and (pointer: coarse)',
  mouse: '(hover: hover) and (pointer: fine)',
} as const;

/**
 * usePrefersDarkMode Hook
 * 检测用户是否偏好深色模式
 */
export function usePrefersDarkMode(): boolean {
  return useMediaQuery(mediaQueries.dark);
}

/**
 * usePrefersReducedMotion Hook
 * 检测用户是否偏好减少动画
 */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery(mediaQueries.reducedMotion);
}

/**
 * useIsTouchDevice Hook
 * 检测是否为触摸设备
 */
export function useIsTouchDevice(): boolean {
  return useMediaQuery(mediaQueries.touch);
}

/**
 * 获取响应式值的工具函数
 * 根据当前断点返回对应的值
 */
export function getResponsiveValue<T>(
  breakpoint: Breakpoint,
  values: Partial<Record<Breakpoint, T>>,
  defaultValue: T
): T {
  const orderedBreakpoints: Breakpoint[] = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'];
  const currentIndex = orderedBreakpoints.indexOf(breakpoint);

  // 从当前断点向下查找第一个定义的值
  for (let i = currentIndex; i >= 0; i--) {
    const bp = orderedBreakpoints[i];
    if (values[bp] !== undefined) {
      return values[bp] as T;
    }
  }

  return defaultValue;
}

/**
 * useResponsiveValue Hook
 * 根据当前断点返回响应式值
 */
export function useResponsiveValue<T>(
  values: Partial<Record<Breakpoint, T>>,
  defaultValue: T
): T {
  const { breakpoint } = useResponsive();
  return getResponsiveValue(breakpoint, values, defaultValue);
}

export default useResponsive;
