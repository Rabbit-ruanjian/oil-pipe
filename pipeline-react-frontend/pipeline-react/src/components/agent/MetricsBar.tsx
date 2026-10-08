import { Card, Statistic } from 'antd';
import type { TraceMetrics } from '../../types/agent';

interface MetricsBarProps {
  metrics: TraceMetrics;
}

export default function MetricsBar({ metrics }: MetricsBarProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(120px, 1fr))', gap: 8 }}>
      <Card size="small">
        <Statistic title="总耗时(ms)" value={metrics.total_duration_ms} />
      </Card>
      <Card size="small">
        <Statistic title="模型调用" value={metrics.llm_calls} />
      </Card>
      <Card size="small">
        <Statistic title="令牌数" value={metrics.total_tokens} />
      </Card>
      <Card size="small">
        <Statistic title="工具调用" value={metrics.tool_calls} />
      </Card>
    </div>
  );
}
