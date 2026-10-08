import { Circle, WifiOff } from 'lucide-react';

interface ChatTopbarProps {
  title: string;
  connected: boolean;
  streaming: boolean;
  status: string;
}

export function ChatTopbar({ title, connected, streaming, status }: ChatTopbarProps) {
  const isError = status === 'error';
  const isRunning = connected || streaming || status === 'planning' || status === 'executing';
  const indicatorText = isError ? '连接异常' : isRunning ? '实时分析中' : '服务就绪';

  return (
    <header className="border-b border-[#e2e9f2] bg-white px-6 py-3.5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-bold tracking-[0.18em] text-[#0891b2]">DIGITAL TWIN · PIPELINE OPS</div>
          <h1 className="mt-0.5 truncate text-[15px] font-bold text-[#132542]">智能分析助手 · {title}</h1>
        </div>
        <div className={['inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold', isError ? 'bg-rose-50 text-rose-600' : 'bg-[#ecfdf5] text-[#059669]'].join(' ')}>
          {isError ? <WifiOff className="h-3 w-3" /> : <Circle className="h-1.5 w-1.5 fill-current" />}
          {indicatorText}
        </div>
      </div>
    </header>
  );
}
