import { useMemo, useState } from 'react';
import { Button, Typography } from 'antd';
import { DownOutlined, RightOutlined } from '@ant-design/icons';
import styles from './ThinkingPanel.module.css';

const { Text } = Typography;

interface ThinkingPanelProps {
  thinking: string;
  streaming?: boolean;
}

function buildPreview(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > 80 ? `${normalized.slice(0, 80)}...` : normalized;
}

export default function ThinkingPanel({ thinking, streaming = false }: ThinkingPanelProps) {
  const [collapsed, setCollapsed] = useState(true);
  const hasThinking = Boolean(thinking.trim());
  const preview = useMemo(() => buildPreview(thinking), [thinking]);

  if (!hasThinking && !streaming) {
    return null;
  }

  return (
    <div className={styles.panel}>
      <Button
        type="text"
        size="small"
        className={styles.toggle}
        icon={collapsed ? <RightOutlined /> : <DownOutlined />}
        onClick={() => setCollapsed((prev) => !prev)}
      >
        {collapsed ? '展开思考链' : '收起思考链'}
      </Button>

      {collapsed ? (
        <Text type="secondary" className={styles.preview}>
          {preview || '正在生成思考链...'}
        </Text>
      ) : (
        <pre className={styles.content}>{thinking || '正在生成思考链...'}</pre>
      )}
    </div>
  );
}
