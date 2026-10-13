import { useMemo, useRef, useState, type ReactNode } from 'react';
import { message } from 'antd';
import { useNavigate } from 'react-router-dom';

import { agentApi } from '../../api/agent';
import { useCalculationLinkStore } from '../../stores/calculationLinkStore';
import type { DynamicReportResponsePayload, DynamicReportSuggestionItem } from '../../types/agent';
import styles from './SmartReportExperience.module.css';

export type SmartReportKind = 'hydraulic' | 'optimization' | 'sensitivity' | 'optimization-comparison' | 'generic';

type ReportSnapshot = {
  projectName?: string | null;
  generatedAt?: string | null;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
};

type SmartReportExperienceProps = {
  report: DynamicReportResponsePayload;
  kind: SmartReportKind;
  snapshot?: ReportSnapshot | null;
  children: ReactNode;
};

type ReportMode = 'full' | 'brief' | 'dispatch';

type Candidate = {
  pump480Num?: number;
  pump375Num?: number;
  totalHead?: number;
  totalPressureDrop?: number;
  endStationInPressure?: number;
  totalEnergyConsumption?: number;
  totalCost?: number;
  isFeasible?: boolean;
  recommended?: boolean;
};

type ComparisonModel = {
  title: string;
  beforeLabel: string;
  beforeValue: string;
  beforePlan: string;
  afterLabel: string;
  afterValue: string;
  afterPlan: string;
  badge: string;
  metrics: Array<{ label: string; before: string; after: string; delta?: string }>;
};

type VerdictModel = {
  word: string;
  title: string;
  detail: string;
  tone: 'good' | 'warn' | 'danger';
  confidence: number;
};

