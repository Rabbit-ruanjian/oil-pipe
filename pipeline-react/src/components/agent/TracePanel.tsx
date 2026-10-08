import { List, Tag, Typography } from 'antd';
import PlanTimeline from './PlanTimeline';
import MetricsBar from './MetricsBar';
import type {
  PlanStep,
  TraceLog,
  TraceMetrics,
  ToolSearchSnapshot,
  ToolExecutionEvent,
} from '../../types/agent';
import styles from './TracePanel.module.css';

const { Text } = Typography;

interface TracePanelProps {
  plan: PlanStep[];
  currentStep: number;
  logs: TraceLog[];
  metrics: TraceMetrics;
  activeTools?: ToolExecutionEvent[];
  toolSearch?: ToolSearchSnapshot | null;
}

export default function TracePanel({
  plan,
  currentStep,
  logs,
  metrics,
  activeTools,
  toolSearch,
}: TracePanelProps) {
  return (
    <div className={styles.panel}>
      {toolSearch && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <Text strong>工具选择</Text>
            <Tag color="blue">{toolSearch.selected_tools.length}/{toolSearch.total_tools}</Tag>
          </div>
          <div className={styles.infoCard}>
            <div className={styles.infoRow}>
              <Text type="secondary">查询词</Text>
              <Text className={styles.value}>{toolSearch.query || '-'}</Text>
            </div>
            <div className={styles.infoRow}>
              <Text type="secondary">模式</Text>
              <Text>{toolSearch.mode}</Text>
            </div>
            <div className={styles.infoRow}>
              <Text type="secondary">耗时</Text>
              <Text>{toolSearch.duration_ms.toFixed(2)} ms</Text>
            </div>
            {(toolSearch.filters?.categories?.length || toolSearch.filters?.sources?.length) ? (
              <div className={styles.metaBlock}>
                {toolSearch.filters?.categories?.length ? (
                  <Text type="secondary">分类过滤: {toolSearch.filters.categories.join(', ')}</Text>
                ) : null}
                {toolSearch.filters?.sources?.length ? (
                  <Text type="secondary">来源过滤: {toolSearch.filters.sources.join(', ')}</Text>
                ) : null}
              </div>
            ) : null}
            <div className={styles.tagWrap}>
              {toolSearch.selected_tools.map((name) => {
                const scoreItem = toolSearch.selected_scores.find((item) => item.name === name);
                const scoreText = scoreItem ? ` ${scoreItem.score.toFixed(2)}` : '';
                return (
                  <Tag
                    key={name}
                    color={scoreItem?.forced ? 'gold' : 'blue'}
                    className={styles.compactTag}
                  >
                    {name}{scoreText}
                  </Tag>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {activeTools && activeTools.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <Text strong>工具调用</Text>
            <Tag color="default">{activeTools.length}</Tag>
          </div>
          <div className={styles.toolList}>
            {activeTools.map((tool, index) => (
              <div
                key={`${tool.call_id ?? tool.tool}-${index}`}
                className={tool.status === 'running' ? styles.toolRunning : styles.toolDone}
              >
                <div className={styles.toolTitleRow}>
                  <span className={styles.toolStatus}>{tool.status === 'running' ? '运行中' : '已完成'}</span>
                  <strong>{tool.tool}</strong>
                </div>
                {tool.output ? (
                  <div className={styles.toolOutput}>
                    {tool.output.slice(0, 120)}
                    {tool.output.length > 120 ? '...' : ''}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <Text strong>执行计划</Text>
          <Tag color="blue">步骤 {currentStep || 0}</Tag>
        </div>
        <div className={styles.planBlock}>
          <PlanTimeline plan={plan} currentStep={currentStep} />
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <Text strong>实时日志</Text>
          <Tag color="default">{logs.length}</Tag>
        </div>
        <List
          size="small"
          bordered
          className={styles.logList}
          dataSource={logs.slice().reverse()}
          renderItem={(item) => (
            <List.Item>
              <div className={styles.logRow}>
                <Tag className={styles.logTag}>{item.type}</Tag>
                <Text type="secondary" className={styles.logTime}>
                  {new Date(item.timestamp).toLocaleTimeString()}
                </Text>
                <Text className={styles.logText}>{item.text}</Text>
              </div>
            </List.Item>
          )}
        />
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <Text strong>性能指标</Text>
        </div>
        <MetricsBar metrics={metrics} />
      </section>
    </div>
  );
}
