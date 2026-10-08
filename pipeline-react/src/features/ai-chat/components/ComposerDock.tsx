import { SendHorizontal, Square } from 'lucide-react';
import type { ChatMode } from '../types';
import { MODE_OPTIONS } from '../utils/chatUi';

interface ComposerDockProps {
  draft: string;
  mode: ChatMode;
  busy: boolean;
  compact?: boolean;
  prompts?: string[];
  onDraftChange: (value: string) => void;
  onModeChange: (mode: ChatMode) => void;
  onSubmit: () => void;
  onStop: () => void;
}

const QUICK_LABELS = ['比较两套泵站方案', '生成节能调度建议', '诊断末站压力异常', '流量敏感性分析'];

export function ComposerDock({
  draft,
  mode,
  busy,
  prompts = [],
  onDraftChange,
  onModeChange,
  onSubmit,
  onStop,
}: ComposerDockProps) {
  return (
    <div className="border-t border-[#e2e9f2] bg-white px-5 py-3 md:px-7">
      <div className="mx-auto w-full max-w-[820px]">
        <div className="mb-2.5 flex gap-2 overflow-x-auto pb-0.5">
          {prompts.slice(0, 4).map((prompt, index) => (
            <button
              key={prompt}
              type="button"
              disabled={busy}
              onClick={() => onDraftChange(prompt)}
              className="shrink-0 rounded-full border border-[#e2e9f2] bg-white px-3 py-1.5 text-[11px] text-[#3d557a] transition hover:border-[#67e8f9] hover:bg-[#f0f9ff] hover:text-[#0891b2] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {QUICK_LABELS[index] ?? `建议 ${index + 1}`}
            </button>
          ))}
        </div>

        <div className="flex items-end gap-2.5">
          <div className="flex min-w-0 flex-1 items-end rounded-xl border-[1.5px] border-[#d8e1ec] bg-white shadow-[0_4px_16px_rgba(19,37,66,.04)] transition focus-within:border-[#06b6d4] focus-within:ring-4 focus-within:ring-cyan-500/10">
            <textarea
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder="描述你的业务场景、诊断问题或优化目标…"
              rows={1}
              className="max-h-32 min-h-[46px] min-w-0 flex-1 resize-none bg-transparent px-4 py-3 text-[13px] leading-5 text-[#132542] outline-none placeholder:text-[#94a3b8]"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  onSubmit();
                }
              }}
            />
            <label className="mb-2 mr-2 sm:hidden">
              <span className="sr-only">选择分析模式</span>
              <select
                value={mode}
                onChange={(event) => onModeChange(event.target.value as ChatMode)}
                className="h-8 rounded-lg bg-[#f8fbff] px-2 text-[11px] text-[#3d557a] outline-none"
              >
                {MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>

          {busy ? (
            <button
              type="button"
              onClick={onStop}
              className="inline-flex h-[46px] shrink-0 items-center gap-2 rounded-xl border border-[#f59e0b] bg-[#fff7ed] px-4 text-sm font-semibold text-[#d97706] transition hover:bg-[#ffedd5]"
            >
              <Square className="h-4 w-4 fill-current" />
              <span className="hidden sm:inline">停止</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onSubmit}
              disabled={!draft.trim()}
              className="inline-flex h-[46px] shrink-0 items-center gap-2 rounded-xl bg-[linear-gradient(135deg,#d97706,#f59e0b)] px-5 text-sm font-bold text-white shadow-[0_8px_18px_rgba(217,119,6,.2)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:bg-[#d8e1ec] disabled:shadow-none"
            >
              <SendHorizontal className="h-4 w-4" />
              <span className="hidden sm:inline">发送</span>
            </button>
          )}
        </div>
        <div className="mt-1.5 text-center text-[10px] text-[#94a3b8]">Enter 发送 · Shift + Enter 换行</div>
      </div>
    </div>
  );
}
