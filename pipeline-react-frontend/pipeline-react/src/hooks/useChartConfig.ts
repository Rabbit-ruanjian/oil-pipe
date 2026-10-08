import { useState, useEffect, useRef } from 'react';

export function useChartConfig(options: { mobileSvg?: boolean } = {}) {
  const { mobileSvg = true } = options;
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const isCompact = containerWidth < 500;
  const isMedium = containerWidth >= 500 && containerWidth < 800;
  const isLarge = containerWidth >= 800;
  const renderer = (isCompact && mobileSvg ? 'svg' : 'canvas') as 'svg' | 'canvas';

  const legend: Record<string, unknown> | false = isCompact
    ? false
    : isMedium
      ? { bottom: 0, icon: 'roundRect', itemWidth: 14, itemHeight: 3, textStyle: { fontSize: 11 } }
      : { right: 20, top: 0, icon: 'roundRect', itemWidth: 16, itemHeight: 3 };

  const grid = isCompact
    ? { left: '12%', right: '5%', bottom: '5%', top: '8%', containLabel: false }
    : { left: '3%', right: '4%', bottom: '3%', top: '15%', containLabel: true };

  const xAxisLabel = isCompact
    ? { rotate: 45, fontSize: 10, interval: 'auto' as const }
    : isMedium
      ? { rotate: 0, fontSize: 11, interval: 0 }
      : { rotate: 0, fontSize: 12, interval: 0 };

  const tooltipConf = isCompact
    ? {
      confine: true,
      extraCssText: 'max-width:200px;font-size:12px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);',
    }
    : {
      confine: false,
      extraCssText: 'border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.12);',
    };

  return {
    containerRef,
    containerWidth,
    isCompact,
    isMedium,
    isLarge,
    renderer,
    legend,
    grid,
    xAxisLabel,
    tooltipConf,
  };
}

