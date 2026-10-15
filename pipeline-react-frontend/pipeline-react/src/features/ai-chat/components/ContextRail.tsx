import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { PlanStep, TraceLog, TraceMetrics, TraceStatus, ToolExecutionEvent } from '../../../types/agent';
import { describeToolOutput, getToolDisplayStatus, getToolTitle } from '../utils/toolOutput';

interface ContextRailProps {
  plan: PlanStep[];
  logs: TraceLog[];
  metrics: TraceMetrics;
  activeTools: ToolExecutionEvent[];
  currentStep: number;
  status: TraceStatus;
}

const STATUS_LABELS: Record<TraceStatus, string> = {
  idle: '待机',
  planning: '规划中',
  executing: '执行中',
  waiting_hitl: '待确认',
  completed: '已完成',
  stopped: '已停止',
  error: '异常',
};

function FoldSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mb-2.5 rounded-[9px] border border-[#e2e9f2] bg-white px-3 py-2.5">
      <button type="button" className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setOpen((value) => !value)}>
        <span className="text-[11.5px] font-semibold text-[#132542]">{title}</span>
        <ChevronDown className={['h-3.5 w-3.5 text-[#7188a8] transition-transform', open ? 'rotate-180' : ''].join(' ')} />
      </button>
      {open ? <div className="mt-2 text-[10.5px] leading-5 text-[#7188a8]">{children}</div> : null}
    </section>
  );
}

function StepItem({ step }: { step: PlanStep }) {
  const stateClass = step.status === 'completed'
    ? 'border-[#059669] bg-[#059669]'
    : step.status === 'in_progress'
      ? 'border-[#d97706] bg-[#d97706] shadow-[0_0_0_4px_rgba(245,158,11,.18)]'
      : step.status === 'failed'
        ? 'border-rose-500 bg-rose-500'
        : 'border-[#06b6d4] bg-white';
  const stateText = step.status === 'completed' ? '✓' : step.status === 'in_progress' ? '运行中' : step.status === 'failed' ? '失败' : '待执行';

  return (
    <div className="relative mb-3.5 pl-5 last:mb-0">
      <span className={['absolute left-0 top-1 h-2.5 w-2.5 rounded-full border-2', stateClass].join(' ')} />
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11.5px] font-semibold leading-5 text-[#132542]">{step.description}</div>
        <span className="shrink-0 pt-0.5 font-mono text-[9px] text-[#94a3b8]">{stateText}</span>
      </div>
      <div className="mt-0.5 text-[10px] leading-4 text-[#7188a8]">
        {step.agent ? `执行单元：${step.agent}` : `步骤 ${step.step_number}`}
        {step.duration_ms ? ` · ${step.duration_ms} ms` : ''}
      </div>
    </div>
  );
}

export function ContextRail({ plan, logs, metrics, activeTools, currentStep, status }: ContextRailProps) {
  const completedSteps = plan.filter((step) => step.status === 'completed').length;
  const displayedStep = currentStep || completedSteps;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex items-center justify-between border-b border-[#e2e9f2] px-4 py-[15px]">
        <h2 className="text-[13px] font-bold text-[#132542]">执行日志 · 实时状态</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ecfdf5] px-2.5 py-1 text-[10px] font-bold text-[#059669]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#059669]" />
          LIVE
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
        <div className="mb-4 grid grid-cols-3 gap-2">
          <div className="rounded-[9px] bg-[#f8fbff] px-2 py-2.5 text-center">
            <div className="font-mono text-[18px] font-bold text-[#132542]">{plan.length || displayedStep || '—'}</div>
            <div className="mt-0.5 text-[9px] text-[#7188a8]">执行步骤</div>
          </div>
          <div className="rounded-[9px] bg-[#f8fbff] px-2 py-2.5 text-center">
            <div className="font-mono text-[18px] font-bold text-[#132542]">{activeTools.length || metrics.tool_calls || '—'}</div>
            <div className="mt-0.5 text-[9px] text-[#7188a8]">工具调用</div>
          </div>
          <div className="rounded-[9px] bg-[#f8fbff] px-2 py-2.5 text-center">
            <div className={['text-[14px] font-bold', status === 'error' ? 'text-rose-500' : status === 'completed' ? 'text-[#059669]' : 'text-[#d97706]'].join(' ')}>
              {STATUS_LABELS[status]}
            </div>
            <div className="mt-1 text-[9px] text-[#7188a8]">状态</div>
          </div>
        </div>

        <div className="relative mb-4 pl-0.5 before:absolute before:bottom-1 before:left-[5px] before:top-1 before:w-px before:bg-[#e2e9f2]">
          {plan.length > 0 ? (
            plan.map((step) => <StepItem key={step.step_id ?? `${step.step_number}-${step.description}`} step={step} />)
          ) : (
            <div className="relative pl-5">
              <span className="absolute left-0 top-1 h-2.5 w-2.5 rounded-full border-2 border-[#06b6d4] bg-white" />
              <div className="text-[11.5px] font-semibold text-[#94a3b8]">等待指令…</div>
              <div className="mt-1 text-[10px] leading-4 text-[#7188a8]">输入问题或点击建议，助手将开始分析</div>
            </div>
          )}
        </div>

        <FoldSection title="工具调用明细" defaultOpen>
          {activeTools.length === 0 ? (
            <div>尚未触发工具调用</div>
          ) : activeTools.map((tool, index) => {
            const displayStatus = getToolDisplayStatus(tool);
            const presentation = describeToolOutput(tool);
            return (
              <div key={tool.call_id ?? `${tool.tool}-${index}`} className="mb-2 last:mb-0">
                <div className="flex items-center justify-between gap-2 font-medium text-[#3d557a]">
                  <span>· {getToolTitle(tool.tool)}</span>
                  <span className={displayStatus === 'failed' ? 'text-rose-500' : displayStatus === 'running' ? 'text-[#d97706]' : 'text-[#059669]'}>
                    {displayStatus === 'running' ? '执行中' : displayStatus === 'failed' ? '失败' : '完成'}
                  </span>
                </div>
                <div className="pl-2 text-[#94a3b8]">{presentation.summary}</div>
              </div>
            );
          })}
        </FoldSection>

        <FoldSection title="实时日志">
          {logs.length === 0 ? <div>暂无日志</div> : logs.slice(-8).map((log, index) => (
            <div key={`${log.timestamp}-${index}`} className="mb-1.5 last:mb-0">
              <span className="font-mono text-[9.5px] text-[#94a3b8]">
                [{new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}]
              </span>{' '}
              <span>{log.text}</span>
            </div>
          ))}
        </FoldSection>

        <FoldSection title="性能指标">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <span>总耗时</span><strong className="text-right text-[#3d557a]">{metrics.total_duration_ms} ms</strong>
            <span>模型调用</span><strong className="text-right text-[#3d557a]">{metrics.llm_calls}</strong>
            <span>工具调用</span><strong className="text-right text-[#3d557a]">{metrics.tool_calls}</strong>
            <span>令牌数</span><strong className="text-right text-[#3d557a]">{metrics.total_tokens}</strong>
          </div>
        </FoldSection>
      </div>
    </div>
  );
}
