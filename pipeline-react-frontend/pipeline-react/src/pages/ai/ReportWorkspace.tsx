import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Empty, Spin, Tag, message } from 'antd';
import { DownloadOutlined, EyeOutlined, FileTextOutlined, LinkOutlined, RobotOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { EChartsOption } from 'echarts';

import { calculationHistoryApi, projectApi } from '../../api';
import { agentApi } from '../../api/agent';
import Chart from '../../components/common/Chart';
import type { CalculationHistory, Project, SaveReportRequest } from '../../types';
import type { DynamicReportResponsePayload } from '../../types/agent';

type ReportKind = 'HYDRAULIC' | 'OPTIMIZATION' | 'SENSITIVITY';
type RecordItem = CalculationHistory & { project?: Project };
type AnyRecord = Record<string, unknown>;

const numberValue = (source: AnyRecord | null | undefined, keys: string[]) => {
  for (const key of keys) {
    const value = source?.[key];
    const parsed = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const textValue = (source: AnyRecord | null | undefined, keys: string[], fallback = '-') => {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }
  return fallback;
};

function parseObject(value?: string | null): AnyRecord {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object') {
      const record = parsed as AnyRecord;
      if (record.data && typeof record.data === 'object') return record.data as AnyRecord;
      return record;
    }
  } catch {
    // History may contain a plain-text error; keep the report usable.
  }
  return {};
}

function formatNumber(value: number | null, digits = 1, unit = '') {
  if (value === null) return '-';
  return `${value.toLocaleString('zh-CN', { maximumFractionDigits: digits })}${unit}`;
}

function recordKind(record?: RecordItem | null): ReportKind {
  const value = `${record?.calcType ?? ''} ${record?.calcTypeName ?? ''}`;
  if (value.includes('OPTIMIZATION') || value.includes('优化')) return 'OPTIMIZATION';
  if (value.includes('SENSITIVITY') || value.includes('敏感')) return 'SENSITIVITY';
  return 'HYDRAULIC';
}

function isReportHistory(record: CalculationHistory) {
  const label = `${record.calcType ?? ''} ${record.calcTypeName ?? ''}`.toUpperCase();
  return label.includes('REPORT') || label.includes('智能报告') || label.includes('运行简报');
}

function kindLabel(kind: ReportKind) {
  return kind === 'OPTIMIZATION' ? '泵站' : kind === 'SENSITIVITY' ? '敏感' : '水力';
}

function reportTypeLabel(kind: ReportKind) {
  return kind === 'OPTIMIZATION' ? '泵站优化运行报告' : kind === 'SENSITIVITY' ? '敏感性分析运行报告' : '水力分析运行报告';
}

function buildSnapshot(record: RecordItem) {
  return {
    projectName: record.projectName || record.project?.name || null,
    generatedAt: record.createTime || null,
    input: parseObject(record.inputParams),
    output: parseObject(record.outputResult),
  };
}

function getResultForKind(kind: ReportKind, output: AnyRecord) {
  if (kind === 'SENSITIVITY' && output.baseResult && typeof output.baseResult === 'object') {
    return output.baseResult as AnyRecord;
  }
  return output;
}

function getPumpCombination(output: AnyRecord) {
  const direct = textValue(output, ['recommendedPumpCombination', 'pumpCombination'], '');
  if (direct) return direct;
  const pump480 = numberValue(output, ['pump480Num']);
  const pump375 = numberValue(output, ['pump375Num']);
  if (pump480 !== null || pump375 !== null) return `${pump480 ?? '—'}×480 + ${pump375 ?? '—'}×375`;
  return '待计算';
}

function getReportTextItems(report: DynamicReportResponsePayload | null, key: 'risks' | 'suggestions') {
  if (!report) return [];
  if (key === 'risks') return report.risks.map((item) => `${item.target}：${item.reason}`);
  return report.suggestions.map((item) => `${item.target}：${item.action}`);
}

