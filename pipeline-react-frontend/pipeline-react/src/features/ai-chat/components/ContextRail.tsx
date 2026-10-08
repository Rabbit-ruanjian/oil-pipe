import { Activity, ChevronDown, Gauge, ListTodo, Wrench } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { PlanStep, TraceLog, TraceMetrics, ToolExecutionEvent } from '../../../types/agent';
import { describeToolOutput, getToolDisplayStatus, getToolTitle } from '../utils/toolOutput';

interface ContextRailProps {
  plan: PlanStep[];
  logs: TraceLog[];
  metrics: TraceMetrics;
  activeTools: ToolExecutionEvent[];
  currentStep: number;
}

const LOG_TYPE_LABELS: Record<string, string> = {
  trace_init: '开始分析',
  tool_search: '工具选择',
  tool_use_start: '调用工具',
  tool_use_done: '工具完成',
  tool_start: '调用工具',
  tool_end: '工具完成',
  plan_created: '已生成计划',
  plan_updated: '更新计划',
  plan_step_start: '开始步骤',
  plan_step_done: '步骤完成',
  step_started: '开始步骤',
  step_completed: '步骤完成',
  step_failed: '步骤失败',
  hitl_waiting: '等待确认',
  hitl_request: '等待确认',
  hitl_resumed: '继续执行',
  thinking_done: '思考完成',
  final_response: '生成完成',
  done: '执行完成',
  error: '执行异常',
};

function getLogTypeLabel(type: string) {
  return LOG_TYPE_LABELS[type] ?? type;
}

function getLogTone(type: string) {
  if (type === 'error' || type === 'step_failed') {
    return 'bg-rose-100 text-rose-600';
  }
  if (type === 'tool_use_start' || type === 'tool_start') {
    return 'bg-sky-100 text-sky-600';
  }
  if (type === 'tool_use_done' || type === 'tool_end' || type === 'done' || type === 'final_response') {
    return 'bg-emerald-100 text-emerald-600';
  }
  return 'bg-neutral-200 text-neutral-500';
}

