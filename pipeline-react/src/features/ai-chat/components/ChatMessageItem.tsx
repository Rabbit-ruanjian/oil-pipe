import { Copy, RefreshCcw, RotateCcw, Sparkles } from 'lucide-react';
import MarkdownRenderer from '../../../components/agent/MarkdownRenderer';
import type { UIMessage } from '../types';
import { ToolCallAccordion } from './ToolCallAccordion';

interface ChatMessageItemProps {
  message: UIMessage;
  streamingLabel?: string | null;
  onRetry?: (message: UIMessage) => void;
  onReusePrompt?: (prompt: string) => void;
}

const markdownClassName = [
  'text-[13px] leading-6 text-[#132542]',
  '[&_p]:mb-4 [&_p]:leading-7',
  '[&_h1]:mb-4 [&_h1]:mt-6 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-[-0.03em]',
  '[&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-[-0.02em]',
  '[&_h3]:mb-3 [&_h3]:mt-5 [&_h3]:text-lg [&_h3]:font-semibold',
  '[&_ul]:mb-4 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5',
  '[&_ol]:mb-4 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5',
  '[&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-neutral-300 [&_blockquote]:pl-4 [&_blockquote]:text-neutral-600',
  '[&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_table]:overflow-hidden [&_table]:rounded-2xl',
  '[&_th]:border-b [&_th]:border-neutral-200 [&_th]:bg-neutral-100 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-[0.12em] [&_th]:text-neutral-500',
  '[&_td]:border-b [&_td]:border-neutral-100 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top',
  '[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-2xl [&_pre]:bg-neutral-100 [&_pre]:p-4',
  '[&_code]:rounded-md [&_code]:bg-neutral-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.92em]',
].join(' ');

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

export function ChatMessageItem({
  message,
  streamingLabel,
  onRetry,
  onReusePrompt,
}: ChatMessageItemProps) {
  if (message.role === 'user') {
    return (
      <article className="group ml-auto w-full max-w-[760px]">
        <div className="mb-1.5 flex justify-end text-[11px] text-[#7188a8]">你</div>
        <div className="ml-auto h-fit w-fit max-w-[82%] rounded-xl rounded-tr-[4px] border border-[#e2e9f2] bg-white px-4 py-3 text-[13px] leading-6 text-[#132542] shadow-[0_3px_12px_rgba(19,37,66,.03)]">
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>
        <div className="mt-1 flex justify-end opacity-0 transition group-hover:opacity-100">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-neutral-500 transition hover:bg-white hover:text-neutral-900"
            onClick={() => void copyText(message.content)}
          >
            <Copy className="h-3.5 w-3.5" />
            复制
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className="group w-full max-w-[760px]">
      <div className="mb-1.5 flex items-center gap-2 text-[11px] text-[#0891b2]">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[linear-gradient(135deg,#7c3aed,#06b6d4)] text-[9px] font-bold text-white">智</span>
        <span>智能体{message.status === 'streaming' ? ' · 分析中…' : ''}</span>
      </div>
      <div className="rounded-xl rounded-tl-[4px] border border-[#e2e9f2] bg-white px-4 py-3.5 shadow-[0_4px_16px_rgba(19,37,66,.05)]">
        <div className={markdownClassName}>
          {message.content ? <MarkdownRenderer content={message.content} /> : null}
        </div>

        {message.status === 'streaming' && streamingLabel ? (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#ecfeff] px-3 py-1.5 text-xs text-[#0891b2]">
            <Sparkles className="h-3.5 w-3.5 text-sky-500" />
            {streamingLabel}
            <span className="animate-pulse text-neutral-400">▍</span>
          </div>
        ) : null}

        {message.toolCalls && message.toolCalls.length > 0 ? (
          <div className="mt-4">
            <ToolCallAccordion tools={message.toolCalls} />
          </div>
        ) : null}

        {message.error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <div className="font-medium">{message.error.title}</div>
            <div className="mt-1 text-rose-600">{message.error.description}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {onRetry ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100"
                  onClick={() => onRetry(message)}
                >
                  <RefreshCcw className="h-3.5 w-3.5" />
                  {message.error.actionLabel || '重试'}
                </button>
              ) : null}
              {message.requestText && onReusePrompt ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100"
                  onClick={() => onReusePrompt(message.requestText!)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  放回输入框
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="mt-2 flex flex-wrap gap-2 opacity-0 transition group-hover:opacity-100">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900"
            onClick={() => void copyText(message.content)}
          >
            <Copy className="h-3.5 w-3.5" />
            复制
          </button>
          {message.requestText && onReusePrompt ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900"
              onClick={() => onReusePrompt(message.requestText!)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              继续追问
            </button>
          ) : null}
          {message.requestText && onRetry ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900"
              onClick={() => onRetry(message)}
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              重试
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
