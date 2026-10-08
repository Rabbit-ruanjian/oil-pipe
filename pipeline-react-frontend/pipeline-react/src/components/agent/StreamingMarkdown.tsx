import { useMemo } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import styles from './StreamingMarkdown.module.css';

interface StreamingMarkdownProps {
  content: string;
  streaming: boolean;
}

/**
 * Detect unclosed code fences (``` count is odd) and temporarily close them
 * so ReactMarkdown doesn't render broken output during streaming.
 */
function fixUnclosedFences(text: string): string {
  const fenceCount = (text.match(/^\s*```/gm) || []).length;
  if (fenceCount % 2 !== 0) {
    return text + '\n```';
  }
  return text;
}

/**
 * Split markdown into display blocks by blank lines, but never split inside
 * fenced code blocks so streaming code content stays structurally valid.
 */
function splitBlocksPreservingFences(text: string): string[] {
  if (!text) return [''];

  const lines = text.split('\n');
  const blocks: string[] = [];
  const current: string[] = [];
  let inFence = false;

  for (const line of lines) {
    const isFenceLine = /^\s*```/.test(line);
    const isBlankLine = line.trim() === '';

    if (!inFence && isBlankLine) {
      if (current.length > 0) {
        blocks.push(current.join('\n'));
        current.length = 0;
      }
      continue;
    }

    current.push(line);

    if (isFenceLine) {
      inFence = !inFence;
    }
  }

  if (current.length > 0 || blocks.length === 0) {
    blocks.push(current.join('\n'));
  }

  return blocks;
}

/**
 * Streaming-optimized Markdown renderer.
 *
 * Splits content into blocks (by double newline) and only re-renders the
 * last (active) block on each update. Completed blocks are memoized.
 */
export default function StreamingMarkdown({ content, streaming }: StreamingMarkdownProps) {
  const blocks = useMemo(() => splitBlocksPreservingFences(content || ''), [content]);
  const completedBlocks = blocks.slice(0, -1);
  const activeBlock = blocks[blocks.length - 1] || '';

  // Memoize completed blocks.
  const memoizedCompleted = useMemo(
    () =>
      completedBlocks.map((block, i) => (
        <div key={`block-${i}`} className={styles.block}>
          <MarkdownRenderer content={block} />
        </div>
      )),
    [completedBlocks],
  );

  // Streaming阶段临时修复未闭合代码栅栏，完成后恢复原文渲染。
  const fixedActiveBlock = streaming ? fixUnclosedFences(activeBlock) : activeBlock;

  return (
    <div className={styles.streamingContainer}>
      {memoizedCompleted}
      <div className={styles.activeBlock} data-active-block>
        <MarkdownRenderer content={fixedActiveBlock} />
      </div>
    </div>
  );
}