function ExportButton({ report, record }: { report: DynamicReportResponsePayload | null; record?: RecordItem | null }) {
  const exportReport = () => {
    if (!report) {
      message.info('请先生成一份智能报告。');
      return;
    }
    const blob = new Blob([`${report.title}\n\n${report.abstract}\n\n${report.conclusion}\n\n${report.raw_text ?? ''}`], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${report.title || record?.projectName || '智能报告'}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return <Button type="primary" icon={<DownloadOutlined />} onClick={exportReport}>导出报告</Button>;
}

function ReportCharts({ kind, output }: { kind: ReportKind; output: AnyRecord }) {
  const totalHead = numberValue(output, ['totalHead', 'head']);
  const pressure = numberValue(output, ['endStationInPressure', 'endStationPressure', 'terminalInPressure']);
  const friction = numberValue(output, ['frictionHeadLoss', 'frictionLoss']);
  const pressureDrop = numberValue(output, ['totalPressureDrop']);
  const cost = numberValue(output, ['totalCost', 'annualCost', 'cost']);
  const energy = numberValue(output, ['totalEnergyConsumption', 'annualEnergyConsumption', 'energyConsumption']);
  const values = kind === 'OPTIMIZATION' ? [totalHead, energy, cost] : [totalHead, kind === 'SENSITIVITY' ? pressureDrop : friction, pressure];
  const labels = kind === 'OPTIMIZATION' ? ['总扬程 / m', '年耗能', '总成本'] : ['总扬程 / m', kind === 'SENSITIVITY' ? '压降 / m' : '摩阻损失 / m', '末站压头 / m'];
  const series = [{ name: '计算结果', type: 'bar' as const, barWidth: 32, data: values.map((value) => value ?? '-',), itemStyle: { color: '#0e8aa5', borderRadius: [8, 8, 0, 0] } }];
  const option: EChartsOption = {
    grid: { left: 48, right: 18, top: 30, bottom: 34 },
    tooltip: { trigger: 'axis' },
    legend: { top: 0, textStyle: { color: '#45607a', fontSize: 12 } },
    xAxis: { type: 'category', data: labels, axisLabel: { color: '#45607a' } },
    yAxis: { type: 'value', axisLabel: { color: '#45607a' }, splitLine: { lineStyle: { color: '#edf3f6' } } },
    series,
  };
  const pump480 = numberValue(output, ['pump480Num']);
  const pump375 = numberValue(output, ['pump375Num']);
  const pumpComposition = [
    pump480 !== null && pump480 > 0 ? { name: 'ZMI480', value: pump480 } : null,
    pump375 !== null && pump375 > 0 ? { name: 'ZMI375', value: pump375 } : null,
  ].filter((item): item is { name: string; value: number } => item !== null);
  const pie: EChartsOption = {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, textStyle: { color: '#45607a', fontSize: 11 } },
    series: [{ type: 'pie', radius: ['45%', '72%'], center: ['50%', '43%'], label: { show: false }, itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 }, color: ['#0e6e8c', '#f5c04b'], data: kind === 'OPTIMIZATION' ? pumpComposition : [] }],
  };
  return <div className="ymzh-chart-grid"><div className="ymzh-panel"><div className="ymzh-panel-title">计算结果指标</div><Chart option={option} height={258} /></div><div className="ymzh-panel"><div className="ymzh-panel-title">{kind === 'OPTIMIZATION' ? '推荐泵组配置' : '结果说明'}</div>{kind === 'OPTIMIZATION' && pumpComposition.length ? <Chart option={pie} height={258} /> : <div className="ymzh-empty">{kind === 'OPTIMIZATION' ? '该记录未返回泵组台数，暂不展示配置占比。' : '当前结果未提供可核验的分项构成，暂不推导占比。'}</div>}</div></div>;
}