const REPORT_KIND_LABELS: Record<SmartReportKind, string> = {
  hydraulic: '水力分析',
  optimization: '泵站优化',
  sensitivity: '敏感性分析',
  'optimization-comparison': '多项目优化对比',
  generic: '综合分析',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function getValue(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (Array.isArray(current)) return /^\d+$/.test(key) ? current[Number(key)] : undefined;
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
}

function firstValue(source: unknown, paths: string[]) {
  for (const path of paths) {
    const value = getValue(source, path);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function numberValue(source: unknown, paths: string[]) {
  const raw = firstValue(source, paths);
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function booleanValue(source: unknown, paths: string[]) {
  const raw = firstValue(source, paths);
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw > 0;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (['true', '1', 'yes', '是', '可行'].includes(normalized)) return true;
    if (['false', '0', 'no', '否', '不可行'].includes(normalized)) return false;
  }
  return null;
}

function formatNumber(value: number | null, digits = 1) {
  if (value === null) return '—';
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatMetric(value: number | null, unit: string, digits = 1) {
  return value === null ? '数据不足' : `${formatNumber(value, digits)} ${unit}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return '本次生成';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function getReportRequest(report: DynamicReportResponsePayload) {
  return asRecord(report.metadata?.request);
}

function getProjectId(report: DynamicReportResponsePayload) {
  const request = getReportRequest(report);
  const ids = firstValue(request, ['selected_project_ids']);
  if (!Array.isArray(ids) || ids.length !== 1) return null;
  const id = Number(ids[0]);
  return Number.isFinite(id) ? id : null;
}

function getSourceLabel(source: DynamicReportResponsePayload['source']) {
  if (source === 'ai') return 'AI 生成';
  if (source === 'rules') return '规则生成';
  return '模型 + 规则联合分析';
}

function getCandidate(source: Record<string, unknown>): Candidate {
  return {
    pump480Num: numberValue(source, ['pump480Num']) ?? undefined,
    pump375Num: numberValue(source, ['pump375Num']) ?? undefined,
    totalHead: numberValue(source, ['totalHead']) ?? undefined,
    totalPressureDrop: numberValue(source, ['totalPressureDrop', 'pressureDrop']) ?? undefined,
    endStationInPressure: numberValue(source, ['endStationInPressure', 'terminalInPressure']) ?? undefined,
    totalEnergyConsumption:
      numberValue(source, ['totalEnergyConsumption', 'annualEnergyConsumption', 'energyConsumption']) ?? undefined,
    totalCost: numberValue(source, ['totalCost', 'annualCost']) ?? undefined,
    isFeasible: booleanValue(source, ['isFeasible', 'feasible']) ?? undefined,
    recommended: booleanValue(source, ['recommended']) ?? undefined,
  };
}

function pumpPlan(candidate?: Candidate | null) {
  if (!candidate) return '方案数据不足';
  const pump480 = candidate.pump480Num ?? 0;
  const pump375 = candidate.pump375Num ?? 0;
  return `${pump480}×ZMI480 + ${pump375}×ZMI375`;
}

function buildHydraulicComparison(snapshot: ReportSnapshot, optimizationOutput?: Record<string, unknown> | null) {
  if (!optimizationOutput) return null;
  const currentHead = numberValue(snapshot.output, ['totalHead']);
  const hydraulicCurrent: Candidate = {
    pump480Num: numberValue(snapshot.input, ['pump480Num']) ?? undefined,
    pump375Num: numberValue(snapshot.input, ['pump375Num']) ?? undefined,
    totalHead: currentHead ?? undefined,
    endStationInPressure:
      numberValue(snapshot.output, ['endStationInPressure', 'endStationPressure']) ?? undefined,
    isFeasible: (numberValue(snapshot.output, ['endStationInPressure', 'endStationPressure']) ?? 0) > 0,
  };
  const candidates = asRecordArray(optimizationOutput.candidates).map(getCandidate);
  const outputCandidate = getCandidate(optimizationOutput);
  const recommended = candidates.find((item) => item.recommended) ?? outputCandidate;
  const feasible = candidates.filter((item) => item.isFeasible !== false);
  const current = !feasible.length
    ? hydraulicCurrent
    : currentHead === null
      ? feasible.sort((left, right) => (right.totalHead ?? 0) - (left.totalHead ?? 0))[0]
    : feasible.reduce((best, item) => {
        if (!best) return item;
        return Math.abs((item.totalHead ?? 0) - currentHead) < Math.abs((best.totalHead ?? 0) - currentHead) ? item : best;
      }, null as Candidate | null);

  if (!recommended || !current) return null;
  const costSaving = current.totalCost !== undefined && recommended.totalCost !== undefined
    ? current.totalCost - recommended.totalCost
    : null;
  const energySaving = current.totalEnergyConsumption !== undefined && recommended.totalEnergyConsumption !== undefined
    ? current.totalEnergyConsumption - recommended.totalEnergyConsumption
    : null;
  const costRate = costSaving !== null && current.totalCost ? (costSaving / current.totalCost) * 100 : null;
  const headDrop = current.totalHead !== undefined && recommended.totalHead !== undefined
    ? current.totalHead - recommended.totalHead
    : null;

  return {
    title: '现状方案 vs 优化推荐',
    beforeLabel: '当前工况对应方案',
    beforeValue: formatMetric(current.totalHead ?? currentHead, 'm', 0),
    beforePlan: pumpPlan(current),
    afterLabel: '系统推荐方案',
    afterValue: formatMetric(recommended.totalHead ?? null, 'm', 0),
    afterPlan: pumpPlan(recommended),
    badge:
      costSaving !== null && costSaving > 0
        ? `预计年省 ${formatNumber(costSaving / 10000, 1)} 万元`
        : headDrop !== null && headDrop > 0
          ? `减少无效扬程 ${formatNumber(headDrop, 0)} m`
          : '已完成方案对比',
    metrics: [
      {
        label: '年运行费用',
        before: formatMetric(current.totalCost !== undefined ? current.totalCost / 10000 : null, '万元', 1),
        after: formatMetric(recommended.totalCost !== undefined ? recommended.totalCost / 10000 : null, '万元', 1),
        delta: costRate !== null && costRate > 0 ? `下降 ${formatNumber(costRate, 1)}%` : undefined,
      },
      {
        label: '年能耗',
        before: formatMetric(current.totalEnergyConsumption ?? null, 'kWh', 0),
        after: formatMetric(recommended.totalEnergyConsumption ?? null, 'kWh', 0),
        delta:
          energySaving !== null && energySaving > 0 && current.totalEnergyConsumption
            ? `下降 ${formatNumber((energySaving / current.totalEnergyConsumption) * 100, 1)}%`
            : undefined,
      },
      {
        label: '末站进站压头',
        before: formatMetric(current.endStationInPressure ?? null, 'm', 1),
        after: formatMetric(recommended.endStationInPressure ?? null, 'm', 1),
      },
    ],
  } satisfies ComparisonModel;
}

function buildOptimizationComparison(snapshot: ReportSnapshot) {
  const output = snapshot.output ?? {};
  const candidates = asRecordArray(output.candidates).map(getCandidate);
  const recommended = candidates.find((item) => item.recommended) ?? getCandidate(output);
  const reference = candidates
    .filter((item) => item.isFeasible !== false && !item.recommended)
    .sort((left, right) => (right.totalCost ?? 0) - (left.totalCost ?? 0))[0];
  if (!recommended || !reference) return null;
  const costSaving = reference.totalCost !== undefined && recommended.totalCost !== undefined
    ? reference.totalCost - recommended.totalCost
    : null;
  const costRate = costSaving !== null && reference.totalCost ? (costSaving / reference.totalCost) * 100 : null;

  return {
    title: '高耗可行方案 vs 推荐方案',
    beforeLabel: '对比基准',
    beforeValue: formatMetric(reference.totalHead ?? null, 'm', 0),
    beforePlan: pumpPlan(reference),
    afterLabel: '推荐方案',
    afterValue: formatMetric(recommended.totalHead ?? null, 'm', 0),
    afterPlan: pumpPlan(recommended),
    badge: costSaving !== null && costSaving > 0 ? `预计年省 ${formatNumber(costSaving / 10000, 1)} 万元` : '综合成本更优',
    metrics: [
      {
        label: '年运行费用',
        before: formatMetric(reference.totalCost !== undefined ? reference.totalCost / 10000 : null, '万元', 1),
        after: formatMetric(recommended.totalCost !== undefined ? recommended.totalCost / 10000 : null, '万元', 1),
        delta: costRate !== null && costRate > 0 ? `下降 ${formatNumber(costRate, 1)}%` : undefined,
      },
      {
        label: '年能耗',
        before: formatMetric(reference.totalEnergyConsumption ?? null, 'kWh', 0),
        after: formatMetric(recommended.totalEnergyConsumption ?? null, 'kWh', 0),
      },
      {
        label: '末站进站压头',
        before: formatMetric(reference.endStationInPressure ?? null, 'm', 1),
        after: formatMetric(recommended.endStationInPressure ?? null, 'm', 1),
      },
    ],
  } satisfies ComparisonModel;
}

function buildSensitivityComparison(snapshot: ReportSnapshot) {
  const output = snapshot.output ?? {};
  const basePressure = numberValue(output, ['baseResult.endStationInPressure', 'baseResult.endStationPressure']);
  const ranking = asRecordArray(output.sensitivityRanking).sort(
    (left, right) => Number(left.rank ?? 999) - Number(right.rank ?? 999),
  );
  const top = ranking[0];
  const variableResults = asRecordArray(output.variableResults);
  const topResult = variableResults.find((item) => String(item.variableType ?? '') === String(top?.variableType ?? ''))
    ?? variableResults[0];
  const points = asRecordArray(topResult?.dataPoints);
  const worst = points.reduce((selected, point) => {
    const change = Math.abs(Number(point.pressureChangePercent ?? 0));
    const selectedChange = Math.abs(Number(selected?.pressureChangePercent ?? 0));
    return !selected || change > selectedChange ? point : selected;
  }, null as Record<string, unknown> | null);
  if (!topResult || !worst) return null;

  const variableName = String(topResult.variableName ?? top?.variableName ?? '最高敏感变量');
  const coefficient = numberValue(topResult, ['sensitivityCoefficient']);
  const changePercent = numberValue(worst, ['changePercent']);
  const worstPressure = numberValue(worst, ['endStationPressure', 'endStationInPressure']);
  const pressureChange = numberValue(worst, ['pressureChangePercent']);

  return {
    title: '基准工况 vs 最不利敏感扰动',
    beforeLabel: '基准工况',
    beforeValue: formatMetric(basePressure, 'm', 1),
    beforePlan: '当前输入参数',
    afterLabel: `${variableName} ${changePercent !== null ? `${changePercent > 0 ? '+' : ''}${formatNumber(changePercent, 0)}%` : '扰动'}`,
    afterValue: formatMetric(worstPressure, 'm', 1),
    afterPlan: `敏感系数 ${formatNumber(coefficient, 2)}`,
    badge: pressureChange !== null ? `压力变化 ${pressureChange > 0 ? '+' : ''}${formatNumber(pressureChange, 1)}%` : '已识别最不利扰动',
    metrics: [
      {
        label: '末站进站压头',
        before: formatMetric(basePressure, 'm', 1),
        after: formatMetric(worstPressure, 'm', 1),
        delta: pressureChange !== null ? `${pressureChange > 0 ? '上升' : '下降'} ${formatNumber(Math.abs(pressureChange), 1)}%` : undefined,
      },
      {
        label: '最高敏感变量',
        before: '基准值',
        after: variableName,
        delta: coefficient !== null ? `系数 ${formatNumber(coefficient, 2)}` : undefined,
      },
    ],
  } satisfies ComparisonModel;
}

function buildVerdict(kind: SmartReportKind, snapshot: ReportSnapshot | null | undefined, report: DynamicReportResponsePayload): VerdictModel {
  const output = snapshot?.output ?? {};
  if (kind === 'hydraulic') {
    const endPressure = numberValue(output, ['endStationInPressure', 'endStationPressure']);
    const totalHead = numberValue(output, ['totalHead']);
    const friction = numberValue(output, ['frictionHeadLoss']);
    const ratio = totalHead && friction !== null ? (friction / totalHead) * 100 : null;
    if (endPressure !== null && endPressure <= 0) {
      return {
        word: '不可行',
        title: '末站压力未满足基本输送约束',
        detail: `末站进站压头为 ${formatNumber(endPressure, 1)} m，应先复核泵组扬程与压力边界。`,
        tone: 'danger',
        confidence: 96,
      };
    }
    return {
      word: '可行',
      title: ratio !== null && ratio >= 50 ? '输送可行，但沿程摩阻与扬程利用仍需优化' : '当前工况满足基本输送要求',
      detail: `末站进站压头 ${formatMetric(endPressure, 'm', 1)}；${ratio !== null ? `摩阻约占总扬程 ${formatNumber(ratio, 1)}%` : '摩阻占比数据不足'}。`,
      tone: ratio !== null && ratio >= 70 ? 'warn' : 'good',
      confidence: 92,
    };
  }

  if (kind === 'optimization') {
    const feasible = booleanValue(output, ['isFeasible', 'feasible']);
    const pressure = numberValue(output, ['endStationInPressure', 'terminalInPressure']);
    return {
      word: feasible === false ? '需复核' : '推荐',
      title: feasible === false ? '当前推荐组合仍未通过全部水力约束' : '推荐组合兼顾可行性与运行经济性',
      detail: `推荐 ${pumpPlan(getCandidate(output))}，末站进站压头 ${formatMetric(pressure, 'm', 1)}。`,
      tone: feasible === false ? 'danger' : 'good',
      confidence: feasible === false ? 88 : 94,
    };
  }

  if (kind === 'sensitivity') {
    const ranking = asRecordArray(output.sensitivityRanking).sort(
      (left, right) => Number(left.rank ?? 999) - Number(right.rank ?? 999),
    );
    const top = ranking[0];
    return {
      word: '已识别',
      title: top ? `${String(top.variableName ?? top.variableType ?? '关键变量')}是当前首要控制变量` : '已完成关键变量敏感性排序',
      detail: top
        ? `敏感系数 ${formatNumber(numberValue(top, ['sensitivityCoefficient']), 2)}，建议优先监测该参数的偏移。`
        : report.conclusion || '请结合排名、趋势与最大影响幅度制定控制策略。',
      tone: 'warn',
      confidence: 91,
    };
  }

  return {
    word: kind === 'optimization-comparison' ? '已优选' : '已完成',
    title: report.conclusion || '报告已完成综合研判',
    detail: report.summary[0] || report.abstract || '已结合计算结果、风险规则和 AI 分析形成结论。',
    tone: 'good',
    confidence: 88,
  };
}

function buildReasoningSteps(
  kind: SmartReportKind,
  snapshot: ReportSnapshot | null | undefined,
  report: DynamicReportResponsePayload,
  comparison: ComparisonModel | null,
) {
  const output = snapshot?.output ?? {};
  const steps: string[] = [];

  if (kind === 'hydraulic') {
    const endPressure = numberValue(output, ['endStationInPressure', 'endStationPressure']);
    const totalHead = numberValue(output, ['totalHead']);
    const friction = numberValue(output, ['frictionHeadLoss']);
    const ratio = totalHead && friction !== null ? (friction / totalHead) * 100 : null;
    steps.push(`末站进站压头 ${formatMetric(endPressure, 'm', 1)}${endPressure !== null ? (endPressure > 0 ? ' > 0，满足基本输送约束。' : ' ≤ 0，未满足输送约束。') : '，当前数据不足以校验基本约束。'}`);
    steps.push(`总扬程 ${formatMetric(totalHead, 'm', 1)}，摩阻损失 ${formatMetric(friction, 'm', 1)}${ratio !== null ? `，摩阻占比 ${formatNumber(ratio, 1)}%。` : '。'}`);
    if (comparison) steps.push(`${comparison.beforePlan} 与 ${comparison.afterPlan} 对比后，系统发现存在可量化的降扬程或降成本空间。`);
  } else if (kind === 'optimization') {
    const candidate = getCandidate(output);
    steps.push(`约束校验：末站进站压头 ${formatMetric(candidate.endStationInPressure ?? null, 'm', 1)}，方案${candidate.isFeasible === false ? '未通过' : '通过'}基本水力约束。`);
    steps.push(`组合筛选：在候选泵组中比较总扬程、末站压力、年能耗和年运行费用。`);
    steps.push(`综合排序后选择 ${pumpPlan(candidate)}，而不是单纯追求最大扬程。`);
  } else if (kind === 'sensitivity') {
    const ranking = asRecordArray(output.sensitivityRanking).sort(
      (left, right) => Number(left.rank ?? 999) - Number(right.rank ?? 999),
    );
    const top = ranking[0];
    steps.push(`以基准工况为参照，对每个敏感变量按设定区间逐点扰动并重新计算水力结果。`);
    steps.push(top
      ? `${String(top.variableName ?? top.variableType ?? '关键变量')} 排名第 1，敏感系数 ${formatNumber(numberValue(top, ['sensitivityCoefficient']), 2)}。`
      : '根据压力、摩阻损失和流态变化幅度完成敏感性排序。');
    steps.push(`将最大影响幅度与运行边界结合，形成优先监测和复算建议。`);
  } else {
    steps.push(...report.summary.slice(0, 2));
  }

  const reportEvidence = [...report.highlights, ...(report.aiAnalysis?.metricAnalysis ?? [])]
    .filter((item) => Boolean(item) && !/数据不足|成功率\s*-|^-$/.test(item))
    .find((item) => !steps.some((step) => step.includes(item.slice(0, 12))));
  if (reportEvidence) steps.push(reportEvidence);
  if (report.conclusion) steps.push(`由上述证据汇总得到结论：${report.conclusion}`);
  return steps.slice(0, 5);
}

function extractAnswer(payload: Record<string, unknown>) {
  const direct = firstValue(payload, ['response', 'answer', 'content', 'message', 'data.response', 'data.answer', 'data.content']);
  return typeof direct === 'string' && direct.trim() ? direct.trim() : '';
}

function actionKind(item: DynamicReportSuggestionItem) {
  const text = `${item.target} ${item.reason} ${item.action} ${item.expected} ${item.text ?? ''}`;
  if (/泵|能耗|电费|扬程|组合|调泵/.test(text)) return 'optimization';
  if (/敏感|变量|扰动|边界/.test(text)) return 'sensitivity';
  if (/复算|校核|压力|流量|摩阻|水力/.test(text)) return 'hydraulic';
  return 'todo';
}

function actionLabel(kind: ReturnType<typeof actionKind>) {
  if (kind === 'optimization') return '带参数去泵站优化 →';
  if (kind === 'sensitivity') return '去敏感性分析 →';
  if (kind === 'hydraulic') return '去水力校核 →';
  return '生成报告待办 →';
}

function priorityLabel(priority?: string | null) {
  const normalized = String(priority ?? '').trim().toLowerCase();
  if (normalized === 'high' || normalized === '高') return '高优先级';
  if (normalized === 'low' || normalized === '低') return '低优先级';
  if (normalized === 'medium' || normalized === '中') return '中优先级';
  return String(priority || '中优先级');
}

export default function SmartReportExperience({ report, kind, snapshot, children }: SmartReportExperienceProps) {
  const navigate = useNavigate();
  const latestOptimization = useCalculationLinkStore((state) => state.latestByType.OPTIMIZATION);
  const [mode, setMode] = useState<ReportMode>('full');
  const [traceOpen, setTraceOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [asking, setAsking] = useState(false);
  const [completedActions, setCompletedActions] = useState<number[]>([]);
  const sessionIdRef = useRef(`report-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);

  const sameProjectOptimization = useMemo(() => {
    if (!latestOptimization || !snapshot?.projectName) return latestOptimization ?? null;
    return latestOptimization.projectName === snapshot.projectName ? latestOptimization : null;
  }, [latestOptimization, snapshot?.projectName]);

  const embeddedOptimizationOutput = useMemo(() => {
    const relatedSnapshot = asRecord(report.metadata?.relatedOptimizationSnapshot);
    return asRecord(relatedSnapshot?.output);
  }, [report.metadata]);

  const comparison = useMemo(() => {
    if (!snapshot) return null;
    if (kind === 'hydraulic') {
      return buildHydraulicComparison(snapshot, embeddedOptimizationOutput ?? sameProjectOptimization?.output ?? null);
    }
    if (kind === 'optimization') return buildOptimizationComparison(snapshot);
    if (kind === 'sensitivity') return buildSensitivityComparison(snapshot);
    return null;
  }, [embeddedOptimizationOutput, kind, sameProjectOptimization?.output, snapshot]);

  const verdict = useMemo(() => buildVerdict(kind, snapshot, report), [kind, report, snapshot]);
  const reasoningSteps = useMemo(
    () => buildReasoningSteps(kind, snapshot, report, comparison),
    [comparison, kind, report, snapshot],
  );
  const evidenceCompleteness = useMemo(() => {
    let score = 55;
    if (snapshot?.input && Object.keys(snapshot.input).length) score += 10;
    if (snapshot?.output && Object.keys(snapshot.output).length) score += 15;
    if (report.risks.length) score += 5;
    if (report.suggestions.length) score += 5;
    if (reasoningSteps.length >= 3) score += 5;
    if (comparison) score += 5;
    return Math.min(score, 100);
  }, [comparison, reasoningSteps.length, report.risks.length, report.suggestions.length, snapshot?.input, snapshot?.output]);
  const projectId = getProjectId(report);
  const projectName = snapshot?.projectName || String(firstValue(getReportRequest(report), ['project_names.0']) ?? '当前项目');
  const reportNumber = useMemo(() => {
    const prefix = kind === 'hydraulic' ? 'H' : kind === 'optimization' ? 'O' : kind === 'sensitivity' ? 'S' : 'A';
    const date = new Date(snapshot?.generatedAt || Date.now());
    const stamp = Number.isNaN(date.getTime())
      ? String(Date.now()).slice(-8)
      : `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    return `OPS-${prefix}-${stamp}`;
  }, [kind, snapshot?.generatedAt]);

  const suggestions = report.suggestions.length
    ? report.suggestions.slice(0, 4)
    : [{
        target: projectName,
        reason: verdict.detail,
        action: kind === 'optimization' ? '复核推荐泵组并确认运行边界。' : '进入对应计算模块复核关键工况。',
        expected: '形成可执行、可复核的运行方案。',
        priority: 'medium',
      }];

  const quickQuestions = useMemo(() => {
    const base = ['为什么得到这个结论？', '下一步最应该做什么？', '本次报告最大的风险是什么？'];
    if (comparison) base.splice(1, 0, '优化后具体能改善多少？');
    return base.slice(0, 4);
  }, [comparison]);

  const handleAsk = async (nextQuestion = question) => {
    const promptQuestion = nextQuestion.trim();
    if (!promptQuestion || asking) return;
    setQuestion(promptQuestion);
    setAsking(true);
    setAnswer('');

    const context = {
      // 保留完整报告对象，而不是只发送摘要，便于 AI 回答章节、指标和原始计算数据问题。
      fullReport: report,
      calculationSnapshot: snapshot ?? null,
      title: report.title,
      kind: REPORT_KIND_LABELS[kind],
      projectName,
      conclusion: report.conclusion,
      summary: report.summary.slice(0, 4),
      highlights: report.highlights.slice(0, 4),
      risks: report.risks.slice(0, 4),
      suggestions: report.suggestions.slice(0, 4),
      reasoningSteps,
      comparison,
    };

    try {
      const payload = await Promise.race([
        agentApi.chat(
          promptQuestion,
          sessionIdRef.current,
          { mode: 'report', context },
        ),
        // Agent 端可能需要调用数据库、知识库或水力工具，7 秒容易把正常响应误判为失败。
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 30000)),
      ]);
      const aiAnswer = payload ? extractAnswer(payload) : '';
      if (aiAnswer) {
        setAnswer(aiAnswer);
      } else {
        setAnswer('AI 服务暂时没有返回结果。请确认智能体服务已启动后重试；本次未使用固定规则代替回答。');
        message.warning('AI 服务响应超时或返回为空，请稍后重试。');
      }
    } catch {
      setAnswer('AI 服务暂不可用，请确认智能体服务和模型配置正常后重试。本次未使用固定规则代替回答。');
      message.warning('AI 服务暂不可用，未生成兜底答案。');
    } finally {
      setAsking(false);
    }
  };

  const handleAction = (item: DynamicReportSuggestionItem, index: number) => {
    const nextKind = actionKind(item);
    if (nextKind === 'todo') {
      setCompletedActions((current) => (current.includes(index) ? current : [...current, index]));
      message.success('已加入本报告待办，可在调度令视图继续核对。');
      return;
    }

    const path = nextKind === 'optimization'
      ? '/calculation/optimization'
      : nextKind === 'sensitivity'
        ? '/calculation/sensitivity'
        : '/calculation/hydraulic';
    const prefill = {
      source: 'smart-report',
      projectId,
      projectName,
      input: sameProjectOptimization?.input ?? snapshot?.input ?? {},
      output: sameProjectOptimization?.output ?? snapshot?.output ?? {},
      recommendation: comparison?.afterPlan,
    };

    if (nextKind === 'optimization') {
      window.sessionStorage.setItem('smart-report-optimization-prefill', JSON.stringify(prefill));
    }
    navigate(path, { state: { smartReportPrefill: prefill } });
  };

  const verdictClassName = [
    styles.verdict,
    verdict.tone === 'warn' ? styles.verdictWarn : '',
    verdict.tone === 'danger' ? styles.verdictDanger : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={styles.shell}>
      <div style={{ display: 'grid', gap: 16 }}>
        <section className={styles.hero}>
          <div className={styles.heroMain}>
            <div>
              <div className={styles.eyebrow}>PIPELINE DECISION REPORT</div>
              <h2 className={styles.title}>{report.title}</h2>
              {report.abstract ? <p className={styles.abstract}>{report.abstract}</p> : null}
            </div>
            <div className={styles.sourceBadge}>{getSourceLabel(report.source)}</div>
          </div>
          <div className={styles.sourceStrip}>
            <span>报告编号 <strong>{reportNumber}</strong></span>
            <span>报告类型 <strong>{REPORT_KIND_LABELS[kind]}</strong></span>
            <span>项目 <strong>{projectName}</strong></span>
            <span>来源记录 <strong>{formatDateTime(snapshot?.generatedAt)}</strong></span>
            <span>证据链 <strong>计算结果 + 风险规则 + AI 解释</strong></span>
          </div>
        </section>

        <section className={styles.modeBar}>
          <div className={styles.modeCopy}>
            <strong>一份报告，三种使用形态</strong>
            <span>专业复核看完整报告，领导汇报看简报，现场执行看调度令。</span>
          </div>
          <div className={styles.modeTabs} role="tablist" aria-label="报告形态">
            {([
              ['full', '完整报告'],
              ['brief', '管理简报'],
              ['dispatch', '调度令'],
            ] as Array<[ReportMode, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                className={`${styles.modeButton} ${mode === value ? styles.modeButtonActive : ''}`}
                onClick={() => setMode(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className={verdictClassName}>
          <div className={styles.verdictWord}>{verdict.word}</div>
          <div className={styles.verdictText}>
            <strong>{verdict.title}</strong>
            <span>{verdict.detail}</span>
          </div>
          <div className={styles.confidence}>
            <strong>{evidenceCompleteness}%</strong>
            <span>证据完整度</span>
          </div>
        </section>

        <section className={styles.trace}>
          <button type="button" className={styles.traceButton} onClick={() => setTraceOpen((current) => !current)}>
            <span>为什么这么判（AI 推理链）</span>
            <span>{traceOpen ? '收起判定依据 ↑' : '展开判定依据 ↓'}</span>
          </button>
          {traceOpen ? (
            <div className={styles.traceBody}>
              {reasoningSteps.map((step, index) => (
                <div className={styles.traceStep} key={`${index}-${step}`}>
                  <span className={styles.traceNo}>{index + 1}</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        {comparison ? (
          <section className={styles.comparison}>
            <div className={styles.sectionTitle}>
              <strong>{comparison.title}</strong>
              <span>同口径计算结果</span>
            </div>
            <div className={styles.comparisonGrid}>
              <div className={styles.comparisonSide}>
                <div className={styles.comparisonLabel}>{comparison.beforeLabel}</div>
                <div className={styles.comparisonValue}>{comparison.beforeValue}</div>
                <div className={styles.comparisonPlan}>{comparison.beforePlan}</div>
              </div>
              <div className={styles.comparisonArrow} aria-hidden="true">
                →
                <span className={styles.savingBadge}>{comparison.badge}</span>
              </div>
              <div className={`${styles.comparisonSide} ${styles.comparisonAfter}`}>
                <div className={styles.comparisonLabel}>{comparison.afterLabel}</div>
                <div className={styles.comparisonValue}>{comparison.afterValue}</div>
                <div className={styles.comparisonPlan}>{comparison.afterPlan}</div>
              </div>
            </div>
            <div className={styles.comparisonMetrics}>
              {comparison.metrics.map((item) => (
                <div className={styles.comparisonMetric} key={item.label}>
                  {item.label}：<strong>{item.before}</strong> → <strong>{item.after}</strong>
                  {item.delta ? <>，<em>{item.delta}</em></> : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {mode === 'full' ? <div className={styles.fullContent}>{children}</div> : null}

        {mode === 'brief' ? (
          <section className={styles.briefGrid}>
            <div className={styles.briefCard}>
              <h3>一句话结论</h3>
              <ul className={styles.briefList}>
                <li>{report.conclusion || verdict.title}</li>
                <li>{verdict.detail}</li>
              </ul>
            </div>
            <div className={styles.briefCard}>
              <h3>关键发现</h3>
              <ul className={styles.briefList}>
                {(report.highlights.length ? report.highlights : report.summary).slice(0, 4).map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <div className={styles.briefCard}>
              <h3>主要风险</h3>
              <ul className={styles.briefList}>
                {(report.risks.length ? report.risks.map((item) => `${item.target}：${item.reason}`) : ['当前未识别到明确高风险项。'])
                  .slice(0, 4)
                  .map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <div className={styles.briefCard}>
              <h3>决策建议</h3>
              <ul className={styles.briefList}>
                {suggestions.slice(0, 4).map((item) => <li key={`${item.target}-${item.action}`}>{item.action || item.text}</li>)}
              </ul>
            </div>
          </section>
        ) : null}

        {mode === 'dispatch' ? (
          <section className={styles.dispatchCard}>
            <h3>调度执行清单</h3>
            <div className={styles.dispatchList}>
              {suggestions.map((item, index) => {
                const nextKind = actionKind(item);
                const completed = completedActions.includes(index);
                return (
                  <div className={`${styles.actionCard} ${completed ? styles.actionCardDone : ''}`} key={`${item.target}-${index}`}>
                    <div>
                      <div className={styles.actionMeta}>
                        <span className={styles.priority}>{priorityLabel(item.priority)}</span>
                        <span className={styles.actionType}>{nextKind === 'todo' ? '现场任务' : '联动分析'}</span>
                      </div>
                      <strong>{item.action || item.text || '复核当前运行方案'}</strong>
                      <p>原因：{item.reason || '基于本次报告结论需要继续验证。'}<br />预期：{item.expected || '完成方案闭环并保留复核证据。'}</p>
                    </div>
                    <button
                      type="button"
                      className={`${styles.actionButton} ${completed ? styles.actionButtonDone : ''}`}
                      onClick={() => handleAction(item, index)}
                      disabled={completed}
                    >
                      {completed ? '已加入待办 ✓' : actionLabel(nextKind)}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {mode !== 'dispatch' ? (
          <section className={styles.dispatchCard}>
            <h3>从建议直接进入行动</h3>
            <div className={styles.dispatchList}>
              {suggestions.slice(0, 3).map((item, index) => {
                const nextKind = actionKind(item);
                const completed = completedActions.includes(index);
                return (
                  <div className={`${styles.actionCard} ${completed ? styles.actionCardDone : ''}`} key={`${item.target}-${index}`}>
                    <div>
                      <div className={styles.actionMeta}>
                        <span className={styles.priority}>{priorityLabel(item.priority)}</span>
                        <span className={styles.actionType}>{nextKind === 'todo' ? '生成待办' : '系统联动'}</span>
                      </div>
                      <strong>{item.action || item.text || '复核当前运行方案'}</strong>
                      <p>{item.reason || '依据本次计算结果继续验证。'}</p>
                    </div>
                    <button
                      type="button"
                      className={`${styles.actionButton} ${completed ? styles.actionButtonDone : ''}`}
                      onClick={() => handleAction(item, index)}
                      disabled={completed}
                    >
                      {completed ? '已加入待办 ✓' : actionLabel(nextKind)}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        <section className={styles.questionPanel}>
          <div className={styles.questionHeader}>
            <div>
              <h3>在报告里继续追问</h3>
              <p>回答会携带本报告结论、关键数字、风险和建议，不需要跳转到聊天页。</p>
            </div>
            <span className={styles.questionStatus}>● 报告上下文已载入</span>
          </div>
          <div className={styles.quickQuestions}>
            {quickQuestions.map((item) => (
              <button key={item} type="button" className={styles.quickQuestion} disabled={asking} onClick={() => void handleAsk(item)}>
                {item}
              </button>
            ))}
          </div>
          {answer || asking ? <div className={styles.answer}>{asking ? '正在结合报告证据分析…' : answer}</div> : null}
          <div className={styles.askRow}>
            <input
              className={styles.askInput}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleAsk();
              }}
              placeholder="例如：为什么末站余压高还要降低泵扬程？"
              aria-label="追问当前报告"
            />
            <button type="button" className={styles.askButton} disabled={asking || !question.trim()} onClick={() => void handleAsk()}>
              {asking ? '分析中' : '追问 AI'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
