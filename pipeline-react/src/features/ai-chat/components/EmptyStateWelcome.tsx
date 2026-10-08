import { Activity, Gauge, GitCompareArrows, Route, Settings2 } from 'lucide-react';

interface EmptyStateWelcomeProps {
  prompts: string[];
  onPromptSelect: (prompt: string) => void;
}

const SUGGESTIONS = [
  { title: '能耗瓶颈诊断', description: '分析当前工况瓶颈并给出优化建议', icon: Gauge, tone: 'bg-[#fff7ed] text-[#d97706]' },
  { title: '泵站方案对比', description: '对比成本、安全性与节能效果', icon: GitCompareArrows, tone: 'bg-[#ecfeff] text-[#0891b2]' },
  { title: '节能调度建议', description: '生成可执行的运行调度方案', icon: Route, tone: 'bg-[#ecfdf5] text-[#059669]' },
  { title: '末站压力异常', description: '定位下降原因并给出处置建议', icon: Activity, tone: 'bg-[#f5f3ff] text-[#7c3aed]' },
];

export function EmptyStateWelcome({ prompts, onPromptSelect }: EmptyStateWelcomeProps) {
  return (
    <div className="mx-auto w-full max-w-[680px] text-center">
      <div className="mx-auto flex h-[76px] w-[76px] items-center justify-center rounded-[20px] bg-[linear-gradient(135deg,#ecfeff,#f5f3ff)]">
        <Settings2 className="h-11 w-11 text-[#0891b2]" strokeWidth={1.35} />
      </div>
      <h2 className="mt-4 text-[22px] font-extrabold tracking-[-0.02em] text-[#132542]">
        从一个问题开始，逐步拆解业务分析
      </h2>
      <p className="mx-auto mt-2 max-w-[620px] text-[12.5px] leading-6 text-[#7188a8]">
        直接描述业务场景、异常现象或优化目标。助手会结合项目数据、知识库、水力计算与泵站优化能力，输出可执行结论。
      </p>

      <div className="mt-5 grid gap-2.5 text-left sm:grid-cols-2">
        {prompts.slice(0, 4).map((prompt, index) => {
          const item = SUGGESTIONS[index] ?? SUGGESTIONS[0];
          const Icon = item.icon;
          return (
            <button
              key={prompt}
              type="button"
              onClick={() => onPromptSelect(prompt)}
              className="group flex items-center gap-3 rounded-xl border border-[#e2e9f2] bg-white px-3.5 py-3 text-left shadow-[0_3px_12px_rgba(19,37,66,.025)] transition hover:-translate-y-0.5 hover:border-[#67e8f9] hover:shadow-[0_6px_18px_rgba(6,182,212,.1)]"
            >
              <span className={['flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]', item.tone].join(' ')}>
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-bold text-[#132542]">{item.title}</span>
                <span className="mt-0.5 block text-[10.5px] leading-4 text-[#7188a8]">{item.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
