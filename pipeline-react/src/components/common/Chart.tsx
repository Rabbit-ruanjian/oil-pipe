import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { useThemeStore } from '../../stores/themeStore';

interface ChartProps {
  option: EChartsOption;
  renderer?: 'canvas' | 'svg';
  height?: string | number;
  className?: string;
  style?: CSSProperties;
}

const DARK_CHART_COLORS = {
  primary: '#F1F5F9',
  secondary: '#CBD5E1',
  tertiary: '#94A3B8',
  border: 'rgba(255, 255, 255, 0.12)',
  grid: 'rgba(255, 255, 255, 0.08)',
  surface: '#1E2433',
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function mapOptionPart(value: unknown, mapper: (item: Record<string, unknown>) => Record<string, unknown>) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item) => mapper(asRecord(item)));
  }
  return mapper(asRecord(value));
}

function applyDarkChartTheme(option: EChartsOption): EChartsOption {
  const base = option as Record<string, unknown>;
  const themeAxis = (axis: Record<string, unknown>) => ({
    ...axis,
    nameTextStyle: {
      ...asRecord(axis.nameTextStyle),
      color: DARK_CHART_COLORS.tertiary,
    },
    axisLine: {
      ...asRecord(axis.axisLine),
      lineStyle: {
        ...asRecord(asRecord(axis.axisLine).lineStyle),
        color: DARK_CHART_COLORS.border,
      },
    },
    axisLabel: {
      ...asRecord(axis.axisLabel),
      color: DARK_CHART_COLORS.tertiary,
    },
    splitLine: {
      ...asRecord(axis.splitLine),
      lineStyle: {
        ...asRecord(asRecord(axis.splitLine).lineStyle),
        color: DARK_CHART_COLORS.grid,
      },
    },
  });

  return {
    ...option,
    backgroundColor: 'transparent',
    textStyle: {
      ...asRecord(base.textStyle),
      color: DARK_CHART_COLORS.secondary,
    },
    title: mapOptionPart(base.title, (title) => ({
      ...title,
      textStyle: { ...asRecord(title.textStyle), color: DARK_CHART_COLORS.primary },
      subtextStyle: { ...asRecord(title.subtextStyle), color: DARK_CHART_COLORS.tertiary },
    })),
    legend: mapOptionPart(base.legend, (legend) => ({
      ...legend,
      textStyle: { ...asRecord(legend.textStyle), color: DARK_CHART_COLORS.secondary },
    })),
    tooltip: mapOptionPart(base.tooltip, (tooltip) => ({
      ...tooltip,
      backgroundColor: DARK_CHART_COLORS.surface,
      borderColor: DARK_CHART_COLORS.border,
      textStyle: { ...asRecord(tooltip.textStyle), color: DARK_CHART_COLORS.primary },
      extraCssText: `${String(tooltip.extraCssText ?? '')};box-shadow:0 12px 30px rgba(0,0,0,.35);`,
    })),
    xAxis: mapOptionPart(base.xAxis, themeAxis),
    yAxis: mapOptionPart(base.yAxis, themeAxis),
    visualMap: mapOptionPart(base.visualMap, (visualMap) => ({
      ...visualMap,
      textStyle: { ...asRecord(visualMap.textStyle), color: DARK_CHART_COLORS.secondary },
    })),
    dataZoom: mapOptionPart(base.dataZoom, (dataZoom) => ({
      ...dataZoom,
      textStyle: { ...asRecord(dataZoom.textStyle), color: DARK_CHART_COLORS.tertiary },
      borderColor: DARK_CHART_COLORS.border,
      fillerColor: 'rgba(8, 145, 178, 0.18)',
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
    })),
  };
}

export default function Chart({ option, renderer = 'canvas', height = '100%', className, style }: ChartProps) {
  const chartRef = useRef<ReactECharts>(null);
  const resolvedTheme = useThemeStore((state) => state.resolved);
  const themedOption = useMemo(
    () => resolvedTheme === 'dark' ? applyDarkChartTheme(option) : option,
    [option, resolvedTheme],
  );

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
      key={resolvedTheme}
      ref={chartRef}
      option={{ ...themedOption, animationEasing: 'cubicInOut', animationDuration: 600 }}
      opts={{ renderer }}
      style={{ height, ...style }}
      className={className}
      notMerge={false}
      lazyUpdate
    />
  );
}
