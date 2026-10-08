import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { LoadingOutlined, CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import type { ToolExecutionEvent } from '../../types/agent';
import styles from './ToolCallCard.module.css';

interface ToolCallCardProps {
  tools: ToolExecutionEvent[];
}

const TOOL_LABELS: Record<string, string> = {
  'SQL_Database': '数据库查询',
  'Knowledge_Base': '知识库检索',
  'Hydraulic_Analysis': '水力计算',
};

function getToolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? toolName;
}

function ToolItem({ tool }: { tool: ToolExecutionEvent }) {
  const [expanded, setExpanded] = useState(false);

  const statusClass =
    tool.status === 'running'
      ? styles.running
      : tool.status === 'completed'
        ? styles.completed
        : styles.failed;

  const statusIcon =
    tool.status === 'running' ? (
      <LoadingOutlined spin />
    ) : tool.status === 'completed' ? (
      <CheckCircleFilled />
    ) : (
      <CloseCircleFilled />
    );

  return (
    <div className={`${styles.card} ${statusClass}`}>
      <div
        className={styles.cardHeader}
        onClick={() => setExpanded((prev) => !prev)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded((prev) => !prev); }}
      >
        <span className={styles.icon}>{statusIcon}</span>
        <span className={styles.toolName}>{getToolLabel(tool.tool)}</span>
        <span className={styles.expand}>{expanded ? '收起' : '详情'}</span>
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div
            className={styles.cardBody}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {tool.input && (
              <div className={styles.section}>
                <div className={styles.sectionLabel}>输入</div>
                <pre className={styles.pre}>{JSON.stringify(tool.input, null, 2)}</pre>
              </div>
            )}
            {tool.output && (
              <div className={styles.section}>
                <div className={styles.sectionLabel}>输出</div>
                <pre className={styles.pre}>{tool.output}</pre>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function ToolCallCard({ tools }: ToolCallCardProps) {
  if (!tools.length) return null;
  return (
    <div className={styles.container}>
      {tools.map((tool, i) => (
        <ToolItem key={tool.call_id ?? `${tool.tool}-${i}`} tool={tool} />
      ))}
    </div>
  );
}
