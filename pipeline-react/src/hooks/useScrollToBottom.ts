import { useEffect, useRef, useState } from 'react';

interface UseScrollToBottomOptions {
  /**
   * 是否启用自动滚动
   */
  enabled?: boolean;
  /**
   * 平滑滚动行为
   */
  behavior?: ScrollBehavior;
  /**
   * 距离底部多少像素时认为已在底部
   */
  threshold?: number;
}

/**
 * 滚动到底部 Hook
 * 自动检测用户手动滚动，并在重新回到底部后恢复自动跟随
 */
export function useScrollToBottom<T extends HTMLElement>(
  deps: unknown[] = [],
  options: UseScrollToBottomOptions = {}
) {
  const { enabled = true, behavior = 'smooth', threshold = 100 } = options;
  const ref = useRef<T>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [userScrolled, setUserScrolled] = useState(false);
  const autoScrollingRef = useRef(false);

  const checkIfAtBottom = () => {
    if (!ref.current) return false;
    const { scrollTop, scrollHeight, clientHeight } = ref.current;
    return scrollHeight - scrollTop - clientHeight < threshold;
  };

  const scrollToBottom = (scrollBehavior: ScrollBehavior = behavior) => {
    if (!ref.current) return;
    autoScrollingRef.current = true;
    ref.current.scrollTo({
      top: ref.current.scrollHeight,
      behavior: scrollBehavior,
    });
    setIsAtBottom(true);
    setUserScrolled(false);
    window.setTimeout(() => {
      autoScrollingRef.current = false;
    }, scrollBehavior === 'smooth' ? 250 : 0);
  };

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const handleScroll = () => {
      const atBottom = checkIfAtBottom();
      setIsAtBottom(atBottom);

      // 程序主动滚动时，不要把它误判成用户打断自动跟随
      if (autoScrollingRef.current) {
        if (atBottom) {
          setUserScrolled(false);
        }
        return;
      }

      // 离开底部时暂停自动跟随，回到底部时恢复
      setUserScrolled(!atBottom);
    };

    element.addEventListener('scroll', handleScroll);
    handleScroll();
    return () => element.removeEventListener('scroll', handleScroll);
  }, [threshold]);

  useEffect(() => {
    if (!enabled || userScrolled) return;

    const frame = window.requestAnimationFrame(() => {
      scrollToBottom(isAtBottom ? 'auto' : behavior);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [...deps, behavior, enabled, isAtBottom, userScrolled]);

  return {
    ref,
    isAtBottom,
    userScrolled,
    scrollToBottom,
  };
}