export default function ReportWorkspace() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [reportHistory, setReportHistory] = useState<CalculationHistory[]>([]);
  const [kind, setKind] = useState<ReportKind>('OPTIMIZATION');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [report, setReport] = useState<DynamicReportResponsePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [projectResponse, historyResponse] = await Promise.all([
        projectApi.list(),
        calculationHistoryApi.page({ pageNum: 1, pageSize: 100 }),
      ]);
      const projectRows = projectResponse.data ?? [];
      const historyRows = (historyResponse.data?.list ?? [])
        .filter((item) => item.outputResult && !isReportHistory(item))
        .map((item) => ({ ...item, project: projectRows.find((project) => project.proId === item.projectId) }))
        .sort((a, b) => String(b.createTime ?? '').localeCompare(String(a.createTime ?? '')));
      setRecords(historyRows);
      setReportHistory((historyResponse.data?.list ?? []).filter((item) => item.outputResult && isReportHistory(item)));
      setSelectedId((current) => current && historyRows.some((item) => item.id === current) ? current : historyRows.find((item) => recordKind(item) === kind)?.id ?? historyRows[0]?.id ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取计算记录失败。');
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => { void loadData(); }, [loadData]);

  const typedRecords = useMemo(() => records.filter((record) => recordKind(record) === kind), [kind, records]);
  const selectedRecord = useMemo(() => typedRecords.find((record) => record.id === selectedId) ?? typedRecords[0] ?? null, [selectedId, typedRecords]);
  const snapshot = useMemo(() => selectedRecord ? buildSnapshot(selectedRecord) : null, [selectedRecord]);
  const output = snapshot?.output ?? {};
  const result = getResultForKind(kind, output);
  const totalHead = numberValue(result, ['totalHead', 'head']);
  const pressure = numberValue(result, ['endStationInPressure', 'endStationPressure', 'terminalInPressure']);
  const friction = numberValue(result, ['frictionHeadLoss', 'frictionLoss']);
  const energy = numberValue(result, ['totalEnergyConsumption', 'annualEnergyConsumption', 'energyConsumption']);
  const cost = numberValue(result, ['totalCost', 'annualCost', 'cost']);
  const pumpCombination = kind === 'OPTIMIZATION' ? getPumpCombination(result) : '—';
  const riskItems = getReportTextItems(report, 'risks');
  const suggestionItems = getReportTextItems(report, 'suggestions');

  const generateReport = async () => {
    if (!selectedRecord || !snapshot) {
      message.warning('暂无可用的计算记录。');
      return;
    }
    setGenerating(true);
    setError('');
    try {
      const projectId = Number(selectedRecord.projectId);
      const response = await agentApi.generateDynamicReport({
        selected_project_ids: Number.isFinite(projectId) ? [projectId] : [],
        project_names: [selectedRecord.projectName || selectedRecord.project?.name || '未命名项目'],
        report_type: 'AI_REPORT',
        report_type_label: reportTypeLabel(kind),
        intelligence_level: 'enhanced',
        output_format: 'markdown',
        include_summary: true,
        include_risk: true,
        include_suggestions: true,
        include_conclusion: true,
        focuses: ['结果摘要', '风险识别', '运行建议', '真实计算依据'],
        user_prompt: `请基于这条真实的${reportTypeLabel(kind)}记录生成可执行报告，所有数字必须来自快照。`,
        hydraulic_snapshot: kind === 'HYDRAULIC' ? snapshot : undefined,
        optimization_snapshot: kind === 'OPTIMIZATION' ? snapshot : undefined,
        sensitivity_snapshot: kind === 'SENSITIVITY' ? snapshot : undefined,
      });
      const enriched = { ...response, metadata: { ...(response.metadata ?? {}), source_record_id: selectedRecord.id, snapshot } };
      setReport(enriched);
      const archivePayload: SaveReportRequest = {
        title: enriched.title || `${selectedRecord.projectName || '项目'}${reportTypeLabel(kind)}`,
        reportType: 'AI_REPORT',
        reportTypeLabel: reportTypeLabel(kind),
        selectedProjectIds: Number.isFinite(projectId) ? [projectId] : [],
        projectNames: [selectedRecord.projectName || selectedRecord.project?.name || '未命名项目'],
        rangeLabel: '当前计算记录',
        intelligenceLabel: '增强分析',
        outputFormat: 'markdown',
        sourceLabel: '智能报告中心',
        result: { source: enriched.source === 'rules' ? 'fallback' : 'ai', highlights: enriched.highlights, summary: enriched.summary, risks: enriched.risks, suggestions: enriched.suggestions, conclusion: enriched.conclusion, rawText: enriched.raw_text, report: enriched },
      };
      try {
        const archived = await calculationHistoryApi.report(archivePayload);
        if (archived.data) setReportHistory((current) => [archived.data, ...current.filter((item) => item.id !== archived.data.id)]);
      } catch { message.warning('报告已生成，但历史归档失败。'); }
      message.success('智能报告生成成功，已保留真实计算记录引用。');
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : '智能报告生成失败。');
      message.error('智能报告生成失败。');
    } finally { setGenerating(false); }
  };

  const share = async () => {
    const url = window.location.href;
    try { await navigator.clipboard.writeText(url); message.success('报告页面链接已复制。'); } catch { message.info(url); }
  };

  return <div className="ymzh-report-page"><style>{`
    .ymzh-report-page{--ink:#0c2433;--muted:#45607a;--line:#e3ecf2;--brand:#0e6e8c;--brand2:#0fa3c0;background:#f4f7f9;min-height:100%;color:var(--ink);font-family:Inter,'PingFang SC','Microsoft YaHei',sans-serif;padding-bottom:42px}
    .ymzh-topbar{background:rgba(244,247,249,.9);border-bottom:1px solid var(--line);padding:14px 28px;display:flex;align-items:center;gap:20px;position:sticky;top:0;z-index:5}.ymzh-brand{display:flex;align-items:center;gap:10px}.ymzh-brand-badge{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,var(--brand),var(--brand2));color:#fff;display:grid;place-items:center;font-weight:900}.ymzh-brand-name{font-size:18px;font-weight:800}.ymzh-brand-sub{font-size:11px;color:#8aa2b8}.ymzh-nav{display:flex;gap:6px;overflow:auto;flex:1}.ymzh-nav span{padding:8px 14px;border-radius:10px;color:var(--muted);font-size:13px;white-space:nowrap}.ymzh-nav .active{background:var(--brand);color:#fff}.ymzh-user{font-size:12px;color:#8aa2b8;white-space:nowrap}
    .ymzh-head,.ymzh-main{max-width:1440px;margin:0 auto}.ymzh-head{padding:28px 28px 4px}.ymzh-crumb{font-size:12px;color:#8aa2b8;margin-bottom:10px}.ymzh-title{font-family:Georgia,'Noto Serif SC',serif;font-size:30px;font-weight:900;margin:0}.ymzh-title span{font:600 12px Inter,'Microsoft YaHei';color:var(--brand);background:rgba(14,110,140,.08);padding:6px 12px;border-radius:999px;margin-left:10px;vertical-align:middle}.ymzh-desc{max-width:860px;color:var(--muted);font-size:14px;line-height:1.8;margin:10px 0 0}.ymzh-main{padding:22px 28px;display:grid;grid-template-columns:350px 1fr;gap:20px;align-items:start}.ymzh-card,.ymzh-panel{background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 8px 24px rgba(12,36,51,.05)}.ymzh-side{position:sticky;top:84px;overflow:hidden}.ymzh-side-head{padding:18px 20px;border-bottom:1px solid var(--line);font-weight:800}.ymzh-side-body{padding:18px}.ymzh-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:14px}.ymzh-tabs button{padding:10px 4px;border:1px solid #d5e2eb;background:#fbfdfe;border-radius:10px;color:var(--muted);font-weight:700}.ymzh-tabs button.active{color:#fff;background:linear-gradient(135deg,var(--brand),var(--brand2));border-color:transparent}.ymzh-rec-list{display:flex;flex-direction:column;gap:9px;max-height:430px;overflow:auto}.ymzh-rec{padding:13px;border:1px solid var(--line);border-radius:12px;background:#fbfdfe;text-align:left;width:100%}.ymzh-rec.active{border-color:var(--brand);background:rgba(14,110,140,.07);box-shadow:0 0 0 3px rgba(14,110,140,.08)}.ymzh-rec-top{display:flex;justify-content:space-between;gap:8px;font-size:12px;font-weight:700}.ymzh-rec-time{font-size:10px;color:#8aa2b8;font-weight:400}.ymzh-rec-meta{margin-top:7px;display:flex;gap:10px;color:#8aa2b8;font-size:11px;flex-wrap:wrap}.ymzh-generate{margin-top:15px;width:100%;height:44px;border:0;border-radius:11px;background:linear-gradient(135deg,var(--brand),var(--brand2));color:#fff;font-weight:800;letter-spacing:.04em}.ymzh-report{display:flex;flex-direction:column;gap:18px}.ymzh-hero{padding:24px 28px;color:#fff;background:linear-gradient(135deg,#0a2733,#0e6e8c 80%);border-radius:18px;box-shadow:0 10px 30px rgba(14,110,140,.2)}.ymzh-kicker{font-size:11px;letter-spacing:.12em;color:rgba(255,255,255,.7)}.ymzh-hero h2{margin:10px 0 0;font:900 24px Georgia,'Noto Serif SC',serif}.ymzh-meta{display:flex;gap:15px;flex-wrap:wrap;margin-top:13px;font-size:11px;color:rgba(255,255,255,.78)}.ymzh-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.ymzh-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.ymzh-metric{padding:17px;border-radius:14px;background:#fff;border:1px solid var(--line);box-shadow:0 5px 16px rgba(12,36,51,.04)}.ymzh-metric-label{font-size:12px;color:#8aa2b8}.ymzh-metric-value{font-size:26px;font-weight:900;margin-top:8px;color:var(--brand)}.ymzh-metric-note{font-size:11px;color:var(--muted);margin-top:5px}.ymzh-chart-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.ymzh-panel{padding:18px}.ymzh-panel-title{font-weight:800;font-size:14px;margin-bottom:4px}.ymzh-section{padding:20px}.ymzh-section-title{display:flex;justify-content:space-between;align-items:center;font-size:15px;font-weight:800;margin-bottom:15px}.ymzh-list{display:grid;gap:10px}.ymzh-list-item{padding:13px 14px;border-radius:12px;background:#f8fbfd;border-left:4px solid #f5c04b;font-size:13px;line-height:1.7;color:#334e63}.ymzh-list-item.suggestion{border-left-color:#10a37f}.ymzh-conclusion{padding:18px;background:#eff8fa;border-radius:13px;color:#24485a;line-height:1.85;font-size:14px}.ymzh-empty{padding:28px;text-align:center;color:#8aa2b8}.ymzh-error{margin:0 28px}
    @media(max-width:1000px){.ymzh-main{grid-template-columns:1fr}.ymzh-side{position:static}.ymzh-metrics{grid-template-columns:repeat(2,1fr)}}@media(max-width:640px){.ymzh-topbar{padding:10px 16px}.ymzh-nav{display:none}.ymzh-head,.ymzh-main{padding-left:16px;padding-right:16px}.ymzh-title{font-size:25px}.ymzh-title span{display:inline-block;margin:8px 0 0}.ymzh-chart-grid{grid-template-columns:1fr}.ymzh-metrics{grid-template-columns:1fr 1fr}.ymzh-metric-value{font-size:20px}.ymzh-hero{padding:20px}.ymzh-hero h2{font-size:20px}
    }
  `}</style>
    <section className="ymzh-head"><div className="ymzh-crumb">智能助手 / 智能报告</div><h1 className="ymzh-title">智能报告 <span>数据 → 判断 → 建议</span></h1><p className="ymzh-desc">选择一条已完成的计算记录，AI 基于真实计算结果生成带溯源依据的运行报告，直接服务于调度决策。</p></section>
    {error ? <div className="ymzh-error"><Alert type="error" showIcon message="报告服务提示" description={error} /></div> : null}
    <main className="ymzh-main"><aside className="ymzh-card ymzh-side"><div className="ymzh-side-head">选择计算记录 <Tag color="blue" style={{ float: 'right', margin: 0 }}>单选</Tag></div><div className="ymzh-side-body"><div className="ymzh-tabs">{(['HYDRAULIC', 'OPTIMIZATION', 'SENSITIVITY'] as ReportKind[]).map((value) => <button key={value} className={kind === value ? 'active' : ''} onClick={() => { setKind(value); setReport(null); }}>{kindLabel(value)}</button>)}</div>{loading ? <div className="ymzh-empty"><Spin /></div> : typedRecords.length ? <div className="ymzh-rec-list">{typedRecords.map((record) => <button key={record.id} className={`ymzh-rec ${selectedRecord?.id === record.id ? 'active' : ''}`} onClick={() => { setSelectedId(record.id); setReport(null); }}><div className="ymzh-rec-top"><span>{record.projectName || record.project?.name || '未命名项目'} · {kindLabel(kind)}</span><span className="ymzh-rec-time">{record.createTime?.slice(5, 16) || '-'}</span></div><div className="ymzh-rec-meta"><span>结果：{record.statusName || '已完成'}</span><span>{textValue(parseObject(record.outputResult), kind === 'OPTIMIZATION' ? ['recommendedPumpCombination', 'pumpCombination'] : ['flowRegime', 'regime'], '已保存')}</span></div></button>)}</div> : <Empty description="暂无已完成记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />}<button className="ymzh-generate" onClick={() => void generateReport()} disabled={generating || !selectedRecord}>{generating ? '正在生成…' : '基于该记录生成报告'}</button><Button type="link" icon={<RobotOutlined />} onClick={() => void loadData()} style={{ marginTop: 8, padding: 0 }}>刷新真实记录</Button></div></aside>
      <section className="ymzh-report"><div className="ymzh-hero"><div className="ymzh-kicker">AI 生成 · 可溯源 · 依据真实计算记录</div><h2>{report?.title || `${selectedRecord?.projectName || '项目'} · ${reportTypeLabel(kind)}`}</h2><div className="ymzh-meta"><span><FileTextOutlined /> 来源：{kindLabel(kind)}计算引擎 · 记录 #{selectedRecord?.id ?? '-'}</span><span>编制依据：真实计算结果</span><span>生成状态：{report ? '已完成' : '待生成'}</span></div><div className="ymzh-actions"><Button ghost icon={<LinkOutlined />} onClick={() => void share()}>分享</Button><ExportButton report={report} record={selectedRecord} /></div></div>{selectedRecord ? <><div className="ymzh-metrics"><div className="ymzh-metric"><div className="ymzh-metric-label">{kind === 'OPTIMIZATION' ? '推荐开泵组合' : '计算对象'}</div><div className="ymzh-metric-value" style={{ fontSize: kind === 'OPTIMIZATION' ? 22 : 18 }}>{kind === 'OPTIMIZATION' ? pumpCombination : selectedRecord.projectName || '—'}</div><div className="ymzh-metric-note">真实记录 #{selectedRecord.id}</div></div><div className="ymzh-metric"><div className="ymzh-metric-label">末站进站压头</div><div className="ymzh-metric-value">{formatNumber(pressure, 1, 'm')}</div><div className="ymzh-metric-note">来自计算结果</div></div><div className="ymzh-metric"><div className="ymzh-metric-label">{kind === 'OPTIMIZATION' ? '总成本' : '摩阻损失'}</div><div className="ymzh-metric-value">{formatNumber(kind === 'OPTIMIZATION' ? cost : friction, 1, kind === 'OPTIMIZATION' ? ' 元' : 'm')}</div><div className="ymzh-metric-note">未使用演示固定值</div></div><div className="ymzh-metric"><div className="ymzh-metric-label">总扬程 / 年能耗</div><div className="ymzh-metric-value">{formatNumber(totalHead ?? energy, 1, totalHead !== null ? 'm' : ' kWh')}</div><div className="ymzh-metric-note">{report ? '报告已生成' : '等待生成报告'}</div></div></div><ReportCharts kind={kind} output={result}/><div className="ymzh-card ymzh-section"><div className="ymzh-section-title"><span>风险识别与行动建议</span><Tag color="gold">AI 基于计算结果推演</Tag></div>{riskItems.length || suggestionItems.length ? <div className="ymzh-list">{riskItems.map((item, index) => <div className="ymzh-list-item" key={`risk-${index}`}>{item}</div>)}{suggestionItems.map((item, index) => <div className="ymzh-list-item suggestion" key={`suggestion-${index}`}>{item}</div>)}</div> : <div className="ymzh-empty">生成报告后显示风险识别与执行建议</div>}</div><div className="ymzh-card ymzh-section"><div className="ymzh-section-title"><span>AI 结论</span><Tag color="cyan">自动生成</Tag></div><div className="ymzh-conclusion">{report?.conclusion || report?.abstract || '当前页面展示的指标、图表和记录均来自后端保存的真实计算结果。点击“基于该记录生成报告”，由 AI 服务生成风险判断、运行建议并归档到历史记录。'}</div></div></> : <div className="ymzh-card ymzh-empty">请选择一条计算记录</div>}</section></main>
    {reportHistory.length ? <section style={{ maxWidth: 1384, margin: '0 auto', padding: '0 28px' }}><div className="ymzh-card ymzh-section"><div className="ymzh-section-title"><span>智能报告历史</span><Tag>{reportHistory.length} 条</Tag></div><div className="ymzh-list">{reportHistory.slice(0, 8).map((item) => <div key={item.id} className="ymzh-list-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}><span>{item.projectName || '项目'} · {item.calcTypeName || '智能报告'} · {item.createTime || ''}</span><Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/ai/report/detail/${item.id}`)}>查看归档</Button></div>)}</div></div></section> : null}
  </div>;
}
