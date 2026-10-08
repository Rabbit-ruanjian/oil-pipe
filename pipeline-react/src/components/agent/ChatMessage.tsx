import React from 'react';
import type { ToolExecutionEvent } from '../../types/agent';
import StreamingMarkdown from './StreamingMarkdown';
import ThinkingIndicator from './ThinkingIndicator';
import ToolCallCard from './ToolCallCard';
import styles from './ChatMessage.module.css';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  tools?: ToolExecutionEvent[];
}

function ChatMessage({ role, content, streaming, tools }: ChatMessageProps) {
  if (role === 'user') {
    return (
      <div className={`${styles.messageRow} ${styles.messageRowUser}`}>
        <div className={styles.userMsg}>{content}</div>
      </div>
    );
  }

  // Assistant message
  const isStreaming = Boolean(streaming);
  const hasTools = Boolean(tools?.length);
  const showThinking = isStreaming && !content && !hasTools;
  const showCursor = isStreaming && Boolean(content);
  const assistantClassName = showCursor
    ? `${styles.assistantMsg} ${styles.streaming}`
    : styles.assistantMsg;

  return (
    <div className={`${styles.messageRow} ${styles.messageRowAssistant}`}>
      <div className={styles.assistantAvatar}>智</div>
      <div className={styles.assistantBody}>
        <div className={assistantClassName}>
          {hasTools && <ToolCallCard tools={tools!} />}
          <ThinkingIndicator visible={showThinking} />
          {content ? <StreamingMarkdown content={content} streaming={isStreaming} /> : null}
        </div>
      </div>
    </div>
  );
}

function areEqual(prev: ChatMessageProps, next: ChatMessageProps) {
  if (prev.role !== next.role) return false;
  if (prev.streaming || next.streaming) return false;
  return prev.content === next.content;
}

export default React.memo(ChatMessage, areEqual);
