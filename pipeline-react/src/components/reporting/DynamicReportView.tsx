import { Empty, Tag } from 'antd';

import type { DynamicReportResponsePayload, DynamicReportSectionPayload } from '../../types/agent';

const REPORT_TITLE_LABELS: Record<string, string> = {
  total: '计算量',
  failed: '失败次数',
  avg_duration_ms: '平均计算耗时',
  success_rate: '成功率',
};

function getSectionKindLabel(kind: DynamicReportSectionPayload['kind']) {
  if (kind === 'metrics') return '指标';
  if (kind === 'table') return '表格';
  if (kind === 'markdown') return '正文';
  if (kind === 'callout') return '结论';
  return '要点';
}

function localizeReportTitle(title: string | undefined) {
  if (!title) return '';
  return REPORT_TITLE_LABELS[title] || title;
}

function renderSection(section: DynamicReportSectionPayload) {
  if (section.kind === 'metrics') {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {section.metrics.map((metric) => (
          <div key={`${section.id}-${metric.label}`} className="rounded-2xl border border-white/8 bg-white/5 px-4 py-4">
            <div className="text-sm text-slate-400">{metric.label}</div>
            <div className="mt-2 text-2xl font-semibold text-white">{metric.value}</div>
            {metric.note ? <div className="mt-2 text-xs leading-5 text-slate-400">{metric.note}</div> : null}
          </div>
        ))}
      </div>
    );
  }

  if (section.kind === 'table' && section.table) {
    return (
      <div className="overflow-x-auto rounded-2xl border border-white/8 bg-white/5">
        <table className="min-w-full divide-y divide-white/10 text-left text-sm">
          <thead>
            <tr className="text-slate-400">
              {section.table.columns.map((column) => (
                <th key={`${section.id}-${column}`} className="px-4 py-3 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/8">
            {section.table.rows.length ? (
              section.table.rows.map((row, rowIndex) => (
                <tr key={`${section.id}-row-${rowIndex}`} className="align-top text-slate-200">
                  {row.map((cell, cellIndex) => (
                    <td key={`${section.id}-${rowIndex}-${cellIndex}`} className="px-4 py-4 leading-6">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={Math.max(section.table.columns.length, 1)} className="px-4 py-6 text-center text-slate-400">
                  暂无数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  if (section.kind === 'markdown' || section.kind === 'callout') {
    return (
      <div className={`rounded-2xl border px-4 py-4 text-sm leading-7 ${
        section.kind === 'callout'
          ? 'border-cyan-300/20 bg-cyan-400/10 text-slate-100'
          : 'border-white/8 bg-white/5 text-slate-200'
      }`}>
        {section.content || '暂无内容'}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {section.items.length ? (
        section.items.map((item, index) => (
          <div key={`${section.id}-${index}`} className="rounded-2xl border border-white/8 bg-white/5 px-4 py-4">
            {item.title ? (
              <div className="mb-2 flex items-center gap-2">
                <Tag color="blue">{String(index + 1).padStart(2, '0')}</Tag>
                <div className="text-sm font-medium text-white">{localizeReportTitle(item.title)}</div>
              </div>
            ) : null}
            <div className="text-sm leading-7 text-slate-200">{item.content}</div>
          </div>
        ))
      ) : (
        <div className="text-sm text-slate-400">暂无内容</div>
      )}
    </div>
  );
}

export default function DynamicReportView({ report }: { report: DynamicReportResponsePayload | null | undefined }) {
  if (!report) {
    return <Empty description="暂无动态报告内容" />;
  }

  return (
    <div className="grid gap-4">
      {report.abstract ? (
        <div className="rounded-[24px] border border-cyan-300/15 bg-[linear-gradient(135deg,rgba(34,211,238,0.14),rgba(15,23,42,0.92))] px-5 py-4 text-sm leading-7 text-slate-100">
          {report.abstract}
        </div>
      ) : null}

      {report.sections.map((section) => (
        <section key={section.id} className="rounded-[24px] border border-white/8 bg-white/5 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-lg font-semibold text-white">{section.title}</div>
            <div className="text-xs tracking-[0.2em] text-slate-500">{getSectionKindLabel(section.kind)}</div>
          </div>
          {section.summary ? <div className="mt-3 text-sm leading-6 text-slate-400">{section.summary}</div> : null}
          <div className="mt-4">{renderSection(section)}</div>
        </section>
      ))}
    </div>
  );
}
