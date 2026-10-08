import { Circle, PanelRightOpen, Sparkles, Wifi, WifiOff } from 'lucide-react';
import type { ChatMode } from '../types';
import { MODE_OPTIONS } from '../utils/chatUi';

interface ChatTopbarProps {
  title: string;
  mode: ChatMode;
  connected: boolean;
  streaming: boolean;
  status: string;
  compact?: boolean;
  contextOpen: boolean;
  onToggleSidebar: () => void;
  onToggleContext: () => void;
  onModeChange: (mode: ChatMode) => void;
}

export function ChatTopbar({
  title,
  mode,
  connected,
  streaming,
  status,
  compact = false,
  contextOpen,
  onToggleSidebar: _onToggleSidebar,
  onToggleContext,
  onModeChange,
}: ChatTopbarProps) {
  const isError = status === 'error';
  const isLiveStream = connected || streaming;
  const indicatorText = isError ? '连接异常' : isLiveStream ? '实时连接中' : '服务就绪';
  const indicatorTone = isError ? 'text-amber-500' : isLiveStream ? 'text-emerald-500' : 'text-sky-500';
  const activeMode = MODE_OPTIONS.find((option) => option.value === mode);

  return (
    <header className={['border-b border-neutral-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.82)_0%,rgba(255,255,255,0.64)_100%)] px-5 backdrop-blur md:px-6', compact ? 'py-3' : 'py-4'].join(' ')}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate text-lg font-semibold tracking-[-0.02em] text-neutral-950">{title}</div>
            {activeMode ? (
              <span className="rounded-full border border-sky-200/80 bg-sky-50/80 px-2.5 py-1 text-[11px] font-medium text-sky-700">
                {activeMode.label}
              </span>
            ) : null}
          </div>
          <div className={['flex flex-wrap items-center gap-2 text-xs text-neutral-500', compact ? 'mt-1.5' : 'mt-2'].join(' ')}>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/85 px-2.5 py-1 ring-1 ring-black/5">
              <Sparkles className="h-3.5 w-3.5 text-sky-500" />
              <span>智能分析助手</span>
            </div>
            {!compact && activeMode?.description ? (
              <span className="line-clamp-1">{activeMode.description}</span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className={['hidden items-center gap-2 rounded-full border border-white/70 bg-white/80 shadow-[0_10px_24px_rgba(15,23,42,0.05)] sm:flex', compact ? 'p-0.5' : 'p-1'].join(' ')}>
            <label className="relative block">
              <span className="sr-only">选择模式</span>
              <select
                value={mode}
                onChange={(event) => onModeChange(event.target.value as ChatMode)}
                className="h-10 appearance-none rounded-full border border-neutral-200 bg-white pl-4 pr-10 text-sm text-neutral-700 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-500/10"
              >
                {MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-center gap-2 rounded-full bg-neutral-50 px-3 py-2 text-xs text-neutral-600 ring-1 ring-black/5">
              {isError ? (
                <WifiOff className="h-3.5 w-3.5 text-amber-500" />
              ) : (
                <Wifi className={['h-3.5 w-3.5', indicatorTone].join(' ')} />
              )}
              <Circle className={['h-2.5 w-2.5 fill-current', indicatorTone].join(' ')} />
              {indicatorText}
            </div>
          </div>

          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-white/80 text-neutral-500 shadow-[0_10px_24px_rgba(15,23,42,0.05)] transition hover:bg-white hover:text-neutral-900"
            onClick={onToggleContext}
            aria-label="切换上下文面板"
          >
            <PanelRightOpen className={['h-5 w-5 transition-transform', contextOpen ? 'rotate-180' : ''].join(' ')} />
          </button>
        </div>
      </div>
    </header>
  );
}
