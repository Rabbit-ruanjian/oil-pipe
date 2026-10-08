import { useEffect, useRef, type CSSProperties } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';

interface ChartProps {
  option: EChartsOption;
  renderer?: 'canvas' | 'svg';
  height?: string | number;
  className?: string;
  style?: CSSProperties;
}

export default function Chart({ option, renderer = 'canvas', height = '100%', className, style }: ChartProps) {
  const chartRef = useRef<ReactECharts>(null);

  useEffect(() => {
    return () => {
      const instance = chartRef.current?.getEchartsInstance();
      if (instance && !instance.isDisposed()) {
        instance.dispose();
      }
    };
  }, []);

  return (
    <ReactECharts
      ref={chartRef}
      option={{ ...option, animationEasing: 'cubicInOut', animationDuration: 600 }}
      opts={{ renderer }}
      style={{ height, ...style }}
      className={className}
      notMerge={false}
      lazyUpdate
    />
  );
}
