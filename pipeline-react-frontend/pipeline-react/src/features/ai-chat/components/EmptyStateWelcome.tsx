import { ArrowRight, Sparkles } from 'lucide-react';

interface EmptyStateWelcomeProps {
  prompts: string[];
  onPromptSelect: (prompt: string) => void;
}

export function EmptyStateWelcome({ prompts, onPromptSelect }: EmptyStateWelcomeProps) {
  return (
    <div className="flex h-full min-h-0 flex-col justify-start px-2 py-2">
      <div className="grid w-full items-start gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)] 2xl:gap-6">
        <div className="max-w-[620px]">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-200/80 bg-sky-50/80 px-3 py-1.5 text-xs font-medium text-sky-700">
            <Sparkles className="h-3.5 w-3.5" />
            智能分析工作台
          </div>

          <div className="mt-3">
            <h1 className="max-w-[560px] text-[1.9rem] font-semibold tracking-[-0.05em] text-neutral-950 md:text-[2.35rem] 2xl:text-[2.6rem]">
              从一个问题开始，逐步拆解复杂业务分析
            </h1>
            <p className="mt-3 max-w-[560px] text-sm leading-6 text-neutral-500">
              你可以直接输入业务场景、异常现象、调度目标或优化约束。助手会结合知识库、计算服务与数据接口，组织出更适合执行的分析过程。
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2.5 text-sm text-neutral-500">
            <div className="rounded-full bg-white px-3 py-2 shadow-[0_10px_30px_rgba(15,23,42,0.06)] ring-1 ring-black/5">
              数据查询
            </div>
            <div className="rounded-full bg-white px-3 py-2 shadow-[0_10px_30px_rgba(15,23,42,0.06)] ring-1 ring-black/5">
              故障诊断
            </div>
            <div className="rounded-full bg-white px-3 py-2 shadow-[0_10px_30px_rgba(15,23,42,0.06)] ring-1 ring-black/5">
              优化建议
            </div>
          </div>
        </div>

        <div className="rounded-[28px] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.92)_0%,rgba(248,250,252,0.96)_100%)] p-4 shadow-[0_24px_54px_rgba(15,23,42,0.08)] ring-1 ring-black/5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-neutral-900">试试这些方向</div>
              <div className="mt-1 text-xs text-neutral-500">选择一个示例，快速开始当前会话。</div>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#e0f2fe_0%,#dbeafe_55%,#e2e8f0_100%)] text-slate-700 shadow-[0_12px_30px_rgba(148,163,184,0.16)] ring-1 ring-white/90">
              <Sparkles className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {prompts.map((prompt, index) => (
              <button
                key={prompt}
                type="button"
                onClick={() => onPromptSelect(prompt)}
                className="group flex h-full w-full items-start justify-between gap-3 rounded-[22px] border border-neutral-200/80 bg-white px-4 py-3 text-left shadow-[0_10px_30px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-[0_16px_40px_rgba(15,23,42,0.08)]"
              >
                <div className="min-w-0">
                  <div className="mb-1.5 inline-flex rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
                    方向 {index + 1}
                  </div>
                  <div className="text-sm font-medium leading-5 text-neutral-800">{prompt}</div>
                </div>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-neutral-400 transition group-hover:text-neutral-900" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
