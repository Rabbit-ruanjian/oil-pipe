import { ChevronDown, CircleCheckBig, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ToolExecutionEvent } from '../../../types/agent';
import { describeToolOutput, getToolDisplayStatus, getToolTitle } from '../utils/toolOutput';

interface ToolCallAccordionProps {
  tools: ToolExecutionEvent[];
}

export function ToolCallAccordion({ tools }: ToolCallAccordionProps) {
  const [open, setOpen] = useState(false);

  const summary = useMemo(() => {
    const running = tools.filter((tool) => getToolDisplayStatus(tool) === 'running').length;
    const failed = tools.filter((tool) => getToolDisplayStatus(tool) === 'failed').length;

    if (running > 0) {
      return `\u5df2\u8c03\u7528 ${tools.length} \u4e2a\u5de5\u5177\uff0c${running} \u4e2a\u4ecd\u5728\u6267\u884c`;
    }

    if (failed > 0) {
      return `\u5df2\u8c03\u7528 ${tools.length} \u4e2a\u5de5\u5177\uff0c\u5176\u4e2d ${failed} \u4e2a\u6267\u884c\u5931\u8d25`;
    }

    return `\u5df2\u8c03\u7528 ${tools.length} \u4e2a\u5de5\u5177`;
  }, [tools]);

  if (!tools.length) return null;

  return (
    <div className="rounded-2xl border border-neutral-200/80 bg-neutral-50/80">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((prev) => !prev)}
      >
        <div>
          <div className="text-sm font-medium text-neutral-800">{'\u67e5\u770b\u5206\u6790\u8fc7\u7a0b'}</div>
          <div className="mt-1 text-xs text-neutral-500">{summary}</div>
        </div>
        <ChevronDown className={['h-4 w-4 text-neutral-400 transition-transform', open ? 'rotate-180' : ''].join(' ')} />
      </button>

      {open ? (
        <div className="space-y-3 border-t border-neutral-200/80 px-4 py-4">
          {tools.map((tool, index) => {
            const displayStatus = getToolDisplayStatus(tool);
            const presentation = describeToolOutput(tool);
            const Icon =
              displayStatus === 'running'
                ? LoaderCircle
                : displayStatus === 'completed'
                  ? CircleCheckBig
                  : TriangleAlert;

            return (
              <div
                key={tool.call_id ?? `${tool.tool}-${index}`}
                className={[
                  'rounded-2xl bg-white px-4 py-3 ring-1',
                  displayStatus === 'failed' ? 'ring-amber-200/80' : 'ring-black/5',
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-neutral-800">
                    <Icon
                      className={[
                        'h-4 w-4',
                        displayStatus === 'running'
                          ? 'animate-spin text-sky-500'
                          : displayStatus === 'completed'
                            ? 'text-emerald-500'
                            : 'text-amber-500',
                      ].join(' ')}
                    />
                    {getToolTitle(tool.tool)}
                  </div>
                  <span
                    className={[
                      'rounded-full px-2.5 py-1 text-[11px] font-medium',
                      displayStatus === 'running'
                        ? 'bg-sky-50 text-sky-600'
                        : displayStatus === 'completed'
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-amber-50 text-amber-700',
                    ].join(' ')}
                  >
                    {displayStatus === 'running'
                      ? '\u6267\u884c\u4e2d'
                      : displayStatus === 'completed'
                        ? '\u5df2\u5b8c\u6210'
                        : '\u5931\u8d25'}
                  </span>
                </div>

                <div
                  className={[
                    'mt-3 rounded-2xl px-3 py-3 text-xs leading-6',
                    displayStatus === 'failed' ? 'bg-amber-50 text-amber-900' : 'bg-neutral-50 text-neutral-600',
                  ].join(' ')}
                >
                  <div className="font-medium">{presentation.summary}</div>
                  {presentation.detail && presentation.detail !== presentation.summary ? (
                    <div
                      className={[
                        'mt-1 text-[12px] leading-5',
                        displayStatus === 'failed' ? 'text-amber-700/90' : 'text-neutral-500',
                      ].join(' ')}
                    >
                      {presentation.detail}
                    </div>
                  ) : null}
                </div>

                {presentation.rawDetail ? (
                  <details
                    className={[
                      'mt-2 rounded-2xl px-3 py-2 text-xs',
                      displayStatus === 'failed'
                        ? 'bg-amber-50/60 text-amber-700'
                        : 'bg-neutral-50/80 text-neutral-500',
                    ].join(' ')}
                  >
                    <summary
                      className={[
                        'cursor-pointer list-none font-medium',
                        displayStatus === 'failed' ? 'text-amber-700' : 'text-neutral-600',
                      ].join(' ')}
                    >
                      {'\u67e5\u770b\u539f\u59cb\u8fd4\u56de'}
                    </summary>
                    <pre
                      className={[
                        'mt-2 overflow-x-auto whitespace-pre-wrap break-all leading-5',
                        displayStatus === 'failed' ? 'text-amber-700/90' : 'text-neutral-500',
                      ].join(' ')}
                    >
                      {presentation.rawDetail}
                    </pre>
                  </details>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
