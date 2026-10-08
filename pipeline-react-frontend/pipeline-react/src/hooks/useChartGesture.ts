import { useEffect, type RefObject } from 'react';

export function useChartGesture(containerRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const preventZoom = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };

    el.addEventListener('touchmove', preventZoom, { passive: false });
    return () => el.removeEventListener('touchmove', preventZoom);
  }, [containerRef]);
}