function Section({
  title,
  icon: Icon,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: typeof Activity;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="rounded-3xl bg-white/80 p-4 ring-1 ring-black/5">
      <button type="button" className="flex w-full items-center justify-between gap-3" onClick={() => setOpen((prev) => !prev)}>
        <div className="flex items-center gap-2 text-sm font-medium text-neutral-800">
          <Icon className="h-4 w-4 text-neutral-500" />
          {title}
        </div>
        <ChevronDown className={['h-4 w-4 text-neutral-400 transition-transform', open ? 'rotate-180' : ''].join(' ')} />
      </button>
      {open ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}

export function ContextRail({ plan, logs, metrics, activeTools, currentStep }: ContextRailProps) {
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto px-4 py-4">
      <div className="rounded-3xl bg-white/85 p-4 ring-1 ring-black/5">
        <div className="text-xs font-medium uppercase tracking-[0.14em] text-neutral-400">
          {'\u5f53\u524d\u8fd0\u884c'}
        </div>
        <div className="mt-2 text-sm text-neutral-600">
          {'\u6b65\u9aa4'} {currentStep || 0}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-neutral-50 p-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-neutral-400">{'\u5de5\u5177'}</div>
            <div className="mt-1 text-lg font-semibold text-neutral-900">{activeTools.length}</div>
          </div>
          <div className="rounded-2xl bg-neutral-50 p-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-neutral-400">{'\u65e5\u5fd7'}</div>
            <div className="mt-1 text-lg font-semibold text-neutral-900">{logs.length}</div>
          </div>
        </div>
      </div>

      <Section title={'\u6267\u884c\u8ba1\u5212'} icon={ListTodo}>
        <div className="space-y-2">
          {plan.length === 0 ? <div className="text-sm text-neutral-500">{'\u5c1a\u672a\u751f\u6210\u6267\u884c\u8ba1\u5212'}</div> : null}
          {plan.map((step) => (
            <div key={`${step.step_number}-${step.description}`} className="rounded-2xl bg-neutral-50 px-3 py-3">
              <div className="flex items-center justify-between gap-2 text-sm font-medium text-neutral-800">
                <span>
                  {'\u6b65\u9aa4'} {step.step_number}
                </span>
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-neutral-500 ring-1 ring-black/5">
                  {step.status === 'in_progress'
                    ? '\u8fdb\u884c\u4e2d'
                    : step.status === 'completed'
                      ? '\u5df2\u5b8c\u6210'
                      : step.status === 'failed'
                        ? '\u5931\u8d25'
                        : '\u5f85\u6267\u884c'}
                </span>
              </div>
              <div className="mt-1 text-sm leading-6 text-neutral-600">{step.description}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title={'\u5de5\u5177\u8c03\u7528'} icon={Wrench}>
        <div className="space-y-2">
          {activeTools.length === 0 ? <div className="text-sm text-neutral-500">{'\u5f53\u524d\u56de\u590d\u672a\u89e6\u53d1\u5de5\u5177\u8c03\u7528'}</div> : null}
          {activeTools.map((tool, index) => {
            const displayStatus = getToolDisplayStatus(tool);
            const presentation = describeToolOutput(tool);

            return (
              <div key={tool.call_id ?? `${tool.tool}-${index}`} className="rounded-2xl bg-neutral-50 px-3 py-3">
                <div className="flex items-center justify-between gap-2 text-sm font-medium text-neutral-800">
                  <span>{getToolTitle(tool.tool)}</span>
                  <span
                    className={[
                      'text-xs',
                      displayStatus === 'failed'
                        ? 'text-amber-600'
                        : displayStatus === 'running'
                          ? 'text-sky-500'
                          : 'text-neutral-500',
                    ].join(' ')}
                  >
                    {displayStatus === 'running'
                      ? '\u6267\u884c\u4e2d'
                      : displayStatus === 'completed'
                        ? '\u5df2\u5b8c\u6210'
                        : '\u5931\u8d25'}
                  </span>
                </div>
                <div className="mt-2 text-xs leading-5 text-neutral-500">{presentation.summary}</div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title={'\u5b9e\u65f6\u65e5\u5fd7'} icon={Activity} defaultOpen={false}>
        <div className="space-y-2">
          {logs.length === 0 ? <div className="text-sm text-neutral-500">{'\u6682\u65e0\u65e5\u5fd7'}</div> : null}
          {logs.slice(-8).map((log, index) => (
            <div key={`${log.timestamp}-${index}`} className="rounded-2xl bg-neutral-50 px-3 py-3 text-xs leading-6 text-neutral-600">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-[11px] font-medium text-neutral-500">
                  <span className={['inline-block h-2 w-2 rounded-full', getLogTone(log.type)].join(' ')} />
                  {getLogTypeLabel(log.type)}
                </span>
                <span className="text-[11px] text-neutral-400">
                  {new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              {log.text}
            </div>
          ))}
        </div>
      </Section>

      <Section title={'\u6027\u80fd\u6307\u6807'} icon={Gauge} defaultOpen={false}>
        <div className="grid grid-cols-2 gap-2 text-sm text-neutral-600">
          <div className="rounded-2xl bg-neutral-50 p-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-neutral-400">{'\u603b\u8017\u65f6'}</div>
            <div className="mt-1 font-semibold text-neutral-900">{metrics.total_duration_ms} ms</div>
          </div>
          <div className="rounded-2xl bg-neutral-50 p-3">
            <div className="text-[11px] tracking-[0.12em] text-neutral-400">{'\u6a21\u578b\u8c03\u7528'}</div>
            <div className="mt-1 font-semibold text-neutral-900">{metrics.llm_calls}</div>
          </div>
          <div className="rounded-2xl bg-neutral-50 p-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-neutral-400">{'\u5de5\u5177\u8c03\u7528'}</div>
            <div className="mt-1 font-semibold text-neutral-900">{metrics.tool_calls}</div>
          </div>
          <div className="rounded-2xl bg-neutral-50 p-3">
            <div className="text-[11px] tracking-[0.12em] text-neutral-400">{'\u4ee4\u724c\u6570'}</div>
            <div className="mt-1 font-semibold text-neutral-900">{metrics.total_tokens}</div>
          </div>
        </div>
      </Section>
    </div>
  );
}
