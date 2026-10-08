import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { EChartsOption } from 'echarts';
import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  EyeOutlined,
  FileTextOutlined,
  HistoryOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { calculationHistoryApi, projectApi } from '../../api';
import { agentApi } from '../../api/agent';
import AnimatedPage from '../../components/common/AnimatedPage';
import Chart from '../../components/common/Chart';
import {
  SENSITIVITY_REPORT_PAGE_COPY,
  type SensitivitySmartReportPayload,
} from '../../components/reporting/sensitivityReportSchema';
import { useCalculationLinkStore } from '../../stores/calculationLinkStore';
import type { CalculationHistory, PageResult, Project, R, SaveReportRequest } from '../../types';
import type { DynamicReportResponsePayload } from '../../types/agent';

const { Title, Paragraph, Text } = Typography;
const { RangePicker } = DatePicker;

type ReportType = 'AI_REPORT' | 'RISK_REVIEW' | 'ENERGY_DIAGNOSIS' | 'OPERATION_BRIEF';

type HistoryRow = CalculationHistory & {
  key: number;
};

type HistoryTableRow = HistoryRow & {
  projectNumber: string;
  responsible: string;
  calcTypeLabel: string;
  updateTimeText: string;
};

type AiReportHistoryRow = HistoryTableRow & {
  reportTitle: string;
  reportAbstract: string;
};

type DetailMetricTone = 'blue' | 'cyan' | 'green' | 'amber' | 'purple';

type DetailMetricCardItem = {
  label: string;
  value: string;
  tone?: DetailMetricTone;
  span?: number;
};

type DetailMetricCardRenderOptions = {
  equalWidth?: boolean;
  singleLine?: boolean;
  compact?: boolean;
  minColumnWidth?: number;
  minHeight?: number;
  valueFontSize?: CSSProperties['fontSize'];
};

type SensitivityDetailRow = {
  key: string;
  variableName: string;
  changePercent: string;
  endStationPressure: string;
  frictionHeadLoss: string;
  flowRegime: string;
  hydraulicSlope: string;
  reynoldsNumber: string;
};

type HydraulicReportSnapshot = {
  projectName?: string | null;
  generatedAt?: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
};

type OptimizationReportSnapshot = {
  projectName?: string | null;
  generatedAt?: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
};

type OptimizationComparisonProjectSnapshot = OptimizationReportSnapshot & {
  projectId: number | undefined;
  projectNumber: string | undefined;
  responsible: string | undefined;
};

type OptimizationComparisonReportSnapshot = {
  projects: OptimizationComparisonProjectSnapshot[];
};

type OptimizationComparisonProjectMetrics = {
  projectName: string;
  projectNumber: string;
  responsible: string;
  recommendedCombination: string;
  currentCondition: string;
  feasibilityText: string;
  recommendationText: string;
  totalHead: number | null;
  totalPressureDrop: number | null;
  endStationInPressure: number | null;
  totalEnergyConsumption: number | null;
  totalCost: number | null;
  isFeasible: boolean | null;
  riskLevel: string;
  comparisonScore: number;
};

type SensitivityReportSnapshot = {
  projectName?: string | null;
  generatedAt?: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
};

type ReportKind = 'hydraulic' | 'sensitivity' | 'optimization' | 'optimization-comparison' | 'generic';

type ReportProjectScope = {
  projectIds: number[];
  projectNames: string[];
};

type DetailPreviewState =
  | {
      mode: 'history';
      row: HistoryTableRow;
    }
  | {
      mode: 'generated';
      report: DynamicReportResponsePayload;
    }
  | null;

type ReportHistoryDetailLocationState = {
  row?: HistoryTableRow;
};

const ALL_CALC_TYPE_OPTION = '__ALL_CALC_TYPE__';
const DEFAULT_REPORT_TYPE: ReportType = 'AI_REPORT';

const ARCHIVED_REPORT_TYPES = new Set<ReportType>([
  'AI_REPORT',
  'RISK_REVIEW',
  'ENERGY_DIAGNOSIS',
  'OPERATION_BRIEF',
]);

const CALC_TYPE_LABELS: Record<string, string> = {
  HYDRAULIC: '水力分析',
  OPTIMIZATION: '泵站优化',
  SENSITIVITY: '敏感性分析',
  AI_REPORT: '智能报告',
  RISK_REVIEW: '风险复核',
  ENERGY_DIAGNOSIS: '能耗诊断',
  OPERATION_BRIEF: '运行简报',
};

const HYDRAULIC_REPORT_CORE_SENTENCE =
  '用真实水力计算结果做基础，用图表展示压头和扬程变化，再让 API 对雷诺数、流态、摩阻损失、总扬程和末站进站压头进行解释、判断和建议。';

const SENSITIVITY_REPORT_CORE_SENTENCE =
  '基于真实敏感性计算结果，重点分析变量变化对压力、摩阻损失和流态的影响程度，用敏感系数仪表盘、趋势图和风险结论告诉用户哪个变量最值得重点控制。';

const OPTIMIZATION_REPORT_CORE_SENTENCE =
  '基于真实优化结果，围绕推荐泵组合的可行性、压力保障能力、能耗水平和总成本进行解释和判断，告诉用户这个方案为什么被选中、能不能用、值不值得用。';

const cardStyle: CSSProperties = {
  borderRadius: 20,
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.08)',
};

const tableCardBodyStyle: CSSProperties = {
  padding: 0,
  overflow: 'hidden',
};

const tableHeaderCellStyle: CSSProperties = {
  background: '#edf4ff',
  color: '#7c8aa5',
  fontSize: 14,
  fontWeight: 600,
  padding: '14px 16px',
  borderBottom: '1px solid #e3edf9',
};

const tableCellStyle: CSSProperties = {
  padding: '18px 16px',
  color: '#334155',
  fontSize: 14,
  borderBottom: '1px solid #eef2f7',
  verticalAlign: 'top',
};

const detailSectionStyle: CSSProperties = {
  borderRadius: 24,
  border: '1px solid rgba(226, 232, 240, 0.95)',
  boxShadow: '0 12px 28px rgba(15, 23, 42, 0.06)',
};

const detailSectionBodyStyle: CSSProperties = {
  padding: 20,
};

const detailMetricToneMap: Record<
  DetailMetricTone,
  { background: string; border: string; label: string; value: string }
> = {
  blue: {
    background: 'linear-gradient(135deg, rgba(236, 245, 255, 0.98), rgba(243, 248, 255, 0.95))',
    border: 'rgba(196, 219, 255, 0.95)',
    label: '#4e86f7',
    value: '#1e3a8a',
  },
  cyan: {
    background: 'linear-gradient(135deg, rgba(235, 250, 255, 0.98), rgba(243, 252, 255, 0.95))',
    border: 'rgba(191, 236, 247, 0.95)',
    label: '#17a2c2',
    value: '#155e75',
  },
  green: {
    background: 'linear-gradient(135deg, rgba(237, 252, 245, 0.98), rgba(246, 255, 250, 0.95))',
    border: 'rgba(194, 240, 218, 0.95)',
    label: '#12b981',
    value: '#166534',
  },
  amber: {
    background: 'linear-gradient(135deg, rgba(255, 247, 230, 0.98), rgba(255, 252, 242, 0.95))',
    border: 'rgba(250, 226, 173, 0.95)',
    label: '#f59e0b',
    value: '#92400e',
  },
  purple: {
    background: 'linear-gradient(135deg, rgba(247, 240, 255, 0.98), rgba(252, 248, 255, 0.95))',
    border: 'rgba(225, 210, 255, 0.95)',
    label: '#a855f7',
    value: '#6b21a8',
  },
};

type MetricCardTone = {
  accent: string;
  accentSoft: string;
  iconBackground: string;
  iconColor: string;
  panelBackground: string;
  panelBorder: string;
};

const metricCardTones: MetricCardTone[] = [
  {
    accent: '#77A7FF',
    accentSoft: 'rgba(119, 167, 255, 0.45)',
    iconBackground: 'linear-gradient(135deg, rgba(224, 236, 255, 0.95), rgba(238, 244, 255, 0.88))',
    iconColor: '#4E86F7',
    panelBackground: 'rgba(231, 241, 255, 0.92)',
    panelBorder: 'rgba(195, 217, 255, 0.9)',
  },
  {
    accent: '#55CDE2',
    accentSoft: 'rgba(85, 205, 226, 0.42)',
    iconBackground: 'linear-gradient(135deg, rgba(223, 247, 251, 0.95), rgba(237, 252, 255, 0.88))',
    iconColor: '#18B6D2',
    panelBackground: 'rgba(229, 250, 255, 0.9)',
    panelBorder: 'rgba(193, 237, 245, 0.92)',
  },
  {
    accent: '#7ADEBA',
    accentSoft: 'rgba(122, 222, 186, 0.42)',
    iconBackground: 'linear-gradient(135deg, rgba(228, 251, 242, 0.95), rgba(242, 255, 248, 0.9))',
    iconColor: '#1CCF8A',
    panelBackground: 'rgba(234, 254, 245, 0.9)',
    panelBorder: 'rgba(198, 241, 223, 0.92)',
  },
  {
    accent: '#FFCC72',
    accentSoft: 'rgba(255, 204, 114, 0.42)',
    iconBackground: 'linear-gradient(135deg, rgba(255, 245, 214, 0.96), rgba(255, 250, 236, 0.9))',
    iconColor: '#F59E0B',
    panelBackground: 'rgba(255, 250, 229, 0.92)',
    panelBorder: 'rgba(250, 227, 164, 0.94)',
  },
];

function MetricBars({ color }: { color: string }) {
  const heights = [24, 34, 28, 46];

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, paddingBottom: 4 }}>
      {heights.map((height, index) => (
        <span
          key={`${color}-${height}`}
          style={{
            width: 8,
            height,
            borderRadius: 999,
            background: color,
            opacity: 0.35 + index * 0.15,
          }}
        />
      ))}
    </div>
  );
}

type MetricCardProps = {
  icon: ReactNode;
  statistic: ReactElement<{ title?: ReactNode; value?: ReactNode }>;
  tone: MetricCardTone;
};

function MetricCard({ icon, statistic, tone }: MetricCardProps) {
  return (
    <Card
      style={{
        ...cardStyle,
        height: '100%',
        border: '1px solid rgba(226, 232, 240, 0.9)',
      }}
      bodyStyle={{ padding: 24 }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <Text
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: '#7c8aa5',
              letterSpacing: '0.02em',
            }}
          >
            {statistic.props.title}
          </Text>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 18,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: tone.iconBackground,
              color: tone.iconColor,
              boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.78)',
              fontSize: 28,
            }}
          >
            {icon}
          </div>
        </div>

        <div
          style={{
            borderRadius: 22,
            border: `1px solid ${tone.panelBorder}`,
            background: `linear-gradient(135deg, rgba(255, 255, 255, 0.96), ${tone.panelBackground})`,
            boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.92), 0 10px 24px rgba(15, 23, 42, 0.04)',
            padding: '24px 22px 18px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
            <div
              style={{
                fontSize: 54,
                fontWeight: 700,
                lineHeight: 1,
                color: '#0f172a',
                letterSpacing: '-0.04em',
              }}
            >
              {statistic.props.value}
            </div>
            <MetricBars color={tone.accent} />
          </div>

          <div
            style={{
              height: 4,
              marginTop: 18,
              borderRadius: 999,
              background: `linear-gradient(90deg, ${tone.accentSoft}, rgba(255, 255, 255, 0))`,
            }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {[0.48, 0.72, 0.96].map((opacity, index) => (
            <span
              key={`${tone.accent}-${index}`}
              style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: tone.accent,
                opacity,
              }}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}

async function fetchAllPagedList<T>(
  requestPage: (pageNum: number, pageSize: number) => Promise<R<PageResult<T>>>,
  pageSize = 100,
  maxPages = 20,
) {
  const records: T[] = [];
  for (let pageNum = 1; pageNum <= maxPages; pageNum += 1) {
    const response = await requestPage(pageNum, pageSize);
    const pageData = response.data;
    const list = Array.isArray(pageData?.list) ? pageData.list : [];
    records.push(...list);
    if (list.length < pageSize || records.length >= Number(pageData?.total ?? list.length)) {
      break;
    }
  }
  return records;
}

function formatTime(value?: string) {
  if (!value) {
    return '-';
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm:ss') : value;
}

function toHistoryTableRow(item: CalculationHistory, projectLookup: Map<number, Project>): HistoryTableRow {
  const project = projectLookup.get(Number(item.projectId));

  return {
    ...item,
    key: item.id,
    projectNumber: project?.number || (item.projectId ? String(item.projectId) : '-'),
    responsible: project?.responsible || item.userName || '-',
    calcTypeLabel: getDisplayCalcTypeLabel(item),
    updateTimeText: formatTime(item.createTime),
  };
}

function parseJson(value?: string) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item));
}

function getValueByPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (Array.isArray(current)) {
      return /^\d+$/.test(key) ? current[Number(key)] : undefined;
    }

    if (typeof current === 'object') {
      return (current as Record<string, unknown>)[key];
    }

    return undefined;
  }, source);
}

function pickFirstValue(sources: unknown[], paths: string[]): unknown {
  for (const source of sources) {
    for (const path of paths) {
      const value = getValueByPath(source, path);
      if (value !== undefined && value !== null && value !== '') {
        return value;
      }
    }
  }
  return undefined;
}

function formatValue(value: unknown, unit?: string) {
  if (value === undefined || value === null || value === '') {
    return '-';
  }

  if (typeof value === 'boolean') {
    return value ? '是' : '否';
  }

  if (typeof value === 'number') {
    const normalized = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
    return unit ? `${normalized} ${unit}` : normalized;
  }

  if (typeof value === 'string') {
    return unit && value !== '-' ? `${value} ${unit}` : value;
  }

  return JSON.stringify(value);
}

function toFiniteNumber(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim() : value;
  if (normalized === '' || normalized === null || normalized === undefined) {
    return null;
  }
  const next = Number(normalized);
  return Number.isFinite(next) ? next : null;
}

function parseBooleanValue(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value > 0 : null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', '是', '可行', '可用', '1'].includes(normalized)) {
      return true;
    }
    if (['false', 'no', '否', '不可行', '不可用', '0'].includes(normalized)) {
      return false;
    }
  }
  return null;
}

function buildHydraulicSnapshot(input: unknown, output: unknown, projectName?: string | null, generatedAt?: string | null) {
  const inputRecord = asRecord(input);
  const outputRecord = asRecord(output);
  if (!inputRecord || !outputRecord) {
    return null;
  }

  return {
    projectName: projectName ?? null,
    generatedAt: generatedAt ?? null,
    input: inputRecord,
    output: outputRecord,
  } satisfies HydraulicReportSnapshot;
}

function buildHydraulicSnapshotFromHistory(record?: Pick<HistoryTableRow, 'projectName' | 'createTime' | 'inputParams' | 'outputResult'> | null) {
  if (!record) {
    return null;
  }

  const parsedOutput = parseJson(record.outputResult);
  const outputRecord = asRecord(getValueByPath(parsedOutput, 'data')) ?? asRecord(parsedOutput);
  return buildHydraulicSnapshot(parseJson(record.inputParams), outputRecord, record.projectName, record.createTime);
}

function buildHydraulicSnapshotFromLinkedRecord(record?: {
  projectName?: string | null;
  updatedAt?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
} | null) {
  if (!record) {
    return null;
  }

  return buildHydraulicSnapshot(record.input, record.output, record.projectName, record.updatedAt);
}

function extractHydraulicSnapshotFromReport(report: DynamicReportResponsePayload) {
  const metadata = asRecord(report.metadata);
  return buildHydraulicSnapshot(
    getValueByPath(metadata, 'hydraulicSnapshot.input'),
    getValueByPath(metadata, 'hydraulicSnapshot.output'),
    typeof getValueByPath(metadata, 'hydraulicSnapshot.projectName') === 'string'
      ? String(getValueByPath(metadata, 'hydraulicSnapshot.projectName'))
      : null,
    typeof getValueByPath(metadata, 'hydraulicSnapshot.generatedAt') === 'string'
      ? String(getValueByPath(metadata, 'hydraulicSnapshot.generatedAt'))
      : null,
  );
}

function createOptimizationReportSnapshot(
  input: unknown,
  output: unknown,
  projectName?: string | null,
  generatedAt?: string | null,
) {
  const inputRecord = asRecord(input);
  const outputRecord = asRecord(output);
  if (!inputRecord || !outputRecord) {
    return null;
  }

  return {
    projectName: projectName ?? null,
    generatedAt: generatedAt ?? null,
    input: inputRecord,
    output: outputRecord,
  } satisfies OptimizationReportSnapshot;
}

function createOptimizationReportSnapshotFromHistory(
  record?: Pick<HistoryTableRow, 'projectName' | 'createTime' | 'inputParams' | 'outputResult'> | null,
) {
  if (!record) {
    return null;
  }

  const parsedOutput = parseJson(record.outputResult);
  const outputRecord = asRecord(getValueByPath(parsedOutput, 'data')) ?? asRecord(parsedOutput);
  return createOptimizationReportSnapshot(parseJson(record.inputParams), outputRecord, record.projectName, record.createTime);
}

function createOptimizationReportSnapshotFromLinkedRecord(record?: {
  projectName?: string | null;
  updatedAt?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
} | null) {
  if (!record) {
    return null;
  }

  return createOptimizationReportSnapshot(record.input, record.output, record.projectName, record.updatedAt);
}

function extractOptimizationSnapshotFromReport(report: DynamicReportResponsePayload) {
  const metadata = asRecord(report.metadata);
  return createOptimizationReportSnapshot(
    getValueByPath(metadata, 'optimizationSnapshot.input'),
    getValueByPath(metadata, 'optimizationSnapshot.output'),
    typeof getValueByPath(metadata, 'optimizationSnapshot.projectName') === 'string'
      ? String(getValueByPath(metadata, 'optimizationSnapshot.projectName'))
      : null,
    typeof getValueByPath(metadata, 'optimizationSnapshot.generatedAt') === 'string'
      ? String(getValueByPath(metadata, 'optimizationSnapshot.generatedAt'))
      : null,
  );
}

function createOptimizationComparisonProjectSnapshot(
  input: unknown,
  output: unknown,
  projectName?: string | null,
  generatedAt?: string | null,
  projectId?: number,
  projectNumber?: string,
  responsible?: string,
) {
  const baseSnapshot = createOptimizationReportSnapshot(input, output, projectName, generatedAt);
  if (!baseSnapshot) {
    return null;
  }

  return {
    ...baseSnapshot,
    projectId,
    projectNumber,
    responsible,
  } satisfies OptimizationComparisonProjectSnapshot;
}

function createOptimizationComparisonProjectSnapshotFromHistory(
  record?: Pick<
    HistoryTableRow,
    | 'projectName'
    | 'createTime'
    | 'inputParams'
    | 'outputResult'
    | 'projectId'
    | 'projectNumber'
    | 'responsible'
  > | null,
) {
  if (!record) {
    return null;
  }

  const parsedOutput = parseJson(record.outputResult);
  const outputRecord = asRecord(getValueByPath(parsedOutput, 'data')) ?? asRecord(parsedOutput);
  const projectId =
    typeof record.projectId === 'number'
      ? record.projectId
      : typeof record.projectId === 'string'
        ? Number(record.projectId)
        : undefined;

  return createOptimizationComparisonProjectSnapshot(
    parseJson(record.inputParams),
    outputRecord,
    record.projectName,
    record.createTime,
    Number.isFinite(projectId) ? projectId : undefined,
    record.projectNumber,
    record.responsible,
  );
}

function normalizeOptimizationComparisonProjectSnapshot(
  snapshot: OptimizationComparisonProjectSnapshot,
): OptimizationComparisonProjectSnapshot {
  return {
    ...snapshot,
    projectName: snapshot.projectName ?? null,
    generatedAt: snapshot.generatedAt ?? null,
    input: snapshot.input ?? {},
    output: snapshot.output ?? {},
    projectId: snapshot.projectId,
    projectNumber: snapshot.projectNumber ?? undefined,
    responsible: snapshot.responsible ?? undefined,
  };
}

function extractOptimizationComparisonSnapshotFromReport(report: DynamicReportResponsePayload) {
  const metadata = asRecord(report.metadata);
  const rawProjects = getValueByPath(metadata, 'optimizationComparisonSnapshot.projects');
  if (!Array.isArray(rawProjects)) {
    return null;
  }

  const projects = rawProjects
    .map((project) => {
      const projectRecord = asRecord(project);
      if (!projectRecord) {
        return null;
      }

      return createOptimizationComparisonProjectSnapshot(
        getValueByPath(projectRecord, 'input'),
        getValueByPath(projectRecord, 'output'),
        typeof projectRecord.projectName === 'string' ? projectRecord.projectName : null,
        typeof projectRecord.generatedAt === 'string' ? projectRecord.generatedAt : null,
        typeof projectRecord.projectId === 'number' ? projectRecord.projectId : undefined,
        typeof projectRecord.projectNumber === 'string' ? projectRecord.projectNumber : undefined,
        typeof projectRecord.responsible === 'string' ? projectRecord.responsible : undefined,
      );
    })
    .filter(Boolean)
    .map((item) => normalizeOptimizationComparisonProjectSnapshot(item as OptimizationComparisonProjectSnapshot));

  return projects.length >= 2
    ? ({
        projects,
      } satisfies OptimizationComparisonReportSnapshot)
    : null;
}

function buildOptimizationComparisonRiskLevel(metrics: {
  isFeasible: boolean | null;
  totalCost: number | null;
  totalEnergyConsumption: number | null;
  endStationInPressure: number | null;
  totalPressureDrop: number | null;
  totalHead: number | null;
}) {
  if (metrics.isFeasible === false) {
    return '高';
  }

  const highSignals = [
    metrics.endStationInPressure !== null && metrics.endStationInPressure < 20,
    metrics.totalEnergyConsumption !== null && metrics.totalEnergyConsumption > 2000,
    metrics.totalCost !== null && metrics.totalCost > 6000,
  ];

  if (highSignals.some(Boolean)) {
    return '高';
  }

  const mediumSignals = [
    metrics.totalPressureDrop !== null && metrics.totalPressureDrop > 250,
    metrics.totalHead !== null && metrics.totalHead > 350,
  ];

  if (mediumSignals.some(Boolean)) {
    return '中';
  }

  if (metrics.isFeasible === true) {
    return '低';
  }

  return '待判定';
}

function getOptimizationRiskPriority(level: string) {
  if (level === '高') {
    return 0;
  }
  if (level === '中') {
    return 1;
  }
  if (level === '低') {
    return 2;
  }
  return 3;
}

function buildOptimizationComparisonProjectMetrics(
  snapshot: OptimizationComparisonProjectSnapshot,
): OptimizationComparisonProjectMetrics {
  const outputSources = [snapshot.output];
  const totalHead = toFiniteNumber(pickFirstValue(outputSources, ['totalHead']));
  const totalPressureDrop = toFiniteNumber(pickFirstValue(outputSources, ['totalPressureDrop', 'pressureDrop']));
  const endStationInPressure = toFiniteNumber(pickFirstValue(outputSources, ['endStationInPressure', 'inPressure']));
  const totalEnergyConsumption = toFiniteNumber(pickFirstValue(outputSources, ['totalEnergyConsumption', 'energyConsumption']));
  const totalCost = toFiniteNumber(pickFirstValue(outputSources, ['totalCost', 'cost']));
  const isFeasible = parseBooleanValue(pickFirstValue(outputSources, ['isFeasible', 'feasible', 'feasibility']));
  const recommendationText =
    formatValue(pickFirstValue(outputSources, ['description', 'recommendation', 'remark'])) || '当前数据不足以支持进一步判断';
  const feasibilityText =
    typeof pickFirstValue(outputSources, ['feasibilityText']) === 'string'
      ? String(pickFirstValue(outputSources, ['feasibilityText']))
      : isFeasible === null
        ? '待判定'
        : isFeasible
          ? '可行'
          : '不可行';

  const metrics = {
    projectName: snapshot.projectName || '未命名项目',
    projectNumber: snapshot.projectNumber || '-',
    responsible: snapshot.responsible || '-',
    recommendedCombination: buildOptimizationPumpCombination(outputSources),
    currentCondition: buildOptimizationCurrentCondition(snapshot.input),
    feasibilityText,
    recommendationText,
    totalHead,
    totalPressureDrop,
    endStationInPressure,
    totalEnergyConsumption,
    totalCost,
    isFeasible,
    riskLevel: '待判定',
    comparisonScore: 0,
  } satisfies OptimizationComparisonProjectMetrics;

  metrics.riskLevel = buildOptimizationComparisonRiskLevel(metrics);
  return metrics;
}

function attachOptimizationComparisonScores(items: OptimizationComparisonProjectMetrics[]) {
  const safeMax = (values: number[]) => (values.length ? Math.max(...values) : 1);
  const safeMin = (values: number[]) => (values.length ? Math.min(...values) : 0);
  const headValues = items.map((item) => item.totalHead ?? 0);
  const pressureDropValues = items.map((item) => item.totalPressureDrop ?? 0);
  const pressureValues = items.map((item) => item.endStationInPressure ?? 0);
  const energyValues = items.map((item) => item.totalEnergyConsumption ?? 0);
  const costValues = items.map((item) => item.totalCost ?? 0);

  const maxHead = safeMax(headValues);
  const maxPressureDrop = safeMax(pressureDropValues);
  const maxPressure = safeMax(pressureValues);
  const maxEnergy = safeMax(energyValues);
  const maxCost = safeMax(costValues);
  const minEnergy = safeMin(energyValues);
  const minCost = safeMin(costValues);

  return items.map((item) => {
    const feasibilityScore = item.isFeasible === false ? 0 : item.isFeasible === true ? 30 : 18;
    const energyScore =
      item.totalEnergyConsumption === null || maxEnergy === minEnergy
        ? 12
        : 20 * (1 - (item.totalEnergyConsumption - minEnergy) / (maxEnergy - minEnergy));
    const costScore =
      item.totalCost === null || maxCost === minCost ? 15 : 25 * (1 - (item.totalCost - minCost) / (maxCost - minCost));
    const pressureScore = maxPressure === 0 ? 8 : 15 * ((item.endStationInPressure ?? 0) / maxPressure);
    const headScore = maxHead === 0 ? 3 : 5 * ((item.totalHead ?? 0) / maxHead);
    const dropPenalty = maxPressureDrop === 0 ? 0 : 5 * ((item.totalPressureDrop ?? 0) / maxPressureDrop);
    const riskPenalty = item.riskLevel === '高' ? 15 : item.riskLevel === '中' ? 8 : item.riskLevel === '低' ? 4 : 6;

    const rawScore = feasibilityScore + energyScore + costScore + pressureScore + headScore - dropPenalty - riskPenalty;
    return {
      ...item,
      comparisonScore: Number.isFinite(rawScore) ? Number(rawScore.toFixed(1)) : 0,
    } satisfies OptimizationComparisonProjectMetrics;
  });
}

function buildPumpDisplay(sources: unknown[]) {
  const pump480Num = pickFirstValue(sources, ['pump480Num']);
  const pump375Num = pickFirstValue(sources, ['pump375Num']);
  const pump480Head = pickFirstValue(sources, ['pump480Head']);
  const pump375Head = pickFirstValue(sources, ['pump375Head']);

  const parts: string[] = [];
  if (pump480Num !== undefined || pump480Head !== undefined) {
    parts.push(`480 泵 ${formatValue(pump480Num)} 台 / ${formatValue(pump480Head, 'm')}`);
  }
  if (pump375Num !== undefined || pump375Head !== undefined) {
    parts.push(`375 泵 ${formatValue(pump375Num)} 台 / ${formatValue(pump375Head, 'm')}`);
  }

  return parts.length ? parts.join('；') : '-';
}

function buildPumpCountDisplay(sources: unknown[]) {
  const pump480Num = pickFirstValue(sources, ['pump480Num']);
  const pump375Num = pickFirstValue(sources, ['pump375Num']);

  const parts: string[] = [];
  if (pump480Num !== undefined) {
    parts.push(`480 泵 ${formatValue(pump480Num)} 台`);
  }
  if (pump375Num !== undefined) {
    parts.push(`375 泵 ${formatValue(pump375Num)} 台`);
  }

  return parts.length ? parts.join('；') : '-';
}

function buildPumpHeadDisplay(sources: unknown[]) {
  const pump480Head = pickFirstValue(sources, ['pump480Head']);
  const pump375Head = pickFirstValue(sources, ['pump375Head']);

  const parts: string[] = [];
  if (pump480Head !== undefined) {
    parts.push(`480 泵 ${formatValue(pump480Head, 'm')}`);
  }
  if (pump375Head !== undefined) {
    parts.push(`375 泵 ${formatValue(pump375Head, 'm')}`);
  }

  return parts.length ? parts.join('；') : '-';
}

function buildHydraulicElevationDisplay(sources: unknown[]) {
  const startAltitude = formatValue(pickFirstValue(sources, ['startAltitude']), 'm');
  const endAltitude = formatValue(pickFirstValue(sources, ['endAltitude']), 'm');
  return `起点 ${startAltitude} / 终点 ${endAltitude}`;
}

function buildHydraulicPumpParameterDisplay(sources: unknown[]) {
  const pump480Num = pickFirstValue(sources, ['pump480Num']);
  const pump375Num = pickFirstValue(sources, ['pump375Num']);
  const pump480Head = pickFirstValue(sources, ['pump480Head']);
  const pump375Head = pickFirstValue(sources, ['pump375Head']);

  const parts: string[] = [];
  if (pump480Num !== undefined || pump480Head !== undefined) {
    parts.push(`480 泵 ${formatValue(pump480Num)} 台 / ${formatValue(pump480Head, 'm')}`);
  }
  if (pump375Num !== undefined || pump375Head !== undefined) {
    parts.push(`375 泵 ${formatValue(pump375Num)} 台 / ${formatValue(pump375Head, 'm')}`);
  }

  return parts.length ? parts.join('；') : '-';
}

function buildHydraulicUserPrompt() {
  return [
    '你是一名管道水力分析专家。请基于当前真实水力计算结果、规则诊断结果和图表事实生成水力分析智能报告。',
    '要求：只能基于输入事实分析，不得编造未提供的数据或结论。',
    '报告结构要服务于专业报告页面，而不是模板化总结页。',
    '请重点突出项目名称、计算类型、更新时间，其他如负责人、编号、备注只能弱化提及。',
    '参数区要拆成两层：核心参数卡只强调流量、密度、管径、粗糙度；补充参数区用紧凑表格说明粘度、长度、高程、泵参数。',
    '结果区只重点突出总扬程、摩阻损失、末站进站压头；雷诺数、流态、水力坡降只作为次级信息。',
    '图表分析区必须包含两张图旁说明：压头变化图对应“压头变化解读”，扬程构成图对应“扬程构成解读”。每个解读都固定按“图表现象 / 运行判断 / 关注重点”三段展开，解释必须紧贴当前数据。',
    '底部结论区固定分为左右双栏：左边风险识别，按对象、等级、原因、影响输出；右边运行建议，按建议、原因、预期效果三段式输出。',
    '请重点解释摩阻损失、总扬程、末站进站压头之间的关系，并指出当前最值得关注的风险与下一步动作。',
    `最重要的一句话请围绕这层意思展开：${HYDRAULIC_REPORT_CORE_SENTENCE}`,
  ].join('');
}

function buildOptimizationPumpCombination(sources: unknown[]) {
  const pump480Num = toFiniteNumber(pickFirstValue(sources, ['pump480Num']));
  const pump375Num = toFiniteNumber(pickFirstValue(sources, ['pump375Num']));
  const parts: string[] = [];

  if (pump480Num !== null && pump480Num > 0) {
    parts.push(`480 泵 ${pump480Num} 台`);
  }
  if (pump375Num !== null && pump375Num > 0) {
    parts.push(`375 泵 ${pump375Num} 台`);
  }

  return parts.length ? parts.join(' + ') : '当前数据不足以支持进一步判断';
}

function buildOptimizationCurrentCondition(inputPayload: Record<string, unknown>) {
  const sources = [inputPayload];
  const parts = [
    `流量 ${formatValue(pickFirstValue(sources, ['flowRate']), 'm3/h')}`,
    `密度 ${formatValue(pickFirstValue(sources, ['density']), 'kg/m3')}`,
    `管径 ${formatValue(pickFirstValue(sources, ['diameter']), 'mm')}`,
    `首站进站压头 ${formatValue(pickFirstValue(sources, ['inletPressure']), 'm')}`,
  ].filter((item) => !item.includes('-'));

  return parts.length ? parts.join('，') : '当前数据不足以支持进一步判断';
}

function buildOptimizationUserPrompt() {
  return [
    '请基于真实泵站优化结果数据生成泵站优化智能报告，并严格按照以下结构输出：',
    '1. 报告标题。',
    '2. 报告说明，说明本报告基于当前项目泵站优化计算结果自动生成，主要分析推荐泵组为什么被选中、该方案是否具备水力可行性，以及该方案的能耗与成本表现。',
    '3. 顶部推荐方案总览，重点突出推荐泵组、末站进站压头、总扬程、年能耗、总成本。',
    '4. 图表分析区固定三行：第一行左侧为推荐方案主卡，右侧为方案解读；第二行左侧为扬程分配图，右侧为水力可行性解读；第三行左侧为双指标概览卡（展示年能耗与总成本），右侧为经济性解读。',
    '5. 底部结论区固定左右双栏：左侧为风险识别，按对象、等级、原因、影响输出；右侧为优化建议，按建议、原因、预期效果输出。',
    '6. 报告要重点回答三件事：为什么是这组泵、为什么这个方案可行、为什么这个方案相对更经济。',
    '只能依据输入数据分析，不允许编造不存在的数据；若数据不足，请明确说明“当前数据不足以支持进一步判断”。',
    `最核心的一句话请围绕这层意思展开：${OPTIMIZATION_REPORT_CORE_SENTENCE}`,
  ].join('');
}

function buildOptimizationComparisonSmartPrompt(snapshot: OptimizationComparisonReportSnapshot) {
  const projectNames = snapshot.projects
    .map((project) => project.projectName)
    .filter((name): name is string => Boolean(name))
    .join('、');
  return [
    '请基于真实泵站优化结果数据生成多项目泵站优化对比智能报告，要求智能化表达，不要固定模板格式。',
    '这是一份对比报告，需要判断多个项目的优劣与风险差异，给出排序和理由。',
    projectNames ? `对比项目包括：${projectNames}。` : '',
    '请结合可行性、末站进站压头、总扬程、总能耗、总成本、推荐泵组合与风险表现进行综合判断。',
    '允许根据数据差异自动调整分析结构，但不要虚构任何不存在的数据。',
    '如数据不足，请明确说明“当前数据不足以支持进一步判断”。',
  ]
    .filter(Boolean)
    .join('');
}

function buildSensitivityUserPrompt() {
  return [
    '请基于真实敏感性分析数据生成敏感性分析智能报告。',
    '允许根据当前数据特点动态组织分析结构，不要写成固定模板，也不要只做参数拼接。',
    '优先解释最敏感变量、基准工况、变化趋势、区间边界、末站压力极值、摩阻变化和流态切换。',
    '当某类风险没有出现时，应明确说明“当前区间整体可控”，而不是硬凑风险条目。',
    '如果存在明显高风险区间，要指出触发区间、触发指标和下一步最应该复核的内容。',
    '只能依据输入数据分析，不允许编造不存在的数据；若数据不足，请明确说明当前数据不足以支持进一步判断。',
    `最核心的一句话请围绕这层意思展开：${SENSITIVITY_REPORT_CORE_SENTENCE}`,
  ].join('');
}

function createSensitivityReportSnapshot(
  input: unknown,
  output: unknown,
  projectName?: string | null,
  generatedAt?: string | null,
) {
  const inputRecord = asRecord(input);
  const outputRecord = asRecord(output);
  if (!inputRecord || !outputRecord) {
    return null;
  }

  return {
    projectName: projectName ?? null,
    generatedAt: generatedAt ?? null,
    input: inputRecord,
    output: outputRecord,
  } satisfies SensitivityReportSnapshot;
}

function createSensitivityReportSnapshotFromHistory(
  record?: Pick<HistoryTableRow, 'projectName' | 'createTime' | 'inputParams' | 'outputResult'> | null,
) {
  if (!record) {
    return null;
  }

  const parsedOutput = parseJson(record.outputResult);
  const outputRecord = asRecord(getValueByPath(parsedOutput, 'data')) ?? asRecord(parsedOutput);
  return createSensitivityReportSnapshot(parseJson(record.inputParams), outputRecord, record.projectName, record.createTime);
}

function createSensitivityReportSnapshotFromLinkedRecord(record?: {
  projectName?: string | null;
  updatedAt?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
} | null) {
  if (!record) {
    return null;
  }

  return createSensitivityReportSnapshot(record.input, record.output, record.projectName, record.updatedAt);
}

function extractSensitivityReportSnapshotFromReport(report: DynamicReportResponsePayload) {
  const metadata = asRecord(report.metadata);
  return createSensitivityReportSnapshot(
    getValueByPath(metadata, 'sensitivitySnapshot.input'),
    getValueByPath(metadata, 'sensitivitySnapshot.output'),
    typeof getValueByPath(metadata, 'sensitivitySnapshot.projectName') === 'string'
      ? String(getValueByPath(metadata, 'sensitivitySnapshot.projectName'))
      : null,
    typeof getValueByPath(metadata, 'sensitivitySnapshot.generatedAt') === 'string'
      ? String(getValueByPath(metadata, 'sensitivitySnapshot.generatedAt'))
      : null,
  );
}

function classifySensitivityImpactLevel(value: number | null) {
  if (value === null) {
    return '当前数据不足以支持进一步判断';
  }
  if (value >= 0.8) {
    return '较强';
  }
  if (value >= 0.4) {
    return '中等';
  }
  return '较弱';
}

function toSortedSensitivityRankingRows(output: Record<string, unknown>) {
  return asRecordArray(getValueByPath(output, 'sensitivityRanking')).sort((a, b) => {
    const rankA = toFiniteNumber(a.rank);
    const rankB = toFiniteNumber(b.rank);
    if (rankA !== null && rankB !== null) {
      return rankA - rankB;
    }
    const scoreA = toFiniteNumber(a.sensitivityCoefficient) ?? -Infinity;
    const scoreB = toFiniteNumber(b.sensitivityCoefficient) ?? -Infinity;
    return scoreB - scoreA;
  });
}

function getSensitivityPrimaryVariableResult(output: Record<string, unknown>) {
  const variableResults = asRecordArray(getValueByPath(output, 'variableResults'));
  if (!variableResults.length) {
    return null;
  }

  const rankingRows = toSortedSensitivityRankingRows(output);
  const topRank = rankingRows[0];
  if (!topRank) {
    return variableResults[0];
  }

  return (
    variableResults.find((item) => String(item.variableType ?? '') === String(topRank.variableType ?? '')) ?? variableResults[0]
  );
}

function buildSensitivityBaseCondition(inputPayload: Record<string, unknown>, inputBase: Record<string, unknown> | null) {
  const sources = [inputBase, inputPayload];
  const parts = [
    `流量 ${formatValue(pickFirstValue(sources, ['flowRate']), 'm³/h')}`,
    `密度 ${formatValue(pickFirstValue(sources, ['density']), 'kg/m³')}`,
    `管径 ${formatValue(pickFirstValue(sources, ['diameter']), 'mm')}`,
  ].filter((item) => !item.includes('-'));

  return parts.length ? parts.join('，') : '当前数据不足以支持进一步判断';
}

function evaluateSensitivityRiskLevel(params: {
  sensitivityCoefficient: number | null;
  maxImpactPercent: number | null;
  minEndStationPressure: number | null;
  flowRegimeChanged: boolean;
}) {
  const { sensitivityCoefficient, maxImpactPercent, minEndStationPressure, flowRegimeChanged } = params;
  if (
    (sensitivityCoefficient !== null && sensitivityCoefficient >= 0.8) ||
    (maxImpactPercent !== null && maxImpactPercent >= 20) ||
    (minEndStationPressure !== null && minEndStationPressure < 0) ||
    flowRegimeChanged
  ) {
    return '是（较高）';
  }

  if (
    (sensitivityCoefficient !== null && sensitivityCoefficient >= 0.4) ||
    (maxImpactPercent !== null && maxImpactPercent >= 10)
  ) {
    return '是（中等）';
  }

  return '否（可控）';
}

function buildEfficiencyDisplay(sources: unknown[]) {
  const pumpEfficiency = pickFirstValue(sources, ['pumpEfficiency']);
  const motorEfficiency = pickFirstValue(sources, ['motorEfficiency']);
  const efficiency = pickFirstValue(sources, ['efficiency']);

  const parts: string[] = [];
  if (pumpEfficiency !== undefined) {
    parts.push(`泵效率 ${formatValue(pumpEfficiency)}`);
  }
  if (motorEfficiency !== undefined) {
    parts.push(`电机效率 ${formatValue(motorEfficiency)}`);
  }
  if (!parts.length && efficiency !== undefined) {
    parts.push(formatValue(efficiency));
  }

  return parts.length ? parts.join('；') : '-';
}

function buildSensitiveVariableDisplay(inputPayload: Record<string, unknown> | null, inputBase: Record<string, unknown> | null) {
  const directValue = pickFirstValue([inputPayload, inputBase], [
    'sensitiveVariableType',
    'sensitivityVariableType',
    'variableType',
  ]);

  if (directValue !== undefined) {
    return formatValue(directValue);
  }

  const variables = asRecordArray(getValueByPath(inputPayload, 'variables'));
  if (!variables.length) {
    return '-';
  }

  return variables
    .map((item) => String(item.variableName ?? item.variableType ?? ''))
    .filter(Boolean)
    .join('、') || '-';
}

function hasMeaningfulMetricValue(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized === '-' || normalized === '--') {
    return false;
  }

  if (/^起点\s*-\s*\/\s*终点\s*-$/.test(normalized)) {
    return false;
  }

  return true;
}

function filterMetricCards(items: DetailMetricCardItem[]) {
  return items.filter((item) => hasMeaningfulMetricValue(item.value));
}

function getCalcTypeLabel(record: Pick<CalculationHistory, 'calcType' | 'calcTypeName'>) {
  if (record.calcTypeName) {
    return record.calcTypeName;
  }
  if (record.calcType && CALC_TYPE_LABELS[record.calcType]) {
    return CALC_TYPE_LABELS[record.calcType];
  }
  return record.calcType || '未知类型';
}

function getReportKindLabel(kind: ReportKind) {
  if (kind === 'hydraulic') {
    return '水力分析';
  }
  if (kind === 'sensitivity') {
    return '敏感性分析';
  }
  if (kind === 'optimization' || kind === 'optimization-comparison') {
    return '泵站优化';
  }
  return '智能报告';
}

function getDisplayCalcTypeLabel(record: Pick<CalculationHistory, 'calcType' | 'calcTypeName' | 'outputResult'>) {
  if (isAiReportHistory(record)) {
    const reportPayload = extractDynamicReportFromOutput(record.outputResult);
    const reportKind = getReportKindFromPayload(reportPayload);
    const reportKindLabel = getReportKindLabel(reportKind);
    if (reportKindLabel !== '智能报告') {
      return reportKindLabel;
    }
  }

  return getCalcTypeLabel(record);
}

function isCompletedHistoryRecord(record: Pick<CalculationHistory, 'status' | 'errorMessage'>) {
  return (record.status ?? 1) === 1 || !record.errorMessage;
}

function dedupeProjectNames(names: Array<string | null | undefined>) {
  return [...new Set(names.map((item) => String(item || '').trim()).filter(Boolean))];
}

function buildProjectScopeSummary(projectNames: string[], fallback = '未命名项目') {
  if (!projectNames.length) {
    return fallback;
  }
  if (projectNames.length === 1) {
    return projectNames[0];
  }
  if (projectNames.length <= 3) {
    return projectNames.join('、');
  }
  return `${projectNames[0]}等${projectNames.length}个项目`;
}

function buildProjectScopeBadge(projectNames: string[], fallback = '未命名项目') {
  if (!projectNames.length) {
    return fallback;
  }
  if (projectNames.length === 1) {
    return projectNames[0];
  }
  if (projectNames.length <= 3) {
    return projectNames.join('、');
  }
  return `${projectNames[0]} 等${projectNames.length}个项目`;
}

function getReportKindFromPayload(report?: DynamicReportResponsePayload | null): ReportKind {
  if (!report) {
    return 'generic';
  }
  if (extractOptimizationComparisonSnapshotFromReport(report)) {
    return 'optimization-comparison';
  }
  if (extractSensitivityReportSnapshotFromReport(report)) {
    return 'sensitivity';
  }
  if (extractOptimizationSnapshotFromReport(report)) {
    return 'optimization';
  }
  if (extractHydraulicSnapshotFromReport(report)) {
    return 'hydraulic';
  }

  const prompt = String(getValueByPath(report.metadata, 'request.user_prompt') || '');
  const focuses = Array.isArray(getValueByPath(report.metadata, 'request.focuses'))
    ? (getValueByPath(report.metadata, 'request.focuses') as unknown[])
    : [];
  const focusText = focuses.map((item) => String(item)).join(' ');
  const typeText = `${prompt} ${focusText}`;
  if (typeText.includes('敏感')) {
    return 'sensitivity';
  }
  if (typeText.includes('优化')) {
    return 'optimization';
  }
  if (typeText.includes('水力')) {
    return 'hydraulic';
  }
  return 'generic';
}

function buildScopedReportTitle(params: {
  projectNames: string[];
  reportKind: ReportKind;
  comparisonCount?: number;
  fallbackTitle?: string;
}) {
  const { projectNames, reportKind, comparisonCount = 1, fallbackTitle } = params;
  const projectLabel = buildProjectScopeSummary(projectNames, '');
  const isComparison = reportKind === 'optimization-comparison' || comparisonCount > 1;
  const reportLabel =
    reportKind === 'hydraulic'
      ? isComparison
        ? '水力分析对比报告'
        : '水力分析报告'
      : reportKind === 'sensitivity'
        ? isComparison
          ? '敏感性分析对比报告'
          : '敏感性分析报告'
        : reportKind === 'optimization'
          ? isComparison
            ? '泵站优化对比报告'
            : '泵站优化报告'
          : reportKind === 'optimization-comparison'
            ? '泵站优化对比报告'
            : isComparison
              ? '智能分析对比报告'
              : '智能分析报告';

  const normalizedTitle = [projectLabel, reportLabel].filter(Boolean).join(' ');
  return normalizedTitle || fallbackTitle || '智能分析报告';
}

function getReportComparisonCount(report?: DynamicReportResponsePayload | null) {
  const metadataCount = Number(getValueByPath(report?.metadata, 'selected_report_count'));
  if (Number.isFinite(metadataCount) && metadataCount > 0) {
    return metadataCount;
  }
  const optimizationComparisonSnapshot = report ? extractOptimizationComparisonSnapshotFromReport(report) : null;
  if (optimizationComparisonSnapshot) {
    return optimizationComparisonSnapshot.projects.length;
  }
  return 1;
}

function normalizeReportAbstract(
  abstract?: string | null,
  comparisonCount = 1,
) {
  const text = String(abstract || '')
    .replace(/^报告按(?:简明版|专业版|管理版)生成，?/, '')
    .trim();

  if (text) {
    return text;
  }

  return comparisonCount > 1
    ? '基于已选计算结果生成，用于对比关键指标、风险与建议。'
    : '基于主数据、计算结果与规则诊断输出推荐与建议。';
}

function buildProjectScopeFromHistoryRows(
  rows: Array<Pick<HistoryTableRow, 'projectId' | 'projectName'>>,
): ReportProjectScope {
  return {
    projectIds: [...new Set(rows.map((row) => Number(row.projectId)).filter((id) => Number.isFinite(id) && id > 0))],
    projectNames: dedupeProjectNames(rows.map((row) => row.projectName)),
  };
}

function buildProjectScopeFromOptimizationComparisonSnapshot(
  snapshot: OptimizationComparisonReportSnapshot,
): ReportProjectScope {
  return {
    projectIds: [
      ...new Set(
        snapshot.projects
          .map((project) => Number(project.projectId))
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    ],
    projectNames: dedupeProjectNames(snapshot.projects.map((project) => project.projectName)),
  };
}

function resolveReportProjectScope(
  report?: DynamicReportResponsePayload | null,
  fallbackProjectName?: string,
): ReportProjectScope {
  if (!report) {
    return {
      projectIds: [],
      projectNames: dedupeProjectNames([fallbackProjectName]),
    };
  }

  const requestProjectNames = Array.isArray(getValueByPath(report.metadata, 'request.project_names'))
    ? dedupeProjectNames(getValueByPath(report.metadata, 'request.project_names') as Array<string | null | undefined>)
    : [];
  const requestProjectIds = Array.isArray(getValueByPath(report.metadata, 'request.selected_project_ids'))
    ? [
        ...new Set(
          (getValueByPath(report.metadata, 'request.selected_project_ids') as unknown[])
            .map((item) => Number(item))
            .filter((id) => Number.isFinite(id) && id > 0),
        ),
      ]
    : [];

  if (requestProjectNames.length || requestProjectIds.length) {
    return {
      projectIds: requestProjectIds,
      projectNames: requestProjectNames,
    };
  }

  const optimizationComparisonSnapshot = extractOptimizationComparisonSnapshotFromReport(report);
  if (optimizationComparisonSnapshot) {
    return buildProjectScopeFromOptimizationComparisonSnapshot(optimizationComparisonSnapshot);
  }

  const snapshotProjectName =
    extractSensitivityReportSnapshotFromReport(report)?.projectName ||
    extractOptimizationSnapshotFromReport(report)?.projectName ||
    extractHydraulicSnapshotFromReport(report)?.projectName ||
    fallbackProjectName;

  return {
    projectIds: [],
    projectNames: dedupeProjectNames([snapshotProjectName]),
  };
}

function isAiReportHistory(record: Pick<CalculationHistory, 'calcType' | 'calcTypeName'>) {
  if (record.calcType && ARCHIVED_REPORT_TYPES.has(record.calcType as ReportType)) {
    return true;
  }

  const typeText = `${record.calcTypeName ?? ''} ${record.calcType ?? ''}`.toUpperCase();
  if (
    typeText.includes('RISK_REVIEW') ||
    typeText.includes('ENERGY_DIAGNOSIS') ||
    typeText.includes('OPERATION_BRIEF')
  ) {
    return true;
  }
  return typeText.includes('REPORT') || typeText.includes('智能报告');
}

function isDynamicReportResponsePayload(value: unknown): value is DynamicReportResponsePayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as DynamicReportResponsePayload;
  return (
    typeof candidate.title === 'string' &&
    typeof candidate.abstract === 'string' &&
    Array.isArray(candidate.summary) &&
    Array.isArray(candidate.highlights) &&
    Array.isArray(candidate.risks)
  );
}

function extractDynamicReportFromOutput(outputResult?: string) {
  const parsed = parseJson(outputResult);
  if (isDynamicReportResponsePayload(parsed)) {
    return parsed;
  }

  const nestedPayload = asRecord(parsed)?.data;
  return isDynamicReportResponsePayload(nestedPayload) ? nestedPayload : null;
}

function renderSummaryList(items: string[]) {
  if (!items.length) {
    return <Text type="secondary">暂无摘要</Text>;
  }

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {items.map((item, index) => (
        <div key={`${index}-${item}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <Tag color="blue" style={{ marginTop: 2 }}>
            {index + 1}
          </Tag>
          <Text>{item}</Text>
        </div>
      ))}
    </Space>
  );
}

function renderNarrativeLineList(lines: Array<string | null | undefined>, dotColor: string) {
  const normalizedLines = lines.map((item) => String(item || '').trim()).filter(Boolean);
  if (!normalizedLines.length) {
    return null;
  }

  return (
    <Space direction="vertical" size={10} style={{ width: '100%', marginTop: 14 }}>
      {normalizedLines.map((line, index) => (
        <div key={`${index}-${line}`} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: dotColor,
              marginTop: 8,
              flex: '0 0 auto',
            }}
          />
          <Text style={{ color: '#475569', lineHeight: 1.8 }}>{line}</Text>
        </div>
      ))}
    </Space>
  );
}

void renderNarrativeLineList;

function getHydraulicRiskItems(report: DynamicReportResponsePayload) {
  const skillItems = report.aiAnalysis?.riskJudgement ?? [];
  return skillItems.length ? skillItems : report.risks;
}

function getHydraulicSuggestionItems(report: DynamicReportResponsePayload) {
  const skillItems = report.aiAnalysis?.suggestions ?? [];
  return skillItems.length ? skillItems : report.suggestions;
}

type HydraulicMetricPanelItem = {
  label: string;
  value: string;
  note?: string;
  accent?: string;
};

type HydraulicInsightSection = {
  label: string;
  content: string;
};

const hydraulicMetricAccentPalette = ['#4e86f7', '#12b981', '#f59e0b', '#7c6cff'];

function HydraulicMetricPanelGrid({
  items,
  minWidth = 180,
  columns,
  valueFontSize = 'clamp(22px, 2.5vw, 30px)',
  noteFontSize = 12,
}: {
  items: HydraulicMetricPanelItem[];
  minWidth?: number;
  columns?: number;
  valueFontSize?: CSSProperties['fontSize'];
  noteFontSize?: CSSProperties['fontSize'];
}) {
  const visibleItems = items.filter((item) => item.value && item.value !== '-');

  if (!visibleItems.length) {
    return <Text type="secondary">当前数据不足以支持进一步判断</Text>;
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: columns ? `repeat(${columns}, minmax(0, 1fr))` : `repeat(auto-fit, minmax(${minWidth}px, 1fr))`,
        gap: 12,
      }}
    >
      {visibleItems.map((item, index) => {
        const accent = item.accent ?? hydraulicMetricAccentPalette[index % hydraulicMetricAccentPalette.length];
        return (
          <div
            key={`${item.label}-${item.value}`}
            style={{
              minWidth: 0,
              borderRadius: 18,
              padding: '16px 18px',
              border: '1px solid rgba(226, 232, 240, 0.95)',
              borderTop: `3px solid ${accent}`,
              background: `linear-gradient(180deg, rgba(255,255,255,0.98) 0%, ${accent}08 100%)`,
              boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)',
            }}
          >
            <div style={{ color: '#64748b', fontSize: 12, fontWeight: 600, lineHeight: 1.5 }}>{item.label}</div>
            <div
              style={{
                marginTop: 10,
                color: '#0f172a',
                fontSize: valueFontSize,
                fontWeight: 700,
                lineHeight: 1.15,
                wordBreak: 'break-word',
              }}
            >
              {item.value}
            </div>
            {item.note ? (
              <div style={{ marginTop: 10, color: '#64748b', fontSize: noteFontSize, lineHeight: 1.6 }}>{item.note}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function buildMetricPanelItems(items: DetailMetricCardItem[]): HydraulicMetricPanelItem[] {
  return filterMetricCards(items).map((item) => ({
    label: item.label,
    value: item.value,
    accent: detailMetricToneMap[item.tone ?? 'blue'].label,
  }));
}

function HydraulicCompactFieldTable({
  items,
}: {
  items: Array<{ label: string; value: string }>;
}) {
  const visibleItems = items.filter((item) => item.value && item.value !== '-');

  if (!visibleItems.length) {
    return <Text type="secondary">当前数据不足以支持进一步判断</Text>;
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 12,
      }}
    >
      {visibleItems.map((item, index) => {
        const accent = hydraulicMetricAccentPalette[index % hydraulicMetricAccentPalette.length];
        return (
          <div
            key={`${item.label}-${item.value}`}
            style={{
              minWidth: 0,
              borderRadius: 18,
              padding: '16px 18px',
              border: '1px solid rgba(226, 232, 240, 0.95)',
              borderTop: `3px solid ${accent}`,
              background: `linear-gradient(180deg, rgba(255,255,255,0.98) 0%, ${accent}08 100%)`,
              boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)',
            }}
          >
            <div style={{ color: '#64748b', fontSize: 12, fontWeight: 600, lineHeight: 1.5 }}>{item.label}</div>
            <div
              style={{
                marginTop: 10,
                color: '#0f172a',
                fontSize: 'clamp(16px, 1.7vw, 22px)',
                fontWeight: 700,
                lineHeight: 1.45,
                whiteSpace: 'normal',
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
              }}
            >
              {item.value}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HydraulicInsightCard({
  title,
  accentColor,
  sections,
}: {
  title: string;
  accentColor: string;
  sections: HydraulicInsightSection[];
}) {
  return (
    <Card
      size="small"
      title={title}
      bodyStyle={{ padding: 20 }}
      style={{
        height: '100%',
        borderRadius: 18,
        border: '1px solid #e2e8f0',
        boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {sections.map((section) => (
          <div
            key={`${title}-${section.label}`}
            style={{
              borderRadius: 14,
              padding: '14px 16px',
              border: `1px solid ${accentColor}24`,
              background: `linear-gradient(180deg, ${accentColor}12 0%, rgba(255,255,255,0.98) 100%)`,
            }}
          >
            <div style={{ color: accentColor, fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{section.label}</div>
            <Paragraph style={{ margin: 0, color: '#334155', lineHeight: 1.8 }}>{section.content}</Paragraph>
          </div>
        ))}
      </div>
    </Card>
  );
}

function getHydraulicRiskLevelTagColor(level?: string | null) {
  const normalized = String(level ?? '').trim().toLowerCase();
  if (normalized === '高' || normalized === 'high' || normalized === '高风险') {
    return 'red';
  }
  if (normalized === '低' || normalized === 'low') {
    return 'blue';
  }
  return 'orange';
}

function getHydraulicSuggestionPriorityTagColor(priority?: string | null) {
  const normalized = String(priority ?? '').trim().toLowerCase();
  if (normalized === '高' || normalized === 'high') {
    return 'red';
  }
  if (normalized === '低' || normalized === 'low') {
    return 'blue';
  }
  return 'gold';
}

function getHydraulicSuggestionPriorityLabel(priority?: string | null) {
  const normalized = String(priority ?? '').trim().toLowerCase();
  if (normalized === 'high') {
    return '高优先级';
  }
  if (normalized === 'medium') {
    return '中优先级';
  }
  if (normalized === 'low') {
    return '低优先级';
  }
  return String(priority ?? '中优先级') || '中优先级';
}

function buildHydraulicPressureDeltaText(fromLabel: string, toLabel: string, delta: number | null) {
  if (delta === null) {
    return null;
  }

  if (Math.abs(delta) < 1) {
    return `${fromLabel}到${toLabel}基本持平`;
  }

  return delta > 0
    ? `${toLabel}较${fromLabel}抬升 ${formatValue(Math.abs(delta), 'm')}`
    : `${toLabel}较${fromLabel}回落 ${formatValue(Math.abs(delta), 'm')}`;
}

function buildHydraulicPressureProfileText(firstSegmentDelta: number | null, secondSegmentDelta: number | null) {
  if (firstSegmentDelta === null || secondSegmentDelta === null) {
    return '当前数据不足以支持完整的压头变化判断。';
  }

  if (Math.abs(firstSegmentDelta) < 1 && Math.abs(secondSegmentDelta) < 1) {
    return '整体压头曲线接近平直，沿线变化不明显。';
  }

  if (firstSegmentDelta > 0 && secondSegmentDelta < 0) {
    return Math.abs(secondSegmentDelta) > Math.abs(firstSegmentDelta) * 1.5
      ? '整体压头曲线呈“先增压、后快速回落”的特征。'
      : '整体压头曲线呈“先升后降”的特征。';
  }

  if (firstSegmentDelta < 0 && secondSegmentDelta > 0) {
    return '整体压头曲线呈“先回落、后回升”的特征。';
  }

  if (firstSegmentDelta > 0 && secondSegmentDelta > 0) {
    return '整体压头曲线呈连续抬升特征。';
  }

  if (firstSegmentDelta < 0 && secondSegmentDelta < 0) {
    return '整体压头曲线呈连续回落特征。';
  }

  if (firstSegmentDelta > 0) {
    return '整体压头曲线在首站出站后仍保持抬升趋势。';
  }

  if (secondSegmentDelta < 0) {
    return '整体压头曲线在沿线输送段出现回落。';
  }

  return '当前压头曲线变化趋势较弱，需要结合更多工况进一步判断。';
}

function buildHydraulicPressureInsightSections(params: {
  firstStationOutPressure: number | null;
  endStationPressure: number | null;
  inletPressure: number | null;
  frictionRatio: number | null;
}) {
  const { firstStationOutPressure, endStationPressure, inletPressure, frictionRatio } = params;
  const pressurePoints = [
    inletPressure !== null ? { label: '首站进站压头', value: inletPressure } : null,
    firstStationOutPressure !== null ? { label: '首站出站压头', value: firstStationOutPressure } : null,
    endStationPressure !== null ? { label: '末站进站压头', value: endStationPressure } : null,
  ].filter((item): item is { label: string; value: number } => Boolean(item));

  const firstSegmentDelta =
    inletPressure !== null && firstStationOutPressure !== null ? Number((firstStationOutPressure - inletPressure).toFixed(2)) : null;
  const secondSegmentDelta =
    firstStationOutPressure !== null && endStationPressure !== null ? Number((endStationPressure - firstStationOutPressure).toFixed(2)) : null;
  const terminalDrop =
    firstStationOutPressure !== null && endStationPressure !== null ? Number((firstStationOutPressure - endStationPressure).toFixed(2)) : null;
  const totalSpan =
    pressurePoints.length >= 2
      ? Number((Math.max(...pressurePoints.map((item) => item.value)) - Math.min(...pressurePoints.map((item) => item.value))).toFixed(2))
      : null;
  const peakPoint = pressurePoints.length
    ? pressurePoints.reduce((current, item) => (item.value > current.value ? item : current))
    : null;
  const troughPoint = pressurePoints.length
    ? pressurePoints.reduce((current, item) => (item.value < current.value ? item : current))
    : null;
  const attenuationRatio =
    terminalDrop !== null && firstStationOutPressure !== null && Math.abs(firstStationOutPressure) > 0
      ? Number((terminalDrop / Math.abs(firstStationOutPressure)).toFixed(4))
      : null;
  const frictionShareText = frictionRatio !== null ? `${Number((frictionRatio * 100).toFixed(1))}%` : null;
  const pressureProfileText = buildHydraulicPressureProfileText(firstSegmentDelta, secondSegmentDelta);
  const firstSegmentText = buildHydraulicPressureDeltaText('首站进站压头', '首站出站压头', firstSegmentDelta);
  const secondSegmentText = buildHydraulicPressureDeltaText('首站出站压头', '末站进站压头', secondSegmentDelta);

  const phenomenonParts = [
    peakPoint && troughPoint && totalSpan !== null
      ? `压头峰值出现在${peakPoint.label}（${formatValue(peakPoint.value, 'm')}），谷值出现在${troughPoint.label}（${formatValue(troughPoint.value, 'm')}），全程波动幅度约 ${formatValue(totalSpan, 'm')}`
      : null,
    firstSegmentText,
    secondSegmentText,
    endStationPressure !== null && endStationPressure < 0 ? '末站进站压头已经跌破 0' : null,
    pressureProfileText,
  ].filter((item): item is string => Boolean(item));

  let runningJudgement = '当前数据不足以支持进一步判断。';
  if (endStationPressure !== null) {
    if (endStationPressure <= 0) {
      runningJudgement =
        firstSegmentDelta !== null && firstSegmentDelta > 0
          ? '首站虽然形成了增压，但沿线压头消耗已经完全吞噬了这部分增益，末端压头跌破 0，当前工况不具备稳定输送边界。'
          : '首站未形成有效增压且末端压头跌破 0，说明当前方案不仅末端失压，而且供压链路本身就偏弱，不能直接作为运行依据。';
    } else if (endStationPressure <= 50) {
      runningJudgement =
        attenuationRatio !== null && attenuationRatio >= 0.8
          ? '末站进站压头虽仍为正，但沿线衰减已经非常明显，系统只保留了很小的末端压力裕度，稍有流量或阻力波动就可能逼近失稳边界。'
          : '末站进站压头保持为正，但安全余量偏小，当前方案只能算勉强可行，需要把它视为紧边界工况。';
    } else if (endStationPressure <= 150) {
      runningJudgement =
        frictionRatio !== null && frictionRatio >= 0.25
          ? '当前工况具备基本输送可行性，但末端压力裕度并不宽松，且摩阻消耗已经偏高，运行稳定性会明显受沿程阻力变化影响。'
          : '当前工况具备基本输送可行性，末端仍保留一定压力裕度，但还没有到可以忽略工况波动影响的程度。';
    } else if (terminalDrop !== null && terminalDrop <= 0) {
      runningJudgement =
        '末站进站压头没有出现常规意义上的回落，当前供压看起来比较充足，但这种结果更依赖高程和边界条件，仍应复核数据与工况的一致性。';
    } else if (frictionRatio !== null && frictionRatio >= 0.3) {
      runningJudgement =
        `当前工况总体可行，末站进站压头仍保持为正，但压头主要消耗在线路上，问题更偏向“沿程损失偏大”而不是“供压不足”。当前摩阻占比约 ${frictionShareText}。`;
    } else {
      runningJudgement = '首站增压与末端留压之间的匹配关系整体正常，当前方案具备较好的输送可行性，主要风险来自后续工况扰动而不是当前压头失配。';
    }
  }

  let focusText = '当前首末站压头变化相对平稳，后续可重点关注流量变化时的末端响应。';
  if (endStationPressure !== null && endStationPressure <= 0) {
    focusText =
      frictionRatio !== null && frictionRatio >= 0.25
        ? `当前最该优先处理的是同时压低末端失压和沿程损失。建议先复核流量设定、粗糙度/粘度参数以及泵组配置，当前摩阻占比约 ${frictionShareText}。`
        : '当前最需要优先处理的是恢复末端正压，建议先复核首站增压能力、泵组配置和入口边界条件，再判断是否需要调整目标流量。';
  } else if (firstSegmentDelta !== null && firstSegmentDelta <= 0) {
    focusText = '首站进出站段没有形成有效增压，后续应优先检查泵站出力、机组组合和入口压力设定，而不是只盯着末端数值。';
  } else if (attenuationRatio !== null && attenuationRatio >= 0.8) {
    focusText =
      frictionRatio !== null && frictionRatio >= 0.25
        ? `首站出站压头到末站进站压头的衰减已经非常大，说明当前限制项主要在线路损失侧。后续应重点跟踪粗糙度、粘度、流量和泵效率对压头回落的放大作用，摩阻占比约 ${frictionShareText}。`
        : '首末站之间的压头衰减已经非常显著，即使末端仍保有正压，也要重点关注末端裕度在工况波动下是否会被快速吃掉。';
  } else if (frictionRatio !== null && frictionRatio >= 0.25) {
    focusText = `当前更值得关注的是压力利用效率，而不是继续堆高供压。沿程损失已经吃掉了较大比例的扬程，摩阻占比约 ${frictionShareText}。`;
  } else if (endStationPressure !== null && endStationPressure <= 150) {
    focusText = '末端压力虽然还在安全线以上，但裕度并不算宽松，后续更应该盯住末端压力回落速度，而不是只看当前是否为正。';
  } else if (terminalDrop !== null && terminalDrop <= 0) {
    focusText = '末端压头未出现常规回落时，后续应同步复核高程差、边界条件和数据口径，确认这类结果是工况特征而不是数据异常。';
  }

  return [
    { label: '图表现象', content: phenomenonParts.join('，') },
    { label: '运行判断', content: runningJudgement },
    { label: '关注重点', content: focusText },
  ] satisfies HydraulicInsightSection[];
}

function buildHydraulicHeadCompositionInsightSections(params: {
  totalHead: number | null;
  frictionHeadLoss: number | null;
  endStationPressure: number | null;
  frictionRatio: number | null;
}) {
  const { totalHead, frictionHeadLoss, endStationPressure, frictionRatio } = params;
  const frictionShareText =
    frictionRatio !== null ? `${Number((frictionRatio * 100).toFixed(1))}%` : '当前数据不足以支持进一步判断';

  const phenomenon =
    totalHead !== null && frictionHeadLoss !== null
      ? frictionRatio !== null && frictionRatio >= 0.25
        ? `当前总扬程为 ${formatValue(totalHead, 'm')}，其中摩阻损失达到 ${formatValue(frictionHeadLoss, 'm')}，在总扬程中占据较大比例（约 ${frictionShareText}）。`
        : `当前总扬程为 ${formatValue(totalHead, 'm')}，其中摩阻损失为 ${formatValue(frictionHeadLoss, 'm')}，在总扬程中的占比约为 ${frictionShareText}。`
      : '当前数据不足以支持进一步判断。';

  const runningJudgement =
    totalHead !== null && endStationPressure !== null && endStationPressure > 0
      ? frictionRatio !== null && frictionRatio >= 0.25
        ? '系统当前不是“扬程不够”，而是“扬程消耗较大”。末站进站压头仍较高，说明方案可行，但输送过程中的沿程损失较为明显。'
        : '当前总扬程配置能够满足输送要求，末站进站压头保持为正，系统整体具备运行可行性。'
      : endStationPressure !== null && endStationPressure <= 0
        ? '虽然系统提供了扬程，但末站压力未形成有效保障，说明当前方案仍存在明显运行边界风险。'
        : '当前数据不足以支持进一步判断。';

  const focusText =
    frictionRatio !== null && frictionRatio >= 0.25
      ? '若后续流量继续提升，摩阻损失很可能进一步放大，因此需要同步关注管道阻力参数与泵站效率。'
      : '后续应持续关注管道阻力参数与泵站运行效率，避免无效扬程进一步增加。';

  return [
    { label: '图表现象', content: phenomenon },
    { label: '运行判断', content: runningJudgement },
    { label: '关注重点', content: focusText },
  ] satisfies HydraulicInsightSection[];
}

type SensitivityInsightBlockData = {
  title: string;
  content: string;
};

type SensitivityRiskCardData = {
  title: string;
  target: string;
  level: string;
  summary: string;
  details: string[];
};

type SensitivitySuggestionCardData = {
  title: string;
  target: string;
  priority: string;
  summary: string;
  details: string[];
};

type SensitivityAnalysisContext = {
  inputPayload: Record<string, unknown>;
  inputBase: Record<string, unknown>;
  inputSources: unknown[];
  outputPayload: Record<string, unknown>;
  baseResult: Record<string, unknown>;
  variableResults: Record<string, unknown>[];
  rankingRows: Record<string, unknown>[];
  impactRankingRows: Record<string, unknown>[];
  primaryVariableResult: Record<string, unknown> | null;
  topVariableName: string;
  topRankNumber: number;
  sensitivityCoefficient: number | null;
  maxImpactPercent: number | null;
  pointRows: Record<string, unknown>[];
  firstPoint: Record<string, unknown> | null;
  lastPoint: Record<string, unknown> | null;
  flowRegimeChanged: boolean;
  flowRegimeSegments: string[];
  minEndStationPressure: number | null;
  maxPressurePoint: Record<string, unknown> | null;
  minPressurePoint: Record<string, unknown> | null;
  maxFrictionPoint: Record<string, unknown> | null;
  minFrictionPoint: Record<string, unknown> | null;
  baseEndStationPressure: number | null;
  baseResultStatus: string;
  riskLevel: string;
  sensitivityImpactLevel: string;
  projectName: string;
  baseCondition: string;
  variableTypeText: string;
  flowRateText: string;
  densityText: string;
  diameterText: string;
  roughnessText: string;
  pressureTrendText: string;
  frictionTrendText: string;
};

function formatSignedPercent(value: unknown, digits = 0) {
  const numeric = toFiniteNumber(value);
  if (numeric === null) {
    return '-';
  }
  const sign = numeric > 0 ? '+' : '';
  const fixed = numeric.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  return `${sign}${fixed}%`;
}

function resolveSensitivityTrendText(firstValue: unknown, lastValue: unknown) {
  const first = toFiniteNumber(firstValue);
  const last = toFiniteNumber(lastValue);
  if (first === null || last === null) {
    return '当前数据不足以支持进一步判断';
  }
  if (last > first) {
    return '整体上升';
  }
  if (last < first) {
    return '整体下降';
  }
  return '变化不明显';
}

function getSensitivityChangeLabel(row?: Record<string, unknown> | null) {
  return row ? formatSignedPercent(row.changePercent) : '-';
}

function buildSensitivityFlowRegimeSegments(rows: Record<string, unknown>[]) {
  if (!rows.length) {
    return [];
  }

  const segments: string[] = [];
  let currentRegime = formatValue(rows[0]?.flowRegime);
  let startLabel = getSensitivityChangeLabel(rows[0]);
  let endLabel = startLabel;

  rows.slice(1).forEach((row) => {
    const nextRegime = formatValue(row.flowRegime);
    const nextLabel = getSensitivityChangeLabel(row);
    if (nextRegime === currentRegime) {
      endLabel = nextLabel;
      return;
    }
    segments.push(`${startLabel} 至 ${endLabel} 保持 ${currentRegime}`);
    currentRegime = nextRegime;
    startLabel = nextLabel;
    endLabel = nextLabel;
  });

  segments.push(`${startLabel} 至 ${endLabel} 保持 ${currentRegime}`);
  return segments;
}

function pickSensitivityExtremePoint(
  rows: Record<string, unknown>[],
  key: string,
  mode: 'min' | 'max',
) {
  const validRows = rows.filter((row) => toFiniteNumber(row[key]) !== null);
  if (!validRows.length) {
    return null;
  }
  return validRows.reduce<Record<string, unknown> | null>((current, row) => {
    if (!current) {
      return row;
    }
    const currentValue = toFiniteNumber(current[key]);
    const nextValue = toFiniteNumber(row[key]);
    if (currentValue === null) {
      return row;
    }
    if (nextValue === null) {
      return current;
    }
    return mode === 'max' ? (nextValue > currentValue ? row : current) : nextValue < currentValue ? row : current;
  }, null);
}

function buildSensitivityAnalysisContext(snapshot: SensitivityReportSnapshot): SensitivityAnalysisContext {
  const inputPayload = snapshot.input;
  const inputBase = asRecord(getValueByPath(inputPayload, 'baseParams')) ?? inputPayload;
  const inputSources = [inputBase, inputPayload] as unknown[];
  const outputPayload = snapshot.output;
  const baseResult = asRecord(getValueByPath(outputPayload, 'baseResult')) ?? outputPayload;
  const variableResults = asRecordArray(getValueByPath(outputPayload, 'variableResults'));
  const rankingRows = toSortedSensitivityRankingRows(outputPayload);
  const impactRankingRows = [...variableResults].sort((a, b) => {
    const impactA = toFiniteNumber(a.maxImpactPercent) ?? Number.NEGATIVE_INFINITY;
    const impactB = toFiniteNumber(b.maxImpactPercent) ?? Number.NEGATIVE_INFINITY;
    return impactB - impactA;
  });
  const primaryVariableResult = getSensitivityPrimaryVariableResult(outputPayload);
  const topRank = rankingRows[0];
  const topVariableName = String(
    topRank?.variableName ??
      primaryVariableResult?.variableName ??
      primaryVariableResult?.variableType ??
      buildSensitiveVariableDisplay(inputPayload, inputBase),
  );
  const topRankNumber = toFiniteNumber(topRank?.rank) ?? 1;
  const sensitivityCoefficient = toFiniteNumber(
    topRank?.sensitivityCoefficient ?? primaryVariableResult?.sensitivityCoefficient,
  );
  const maxImpactPercent =
    toFiniteNumber(primaryVariableResult?.maxImpactPercent) ??
    variableResults.reduce<number | null>((current, item) => {
      const next = toFiniteNumber(item.maxImpactPercent);
      if (next === null) {
        return current;
      }
      if (current === null) {
        return next;
      }
      return Math.max(current, next);
    }, null);
  const pointRows = asRecordArray(primaryVariableResult?.dataPoints).sort((a, b) => {
    const changeA = toFiniteNumber(a.changePercent) ?? 0;
    const changeB = toFiniteNumber(b.changePercent) ?? 0;
    return changeA - changeB;
  });
  const firstPoint = pointRows[0] ?? null;
  const lastPoint = pointRows[pointRows.length - 1] ?? null;
  const flowRegimeValues = pointRows.map((item) => formatValue(item.flowRegime)).filter((item) => item && item !== '-');
  const flowRegimeChanged = new Set(flowRegimeValues).size > 1;
  const minEndStationPressure = pointRows.reduce<number | null>((current, item) => {
    const next = toFiniteNumber(item.endStationPressure);
    if (next === null) {
      return current;
    }
    if (current === null) {
      return next;
    }
    return Math.min(current, next);
  }, null);
  const baseEndStationPressure = toFiniteNumber(
    pickFirstValue([baseResult], ['endStationInPressure', 'endStationPressure', 'terminalInPressure']),
  );
  const baseResultStatus =
    baseEndStationPressure === null ? '当前数据不足以支持进一步判断' : baseEndStationPressure >= 0 ? '正常' : '存在压力风险';
  const riskLevel = evaluateSensitivityRiskLevel({
    sensitivityCoefficient,
    maxImpactPercent,
    minEndStationPressure,
    flowRegimeChanged,
  });
  const sensitivityImpactLevel = classifySensitivityImpactLevel(sensitivityCoefficient);
  const projectName = snapshot.projectName || '当前项目';
  const baseCondition = buildSensitivityBaseCondition(inputPayload, inputBase);
  const variableTypeText = buildSensitiveVariableDisplay(inputPayload, inputBase);
  const flowRateText = formatValue(pickFirstValue(inputSources, ['flowRate', 'throughput', 'flow']), 'm³/h');
  const densityText = formatValue(pickFirstValue(inputSources, ['density']), 'kg/m³');
  const diameterText = formatValue(pickFirstValue(inputSources, ['diameter', 'pipeDiameter']), 'mm');
  const roughnessText = formatValue(pickFirstValue(inputSources, ['roughness']));
  const pressureTrendText = resolveSensitivityTrendText(firstPoint?.endStationPressure, lastPoint?.endStationPressure);
  const frictionTrendText = resolveSensitivityTrendText(firstPoint?.frictionHeadLoss, lastPoint?.frictionHeadLoss);

  return {
    inputPayload,
    inputBase,
    inputSources,
    outputPayload,
    baseResult,
    variableResults,
    rankingRows,
    impactRankingRows,
    primaryVariableResult,
    topVariableName,
    topRankNumber,
    sensitivityCoefficient,
    maxImpactPercent,
    pointRows,
    firstPoint,
    lastPoint,
    flowRegimeChanged,
    flowRegimeSegments: buildSensitivityFlowRegimeSegments(pointRows),
    minEndStationPressure,
    maxPressurePoint: pickSensitivityExtremePoint(pointRows, 'endStationPressure', 'max'),
    minPressurePoint: pickSensitivityExtremePoint(pointRows, 'endStationPressure', 'min'),
    maxFrictionPoint: pickSensitivityExtremePoint(pointRows, 'frictionHeadLoss', 'max'),
    minFrictionPoint: pickSensitivityExtremePoint(pointRows, 'frictionHeadLoss', 'min'),
    baseEndStationPressure,
    baseResultStatus,
    riskLevel,
    sensitivityImpactLevel,
    projectName,
    baseCondition,
    variableTypeText,
    flowRateText,
    densityText,
    diameterText,
    roughnessText,
    pressureTrendText,
    frictionTrendText,
  };
}

function buildSensitivityRiskCards(context: SensitivityAnalysisContext): SensitivityRiskCardData[] {
  const cards: SensitivityRiskCardData[] = [];
  const secondRank = context.rankingRows[1];
  const secondVariableName = secondRank ? String(secondRank.variableName ?? secondRank.variableType ?? '').trim() : '';
  const secondCoefficient = toFiniteNumber(secondRank?.sensitivityCoefficient);
  const minPressureLabel = getSensitivityChangeLabel(context.minPressurePoint);
  const maxFrictionLabel = getSensitivityChangeLabel(context.maxFrictionPoint);

  if (context.sensitivityCoefficient !== null) {
    const level = context.sensitivityCoefficient >= 0.8 ? '高' : context.sensitivityCoefficient >= 0.4 ? '中' : '低';
    const summary =
      level === '高'
        ? `${context.topVariableName} 的敏感系数为 ${formatValue(context.sensitivityCoefficient)}，在当前样本中排名第 ${context.topRankNumber}，已经是主导性的敏感变量。`
        : level === '中'
          ? `${context.topVariableName} 的敏感系数为 ${formatValue(context.sensitivityCoefficient)}，对结果已经形成可感知影响，需要作为重点跟踪变量。`
          : `${context.topVariableName} 的敏感系数为 ${formatValue(context.sensitivityCoefficient)}，当前样本下整体仍处于可控范围。`;
    const details = [
      secondVariableName
        ? `与 ${secondVariableName}${secondCoefficient !== null ? `（敏感系数 ${formatValue(secondCoefficient)}）` : ''}相比，${context.topVariableName} 对结果的牵引作用更强。`
        : null,
      context.maxImpactPercent !== null
        ? `该变量的最大影响幅度达到 ${formatValue(context.maxImpactPercent, '%')}，说明参数扰动已经会被明显放大到结果侧。`
        : null,
      context.pressureTrendText !== '当前数据不足以支持进一步判断'
        ? `在测试区间内，末站压力${context.pressureTrendText}，摩阻损失${context.frictionTrendText}。`
        : null,
    ].filter((item): item is string => Boolean(item));
    cards.push({
      title: '主导敏感变量',
      target: context.topVariableName,
      level,
      summary,
      details,
    });
  }

  if (context.minEndStationPressure !== null && context.minEndStationPressure < 0) {
    cards.push({
      title: '压力边界',
      target: context.projectName,
      level: '高',
      summary: `${minPressureLabel !== '-' ? `${minPressureLabel} 区间` : '当前测试区间'}已出现末站进站压力 ${formatValue(context.minEndStationPressure)}，运行边界已经被触发。`,
      details: [
        context.minPressurePoint
          ? `最低压力点出现在 ${minPressureLabel}，对应的末站压力为 ${formatValue(context.minPressurePoint.endStationPressure)}。`
          : null,
        `相对于基准工况“${context.baseCondition}”，当前参数窗口已经不能完全覆盖最不利工况。`,
      ].filter((item): item is string => Boolean(item)),
    });
  } else if (context.maxImpactPercent !== null && context.maxImpactPercent >= 10) {
    cards.push({
      title: '区间放大效应',
      target: context.projectName,
      level: context.maxImpactPercent >= 20 ? '高' : '中',
      summary: `虽然当前区间还没有出现负压边界，但最大影响幅度已达到 ${formatValue(context.maxImpactPercent, '%')}，说明结果对变量波动并不迟钝。`,
      details: [
        context.maxPressurePoint
          ? `最高末站压力出现在 ${getSensitivityChangeLabel(context.maxPressurePoint)}，说明参数上调时会同步推高关键结果。`
          : null,
        '这意味着后续再扩大扰动范围时，系统可能很快从“可控”转入“边界敏感”。',
      ].filter((item): item is string => Boolean(item)),
    });
  }

  if (context.flowRegimeChanged) {
    cards.push({
      title: '流态切换',
      target: context.projectName,
      level: '中',
      summary: '不同变化比例下已经出现流态切换，说明这组样本不能再按单一流动特征理解。',
      details: [
        context.flowRegimeSegments.length ? `区间表现为：${context.flowRegimeSegments.join('；')}。` : null,
        context.maxFrictionPoint
          ? `最高摩阻损失出现在 ${maxFrictionLabel}，达到 ${formatValue(context.maxFrictionPoint.frictionHeadLoss)}。`
          : null,
      ].filter((item): item is string => Boolean(item)),
    });
  } else if (context.frictionTrendText === '整体上升') {
    cards.push({
      title: '阻力抬升',
      target: context.projectName,
      level: context.maxImpactPercent !== null && context.maxImpactPercent >= 20 ? '高' : '中',
      summary: `随着 ${context.topVariableName} 变化，摩阻损失持续上升，阻力项正在压缩当前运行裕度。`,
      details: [
        context.maxFrictionPoint
          ? `最高摩阻损失出现在 ${maxFrictionLabel}，达到 ${formatValue(context.maxFrictionPoint.frictionHeadLoss)}。`
          : null,
        '如果后续继续放大该变量扰动，摩阻项会先于其他指标成为边界收紧的主要来源。',
      ].filter((item): item is string => Boolean(item)),
    });
  }

  if (!cards.length) {
    cards.push({
      title: '整体可控',
      target: context.projectName,
      level: '低',
      summary: '当前样本中没有出现明显的压力失稳或流态切换迹象，测试区间整体仍处于可控状态。',
      details: [
        `基准工况为 ${context.baseCondition}。`,
        context.pressureTrendText !== '当前数据不足以支持进一步判断'
          ? `末站压力${context.pressureTrendText}，摩阻损失${context.frictionTrendText}。`
          : null,
      ].filter((item): item is string => Boolean(item)),
    });
  }

  return cards.slice(0, 3);
}

function buildSensitivitySuggestionCards(context: SensitivityAnalysisContext): SensitivitySuggestionCardData[] {
  const cards: SensitivitySuggestionCardData[] = [];
  const minPressureLabel = getSensitivityChangeLabel(context.minPressurePoint);
  const maxFrictionLabel = getSensitivityChangeLabel(context.maxFrictionPoint);

  if (context.sensitivityCoefficient !== null && context.sensitivityCoefficient >= 0.4) {
    cards.push({
      title: '控制窗口',
      target: context.topVariableName,
      priority: context.sensitivityCoefficient >= 0.8 ? 'high' : 'medium',
      summary: `优先把 ${context.topVariableName} 纳入运行控制窗口，不要与其他普通参数等权处理。`,
      details: [
        `当前它在敏感性排序中位列第 ${context.topRankNumber}，对结果的影响等级属于${context.sensitivityImpactLevel}。`,
        context.maxImpactPercent !== null
          ? `建议先围绕最大影响幅度 ${formatValue(context.maxImpactPercent, '%')} 对应的工况做上限校核。`
          : null,
      ].filter((item): item is string => Boolean(item)),
    });
  }

  if (context.minEndStationPressure !== null && context.minEndStationPressure < 0) {
    cards.push({
      title: '边界复核',
      target: context.projectName,
      priority: 'high',
      summary: `优先复核 ${minPressureLabel !== '-' ? `${minPressureLabel} 区间` : '最不利区间'}的压力边界，并重新确认该工况下的调度参数。`,
      details: [
        `当前最低末站压力为 ${formatValue(context.minEndStationPressure)}。`,
        '建议将该区间作为下一轮报警阈值、参数上限和工况切换校核的基准点。',
      ],
    });
  } else if (context.maxImpactPercent !== null && context.maxImpactPercent >= 20) {
    cards.push({
      title: '区间复算',
      target: context.projectName,
      priority: 'high',
      summary: '补做高影响区间的复算和边界校核，避免一次样本放大后直接带来运行误判。',
      details: [
        `当前最大影响幅度已经达到 ${formatValue(context.maxImpactPercent, '%')}。`,
        '建议把高影响区间单独抽出来，复核压力、摩阻和安全裕度是否同时满足要求。',
      ],
    });
  }

  if (context.flowRegimeChanged) {
    cards.push({
      title: '流态校核',
      target: context.projectName,
      priority: 'medium',
      summary: '把发生流态切换的区间单独复核，不要与稳定区间混在一起解释和调度。',
      details: [
        context.flowRegimeSegments.length ? `建议重点复核这些区间：${context.flowRegimeSegments.join('；')}。` : null,
        '必要时补充更密的变化比例采样，确认流态切换点附近的真实运行窗口。',
      ].filter((item): item is string => Boolean(item)),
    });
  } else if (context.frictionTrendText === '整体上升') {
    cards.push({
      title: '阻力参数复核',
      target: context.projectName,
      priority: 'medium',
      summary: '继续复核粗糙度、流量设定和摩阻参数，防止阻力项继续抬升并侵蚀压力裕度。',
      details: [
        context.maxFrictionPoint
          ? `最高摩阻损失出现在 ${maxFrictionLabel}，达到 ${formatValue(context.maxFrictionPoint.frictionHeadLoss)}。`
          : null,
        `建议结合当前粗糙度 ${context.roughnessText} 与基准工况一起校核沿程阻力参数。`,
      ].filter((item): item is string => Boolean(item)),
    });
  }

  if (!cards.length) {
    cards.push({
      title: '持续监测',
      target: context.projectName,
      priority: 'low',
      summary: '当前区间整体可控，后续以持续监测和小步校核为主，不需要立即调整运行策略。',
      details: [
        `建议继续跟踪 ${context.topVariableName} 在常用工况下对压力和摩阻的影响。`,
        '当样本范围扩大或新增异常点后，再重新评估是否需要升级控制优先级。',
      ],
    });
  }

  return cards.slice(0, 3);
}

function getSensitivityRiskItems(report: DynamicReportResponsePayload) {
  const skillItems = report.aiAnalysis?.riskJudgement ?? [];
  if (skillItems.length) {
    return skillItems;
  }

  const identifyItems = report.aiAnalysis?.riskIdentify ?? [];
  return identifyItems.length ? identifyItems : report.risks;
}

function getSensitivitySuggestionItems(report: DynamicReportResponsePayload) {
  const skillItems = report.aiAnalysis?.suggestions ?? [];
  return skillItems.length ? skillItems : report.suggestions;
}

function getSensitivityLevelTagColor(level?: string | null) {
  const normalized = String(level ?? '').trim().toLowerCase();
  if (normalized === '高' || normalized === 'high' || normalized === '高风险') {
    return 'red';
  }
  if (normalized === '低' || normalized === 'low') {
    return 'blue';
  }
  return 'orange';
}

function getSensitivityPriorityTagColor(priority?: string | null) {
  const normalized = String(priority ?? '').trim().toLowerCase();
  if (normalized === '高' || normalized === 'high') {
    return 'red';
  }
  if (normalized === '低' || normalized === 'low') {
    return 'blue';
  }
  return 'gold';
}

function getSensitivityPriorityLabel(priority?: string | null) {
  const normalized = String(priority ?? '').trim().toLowerCase();
  if (normalized === 'high') {
    return '高优先级';
  }
  if (normalized === 'medium') {
    return '中优先级';
  }
  if (normalized === 'low') {
    return '低优先级';
  }
  return String(priority ?? '中优先级') || '中优先级';
}

function renderSensitivityInsightCard(block: SensitivityInsightBlockData, accentColor: string) {
  return (
    <Card
      size="small"
      title={block.title}
      bodyStyle={{ padding: 20 }}
      style={{
        height: '100%',
        borderRadius: 18,
        border: '1px solid #e2e8f0',
        boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: '100%',
          borderRadius: 14,
          padding: 16,
          background: `linear-gradient(180deg, ${accentColor}14 0%, rgba(255,255,255,0.98) 100%)`,
          border: `1px solid ${accentColor}24`,
        }}
      >
        <Paragraph style={{ margin: 0, color: '#334155', lineHeight: 1.8 }}>{block.content}</Paragraph>
      </div>
    </Card>
  );
}

function formatSensitivityGaugeNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-';
  }
  return String(Number(value.toFixed(value >= 1 ? 2 : 3)));
}

function roundUpToStep(value: number, step: number) {
  return Math.ceil(value / step) * step;
}

function getSensitivityGaugeMax(rankingData: SensitivitySmartReportPayload['rankingData']) {
  const maxValue = rankingData.reduce((current, item) => {
    const next = item.sensitivityCoefficient ?? 0;
    return Number.isFinite(next) ? Math.max(current, next) : current;
  }, 0);

  return Math.max(1.5, roundUpToStep(maxValue <= 1.5 ? 1.5 : maxValue * 1.08, 0.1));
}

function getSensitivityGaugeLevel(value: number | null | undefined) {
  const numericValue = typeof value === 'number' && Number.isFinite(value) ? value : null;

  if (numericValue !== null && numericValue >= 0.8) {
    return {
      label: '较高敏感',
      accent: '#f97316',
      background: 'rgba(255, 237, 213, 0.96)',
      textColor: '#c2410c',
    };
  }

  if (numericValue !== null && numericValue >= 0.4) {
    return {
      label: '中等敏感',
      accent: '#2563eb',
      background: 'rgba(219, 234, 254, 0.96)',
      textColor: '#1d4ed8',
    };
  }

  return {
    label: '低敏感',
    accent: '#10b981',
    background: 'rgba(220, 252, 231, 0.96)',
    textColor: '#047857',
  };
}

function buildSensitivityGaugeOption(
  _variableName: string,
  value: number | null | undefined,
  gaugeMax: number,
): EChartsOption {
  const safeValue = Math.max(0, Math.min(value ?? 0, gaugeMax));
  const level = getSensitivityGaugeLevel(safeValue);
  const mediumRatio = Math.min(0.4 / gaugeMax, 1);
  const highRatio = Math.min(0.8 / gaugeMax, 1);

  return {
    series: [
      {
        type: 'gauge',
        startAngle: 180,
        endAngle: 0,
        min: 0,
        max: gaugeMax,
        center: ['50%', '57%'],
        radius: '94%',
        splitNumber: Math.max(6, Math.round(gaugeMax * 4)),
        axisLine: {
          lineStyle: {
            width: 16,
            color: [
              [mediumRatio, '#9ad9c7'],
              [highRatio, '#f7db7d'],
              [1, '#ff9b8d'],
            ],
          },
        },
        progress: { show: false },
        axisTick: { show: false },
        splitLine: {
          distance: -16,
          length: 12,
          lineStyle: {
            width: 2,
            color: 'rgba(148, 163, 184, 0.35)',
          },
        },
        axisLabel: {
          distance: 10,
          color: '#64748b',
          fontSize: 12,
          formatter: (current: number) => {
            if (Math.abs(current) < 0.001) {
              return '0';
            }
            if (Math.abs(current - gaugeMax) < 0.001) {
              return formatSensitivityGaugeNumber(gaugeMax);
            }
            return '';
          },
        },
        pointer: {
          icon: 'path://M12 0 L-12 0 L0 -88 z',
          length: '54%',
          width: 12,
          offsetCenter: [0, '2%'],
          itemStyle: {
            color: level.accent,
            shadowBlur: 8,
            shadowColor: `${level.accent}55`,
          },
        },
        anchor: {
          show: true,
          showAbove: true,
          size: 18,
          itemStyle: {
            color: level.accent,
            borderColor: 'rgba(191, 219, 254, 0.95)',
            borderWidth: 5,
          },
        },
        detail: {
          valueAnimation: true,
          fontSize: 30,
          fontWeight: 700,
          offsetCenter: [0, '40%'],
          color: '#0f172a',
          formatter: (current: number) => formatSensitivityGaugeNumber(current),
        },
        data: [
          {
            value: safeValue,
            name: '',
          },
        ],
      },
    ],
  };
}

type SensitivityGaugePanelProps = {
  item: SensitivitySmartReportPayload['rankingData'][number];
  gaugeMax: number;
};

function SensitivityGaugePanel({ item, gaugeMax }: SensitivityGaugePanelProps) {
  const level = getSensitivityGaugeLevel(item.sensitivityCoefficient);

  return (
    <div
      style={{
        height: '100%',
        borderRadius: 20,
        padding: 20,
        border: '1px solid rgba(226, 232, 240, 0.95)',
        background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 0.96) 100%)',
        boxShadow: '0 12px 28px rgba(15, 23, 42, 0.06)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 8,
        }}
      >
        <Tag color={item.rank === 1 ? 'gold' : item.rank === 2 ? 'blue' : 'geekblue'} style={{ marginInlineEnd: 0 }}>
          TOP {item.rank || '-'}
        </Tag>
        <Text type="secondary">敏感系数 {formatSensitivityGaugeNumber(item.sensitivityCoefficient)}</Text>
      </div>

      <Chart
        option={buildSensitivityGaugeOption(item.variableName, item.sensitivityCoefficient, gaugeMax)}
        height={252}
      />

      <div
        style={{
          marginTop: -4,
          textAlign: 'center',
          fontSize: 18,
          fontWeight: 700,
          color: '#1e293b',
          lineHeight: 1.4,
        }}
      >
        {item.variableName}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginTop: 14,
        }}
      >
        <Text style={{ fontSize: 12, color: '#64748b' }}>低敏 &lt; 0.40 · 中敏 0.40-0.79 · 高敏 ≥ 0.80</Text>
        <span
          style={{
            padding: '6px 12px',
            borderRadius: 999,
            background: level.background,
            color: level.textColor,
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          {level.label}
        </span>
      </div>

      {item.description ? (
        <Paragraph
          ellipsis={{ rows: 2, tooltip: item.description }}
          style={{ margin: '12px 0 0', color: '#64748b', fontSize: 13, lineHeight: 1.8 }}
        >
          {item.description}
        </Paragraph>
      ) : null}
    </div>
  );
}

function getSensitivityGaugeColSpan(itemCount: number) {
  if (itemCount <= 1) {
    return { md: 24, xl: 24 };
  }
  if (itemCount === 2) {
    return { md: 12, xl: 12 };
  }
  return { md: 12, xl: 8 };
}

function formatSensitivityImpactPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-';
  }
  return `${Number(value.toFixed(value >= 10 ? 2 : 3))}%`;
}

function getSensitivityImpactBandMax(impactData: SensitivitySmartReportPayload['impactData']) {
  const maxValue = impactData.reduce((current, item) => {
    const next = item.maxImpactPercent ?? 0;
    return Number.isFinite(next) ? Math.max(current, next) : current;
  }, 0);

  return Math.max(30, roundUpToStep(maxValue <= 30 ? 30 : maxValue * 1.05, 5));
}

type SensitivityImpactBandListProps = {
  items: SensitivitySmartReportPayload['impactData'];
};

function SensitivityImpactBandList({ items }: SensitivityImpactBandListProps) {
  const sortedItems = [...items].sort((a, b) => {
    const valueA = a.maxImpactPercent ?? Number.NEGATIVE_INFINITY;
    const valueB = b.maxImpactPercent ?? Number.NEGATIVE_INFINITY;
    return valueB - valueA;
  });

  const bandMax = getSensitivityImpactBandMax(sortedItems);
  const lowThreshold = Math.min(10, bandMax);
  const mediumThreshold = Math.min(20, bandMax);
  const lowPercent = (lowThreshold / bandMax) * 100;
  const mediumPercent = (mediumThreshold / bandMax) * 100;
  const highGuidePercent = Math.min(80, Math.max(mediumPercent + 18, 74));

  if (!sortedItems.length) {
    return <Empty description="暂无最大影响幅度数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {sortedItems.map((item, index) => {
        const numericValue = item.maxImpactPercent;
        const positionPercent =
          numericValue !== null && numericValue !== undefined && Number.isFinite(numericValue)
            ? Math.max(0, Math.min((numericValue / bandMax) * 100, 100))
            : 0;

        return (
          <div
            key={`${item.variableName}-${index}`}
            style={{
              borderRadius: 18,
              padding: 18,
              border: '1px solid rgba(251, 191, 36, 0.22)',
              background: 'linear-gradient(180deg, rgba(255, 251, 235, 0.96) 0%, rgba(255, 255, 255, 1) 100%)',
              boxShadow: '0 10px 24px rgba(245, 158, 11, 0.08)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <Text strong style={{ fontSize: 16, color: '#1e293b' }}>
                {item.variableName}
              </Text>
              <span
                style={{
                  fontSize: 'clamp(28px, 3.2vw, 40px)',
                  lineHeight: 1,
                  fontWeight: 700,
                  color: '#0f172a',
                  letterSpacing: '-0.04em',
                }}
              >
                {formatSensitivityImpactPercent(numericValue)}
              </span>
            </div>

            <div style={{ marginTop: 18 }}>
              <div
                style={{
                  position: 'relative',
                  height: 60,
                  padding: '18px 8px 0',
                }}
              >
                <div
                  style={{
                    position: 'relative',
                    height: 18,
                    borderRadius: 999,
                    background:
                      'linear-gradient(90deg, rgba(153, 222, 208, 0.95) 0%, rgba(192, 235, 209, 0.92) 31%, rgba(248, 238, 151, 0.92) 58%, rgba(248, 194, 164, 0.92) 79%, rgba(245, 141, 141, 0.95) 100%)',
                    boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.5)',
                    overflow: 'hidden',
                  }}
                >
                  {[lowPercent, mediumPercent, highGuidePercent].map((stop, markerIndex) => (
                    <span
                      key={`${item.variableName}-stop-${markerIndex}`}
                      style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: `${stop}%`,
                        width: 1,
                        background: 'rgba(148, 163, 184, 0.3)',
                      }}
                    />
                  ))}

                  {numericValue !== null && numericValue !== undefined && Number.isFinite(numericValue) ? (
                    <span
                      style={{
                        position: 'absolute',
                        top: '50%',
                        left: `clamp(6px, calc(${positionPercent}% - 56px), calc(100% - 118px))`,
                        width: 112,
                        height: 22,
                        borderRadius: 999,
                        transform: 'translateY(-50%)',
                        background: 'linear-gradient(90deg, #6ea8ff 0%, #5b8ff9 100%)',
                        boxShadow: '0 8px 18px rgba(91, 143, 249, 0.25)',
                      }}
                    />
                  ) : null}
                </div>
              </div>

              <div
                style={{
                  position: 'relative',
                  height: 30,
                  marginTop: 4,
                  color: '#64748b',
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                <span style={{ position: 'absolute', left: 0, transform: 'translateX(0)' }}>低</span>
                <span style={{ position: 'absolute', left: `${lowPercent}%`, transform: 'translateX(-50%)' }}>
                  {formatValue(lowThreshold)}
                </span>
                <span style={{ position: 'absolute', left: `${mediumPercent}%`, transform: 'translateX(-50%)' }}>
                  {formatValue(mediumThreshold)}
                </span>
                <span style={{ position: 'absolute', right: 0, transform: 'translateX(0)' }}>高</span>
              </div>
            </div>
          </div>
        );
      })}
    </Space>
  );
}

function getOptimizationSchemeExplainItems(report: DynamicReportResponsePayload, fallback: string[] = []) {
  const skillItems = report.aiAnalysis?.schemeExplain ?? [];
  if (skillItems.length) {
    return skillItems;
  }
  return report.highlights.length ? report.highlights : fallback;
}

function getOptimizationComparisonItems(report: DynamicReportResponsePayload, fallback: string[] = []) {
  const skillItems = report.aiAnalysis?.comparison ?? [];
  return skillItems.length ? skillItems : fallback;
}

function getOptimizationRiskItems(report: DynamicReportResponsePayload) {
  const skillItems = report.aiAnalysis?.riskJudgement ?? [];
  return skillItems.length ? skillItems : report.risks;
}

function getOptimizationSuggestionItems(report: DynamicReportResponsePayload) {
  const skillItems = report.aiAnalysis?.suggestions ?? [];
  return skillItems.length ? skillItems : report.suggestions;
}

type OptimizationInsightBlockData = {
  title: string;
  content: string;
};

function renderOptimizationInsightCard(block: OptimizationInsightBlockData, accentColor: string) {
  return (
    <Card
      size="small"
      title={block.title}
      bodyStyle={{ padding: 20 }}
      style={{
        height: '100%',
        borderRadius: 18,
        border: '1px solid #e2e8f0',
        boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: '100%',
          borderRadius: 14,
          padding: 16,
          background: `linear-gradient(180deg, ${accentColor}14 0%, rgba(255,255,255,0.98) 100%)`,
          border: `1px solid ${accentColor}24`,
        }}
      >
        <Paragraph style={{ margin: 0, color: '#334155', lineHeight: 1.8 }}>{block.content}</Paragraph>
      </div>
    </Card>
  );
}

type OptimizationOverviewCardTheme = {
  headerBackground: string;
  panelBorder: string;
  surfaceTint: string;
  badgeBackground: string;
  badgeColor: string;
  dividerColor: string;
};

const optimizationOverviewCardThemes: Record<'energy' | 'cost', OptimizationOverviewCardTheme> = {
  energy: {
    headerBackground: 'linear-gradient(90deg, rgba(230, 242, 255, 0.98) 0%, rgba(240, 248, 255, 0.95) 100%)',
    panelBorder: 'rgba(204, 222, 245, 0.96)',
    surfaceTint: 'rgba(236, 245, 255, 0.7)',
    badgeBackground: 'rgba(222, 247, 236, 0.98)',
    badgeColor: '#14835c',
    dividerColor: 'rgba(213, 227, 243, 0.96)',
  },
  cost: {
    headerBackground: 'linear-gradient(90deg, rgba(255, 243, 226, 0.98) 0%, rgba(255, 249, 240, 0.95) 100%)',
    panelBorder: 'rgba(246, 226, 196, 0.96)',
    surfaceTint: 'rgba(255, 247, 235, 0.72)',
    badgeBackground: 'rgba(255, 238, 217, 0.98)',
    badgeColor: '#b86819',
    dividerColor: 'rgba(241, 226, 205, 0.96)',
  },
};

function formatOptimizationOverviewNumber(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return '-';
  }

  const hasFraction = Math.abs(value - Math.trunc(value)) > 0.0001;
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

function getOptimizationOverviewStatus(value: number | null, isFeasible: boolean | null) {
  if (value === null || !Number.isFinite(value)) {
    return '待判定';
  }
  if (isFeasible === false) {
    return '待复核';
  }
  return '较优';
}

function OptimizationOverviewMetricCard({
  title,
  value,
  unit,
  badgePrefix,
  status,
  description,
  theme,
}: {
  title: string;
  value: number | null;
  unit: string;
  badgePrefix: string;
  status: string;
  description: string;
  theme: OptimizationOverviewCardTheme;
}) {
  const formattedValue = formatOptimizationOverviewNumber(value);
  const badgeStyle =
    status === '待复核'
      ? { background: 'rgba(255, 237, 213, 0.98)', color: '#c2410c' }
      : status === '待判定'
        ? { background: 'rgba(226, 232, 240, 0.96)', color: '#475569' }
        : { background: theme.badgeBackground, color: theme.badgeColor };

  return (
    <div
      style={{
        minWidth: 0,
        height: '100%',
        borderRadius: 24,
        overflow: 'hidden',
        border: `1px solid ${theme.panelBorder}`,
        background: `linear-gradient(180deg, rgba(255,255,255,0.98) 0%, ${theme.surfaceTint} 100%)`,
        boxShadow: '0 14px 30px rgba(15, 23, 42, 0.06)',
      }}
    >
      <div
        style={{
          padding: '20px 24px',
          background: theme.headerBackground,
          borderBottom: `1px solid ${theme.panelBorder}`,
        }}
      >
        <div style={{ color: '#0f172a', fontSize: 18, fontWeight: 700, lineHeight: 1.3 }}>{title}</div>
      </div>
      <div style={{ padding: '24px 28px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span
            style={{
              color: '#0f172a',
              fontSize: 'clamp(30px, 3.2vw, 52px)',
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: '-0.03em',
            }}
          >
            {formattedValue}
          </span>
          {formattedValue !== '-' ? (
            <span style={{ color: '#475569', fontSize: 'clamp(18px, 1.9vw, 30px)', fontWeight: 500, lineHeight: 1.2 }}>
              {unit}
            </span>
          ) : null}
        </div>
        <div
          style={{
            alignSelf: 'flex-start',
            borderRadius: 14,
            padding: '8px 14px',
            background: badgeStyle.background,
            color: badgeStyle.color,
            fontSize: 14,
            fontWeight: 700,
            lineHeight: 1.2,
          }}
        >
          {badgePrefix}：{status}
        </div>
        <div style={{ borderTop: `1px solid ${theme.dividerColor}`, paddingTop: 16, color: '#334155', fontSize: 15, lineHeight: 1.75 }}>
          {description}
        </div>
      </div>
    </div>
  );
}

function formatHeadAllocationMetric(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return '-';
  }

  const rounded = Number(value.toFixed(4));
  const isIntegerLike = Math.abs(rounded - Math.round(rounded)) < 0.0001;
  return rounded.toLocaleString('zh-CN', {
    minimumFractionDigits: isIntegerLike ? 0 : 1,
    maximumFractionDigits: 4,
  });
}

function formatHeadAllocationPercent(value: number | null, total: number) {
  if (value === null || !Number.isFinite(value) || total <= 0) {
    return '--';
  }

  return `${((value / total) * 100).toFixed(1)}%`;
}

function normalizeHeadAllocationMagnitude(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(Math.abs(value), 0);
}

function OptimizationHeadAllocationBand({
  totalHead,
  totalPressureDrop,
  endStationInPressure,
}: {
  totalHead: number | null;
  totalPressureDrop: number | null;
  endStationInPressure: number | null;
}) {
  const normalizedRawPressureDrop = normalizeHeadAllocationMagnitude(totalPressureDrop);
  const normalizedRawEndStationPressure =
    endStationInPressure !== null && Number.isFinite(endStationInPressure) ? Math.max(endStationInPressure, 0) : null;
  const normalizedPressureDrop =
    normalizedRawPressureDrop ??
    (totalHead !== null && endStationInPressure !== null ? Math.max(totalHead - Math.max(endStationInPressure, 0), 0) : null);
  const normalizedEndStationPressure =
    normalizedRawEndStationPressure ??
    (totalHead !== null && totalPressureDrop !== null
      ? Math.max(totalHead - (normalizedRawPressureDrop ?? 0), 0)
      : null);
  const segmentTotal = (normalizedPressureDrop ?? 0) + (normalizedEndStationPressure ?? 0);
  const shouldFallbackToSegmentTotal =
    totalHead === null ||
    !Number.isFinite(totalHead) ||
    totalHead <= 0 ||
    (segmentTotal > 0 &&
      (totalHead < Math.max(normalizedPressureDrop ?? 0, normalizedEndStationPressure ?? 0) ||
        Math.abs(totalHead - segmentTotal) > Math.max(1, segmentTotal * 0.05)));
  const displayTotal =
    segmentTotal > 0 ? Number((shouldFallbackToSegmentTotal ? segmentTotal : totalHead).toFixed(4)) : null;

  if (displayTotal === null || segmentTotal <= 0) {
    return <Text type="secondary">当前数据不足以支持进一步判断</Text>;
  }

  const pressureDropWeight = Math.max(normalizedPressureDrop ?? 0, 0.0001);
  const endStationWeight = Math.max(normalizedEndStationPressure ?? 0, 0.0001);
  const pressureDropPercent = formatHeadAllocationPercent(normalizedPressureDrop, segmentTotal);
  const endStationPercent = formatHeadAllocationPercent(normalizedEndStationPressure, segmentTotal);
  const pressureDropShare = segmentTotal > 0 ? pressureDropWeight / segmentTotal : 0;
  const endStationShare = segmentTotal > 0 ? endStationWeight / segmentTotal : 0;
  const showPressureDropBandContent = pressureDropShare >= 0.18;
  const showEndStationBandContent = endStationShare >= 0.18;
  const hasVisualNormalization =
    (totalPressureDrop !== null && totalPressureDrop < 0) ||
    (endStationInPressure !== null && endStationInPressure < 0) ||
    shouldFallbackToSegmentTotal;
  const visualScale = {
    containerMinHeight: 236,
    stackGap: 20,
    headerCapHeight: 18,
    headerFontSize: 'clamp(20px, 2vw, 30px)',
    bandMinHeight: 76,
    bandPaddingX: 20,
    bandLabelFontSize: 'clamp(12px, 1vw, 14px)',
    bandValueFontSize: 'clamp(18px, 1.55vw, 24px)',
    ratioLabelFontSize: 16,
    ratioValueFontSize: 'clamp(22px, 2vw, 32px)',
  } as const;

  return (
    <div style={{ width: '100%', paddingBottom: 4 }}>
      <div
        style={{
          width: '100%',
          minHeight: visualScale.containerMinHeight,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: visualScale.stackGap,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            <span style={{ width: 2, height: visualScale.headerCapHeight, borderRadius: 999, background: '#d7e3f5' }} />
            <div style={{ flex: 1, height: 1, background: '#d7e3f5' }} />
          </div>
          <div
            style={{
              color: '#334155',
              fontSize: visualScale.headerFontSize,
              fontWeight: 700,
              lineHeight: 1.1,
              whiteSpace: 'nowrap',
            }}
          >
            总扬程 {formatHeadAllocationMetric(displayTotal)} m
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            <div style={{ flex: 1, height: 1, background: '#d7e3f5' }} />
            <span style={{ width: 2, height: visualScale.headerCapHeight, borderRadius: 999, background: '#d7e3f5' }} />
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            minHeight: visualScale.bandMinHeight,
            borderRadius: 0,
            overflow: 'hidden',
            boxShadow: '0 14px 30px rgba(15, 23, 42, 0.06)',
          }}
        >
          <div
            style={{
              flex: pressureDropWeight,
              minWidth: 0,
              padding: `0 ${showPressureDropBandContent ? visualScale.bandPaddingX : 10}px`,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'flex-start',
              gap: 4,
              background: 'linear-gradient(90deg, #ffb100 0%, #f59e0b 100%)',
              color: '#ffffff',
              overflow: 'hidden',
            }}
          >
            {showPressureDropBandContent ? (
              <>
                <span
                  style={{
                    fontSize: visualScale.bandLabelFontSize,
                    fontWeight: 600,
                    lineHeight: 1.15,
                    letterSpacing: '0.01em',
                    opacity: 0.92,
                  }}
                >
                  总压降
                </span>
                <span
                  style={{
                    minWidth: 0,
                    fontSize: visualScale.bandValueFontSize,
                    fontWeight: 700,
                    lineHeight: 1.1,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatHeadAllocationMetric(normalizedPressureDrop)} m
                </span>
              </>
            ) : null}
          </div>
          <div
            style={{
              flex: endStationWeight,
              minWidth: 0,
              padding: `0 ${showEndStationBandContent ? visualScale.bandPaddingX : 10}px`,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'flex-start',
              gap: 4,
              background: 'linear-gradient(90deg, #23c7a1 0%, #19b68d 100%)',
              color: '#ffffff',
              overflow: 'hidden',
            }}
          >
            {showEndStationBandContent ? (
              <>
                <span
                  style={{
                    fontSize: visualScale.bandLabelFontSize,
                    fontWeight: 600,
                    lineHeight: 1.15,
                    letterSpacing: '0.01em',
                    opacity: 0.92,
                    wordBreak: 'break-all',
                  }}
                >
                  末站进站压头
                </span>
                <span
                  style={{
                    minWidth: 0,
                    fontSize: visualScale.bandValueFontSize,
                    fontWeight: 700,
                    lineHeight: 1.1,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatHeadAllocationMetric(normalizedEndStationPressure)} m
                </span>
              </>
            ) : null}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
          }}
        >
          {[
            {
              key: 'pressure-drop',
              label: '总压降',
              value: `${formatHeadAllocationMetric(normalizedPressureDrop)} m`,
              percent: pressureDropPercent,
              accentColor: '#f59e0b',
              borderColor: 'rgba(245, 158, 11, 0.22)',
              background: 'linear-gradient(180deg, rgba(255, 250, 235, 0.96) 0%, rgba(255, 243, 205, 0.72) 100%)',
            },
            {
              key: 'end-station',
              label: '末站进站压头',
              value: `${formatHeadAllocationMetric(normalizedEndStationPressure)} m`,
              percent: endStationPercent,
              accentColor: '#19b68d',
              borderColor: 'rgba(25, 182, 141, 0.2)',
              background: 'linear-gradient(180deg, rgba(236, 253, 245, 0.96) 0%, rgba(209, 250, 229, 0.72) 100%)',
            },
          ].map((item) => (
            <div
              key={item.key}
              style={{
                minWidth: 0,
                borderRadius: 18,
                border: `1px solid ${item.borderColor}`,
                background: item.background,
                padding: '14px 16px',
                boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)',
              }}
            >
              <div style={{ color: '#475569', fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{item.label}</div>
              <div
                style={{
                  marginTop: 10,
                  color: item.accentColor,
                  fontSize: visualScale.ratioValueFontSize,
                  fontWeight: 700,
                  lineHeight: 1.1,
                  wordBreak: 'break-word',
                }}
              >
                {item.value}
              </div>
              <div
                style={{
                  marginTop: 10,
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 8,
                  flexWrap: 'wrap',
                  color: '#334155',
                  fontSize: visualScale.ratioLabelFontSize,
                  lineHeight: 1.35,
                }}
              >
                <span>占比</span>
                <span style={{ color: item.accentColor, fontSize: 'clamp(18px, 1.7vw, 26px)', fontWeight: 700 }}>{item.percent}</span>
              </div>
            </div>
          ))}
        </div>

        {hasVisualNormalization ? (
          <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.7 }}>
            检测到原始结果存在负压降或总扬程不闭合，图中已按分配幅值进行规范化展示。
          </Text>
        ) : null}
      </div>
    </div>
  );
}

function getOptimizationPumpRunState(count: number | null) {
  if (count === null) {
    return {
      label: '待确认',
      note: '台数待补全',
      accent: '#d97706',
      textColor: '#9a3412',
      borderColor: 'rgba(245, 158, 11, 0.22)',
      background: 'rgba(245, 158, 11, 0.14)',
    };
  }

  if (count > 0) {
    return {
      label: '运行中',
      note: '参与当前推荐组合',
      accent: '#16a34a',
      textColor: '#166534',
      borderColor: 'rgba(34, 197, 94, 0.24)',
      background: 'rgba(34, 197, 94, 0.14)',
    };
  }

  return {
    label: '未启用',
    note: '当前方案未投用',
    accent: '#94a3b8',
    textColor: '#475569',
    borderColor: 'rgba(148, 163, 184, 0.24)',
    background: 'rgba(148, 163, 184, 0.14)',
  };
}

function getOptimizationFeasibilityVisual(isFeasible: boolean | null) {
  if (isFeasible === true) {
    return {
      label: '可行',
      note: '满足当前约束条件',
      accent: '#15803d',
      textColor: '#14532d',
      borderColor: 'rgba(34, 197, 94, 0.28)',
      background: 'linear-gradient(180deg, rgba(240, 253, 244, 0.98) 0%, rgba(220, 252, 231, 0.92) 100%)',
      shadow: '0 14px 30px rgba(22, 163, 74, 0.12)',
      icon: <CheckCircleOutlined style={{ fontSize: 28, color: '#16a34a' }} />,
    };
  }

  if (isFeasible === false) {
    return {
      label: '受限',
      note: '存在运行约束，需要复核',
      accent: '#dc2626',
      textColor: '#7f1d1d',
      borderColor: 'rgba(248, 113, 113, 0.28)',
      background: 'linear-gradient(180deg, rgba(254, 242, 242, 0.98) 0%, rgba(254, 226, 226, 0.92) 100%)',
      shadow: '0 14px 30px rgba(239, 68, 68, 0.12)',
      icon: <CloseCircleOutlined style={{ fontSize: 28, color: '#ef4444' }} />,
    };
  }

  return {
    label: '待确认',
    note: '当前数据不足以支持进一步判断',
    accent: '#d97706',
    textColor: '#9a3412',
    borderColor: 'rgba(245, 158, 11, 0.28)',
    background: 'linear-gradient(180deg, rgba(255, 251, 235, 0.98) 0%, rgba(254, 243, 199, 0.92) 100%)',
    shadow: '0 14px 30px rgba(245, 158, 11, 0.12)',
    icon: <QuestionCircleOutlined style={{ fontSize: 28, color: '#f59e0b' }} />,
  };
}

function PumpGlyph({ accentColor, active }: { accentColor: string; active: boolean }) {
  const stroke = active ? accentColor : '#94a3b8';
  const fill = active ? `${accentColor}18` : 'rgba(148, 163, 184, 0.12)';

  return (
    <div
      style={{
        width: 56,
        height: 56,
        borderRadius: 18,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: fill,
        border: `1px solid ${active ? `${accentColor}40` : 'rgba(148, 163, 184, 0.24)'}`,
        boxShadow: active ? `0 12px 24px ${accentColor}18` : '0 10px 20px rgba(148, 163, 184, 0.12)',
        flexShrink: 0,
      }}
    >
      <svg width="34" height="34" viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <path d="M8 50H56" stroke={stroke} strokeWidth="3.2" strokeLinecap="round" />
        <rect x="10" y="24" width="18" height="18" rx="5" fill={fill} stroke={stroke} strokeWidth="3.2" />
        <path
          d="M28 28H37C45.2843 28 52 34.7157 52 43V43H28V28Z"
          fill={fill}
          stroke={stroke}
          strokeWidth="3.2"
          strokeLinejoin="round"
        />
        <circle cx="40" cy="43" r="4.8" fill="white" stroke={stroke} strokeWidth="3.2" />
        <path d="M52 43H58" stroke={stroke} strokeWidth="3.2" strokeLinecap="round" />
        <path d="M14 20V14H24V20" stroke={stroke} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function OptimizationRecommendedSchemeBoard({
  recommendedCombination,
  pump480Num,
  pump375Num,
  isFeasible,
}: {
  recommendedCombination: string;
  pump480Num: number | null;
  pump375Num: number | null;
  isFeasible: boolean | null;
}) {
  const feasibility = getOptimizationFeasibilityVisual(isFeasible);
  const pumpCards = [
    { key: '480', model: 'ZMI480', count: pump480Num, accentColor: '#4e86f7' },
    { key: '375', model: 'ZMI375', count: pump375Num, accentColor: '#7c6cff' },
  ];

  return (
    <div style={{ minHeight: 300, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '12px 14px',
          borderRadius: 16,
          border: '1px solid rgba(226, 232, 240, 0.95)',
          background: 'linear-gradient(180deg, rgba(248, 250, 252, 0.98) 0%, rgba(255,255,255,1) 100%)',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '4px 10px',
              borderRadius: 999,
              background: 'rgba(34, 197, 94, 0.12)',
              color: '#166534',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            最推荐
          </div>
          <div style={{ marginTop: 8, color: '#0f172a', fontSize: 18, fontWeight: 700, lineHeight: 1.25 }}>
            推荐泵组：{recommendedCombination}
          </div>
        </div>
        <Text type="secondary" style={{ flexShrink: 0, fontSize: 12 }}>
          工程系统布局
        </Text>
      </div>

      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.88fr)',
          gap: 16,
        }}
      >
        {pumpCards.map((item) => {
          const runState = getOptimizationPumpRunState(item.count);
          const countText = item.count === null ? '--' : `${Math.max(0, Math.round(item.count))}`;

          return (
            <div
              key={item.key}
              style={{
                minWidth: 0,
                borderRadius: 22,
                padding: '18px 18px 16px',
                border: `1px solid ${item.accentColor}24`,
                background: `linear-gradient(180deg, rgba(255,255,255,0.98) 0%, ${item.accentColor}12 100%)`,
                boxShadow: `0 14px 28px ${item.accentColor}14`,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: 14,
                overflow: 'hidden',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: '#64748b', fontSize: 12, fontWeight: 600, lineHeight: 1.5 }}>泵组单元</div>
                  <div style={{ marginTop: 4, color: '#0f172a', fontSize: 20, fontWeight: 800, lineHeight: 1.2 }}>
                    {item.model}
                  </div>
                </div>
                <PumpGlyph accentColor={item.accentColor} active={item.count !== null && item.count > 0} />
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span
                    style={{
                      color: '#0f172a',
                      fontSize: 'clamp(34px, 3.6vw, 52px)',
                      fontWeight: 800,
                      lineHeight: 1,
                      letterSpacing: '-0.04em',
                    }}
                  >
                    {countText}
                  </span>
                  <span style={{ color: '#475569', fontSize: 14, fontWeight: 700 }}>台</span>
                </div>
                <div style={{ marginTop: 10 }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '5px 10px',
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 700,
                      color: runState.textColor,
                      background: runState.background,
                      border: `1px solid ${runState.borderColor}`,
                    }}
                  >
                    {runState.label}
                  </span>
                </div>
              </div>

              <div style={{ color: '#64748b', fontSize: 11, lineHeight: 1.55 }}>{runState.note}</div>
            </div>
          );
        })}

        <div
          style={{
            minWidth: 0,
            borderRadius: 22,
            padding: '18px 18px 16px',
            border: `1px solid ${feasibility.borderColor}`,
            background: feasibility.background,
            boxShadow: feasibility.shadow,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 14,
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: '#64748b', fontSize: 12, fontWeight: 600, lineHeight: 1.5 }}>方案状态</div>
              <div style={{ marginTop: 4, color: feasibility.textColor, fontSize: 18, fontWeight: 800, lineHeight: 1.2 }}>
                系统判定
              </div>
            </div>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 18,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(255,255,255,0.6)',
                border: `1px solid ${feasibility.borderColor}`,
                flexShrink: 0,
              }}
            >
              {feasibility.icon}
            </div>
          </div>

          <div>
            <div
              style={{
                color: feasibility.accent,
                fontSize: 'clamp(30px, 3vw, 44px)',
                fontWeight: 800,
                lineHeight: 1,
                letterSpacing: '-0.04em',
              }}
            >
              {feasibility.label}
            </div>
            <div style={{ marginTop: 12, color: feasibility.textColor, fontSize: 13, lineHeight: 1.7 }}>
              {feasibility.note}
            </div>
          </div>

          <div
            style={{
              padding: '10px 12px',
              borderRadius: 16,
              background: 'rgba(255,255,255,0.6)',
              border: `1px solid ${feasibility.borderColor}`,
              color: feasibility.textColor,
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            推荐组合：{recommendedCombination}
          </div>
        </div>
      </div>
    </div>
  );
}

function getOptimizationRiskLevelTagColor(level?: string | null) {
  const normalized = String(level ?? '').trim().toLowerCase();
  if (normalized === '高' || normalized === 'high' || normalized === '高风险') {
    return 'red';
  }
  if (normalized === '低' || normalized === 'low') {
    return 'blue';
  }
  return 'orange';
}

function getOptimizationSuggestionPriorityTagColor(priority?: string | null) {
  const normalized = String(priority ?? '').trim().toLowerCase();
  if (normalized === '高' || normalized === 'high') {
    return 'red';
  }
  if (normalized === '低' || normalized === 'low') {
    return 'blue';
  }
  return 'gold';
}

function getOptimizationSuggestionPriorityLabel(priority?: string | null) {
  const normalized = String(priority ?? '').trim().toLowerCase();
  if (normalized === 'high') {
    return '高优先级';
  }
  if (normalized === 'medium') {
    return '中优先级';
  }
  if (normalized === 'low') {
    return '低优先级';
  }
  return String(priority ?? '中优先级') || '中优先级';
}

function renderHydraulicAiReportContent(report: DynamicReportResponsePayload, snapshot: HydraulicReportSnapshot) {
  return renderHydraulicAiReportContentV2(report, snapshot);
}

void renderHydraulicAiReportContent;

function renderHydraulicAiReportContentV2(report: DynamicReportResponsePayload, snapshot: HydraulicReportSnapshot) {
  const inputSources = [snapshot.input];
  const outputSources = [snapshot.output];
  const projectName = snapshot.projectName || '当前项目';

  const flowRateText = formatValue(pickFirstValue(inputSources, ['flowRate']), 'm³/h');
  const densityText = formatValue(pickFirstValue(inputSources, ['density']), 'kg/m³');
  const diameterText = formatValue(pickFirstValue(inputSources, ['diameter']), 'mm');
  const roughnessText = formatValue(pickFirstValue(inputSources, ['roughness']));
  const viscosityText = formatValue(pickFirstValue(inputSources, ['viscosity']));
  const lengthText = formatValue(pickFirstValue(inputSources, ['length']), 'km');
  const elevationText = buildHydraulicElevationDisplay(inputSources);
  const pumpParameterText = buildHydraulicPumpParameterDisplay(inputSources);

  const totalHead = toFiniteNumber(pickFirstValue(outputSources, ['totalHead']));
  const frictionHeadLoss = toFiniteNumber(pickFirstValue(outputSources, ['frictionHeadLoss']));
  const endStationPressure = toFiniteNumber(
    pickFirstValue(outputSources, ['endStationInPressure', 'endStationPressure']),
  );
  const inletPressure = toFiniteNumber(pickFirstValue(inputSources, ['inletPressure']));
  const firstStationOutPressure = toFiniteNumber(pickFirstValue(outputSources, ['firstStationOutPressure']));
  const reynoldsNumberText = formatValue(pickFirstValue(outputSources, ['reynoldsNumber']));
  const flowRegimeText = formatValue(pickFirstValue(outputSources, ['flowRegime']));
  const hydraulicSlopeText = formatValue(pickFirstValue(outputSources, ['hydraulicSlope']));
  const startAltitude = toFiniteNumber(pickFirstValue(inputSources, ['startAltitude']));
  const endAltitude = toFiniteNumber(pickFirstValue(inputSources, ['endAltitude']));
  const elevationDiff = startAltitude !== null && endAltitude !== null ? Number((endAltitude - startAltitude).toFixed(2)) : null;
  const frictionRatio =
    totalHead !== null && totalHead !== 0 && frictionHeadLoss !== null ? Number((frictionHeadLoss / totalHead).toFixed(4)) : null;
  const riskItems = getHydraulicRiskItems(report);
  const suggestionItems = getHydraulicSuggestionItems(report);

  const coreParameterItems: HydraulicMetricPanelItem[] = [
    { label: '流量', value: flowRateText, accent: '#4e86f7' },
    { label: '密度', value: densityText, accent: '#12b981' },
    { label: '管径', value: diameterText, accent: '#7c6cff' },
    { label: '粗糙度', value: roughnessText, accent: '#f59e0b' },
  ];

  const supplementaryParameterItems = [
    { label: '粘度', value: viscosityText },
    { label: '长度', value: lengthText },
    { label: '高程', value: elevationText },
    { label: '泵参数', value: pumpParameterText },
  ];

  const frictionShareText =
    frictionRatio !== null ? `${Number((frictionRatio * 100).toFixed(1))}%` : '当前数据不足以支持进一步判断';

  const primaryResultItems: HydraulicMetricPanelItem[] = [
    {
      label: '总扬程',
      value: formatValue(totalHead, 'm'),
      note: frictionRatio !== null ? `摩阻损失约占总扬程 ${frictionShareText}` : '用于判断系统供能能力。',
      accent: '#7c6cff',
    },
    {
      label: '摩阻损失',
      value: formatValue(frictionHeadLoss, 'm'),
      note:
        frictionRatio !== null && frictionRatio >= 0.25
          ? '沿程损失占比较高，应优先关注压力利用效率。'
          : '沿程损失整体处于可读区间，可继续跟踪变化趋势。',
      accent: '#f59e0b',
    },
    {
      label: '末站进站压头',
      value: formatValue(endStationPressure, 'm'),
      note:
        endStationPressure !== null && endStationPressure > 0
          ? '末端压力保持为正，当前方案具备基本输送可行性。'
          : '末端压力不足，需要优先复核当前方案。',
      accent: '#12b981',
    },
  ];

  const secondaryResultItems: HydraulicMetricPanelItem[] = [
    { label: '雷诺数', value: reynoldsNumberText, note: '用于判断当前流动状态。', accent: '#4e86f7' },
    { label: '流态', value: flowRegimeText, note: '反映当前工况下的流动特征。', accent: '#12b981' },
    { label: '水力坡降', value: hydraulicSlopeText, note: '用于观察沿程能量损失趋势。', accent: '#f59e0b' },
  ];

  const pressureInsightSections = buildHydraulicPressureInsightSections({
    firstStationOutPressure,
    endStationPressure,
    inletPressure,
    frictionRatio,
  });

  const headCompositionInsightSections = buildHydraulicHeadCompositionInsightSections({
    totalHead,
    frictionHeadLoss,
    endStationPressure,
    frictionRatio,
  });

  const fallbackRiskItems: Array<(typeof report.risks)[number] | null> = [
    frictionRatio !== null && frictionRatio >= 0.25
      ? {
          target: projectName,
          riskType: '沿程压损',
          level: '中',
          reason: '摩阻损失在总扬程中占比较高，说明沿程阻力偏大。',
          impact: '可能导致沿程压损持续增加，并在高流量工况下进一步压缩末站压力裕度。',
          suggestion: '建议优先复核管道阻力参数与流量设定。',
        }
      : null,
    endStationPressure !== null && endStationPressure <= 0
      ? {
          target: projectName,
          riskType: '末端压力',
          level: '高',
          reason: '末站进站压头已低于 0，末端压力无法满足基本输送要求。',
          impact: '会直接影响系统输送可行性，当前方案存在明显运行边界风险。',
          suggestion: '建议立即复核泵组配置与供压能力。',
        }
      : endStationPressure !== null && endStationPressure <= 100
        ? {
            target: projectName,
            riskType: '末端压力裕度',
            level: '中',
            reason: '末站进站压头虽为正，但压力裕度有限。',
            impact: '在工况波动或流量提升时，末端压力更容易出现回落。',
          suggestion: '建议持续跟踪末端压力并校核关键工况。',
        }
        : null,
  ];
  const resolvedFallbackRiskItems = fallbackRiskItems.filter((item): item is (typeof report.risks)[number] => Boolean(item));

  const displayRiskItems = riskItems.length
    ? riskItems
    : resolvedFallbackRiskItems.length
      ? resolvedFallbackRiskItems
      : [
          {
            target: projectName,
            riskType: '运行稳定性',
            level: '低',
            reason: '当前主要指标未显示明显异常，末站进站压头保持为正。',
            impact: '当前方案整体具备输送可行性，但仍需持续关注流量波动带来的压损变化。',
            suggestion: '建议维持常规监测频率并定期复核关键参数。',
          },
        ];

  const fallbackSuggestionItems: Array<(typeof report.suggestions)[number] | null> = [
    frictionRatio !== null && frictionRatio >= 0.25
      ? {
          target: projectName,
          reason: '当前摩阻损失较高，说明沿程损失占比较大。',
          action: '复核管道粗糙度、流量设定及沿程阻力参数。',
          expected: '有助于改善输送稳定性，并降低压损增长风险。',
          priority: 'medium',
        }
      : null,
    totalHead !== null && totalHead > 0
      ? {
          target: projectName,
          reason: '当前方案能够满足基本输送要求，但仍需要控制无效扬程消耗。',
          action: '持续校核首站出站压头与末站进站压头的匹配情况，并优化泵组运行点。',
          expected: '有助于提升压力利用效率并稳定末端压力。',
          priority: 'medium',
        }
      : null,
  ];
  const resolvedFallbackSuggestionItems = fallbackSuggestionItems.filter(
    (item): item is (typeof report.suggestions)[number] => Boolean(item),
  );

  const displaySuggestionItems = suggestionItems.length
    ? suggestionItems
    : resolvedFallbackSuggestionItems.length
      ? resolvedFallbackSuggestionItems
      : [
          {
            target: projectName,
            reason: '当前方案整体可行，但运行边界仍会受工况波动影响。',
            action: '持续跟踪总扬程、摩阻损失和末站进站压头的联动变化。',
            expected: '有助于及时发现压损上升或末端压力回落风险。',
            priority: 'medium',
          },
        ];

  const headChangeChartOption: EChartsOption = {
    tooltip: { trigger: 'axis' },
    grid: { left: 48, right: 24, top: 32, bottom: 40 },
    xAxis: {
      type: 'category',
      data: ['首站进站压头', '首站出站压头', '末站进站压头'],
      axisLine: { lineStyle: { color: '#cbd5e1' } },
      axisLabel: { color: '#64748b' },
    },
    yAxis: {
      type: 'value',
      name: '压头 / 扬程 (m)',
      nameTextStyle: { color: '#64748b' },
      axisLine: { show: false },
      axisLabel: { color: '#64748b' },
      splitLine: { lineStyle: { color: '#e2e8f0' } },
    },
    series: [
      {
        type: 'line',
        smooth: true,
        symbolSize: 10,
        lineStyle: { width: 3, color: '#4e86f7' },
        itemStyle: { color: '#4e86f7' },
        areaStyle: { color: 'rgba(78, 134, 247, 0.16)' },
        data: [
          toFiniteNumber(pickFirstValue(inputSources, ['inletPressure'])),
          toFiniteNumber(pickFirstValue(outputSources, ['firstStationOutPressure'])),
          toFiniteNumber(pickFirstValue(outputSources, ['endStationInPressure', 'endStationPressure'])),
        ],
      },
    ],
  };

  const headCompositionChartOption: EChartsOption = {
    tooltip: { trigger: 'axis' },
    grid: { left: 48, right: 24, top: 32, bottom: 40 },
    xAxis: {
      type: 'category',
      data: ['摩阻损失', '高程差', '总扬程', '末站进站压头'],
      axisLine: { lineStyle: { color: '#cbd5e1' } },
      axisLabel: { color: '#64748b' },
    },
    yAxis: {
      type: 'value',
      name: 'm',
      nameTextStyle: { color: '#64748b' },
      axisLine: { show: false },
      axisLabel: { color: '#64748b' },
      splitLine: { lineStyle: { color: '#e2e8f0' } },
    },
    series: [
      {
        type: 'bar',
        barMaxWidth: 42,
        itemStyle: {
          borderRadius: [10, 10, 0, 0],
          color: '#7c6cff',
        },
        data: [
          toFiniteNumber(pickFirstValue(outputSources, ['frictionHeadLoss'])),
          elevationDiff,
          toFiniteNumber(pickFirstValue(outputSources, ['totalHead'])),
          toFiniteNumber(pickFirstValue(outputSources, ['endStationInPressure', 'endStationPressure'])),
        ],
      },
    ],
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" title="参数区">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 12 }}>核心参数卡</div>
            <HydraulicMetricPanelGrid items={coreParameterItems} minWidth={180} valueFontSize="clamp(20px, 2.3vw, 28px)" />
          </div>

          <div style={{ paddingTop: 18, borderTop: '1px solid rgba(226, 232, 240, 0.92)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 12 }}>补充参数表</div>
            <HydraulicCompactFieldTable items={supplementaryParameterItems} />
          </div>
        </div>
      </Card>

      <Card size="small" title="结果区">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 12 }}>主结果卡</div>
            <HydraulicMetricPanelGrid
              items={primaryResultItems}
              minWidth={220}
              valueFontSize="clamp(26px, 3vw, 40px)"
              noteFontSize={12}
            />
          </div>

          <div style={{ paddingTop: 18, borderTop: '1px solid rgba(226, 232, 240, 0.92)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 12 }}>次级信息</div>
            <HydraulicMetricPanelGrid
              items={secondaryResultItems}
              minWidth={200}
              valueFontSize="clamp(16px, 1.8vw, 22px)"
              noteFontSize={11}
            />
          </div>
        </div>
      </Card>

      <Card size="small" title="图表分析区">
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={16}>
            <Card size="small" title="压头变化图">
              <Chart option={headChangeChartOption} height={300} />
            </Card>
          </Col>
          <Col xs={24} xl={8}>
            <HydraulicInsightCard title="压头变化解读" accentColor="#4e86f7" sections={pressureInsightSections} />
          </Col>

          <Col xs={24} xl={16}>
            <Card size="small" title="扬程构成图">
              <Chart option={headCompositionChartOption} height={300} />
            </Card>
          </Col>
          <Col xs={24} xl={8}>
            <HydraulicInsightCard title="扬程构成解读" accentColor="#7c6cff" sections={headCompositionInsightSections} />
          </Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card size="small" title="风险识别" style={{ height: '100%' }} bodyStyle={{ padding: 18 }}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {displayRiskItems.map((item, index) => (
                <div
                  key={`${item.target}-${index}`}
                  style={{
                    borderRadius: 18,
                    padding: 18,
                    background: 'linear-gradient(180deg, rgba(254, 242, 242, 0.95) 0%, rgba(255,255,255,1) 100%)',
                    border: '1px solid #fecaca',
                    boxShadow: '0 10px 24px rgba(239, 68, 68, 0.08)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <Text strong style={{ fontSize: 16, color: '#0f172a' }}>
                      风险 {index + 1}
                    </Text>
                    <Tag color={getHydraulicRiskLevelTagColor(item.level)} style={{ marginInlineEnd: 0 }}>
                      {item.level || '中'}
                    </Tag>
                  </div>
                  <Paragraph style={{ margin: '14px 0 8px', color: '#334155' }}>
                    <Text strong style={{ color: '#991b1b' }}>
                      对象：
                    </Text>
                    {item.target || projectName}
                  </Paragraph>
                  <Paragraph style={{ margin: '0 0 8px', color: '#334155' }}>
                    <Text strong style={{ color: '#991b1b' }}>
                      原因：
                    </Text>
                    {item.reason || item.message || '当前数据不足以支持进一步判断。'}
                  </Paragraph>
                  <Paragraph style={{ margin: 0, color: '#334155' }}>
                    <Text strong style={{ color: '#991b1b' }}>
                      影响：
                    </Text>
                    {item.impact || item.suggestion || '会对系统稳定性和运行边界判断带来额外扰动。'}
                  </Paragraph>
                </div>
              ))}
            </Space>
          </Card>
        </Col>

        <Col xs={24} xl={12}>
          <Card size="small" title="运行建议" style={{ height: '100%' }} bodyStyle={{ padding: 18 }}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {displaySuggestionItems.map((item, index) => (
                <div
                  key={`${item.target}-${index}`}
                  style={{
                    borderRadius: 18,
                    padding: 18,
                    background: 'linear-gradient(180deg, rgba(239, 246, 255, 0.96) 0%, rgba(255,255,255,1) 100%)',
                    border: '1px solid #bfdbfe',
                    boxShadow: '0 10px 24px rgba(59, 130, 246, 0.08)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <Text strong style={{ fontSize: 16, color: '#0f172a' }}>
                      建议 {index + 1}
                    </Text>
                    <Tag color={getHydraulicSuggestionPriorityTagColor(item.priority)} style={{ marginInlineEnd: 0 }}>
                      {getHydraulicSuggestionPriorityLabel(item.priority)}
                    </Tag>
                  </div>
                  <Paragraph style={{ margin: '14px 0 8px', color: '#334155' }}>
                    <Text strong style={{ color: '#1d4ed8' }}>
                      建议：
                    </Text>
                    {item.text || item.action}
                  </Paragraph>
                  <Paragraph style={{ margin: '0 0 8px', color: '#334155' }}>
                    <Text strong style={{ color: '#1d4ed8' }}>
                      原因：
                    </Text>
                    {item.reason || '当前数据不足以支持进一步判断。'}
                  </Paragraph>
                  <Paragraph style={{ margin: 0, color: '#334155' }}>
                    <Text strong style={{ color: '#1d4ed8' }}>
                      预期效果：
                    </Text>
                    {item.expected || '帮助当前系统在后续工况下保持更稳的运行状态。'}
                  </Paragraph>
                </div>
              ))}
            </Space>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

function createOptimizationComparisonReportPresentation(
  report: DynamicReportResponsePayload,
  snapshot: OptimizationComparisonReportSnapshot,
) {
  const metrics = attachOptimizationComparisonScores(
    snapshot.projects.map((project) => buildOptimizationComparisonProjectMetrics(project)),
  );
  const sortedByScore = [...metrics].sort((a, b) => b.comparisonScore - a.comparisonScore);
  const bestProject = sortedByScore[0];
  const costLeader = [...metrics].sort((a, b) => (a.totalCost ?? Number.POSITIVE_INFINITY) - (b.totalCost ?? Number.POSITIVE_INFINITY))[0];
  const energyLeader = [...metrics].sort(
    (a, b) => (a.totalEnergyConsumption ?? Number.POSITIVE_INFINITY) - (b.totalEnergyConsumption ?? Number.POSITIVE_INFINITY),
  )[0];
  const pressureLeader = [...metrics].sort(
    (a, b) => (b.endStationInPressure ?? Number.NEGATIVE_INFINITY) - (a.endStationInPressure ?? Number.NEGATIVE_INFINITY),
  )[0];
  const riskLeader = [...metrics].sort((a, b) => getOptimizationRiskPriority(a.riskLevel) - getOptimizationRiskPriority(b.riskLevel))[0];
  const projectNames = metrics.map((item) => item.projectName).join('、');

  const summaryFallback = [
    bestProject ? `${bestProject.projectName}综合评分最高，成本与能耗表现更均衡。` : '当前数据不足以支持进一步判断。',
    riskLeader ? `${riskLeader.projectName}风险等级为${riskLeader.riskLevel}，需重点关注可行性与压头保障。` : '风险等级暂无清晰结论。',
  ];

  const highlightFallback = [
    costLeader ? `最低总成本项目：${costLeader.projectName}（${formatValue(costLeader.totalCost, '万元')}）。` : '',
    energyLeader ? `最低年能耗项目：${energyLeader.projectName}（${formatValue(energyLeader.totalEnergyConsumption, '万kWh')}）。` : '',
    pressureLeader ? `末站进站压头最高项目：${pressureLeader.projectName}（${formatValue(pressureLeader.endStationInPressure, 'm')}）。` : '',
  ].filter(Boolean);

  const conclusionFallback = bestProject
    ? `${bestProject.projectName}在可行性、成本与能耗维度表现更优，建议优先作为推荐方案。`
    : report.conclusion;

  return {
    ...report,
    title: report.title || `${projectNames || '多项目'}泵站优化对比报告`,
    abstract: report.abstract || summaryFallback[0],
    summary: report.summary.length ? report.summary : summaryFallback,
    highlights: report.highlights.length ? report.highlights : highlightFallback,
    conclusion: report.conclusion || conclusionFallback || report.abstract,
    metadata: {
      ...(report.metadata ?? {}),
      optimizationComparisonSnapshot: snapshot,
    },
  } satisfies DynamicReportResponsePayload;
}

function renderOptimizationComparisonAiReportContent(
  report: DynamicReportResponsePayload,
  snapshot: OptimizationComparisonReportSnapshot,
) {
  const metrics = attachOptimizationComparisonScores(
    snapshot.projects.map((project) => buildOptimizationComparisonProjectMetrics(project)),
  );
  const sortedByScore = [...metrics].sort((a, b) => b.comparisonScore - a.comparisonScore);
  const bestProject = sortedByScore[0];
  const costLeader = [...metrics].sort((a, b) => (a.totalCost ?? Number.POSITIVE_INFINITY) - (b.totalCost ?? Number.POSITIVE_INFINITY))[0];
  const energyLeader = [...metrics].sort(
    (a, b) => (a.totalEnergyConsumption ?? Number.POSITIVE_INFINITY) - (b.totalEnergyConsumption ?? Number.POSITIVE_INFINITY),
  )[0];
  const pressureLeader = [...metrics].sort(
    (a, b) => (b.endStationInPressure ?? Number.NEGATIVE_INFINITY) - (a.endStationInPressure ?? Number.NEGATIVE_INFINITY),
  )[0];
  const riskLeader = [...metrics].sort((a, b) => getOptimizationRiskPriority(a.riskLevel) - getOptimizationRiskPriority(b.riskLevel))[0];
  const latestProject = [...snapshot.projects]
    .filter((item) => item.generatedAt)
    .sort((a, b) => dayjs(b.generatedAt ?? 0).valueOf() - dayjs(a.generatedAt ?? 0).valueOf())[0];

  const resultCards = filterMetricCards([
    {
      label: '综合评分最高',
      value: bestProject ? `${bestProject.projectName} ${bestProject.comparisonScore} 分` : '-',
      tone: 'blue',
      span: 6,
    },
    {
      label: '最低总成本',
      value: costLeader ? `${costLeader.projectName} ${formatValue(costLeader.totalCost, '万元')}` : '-',
      tone: 'cyan',
      span: 6,
    },
    {
      label: '最低年能耗',
      value: energyLeader ? `${energyLeader.projectName} ${formatValue(energyLeader.totalEnergyConsumption, '万kWh')}` : '-',
      tone: 'green',
      span: 6,
    },
    {
      label: '最高末站压头',
      value: pressureLeader ? `${pressureLeader.projectName} ${formatValue(pressureLeader.endStationInPressure, 'm')}` : '-',
      tone: 'purple',
      span: 6,
    },
  ]);

  const comparisonChartOption: EChartsOption = {
    tooltip: { trigger: 'axis' },
    grid: { left: 48, right: 24, top: 32, bottom: 40 },
    xAxis: {
      type: 'category',
      data: sortedByScore.map((item) => item.projectName),
      axisLabel: { color: '#64748b' },
      axisLine: { lineStyle: { color: '#cbd5e1' } },
    },
    yAxis: {
      type: 'value',
      name: '综合评分',
      nameTextStyle: { color: '#64748b' },
      axisLine: { show: false },
      axisLabel: { color: '#64748b' },
      splitLine: { lineStyle: { color: '#e2e8f0' } },
    },
    series: [
      {
        type: 'bar',
        barMaxWidth: 36,
        itemStyle: { color: '#6d83ff', borderRadius: [10, 10, 0, 0] },
        data: sortedByScore.map((item) => item.comparisonScore),
      },
    ],
  };

  const costEnergyChartOption: EChartsOption = {
    tooltip: { trigger: 'axis' },
    grid: { left: 48, right: 40, top: 32, bottom: 40 },
    xAxis: {
      type: 'category',
      data: metrics.map((item) => item.projectName),
      axisLabel: { color: '#64748b' },
      axisLine: { lineStyle: { color: '#cbd5e1' } },
    },
    yAxis: [
      {
        type: 'value',
        name: '总成本 (万元)',
        nameTextStyle: { color: '#64748b' },
        axisLine: { show: false },
        axisLabel: { color: '#64748b' },
        splitLine: { lineStyle: { color: '#e2e8f0' } },
      },
      {
        type: 'value',
        name: '年能耗 (万kWh)',
        nameTextStyle: { color: '#64748b' },
        axisLine: { show: false },
        axisLabel: { color: '#64748b' },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        type: 'bar',
        name: '总成本',
        barMaxWidth: 32,
        itemStyle: { color: '#5ad8a6', borderRadius: [8, 8, 0, 0] },
        data: metrics.map((item) => item.totalCost ?? 0),
      },
      {
        type: 'line',
        name: '年能耗',
        yAxisIndex: 1,
        smooth: true,
        symbolSize: 10,
        lineStyle: { width: 3, color: '#ffb84d' },
        itemStyle: { color: '#ffb84d' },
        data: metrics.map((item) => item.totalEnergyConsumption ?? 0),
      },
    ],
  };

  const pressureChartOption: EChartsOption = {
    tooltip: { trigger: 'axis' },
    grid: { left: 48, right: 24, top: 32, bottom: 40 },
    xAxis: {
      type: 'category',
      data: metrics.map((item) => item.projectName),
      axisLabel: { color: '#64748b' },
      axisLine: { lineStyle: { color: '#cbd5e1' } },
    },
    yAxis: {
      type: 'value',
      name: 'm',
      nameTextStyle: { color: '#64748b' },
      axisLine: { show: false },
      axisLabel: { color: '#64748b' },
      splitLine: { lineStyle: { color: '#e2e8f0' } },
    },
    series: [
      {
        type: 'bar',
        name: '总扬程',
        barMaxWidth: 28,
        itemStyle: { color: '#7c6cff', borderRadius: [8, 8, 0, 0] },
        data: metrics.map((item) => item.totalHead ?? 0),
      },
      {
        type: 'bar',
        name: '总压降',
        barMaxWidth: 28,
        itemStyle: { color: '#9ab9ff', borderRadius: [8, 8, 0, 0] },
        data: metrics.map((item) => item.totalPressureDrop ?? 0),
      },
      {
        type: 'line',
        name: '末站进站压头',
        smooth: true,
        symbolSize: 10,
        lineStyle: { width: 3, color: '#ff7a8c' },
        itemStyle: { color: '#ff7a8c' },
        data: metrics.map((item) => item.endStationInPressure ?? 0),
      },
    ],
  };

  const analysisSummary = report.summary.length
    ? report.summary
    : [
        bestProject ? `${bestProject.projectName}综合评分最高，建议优先作为推荐方案。` : '当前数据不足以支持进一步判断。',
        costLeader && energyLeader
          ? `${costLeader.projectName}在成本上最优，${energyLeader.projectName}在能耗上更具优势。`
          : '成本与能耗差异不明显。',
      ];

  const analysisHighlights = report.highlights.length
    ? report.highlights
    : [
        pressureLeader ? `末站进站压头最高的是${pressureLeader.projectName}，更利于末端压力保障。` : '',
        riskLeader ? `${riskLeader.projectName}风险等级${riskLeader.riskLevel}，需要重点复核。` : '',
      ].filter(Boolean);

  const riskRecognition = report.risks.length
    ? report.risks.map((item) => `${item.target}：${item.reason}`)
    : [
        riskLeader
          ? `${riskLeader.projectName}风险等级${riskLeader.riskLevel}，建议重点检查泵组组合与压头冗余。`
          : '当前数据不足以支持进一步判断。',
      ];

  const suggestionList = report.suggestions.length
    ? report.suggestions.map((item) => `${item.target}：${item.action}（预期：${item.expected}）`)
    : [
        bestProject ? `优先推进${bestProject.projectName}，同步复核高风险项目的泵组匹配。` : '当前数据不足以支持进一步判断。',
      ];

  const comparisonColumns: ColumnsType<OptimizationComparisonProjectMetrics & { key: string }> = [
    { title: '项目名称', dataIndex: 'projectName', key: 'projectName', width: 180 },
    { title: '项目编号', dataIndex: 'projectNumber', key: 'projectNumber', width: 140 },
    { title: '负责人', dataIndex: 'responsible', key: 'responsible', width: 120 },
    { title: '可行性', dataIndex: 'feasibilityText', key: 'feasibilityText', width: 120 },
    {
      title: '总成本(万元)',
      dataIndex: 'totalCost',
      key: 'totalCost',
      width: 140,
      render: (value: number | null) => formatValue(value, '万元'),
    },
    {
      title: '年能耗(万kWh)',
      dataIndex: 'totalEnergyConsumption',
      key: 'totalEnergyConsumption',
      width: 150,
      render: (value: number | null) => formatValue(value, '万kWh'),
    },
    {
      title: '总扬程(m)',
      dataIndex: 'totalHead',
      key: 'totalHead',
      width: 120,
      render: (value: number | null) => formatValue(value, 'm'),
    },
    {
      title: '末站进站压头(m)',
      dataIndex: 'endStationInPressure',
      key: 'endStationInPressure',
      width: 150,
      render: (value: number | null) => formatValue(value, 'm'),
    },
    {
      title: '综合评分',
      dataIndex: 'comparisonScore',
      key: 'comparisonScore',
      width: 120,
      render: (value: number) => `${value} 分`,
    },
    { title: '风险等级', dataIndex: 'riskLevel', key: 'riskLevel', width: 120 },
  ];

  const comparisonDataSource = metrics.map((item, index) => ({
    key: `${item.projectName}-${index}`,
    ...item,
  }));

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" title="综合结果卡片">
        {renderDetailMetricCards(resultCards, {
          singleLine: true,
          compact: true,
          minColumnWidth: 200,
          minHeight: 88,
          valueFontSize: 'clamp(14px, 1.8vw, 18px)',
        })}
      </Card>

      <Card size="small" title="对比图表">
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={12}>
            <Card size="small" title="综合评分对比">
              <Chart option={comparisonChartOption} height={300} />
            </Card>
          </Col>
          <Col xs={24} xl={12}>
            <Card size="small" title="成本与能耗对比">
              <Chart option={costEnergyChartOption} height={300} />
            </Card>
          </Col>
          <Col xs={24}>
            <Card size="small" title="压头与压降对比">
              <Chart option={pressureChartOption} height={320} />
            </Card>
          </Col>
        </Row>
      </Card>

      <Card size="small" title="项目对比明细">
        <Table
          columns={comparisonColumns}
          dataSource={comparisonDataSource}
          pagination={false}
          size="small"
          scroll={{ x: 1300 }}
        />
      </Card>

      <Card size="small" title="AI分析">
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card size="small" title="结果摘要">
            {renderSummaryList(analysisSummary)}
          </Card>

          <Card size="small" title="指标洞察">
            {renderSummaryList(analysisHighlights)}
          </Card>

          <Card size="small" title="风险识别">
            {renderSummaryList(riskRecognition)}
          </Card>

          <Card size="small" title="优化建议">
            {renderSummaryList(suggestionList)}
          </Card>

          <Alert
            type="info"
            showIcon
            message="结论"
            description={
              report.conclusion ||
              (bestProject ? `${bestProject.projectName}综合表现领先，可作为当前优先方案。` : '当前数据不足以支持进一步判断。')
            }
          />
          {latestProject ? (
            <Text type="secondary">最近更新：{latestProject.projectName}（{formatTime(latestProject.generatedAt ?? undefined)}）</Text>
          ) : null}
        </Space>
      </Card>
    </Space>
  );
}

function renderOptimizationAiReportContentV2(
  report: DynamicReportResponsePayload,
  snapshot: OptimizationReportSnapshot,
) {
  const inputSources = [snapshot.input];
  const outputSources = [snapshot.output];
  const projectName = snapshot.projectName || '当前项目';
  const recommendedCombination = buildOptimizationPumpCombination(outputSources);
  const pump480Num = toFiniteNumber(pickFirstValue(outputSources, ['pump480Num']));
  const pump375Num = toFiniteNumber(pickFirstValue(outputSources, ['pump375Num']));
  const totalHead = toFiniteNumber(pickFirstValue(outputSources, ['totalHead']));
  const totalPressureDrop = toFiniteNumber(pickFirstValue(outputSources, ['totalPressureDrop', 'pressureDrop']));
  const endStationInPressure = toFiniteNumber(
    pickFirstValue(outputSources, ['endStationInPressure', 'terminalInPressure']),
  );
  const totalEnergyConsumption = toFiniteNumber(
    pickFirstValue(outputSources, ['totalEnergyConsumption', 'annualEnergyConsumption', 'energyConsumption']),
  );
  const totalCost = toFiniteNumber(pickFirstValue(outputSources, ['totalCost', 'annualCost']));
  const isFeasibleValue = pickFirstValue(outputSources, ['isFeasible', 'feasible']);
  const isFeasible = typeof isFeasibleValue === 'boolean' ? isFeasibleValue : null;
  const feasibilityText =
    isFeasible === null ? '当前数据不足以支持进一步判断' : isFeasible ? '可行' : '不可行';
  const recommendationText =
    formatValue(pickFirstValue(outputSources, ['description', 'recommendation', 'remark'])) || '当前数据不足以支持进一步判断';
  const startAltitudeText = formatValue(pickFirstValue(inputSources, ['startAltitude', 'startElevation']), 'm');
  const endAltitudeText = formatValue(pickFirstValue(inputSources, ['endAltitude', 'endElevation']), 'm');
  const schemeExplainFallbackItems = [
    `当前推荐方案为 ${recommendedCombination}，说明该组合更符合当前工况下的泵站运行需求。`,
    `总扬程 ${formatValue(totalHead, 'm')} 与总压降 ${formatValue(totalPressureDrop, 'm')} 共同反映了该方案需要承担的能量供给与输送损失水平。`,
    `末站进站压头为 ${formatValue(endStationInPressure, 'm')}，该指标直接关系到当前推荐方案对末端压力的保障能力。`,
    `推荐说明为：${recommendationText}。这也是当前方案被优先采用的重要依据。`,
  ];
  const schemeExplainItems = getOptimizationSchemeExplainItems(report, schemeExplainFallbackItems);

  const comparisonFallbackItems = [
    `当前推荐方案为 ${recommendedCombination}，优先原因在于其在可行性、压头保障与运行经济性之间取得了较为均衡的结果。`,
    isFeasible === false
      ? '现有返回结果显示当前推荐方案仍存在可行性不足，说明部分候选组合受约束条件限制较大。'
      : '从当前结果看，推荐方案已满足基本运行要求，可作为当前工况下的优先候选组合。',
    recommendationText !== '当前数据不足以支持进一步判断'
      ? `结合系统返回的推荐说明，当前方案与其他候选组合相比更贴近本次优化目标：${recommendationText}。`
      : '当前输出未返回完整候选方案明细，暂时无法展开逐项排序对比。',
  ].filter((item): item is string => Boolean(item));
  const comparisonItems = getOptimizationComparisonItems(report, comparisonFallbackItems);

  const riskItems = getOptimizationRiskItems(report);

  const suggestionItems = getOptimizationSuggestionItems(report);

  const optimizationInsights = report.aiAnalysis?.optimizationInsights;
  const schemeInsightBlock: OptimizationInsightBlockData = {
    title: optimizationInsights?.schemeInsight?.title || '方案解读',
    content:
      optimizationInsights?.schemeInsight?.content ||
      [
        `当前推荐泵组为 ${recommendedCombination}。`,
        recommendationText !== '当前数据不足以支持进一步判断'
          ? `系统推荐说明指出：${recommendationText}。`
          : '该组合当前被系统优先推荐，说明它更接近本次优化目标。',
        schemeExplainItems[0],
      ]
        .filter((item): item is string => Boolean(item))
        .join(' '),
  };

  const feasibilityInsightBlock: OptimizationInsightBlockData = {
    title: optimizationInsights?.feasibilityInsight?.title || '水力可行性解读',
    content:
      optimizationInsights?.feasibilityInsight?.content ||
      [
        `当前方案总扬程为 ${formatValue(totalHead, 'm')}，总压降为 ${formatValue(totalPressureDrop, 'm')}，末站进站压头为 ${formatValue(endStationInPressure, 'm')}。`,
        feasibilityText === '可行'
          ? '结果表明当前方案具备基本水力可行性，能够满足当前工况下的输送要求。'
          : '结果显示当前方案仍存在明显约束边界，需要进一步复核扬程匹配与末端压力保障。'
        ,
        comparisonItems[0],
      ]
        .filter((item): item is string => Boolean(item))
        .join(' '),
  };

  const economicInsightBlock: OptimizationInsightBlockData = {
    title: optimizationInsights?.economicInsight?.title || '经济性解读',
    content:
      optimizationInsights?.economicInsight?.content ||
      [
        `当前方案年能耗为 ${formatValue(totalEnergyConsumption, 'kWh')}，总成本为 ${formatValue(totalCost, '元')}。`,
        totalEnergyConsumption !== null && totalEnergyConsumption >= 1000000
          ? '当前年能耗水平偏高，后续需要继续关注泵组效率与运行时长安排。'
          : totalCost !== null && totalCost >= 800000
            ? '当前总成本压力较大，说明方案虽然可行，但仍有进一步优化经济性的空间。'
            : '从当前结果看，方案在满足运行要求的同时兼顾了一定经济性。',
        comparisonItems[1],
      ]
        .filter((item): item is string => Boolean(item))
        .join(' '),
  };
  const energyOverviewStatus = getOptimizationOverviewStatus(totalEnergyConsumption, isFeasible);
  const costOverviewStatus = getOptimizationOverviewStatus(totalCost, isFeasible);

  const optimizationInputCards: DetailMetricCardItem[] = [
    {
      label: '流量',
      value: formatValue(pickFirstValue(inputSources, ['flowRate', 'targetFlow', 'throughput', 'flow']), 'm3/h'),
      tone: 'blue',
    },
    { label: '密度', value: formatValue(pickFirstValue(inputSources, ['density']), 'kg/m3'), tone: 'cyan' },
    { label: '粘度', value: formatValue(pickFirstValue(inputSources, ['viscosity']), 'mPa·s'), tone: 'green' },
    { label: '长度', value: formatValue(pickFirstValue(inputSources, ['length', 'pipelineLength']), 'm'), tone: 'amber' },
    { label: '管径', value: formatValue(pickFirstValue(inputSources, ['diameter', 'pipeDiameter']), 'mm'), tone: 'purple' },
    {
      label: '首站进站压头',
      value: formatValue(pickFirstValue(inputSources, ['inletPressure', 'firstStationInPressure', 'stationInPressure']), 'm'),
      tone: 'blue',
    },
    { label: '起点高程', value: startAltitudeText, tone: 'green' },
    { label: '终点高程', value: endAltitudeText, tone: 'green' },
    { label: '泵站参数', value: buildPumpHeadDisplay(inputSources), tone: 'purple', span: 12 },
    { label: '效率', value: buildEfficiencyDisplay(inputSources), tone: 'cyan', span: 12 },
    { label: '电价', value: formatValue(pickFirstValue(inputSources, ['electricityPrice', 'powerPrice']), '元/kWh'), tone: 'amber' },
    { label: '工作天数', value: formatValue(pickFirstValue(inputSources, ['workingDays']), '天'), tone: 'blue' },
  ];

  const optimizationOutputCards: DetailMetricCardItem[] = [
    { label: '推荐泵组合', value: recommendedCombination, tone: 'purple', span: 8 },
    { label: '可行性', value: feasibilityText, tone: 'green' },
    { label: '480 泵台数', value: formatValue(pump480Num, '台'), tone: 'blue' },
    { label: '375 泵台数', value: formatValue(pump375Num, '台'), tone: 'cyan' },
    { label: '总扬程', value: formatValue(totalHead, 'm'), tone: 'blue' },
    { label: '总压降', value: formatValue(totalPressureDrop, 'm'), tone: 'cyan' },
    { label: '末站进站压头', value: formatValue(endStationInPressure, 'm'), tone: 'green' },
    { label: '年能耗', value: formatValue(totalEnergyConsumption, 'kWh'), tone: 'amber' },
    { label: '总成本', value: formatValue(totalCost, '元'), tone: 'purple' },
  ];

  const fallbackRiskItems: Array<(typeof report.risks)[number] | null> = [
    isFeasible === false
      ? {
          target: projectName,
          riskType: 'scheme_feasibility',
          level: '高',
          reason: '推荐泵组尚未完全满足当前工况约束，说明扬程配置或压力边界仍需继续复核。',
          impact: '会直接影响当前方案的稳定投用，并可能导致末端压力无法持续满足要求。',
          suggestion: '建议优先复核压力边界与泵组组合。',
        }
      : null,
    endStationInPressure !== null && endStationInPressure < 10
      ? {
          target: projectName,
          riskType: 'end_pressure_margin',
          level: '中',
          reason: '末站进站压头偏低，末端压力裕度有限。',
          impact: '在流量波动或边界工况变化时，更容易出现末端压力回落。',
          suggestion: '建议持续跟踪末端压力并预留调泵空间。',
        }
      : null,
    totalEnergyConsumption !== null && totalEnergyConsumption >= 1000000
      ? {
          target: projectName,
          riskType: 'energy_cost_high',
          level: '中',
          reason: '当前方案年能耗偏高，长期运行能耗压力较大。',
          impact: '会提高单位输量能耗，并放大后续运行成本压力。',
          suggestion: '建议继续优化泵组效率和运行时长安排。',
        }
      : totalCost !== null && totalCost >= 800000
        ? {
            target: projectName,
            riskType: 'economic_pressure',
            level: '中',
            reason: '当前方案总成本偏高，说明运行经济性仍有优化空间。',
            impact: '会增加长期运行费用，并削弱方案的综合经济优势。',
            suggestion: '建议继续对比候选组合的成本与能耗结果。',
          }
        : null,
  ];
  const displayRiskItems = riskItems.length
    ? riskItems
    : fallbackRiskItems.filter((item): item is (typeof report.risks)[number] => Boolean(item));

  const fallbackSuggestionItems: Array<(typeof report.suggestions)[number] | null> = [
    {
      target: projectName,
      reason: '当前推荐泵组已经形成明确结果，后续重点是验证它在现场工况下的持续稳定性。',
      action: `优先复核 ${recommendedCombination} 在当前工况下的运行组合，并结合末站进站压头持续跟踪泵组匹配情况。`,
      expected: '有助于确认当前推荐方案是否能够稳定满足实际输送要求。',
      priority: isFeasible === false ? 'high' : 'medium',
      text: null,
    },
    totalPressureDrop !== null && totalPressureDrop >= 20
      ? {
          target: projectName,
          reason: '当前总压降较大，说明方案在输送过程中仍存在较明显的扬程消耗。',
          action: '复核总扬程、总压降与末站进站压头之间的闭合关系，必要时重新校核泵组扬程分配。',
          expected: '有助于进一步确认方案的水力可行性，并降低压头利用不充分的风险。',
          priority: 'medium',
          text: null,
        }
      : null,
    totalEnergyConsumption !== null || totalCost !== null
      ? {
          target: projectName,
          reason: '当前方案的年能耗和总成本是评价推荐方案是否值得执行的关键依据。',
          action: '结合年能耗与总成本结果继续评估经济性，必要时对比其他可行组合的能耗和成本差异。',
          expected: '有助于确认当前推荐方案是否在经济性上具备持续优势。',
          priority: 'medium',
          text: null,
        }
      : null,
  ];
  const displaySuggestionItems = suggestionItems.length
    ? suggestionItems
    : fallbackSuggestionItems.filter((item): item is (typeof report.suggestions)[number] => Boolean(item));
  const optimizationInputPanelItems = buildMetricPanelItems(optimizationInputCards);
  const optimizationOutputPanelItems = buildMetricPanelItems(optimizationOutputCards);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" title="计算输入参数" bodyStyle={{ padding: 18 }}>
        <HydraulicMetricPanelGrid
          items={optimizationInputPanelItems}
          minWidth={210}
          columns={3}
          valueFontSize="clamp(18px, 2vw, 32px)"
        />
      </Card>

      <Card size="small" title="计算输出结果" bodyStyle={{ padding: 18 }}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <HydraulicMetricPanelGrid
            items={optimizationOutputPanelItems}
            minWidth={190}
            columns={3}
            valueFontSize="clamp(18px, 2vw, 32px)"
          />
          <div
            style={{
              borderRadius: 18,
              padding: '16px 18px',
              border: '1px solid rgba(226, 232, 240, 0.95)',
              borderTop: '3px solid #7c6cff',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(124, 108, 255, 0.08) 100%)',
              boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)',
            }}
          >
            <Text strong style={{ display: 'block', color: '#64748b', marginBottom: 10, fontSize: 14 }}>
              推荐说明
            </Text>
            <Paragraph style={{ margin: 0, color: '#334155', lineHeight: 1.8 }}>{recommendationText}</Paragraph>
          </div>
        </Space>
      </Card>

      <Card size="small" title="图表分析区">
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={16}>
            <Card size="small" title="推荐方案主卡" style={{ height: '100%' }}>
              <OptimizationRecommendedSchemeBoard
                recommendedCombination={recommendedCombination}
                pump480Num={pump480Num}
                pump375Num={pump375Num}
                isFeasible={isFeasible}
              />
            </Card>
          </Col>
          <Col xs={24} xl={8}>
            {renderOptimizationInsightCard(schemeInsightBlock, '#7c6cff')}
          </Col>

          <Col xs={24} xl={16}>
            <Card size="small" title="扬程分配图" bodyStyle={{ padding: 18 }}>
              <OptimizationHeadAllocationBand
                totalHead={totalHead}
                totalPressureDrop={totalPressureDrop}
                endStationInPressure={endStationInPressure}
              />
            </Card>
          </Col>
          <Col xs={24} xl={8}>
            {renderOptimizationInsightCard(feasibilityInsightBlock, '#4e86f7')}
          </Col>

          <Col xs={24} xl={16}>
            <Card size="small" title="双指标概览卡" bodyStyle={{ padding: 18 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: 16,
                }}
              >
                <OptimizationOverviewMetricCard
                  title="年能耗"
                  value={totalEnergyConsumption}
                  unit="kWh"
                  badgePrefix="能耗表现"
                  status={energyOverviewStatus}
                  description="反映方案年度运行电耗水平"
                  theme={optimizationOverviewCardThemes.energy}
                />
                <OptimizationOverviewMetricCard
                  title="总成本"
                  value={totalCost}
                  unit="元"
                  badgePrefix="成本表现"
                  status={costOverviewStatus}
                  description="反映方案年度综合运行费用"
                  theme={optimizationOverviewCardThemes.cost}
                />
              </div>
            </Card>
          </Col>
          <Col xs={24} xl={8}>
            {renderOptimizationInsightCard(economicInsightBlock, '#f59e0b')}
          </Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card size="small" title="风险识别" style={{ height: '100%' }} bodyStyle={{ padding: 18 }}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {displayRiskItems.length ? (
                displayRiskItems.map((item, index) => (
                  <div
                    key={`${item.target}-${index}`}
                    style={{
                      borderRadius: 18,
                      padding: 18,
                      background: 'linear-gradient(180deg, rgba(254, 242, 242, 0.95) 0%, rgba(255,255,255,1) 100%)',
                      border: '1px solid #fecaca',
                      boxShadow: '0 10px 24px rgba(239, 68, 68, 0.08)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <Text strong style={{ fontSize: 16, color: '#0f172a' }}>
                        风险 {index + 1}
                      </Text>
                      <Tag color={getOptimizationRiskLevelTagColor(item.level)} style={{ marginInlineEnd: 0 }}>
                        {item.level || '中'}
                      </Tag>
                    </div>
                    <Paragraph style={{ margin: '14px 0 8px', color: '#334155' }}>
                      <Text strong style={{ color: '#991b1b' }}>
                        对象：
                      </Text>
                      {item.target || projectName}
                    </Paragraph>
                    <Paragraph style={{ margin: '0 0 8px', color: '#334155' }}>
                      <Text strong style={{ color: '#991b1b' }}>
                        原因：
                      </Text>
                      {item.reason || item.message || '当前数据不足以支持进一步判断。'}
                    </Paragraph>
                    <Paragraph style={{ margin: 0, color: '#334155' }}>
                      <Text strong style={{ color: '#991b1b' }}>
                        影响：
                      </Text>
                      {item.impact || item.suggestion || '会对方案的稳定执行和经济性判断带来额外扰动。'}
                    </Paragraph>
                  </div>
                ))
              ) : (
                <Text type="secondary">暂无风险识别</Text>
              )}
            </Space>
          </Card>
        </Col>

        <Col xs={24} xl={12}>
          <Card size="small" title="优化建议" style={{ height: '100%' }} bodyStyle={{ padding: 18 }}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {displaySuggestionItems.length ? (
                displaySuggestionItems.map((item, index) => (
                  <div
                    key={`${item.target}-${index}`}
                    style={{
                      borderRadius: 18,
                      padding: 18,
                      background: 'linear-gradient(180deg, rgba(239, 246, 255, 0.96) 0%, rgba(255,255,255,1) 100%)',
                      border: '1px solid #bfdbfe',
                      boxShadow: '0 10px 24px rgba(59, 130, 246, 0.08)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <Text strong style={{ fontSize: 16, color: '#0f172a' }}>
                        建议 {index + 1}
                      </Text>
                      <Tag
                        color={getOptimizationSuggestionPriorityTagColor(item.priority)}
                        style={{ marginInlineEnd: 0 }}
                      >
                        {getOptimizationSuggestionPriorityLabel(item.priority)}
                      </Tag>
                    </div>
                    <Paragraph style={{ margin: '14px 0 8px', color: '#334155' }}>
                      <Text strong style={{ color: '#1d4ed8' }}>
                        建议：
                      </Text>
                      {item.text || item.action}
                    </Paragraph>
                    <Paragraph style={{ margin: '0 0 8px', color: '#334155' }}>
                      <Text strong style={{ color: '#1d4ed8' }}>
                        原因：
                      </Text>
                      {item.reason || '当前数据不足以支持进一步判断。'}
                    </Paragraph>
                    <Paragraph style={{ margin: 0, color: '#334155' }}>
                      <Text strong style={{ color: '#1d4ed8' }}>
                        预期效果：
                      </Text>
                      {item.expected || '帮助当前方案在后续工况下保持更稳的运行状态。'}
                    </Paragraph>
                  </div>
                ))
              ) : (
                <Text type="secondary">暂无优化建议</Text>
              )}
            </Space>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

function renderSensitivityAiReportContent(report: DynamicReportResponsePayload, snapshot: SensitivityReportSnapshot) {
  const inputPayload = snapshot.input;
  const inputBase = asRecord(getValueByPath(inputPayload, 'baseParams')) ?? inputPayload;
  const outputPayload = snapshot.output;
  const baseResult = asRecord(getValueByPath(outputPayload, 'baseResult')) ?? outputPayload;
  const variableResults = asRecordArray(getValueByPath(outputPayload, 'variableResults'));
  const rankingRows = toSortedSensitivityRankingRows(outputPayload);
  const primaryVariableResult = getSensitivityPrimaryVariableResult(outputPayload);
  const topRank = rankingRows[0];
  const topVariableName = String(
    topRank?.variableName ??
      primaryVariableResult?.variableName ??
      primaryVariableResult?.variableType ??
      buildSensitiveVariableDisplay(inputPayload, inputBase),
  );
  const topRankNumber = toFiniteNumber(topRank?.rank) ?? 1;
  const sensitivityCoefficient = toFiniteNumber(
    topRank?.sensitivityCoefficient ?? primaryVariableResult?.sensitivityCoefficient,
  );
  const maxImpactPercent =
    toFiniteNumber(primaryVariableResult?.maxImpactPercent) ??
    variableResults.reduce<number | null>((current, item) => {
      const next = toFiniteNumber(item.maxImpactPercent);
      if (next === null) {
        return current;
      }
      if (current === null) {
        return next;
      }
      return Math.max(current, next);
    }, null);
  const pointRows = asRecordArray(primaryVariableResult?.dataPoints).sort((a, b) => {
    const changeA = toFiniteNumber(a.changePercent) ?? 0;
    const changeB = toFiniteNumber(b.changePercent) ?? 0;
    return changeA - changeB;
  });
  const firstPoint = pointRows[0];
  const lastPoint = pointRows[pointRows.length - 1];
  const flowRegimeValues = pointRows
    .map((item) => formatValue(item.flowRegime))
    .filter((item) => item && item !== '-');
  const flowRegimeChanged = new Set(flowRegimeValues).size > 1;
  const minEndStationPressure = pointRows.reduce<number | null>((current, item) => {
    const next = toFiniteNumber(item.endStationPressure);
    if (next === null) {
      return current;
    }
    if (current === null) {
      return next;
    }
    return Math.min(current, next);
  }, null);
  const baseEndStationPressure = toFiniteNumber(
    pickFirstValue([baseResult], ['endStationInPressure', 'endStationPressure', 'terminalInPressure']),
  );
  const baseResultStatus =
    baseEndStationPressure === null
      ? '当前数据不足以支持进一步判断'
      : baseEndStationPressure >= 0
        ? '正常'
        : '存在压力风险';
  const riskLevel = evaluateSensitivityRiskLevel({
    sensitivityCoefficient,
    maxImpactPercent,
    minEndStationPressure,
    flowRegimeChanged,
  });
  const sensitivityImpactLevel = classifySensitivityImpactLevel(sensitivityCoefficient);
  const projectName = snapshot.projectName || '当前项目';
  const baseCondition = buildSensitivityBaseCondition(inputPayload, inputBase);
  const variableTypeText = buildSensitiveVariableDisplay(inputPayload, inputBase);

  const pressureTrendText =
    firstPoint && lastPoint
      ? toFiniteNumber(lastPoint.endStationPressure) !== null && toFiniteNumber(firstPoint.endStationPressure) !== null
        ? (toFiniteNumber(lastPoint.endStationPressure) ?? 0) > (toFiniteNumber(firstPoint.endStationPressure) ?? 0)
          ? '整体上升'
          : (toFiniteNumber(lastPoint.endStationPressure) ?? 0) < (toFiniteNumber(firstPoint.endStationPressure) ?? 0)
            ? '整体下降'
            : '变化不明显'
        : '当前数据不足以支持进一步判断'
      : '当前数据不足以支持进一步判断';
  const frictionTrendText =
    firstPoint && lastPoint
      ? toFiniteNumber(lastPoint.frictionHeadLoss) !== null && toFiniteNumber(firstPoint.frictionHeadLoss) !== null
        ? (toFiniteNumber(lastPoint.frictionHeadLoss) ?? 0) > (toFiniteNumber(firstPoint.frictionHeadLoss) ?? 0)
          ? '整体上升'
          : (toFiniteNumber(lastPoint.frictionHeadLoss) ?? 0) < (toFiniteNumber(firstPoint.frictionHeadLoss) ?? 0)
            ? '整体下降'
            : '变化不明显'
        : '当前数据不足以支持进一步判断'
      : '当前数据不足以支持进一步判断';

  const basicInfoCards = filterMetricCards([
    { label: '项目名称', value: projectName, tone: 'blue', span: 6 },
    { label: '分析类型', value: '敏感性分析', tone: 'purple', span: 6 },
    { label: '敏感变量类型', value: variableTypeText, tone: 'cyan', span: 6 },
    { label: '基准工况', value: baseCondition, tone: 'green', span: 12 },
    { label: '生成时间', value: formatTime(snapshot.generatedAt ?? undefined), tone: 'amber', span: 6 },
  ]);

  const coreResultCards = filterMetricCards([
    { label: '基准结果', value: baseResultStatus, tone: 'blue', span: 4 },
    { label: '最敏感变量', value: topVariableName || '-', tone: 'purple', span: 4 },
    { label: '敏感系数', value: formatValue(sensitivityCoefficient), tone: 'cyan', span: 4 },
    { label: '最大影响幅度', value: formatValue(maxImpactPercent, '%'), tone: 'amber', span: 4 },
    { label: '影响排名第 1 名', value: topVariableName || '-', tone: 'green', span: 4 },
    { label: '是否存在明显波动风险', value: riskLevel, tone: 'purple', span: 4 },
  ]);

  const summaryItems = report.summary.length
    ? report.summary
    : [
        `本次敏感性分析以 ${topVariableName} 作为敏感变量，基准工况下系统结果为 ${baseResultStatus}。`,
        `当前变量的敏感系数为 ${formatValue(sensitivityCoefficient)}，最大影响幅度为 ${formatValue(maxImpactPercent, '%')}，在影响程度排序中位列第 ${topRankNumber} 位。`,
        `整体来看，该变量对系统运行结果具有 ${sensitivityImpactLevel} 影响，是评估系统稳定性的重要因素之一。`,
      ];
  const keyFindingItems = report.highlights.length
    ? report.highlights
    : [
        `基准工况为 ${baseCondition}，可作为后续比较不同变化比例结果的参考基础。`,
        `${topVariableName} 的敏感系数为 ${formatValue(sensitivityCoefficient)}，属于${sensitivityImpactLevel}影响，应作为后续运行控制重点关注的参数。`,
        `随着 ${topVariableName} 变化，末站进站压力 ${pressureTrendText}，摩阻损失 ${frictionTrendText}。`,
        flowRegimeChanged ? '不同变化比例下流态发生变化，说明系统存在明显运行状态切换风险。' : '不同变化比例下流态整体稳定，暂未出现明显流态切换。',
      ];
  const riskFallbackItems = [
    sensitivityCoefficient !== null && sensitivityCoefficient >= 0.8
      ? '当前变量敏感系数较高，系统对该变量变化反应明显，应重点加强监测与控制。'
      : null,
    maxImpactPercent !== null && maxImpactPercent >= 20
      ? '当前变量带来的最大影响幅度较大，说明在设定波动范围内系统结果变化明显，存在较高的不稳定风险。'
      : null,
    minEndStationPressure !== null && minEndStationPressure < 0
      ? '部分变化比例下末站进站压力出现低于 0 的情况，说明系统压力稳定性存在明显风险。'
      : null,
    flowRegimeChanged ? '不同变化比例下流态发生变化，说明变量波动可能改变系统流动特征，应重点关注临界区间。' : null,
  ].filter((item): item is string => Boolean(item));
  const suggestionFallbackItems = [
    `建议将 ${topVariableName} 作为运行控制中的重点监测对象，在实际调度和参数管理中优先保证该变量稳定性。`,
    pressureTrendText !== '变化不明显' && pressureTrendText !== '当前数据不足以支持进一步判断'
      ? '建议进一步校核不同工况下的压力分布情况，确保关键节点压力满足运行要求。'
      : null,
    frictionTrendText !== '变化不明显' && frictionTrendText !== '当前数据不足以支持进一步判断'
      ? '建议结合流量、管径、粘度等参数进一步评估阻力增长原因，为优化运行方案提供依据。'
      : null,
    flowRegimeChanged ? '建议在后续分析中增加流态临界区间校核，避免系统在运行波动中进入不稳定状态。' : null,
  ].filter((item): item is string => Boolean(item));

  const sensitivityGaugeMax = getSensitivityGaugeMax(
    rankingRows.map((item) => ({
      rank: toFiniteNumber(item.rank) ?? 0,
      variableName: String(item.variableName ?? item.variableType ?? '-'),
      sensitivityCoefficient: toFiniteNumber(item.sensitivityCoefficient),
      description: String(item.description ?? ''),
    })),
  );
  const rankingInsightBlock: SensitivityInsightBlockData = {
    title: '排名解读',
    content: [
      `敏感系数仪表盘显示，${topVariableName}位列第 ${topRankNumber} 位，敏感系数为 ${formatValue(sensitivityCoefficient)}。`,
      `当前样本中最需要优先关注的变量为 ${topVariableName}。`,
    ].join(' '),
  };

  const trendChartOption: EChartsOption = {
    tooltip: { trigger: 'axis' },
    legend: {
      data: ['末站进站压力', '摩阻损失'],
      top: 0,
      textStyle: { color: '#64748b' },
    },
    grid: { left: 48, right: 48, top: 48, bottom: 32 },
    xAxis: {
      type: 'category',
      name: '变化比例',
      data: pointRows.map((item) => `${formatValue(item.changePercent)}%`),
      axisLabel: { color: '#64748b' },
      axisLine: { lineStyle: { color: '#cbd5e1' } },
    },
    yAxis: [
      {
        type: 'value',
        name: '压力',
        axisLabel: { color: '#64748b' },
        nameTextStyle: { color: '#64748b' },
        splitLine: { lineStyle: { color: '#e2e8f0' } },
      },
      {
        type: 'value',
        name: '摩阻损失',
        axisLabel: { color: '#64748b' },
        nameTextStyle: { color: '#64748b' },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '末站进站压力',
        type: 'line',
        smooth: true,
        symbolSize: 8,
        lineStyle: { width: 3, color: '#4e86f7' },
        itemStyle: { color: '#4e86f7' },
        data: pointRows.map((item) => toFiniteNumber(item.endStationPressure)),
      },
      {
        name: '摩阻损失',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbolSize: 8,
        lineStyle: { width: 3, color: '#12b981' },
        itemStyle: { color: '#12b981' },
        data: pointRows.map((item) => toFiniteNumber(item.frictionHeadLoss)),
      },
    ],
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" title="基本信息">
        {renderDetailMetricCards(basicInfoCards, {
          singleLine: true,
          compact: true,
          minColumnWidth: 220,
          minHeight: 88,
          valueFontSize: 'clamp(14px, 1.8vw, 18px)',
        })}
      </Card>

      <Card size="small" title="核心结果卡片">
        {renderDetailMetricCards(coreResultCards, {
          equalWidth: true,
          singleLine: true,
          compact: true,
          minColumnWidth: 190,
          minHeight: 88,
          valueFontSize: 'clamp(14px, 1.8vw, 18px)',
        })}
      </Card>

      <Card size="small" title="图表分析区">
        <Row gutter={[16, 16]}>
          <Col xs={24}>
            <Card size="small" title="敏感系数仪表盘">
              {rankingRows.length ? (
                <Row gutter={[16, 16]}>
                  {rankingRows.map((item) => (
                    <Col
                      xs={24}
                      {...getSensitivityGaugeColSpan(rankingRows.length)}
                      key={`${formatValue(item.rank)}-${String(item.variableName ?? item.variableType ?? '-')}`}
                    >
                      <SensitivityGaugePanel
                        gaugeMax={sensitivityGaugeMax}
                        item={{
                          rank: toFiniteNumber(item.rank) ?? 0,
                          variableName: String(item.variableName ?? item.variableType ?? '-'),
                          sensitivityCoefficient: toFiniteNumber(item.sensitivityCoefficient),
                          description: String(item.description ?? ''),
                        }}
                      />
                    </Col>
                  ))}
                </Row>
              ) : (
                <Empty description="暂无敏感系数仪表盘数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>
          </Col>
          <Col xs={24}>
            {renderSensitivityInsightCard(rankingInsightBlock, '#7c6cff')}
          </Col>
          <Col xs={24}>
            <Card size="small" title="变化比例-结果变化趋势图">
              <Chart option={trendChartOption} height={300} />
            </Card>
          </Col>
          <Col xs={24}>
            <Card size="small" title="最大影响幅度对比图">
              <SensitivityImpactBandList
                items={variableResults.map((item) => ({
                  variableName: String(item.variableName ?? item.variableType ?? '-'),
                  maxImpactPercent: toFiniteNumber(item.maxImpactPercent),
                }))}
              />
            </Card>
          </Col>
        </Row>
      </Card>

      <Card size="small" title="智能分析正文">
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card size="small" title="结果摘要">
            {renderSummaryList(summaryItems)}
          </Card>

          <Card size="small" title="关键变化分析">
            {renderSummaryList(keyFindingItems)}
          </Card>

          <Card size="small" title="风险识别">
            {report.risks.length ? (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {report.risks.map((item, index) => (
                  <div key={`${item.target}-${index}`}>
                    <Space wrap>
                      <Tag color="red">{item.level}</Tag>
                      <Text strong>{item.target}</Text>
                      <Text>{item.riskType}</Text>
                    </Space>
                    <Paragraph style={{ margin: '8px 0 0' }}>{item.reason}</Paragraph>
                  </div>
                ))}
              </Space>
            ) : riskFallbackItems.length ? (
              renderSummaryList(riskFallbackItems)
            ) : (
              <Text type="secondary">当前数据不足以支持进一步判断</Text>
            )}
          </Card>

          <Card size="small" title="优化建议">
            {report.suggestions.length ? (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {report.suggestions.map((item, index) => (
                  <div key={`${item.target}-${index}`}>
                    <Space wrap>
                      <Tag color="blue">{item.priority}</Tag>
                      <Text strong>{item.target}</Text>
                    </Space>
                    <Paragraph style={{ margin: '8px 0 0' }}>
                      {item.action}。原因：{item.reason}。预期：{item.expected}
                    </Paragraph>
                  </div>
                ))}
              </Space>
            ) : suggestionFallbackItems.length ? (
              renderSummaryList(suggestionFallbackItems)
            ) : (
              <Text type="secondary">当前数据不足以支持进一步判断</Text>
            )}
          </Card>
        </Space>
      </Card>
    </Space>
  );
}

void renderSensitivityAiReportContent;

function renderSensitivityAiReportContentV2(
  report: DynamicReportResponsePayload,
  snapshot: SensitivityReportSnapshot,
) {
  const context = buildSensitivityAnalysisContext(snapshot);
  const {
    variableResults,
    rankingRows,
    impactRankingRows,
    topVariableName,
    topRankNumber,
    sensitivityCoefficient,
    maxImpactPercent,
    pointRows,
    flowRegimeChanged,
    minEndStationPressure,
    baseResultStatus,
    riskLevel,
    sensitivityImpactLevel,
    projectName,
    baseCondition,
    variableTypeText,
    flowRateText,
    densityText,
    diameterText,
    roughnessText,
    pressureTrendText,
    frictionTrendText,
  } = context;

  const rankingSecondRow = rankingRows[1];
  const topImpactRow = impactRankingRows[0];
  const secondImpactRow = impactRankingRows[1];
  const riskCards = buildSensitivityRiskCards(context);
  const suggestionCards = buildSensitivitySuggestionCards(context);
  const skillInsightBlocks = report.aiAnalysis?.sensitivityInsights;
  const rankingInsightBlock: SensitivityInsightBlockData = {
    title: skillInsightBlocks?.rankingInsight?.title || '排名解读',
    content:
      skillInsightBlocks?.rankingInsight?.content ||
      [
        `敏感系数仪表盘显示，${topVariableName}位列第 ${topRankNumber} 位，敏感系数为 ${formatValue(sensitivityCoefficient)}。`,
        rankingSecondRow
          ? `与第二位 ${String(rankingSecondRow.variableName ?? rankingSecondRow.variableType ?? '-')} 的差距反映了当前头部变量的影响集中程度。`
          : null,
        `整体来看，该变量对系统运行结果具有 ${sensitivityImpactLevel} 影响。`,
      ]
        .filter((item): item is string => Boolean(item))
        .join(''),
  };
  const trendInsightBlock: SensitivityInsightBlockData = {
    title: skillInsightBlocks?.trendInsight?.title || '趋势解读',
    content:
      skillInsightBlocks?.trendInsight?.content ||
      [
        `随着 ${topVariableName} 变化，末站进站压力${pressureTrendText}，摩阻损失${frictionTrendText}。`,
        flowRegimeChanged
          ? '变化过程中出现流态切换，说明趋势解读需要重点关注临界区间。'
          : '各变化比例下流态整体稳定，趋势变化可作为运行边界参考。',
      ]
        .filter((item): item is string => Boolean(item))
        .join(''),
  };
  const impactInsightBlock: SensitivityInsightBlockData = {
    title: skillInsightBlocks?.impactInsight?.title || '影响区间分析',
    content:
      skillInsightBlocks?.impactInsight?.content ||
      [
        `最大影响幅度图显示，${String(topImpactRow?.variableName ?? topImpactRow?.variableType ?? topVariableName)} 的最大影响幅度为 ${formatValue(topImpactRow?.maxImpactPercent, '%')}。`,
        secondImpactRow
          ? `与第二位 ${String(secondImpactRow.variableName ?? secondImpactRow.variableType ?? '-')} 对比，可以进一步判断影响是否集中在少数关键变量上。`
          : null,
        `当前样本中该变量的结果响应属于 ${sensitivityImpactLevel} 影响。`,
      ]
        .filter((item): item is string => Boolean(item))
        .join(''),
  };
  const tableConclusionBlock: SensitivityInsightBlockData = {
    title: skillInsightBlocks?.tableConclusion?.title || '区间变化结论',
    content:
      skillInsightBlocks?.tableConclusion?.content ||
      [
        `基准工况为 ${baseCondition}，可作为比较不同变化比例结果的参考基础。`,
        minEndStationPressure !== null && minEndStationPressure < 0
          ? '区间表格已出现末站压力为负的情形，说明部分变化区间存在明显运行边界风险。'
          : '当前区间表格未出现明显末站压力失稳边界。',
        flowRegimeChanged ? '流态切换区间应作为后续复核重点。' : '当前测试区间内流态保持稳定。',
      ]
        .filter((item): item is string => Boolean(item))
        .join(''),
  };
  const riskItems = getSensitivityRiskItems(report);
  const suggestionItems = getSensitivitySuggestionItems(report);

  const reportViewModel: SensitivitySmartReportPayload = {
    title:
      report.title && report.title.includes('敏感')
        ? report.title
        : `${projectName}关键变量敏感性分析报告`,
    description: report.abstract || SENSITIVITY_REPORT_PAGE_COPY.defaultDescription,
    basicInfo: {
      projectName,
      analysisType: '敏感性分析',
      sensitiveVariableType: variableTypeText,
      baseCondition,
      generatedAt: formatTime(snapshot.generatedAt ?? undefined),
    },
    resultCards: {
      baseResult: baseResultStatus,
      mostSensitiveVariable: topVariableName || '-',
      sensitivityCoefficient: formatValue(sensitivityCoefficient),
      maxImpactPercent: formatValue(maxImpactPercent, '%'),
      impactRanking: `第 ${topRankNumber} 名`,
      riskLevel,
    },
    chartMeta: {
      sensitivityRanking: {
        title: '敏感系数仪表盘',
        chartType: 'bar-horizontal',
        xField: 'sensitivityCoefficient',
        yFields: ['variableName'],
        description: '使用仪表盘展示不同变量的敏感系数，并按影响强弱排序。',
      },
      changeTrend: {
        title: '变化比例-结果变化趋势图',
        chartType: 'line',
        xField: 'changeRateLabel',
        yFields: ['pressure', 'frictionLoss'],
        description: '展示不同变化比例下末站压力与摩阻损失的变化趋势。',
      },
      maxImpact: {
        title: '最大影响幅度对比图',
        chartType: 'bar',
        xField: 'variableName',
        yFields: ['maxImpactPercent'],
        description: '对比各敏感变量带来的最大影响幅度。',
      },
    },
    rankingData: rankingRows.map((item) => ({
      rank: toFiniteNumber(item.rank) ?? 0,
      variableName: String(item.variableName ?? item.variableType ?? '-'),
      sensitivityCoefficient: toFiniteNumber(item.sensitivityCoefficient),
      description: String(item.description ?? ''),
    })),
    trendData: pointRows.map((item) => ({
      changeRateLabel: `${formatValue(item.changePercent)}%`,
      changeRateValue: toFiniteNumber(item.changePercent) ?? 0,
      pressure: toFiniteNumber(item.endStationPressure),
      frictionLoss: toFiniteNumber(item.frictionHeadLoss),
      pressureChangePercent: toFiniteNumber(item.pressureChangePercent),
      frictionChangePercent: toFiniteNumber(item.frictionChangePercent),
      flowState: formatValue(item.flowRegime),
    })),
    impactData: variableResults.map((item) => ({
      variableName: String(item.variableName ?? item.variableType ?? '-'),
      maxImpactPercent: toFiniteNumber(item.maxImpactPercent),
    })),
    analysis: {
      resultSummary: [],
      keyChangeAnalysis: [],
      riskRecognition: riskCards.length ? riskCards.map((item) => item.summary) : ['当前数据不足以支持进一步判断。'],
      optimizationSuggestions: suggestionCards.length
        ? suggestionCards.map((item) => item.summary)
        : ['当前数据不足以支持进一步判断。'],
    },
  };

  const coreParameterItems: HydraulicMetricPanelItem[] = [
    { label: '流量', value: flowRateText, accent: '#4e86f7' },
    { label: '密度', value: densityText, accent: '#12b981' },
    { label: '管径', value: diameterText, accent: '#7c6cff' },
    { label: '粗糙度', value: roughnessText, accent: '#f59e0b' },
  ];

  const coreResultItems: HydraulicMetricPanelItem[] = [
    { label: SENSITIVITY_REPORT_PAGE_COPY.labels.baseResult, value: reportViewModel.resultCards.baseResult, accent: '#4e86f7' },
    {
      label: SENSITIVITY_REPORT_PAGE_COPY.labels.mostSensitiveVariable,
      value: reportViewModel.resultCards.mostSensitiveVariable,
      accent: '#7c6cff',
    },
    {
      label: SENSITIVITY_REPORT_PAGE_COPY.labels.sensitivityCoefficient,
      value: reportViewModel.resultCards.sensitivityCoefficient,
      accent: '#06b6d4',
    },
    {
      label: SENSITIVITY_REPORT_PAGE_COPY.labels.maxImpactPercent,
      value: reportViewModel.resultCards.maxImpactPercent,
      accent: '#f59e0b',
    },
    {
      label: SENSITIVITY_REPORT_PAGE_COPY.labels.impactRanking,
      value: reportViewModel.resultCards.impactRanking,
      accent: '#12b981',
    },
    {
      label: SENSITIVITY_REPORT_PAGE_COPY.labels.riskLevel,
      value: reportViewModel.resultCards.riskLevel,
      accent: '#7c6cff',
    },
  ];

  const sensitivityGaugeMax = getSensitivityGaugeMax(reportViewModel.rankingData);

  const trendChartOption: EChartsOption = {
    tooltip: { trigger: 'axis' },
    legend: {
      data: ['末站进站压力', '摩阻损失'],
      top: 0,
      textStyle: { color: '#64748b' },
    },
    grid: { left: 48, right: 48, top: 48, bottom: 32 },
    xAxis: {
      type: 'category',
      name: '变化比例',
      data: reportViewModel.trendData.map((item) => item.changeRateLabel),
      axisLabel: { color: '#64748b' },
      axisLine: { lineStyle: { color: '#cbd5e1' } },
    },
    yAxis: [
      {
        type: 'value',
        name: '压力',
        axisLabel: { color: '#64748b' },
        nameTextStyle: { color: '#64748b' },
        splitLine: { lineStyle: { color: '#e2e8f0' } },
      },
      {
        type: 'value',
        name: '摩阻损失',
        axisLabel: { color: '#64748b' },
        nameTextStyle: { color: '#64748b' },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '末站进站压力',
        type: 'line',
        smooth: true,
        symbolSize: 8,
        lineStyle: { width: 3, color: '#4e86f7' },
        itemStyle: { color: '#4e86f7' },
        data: reportViewModel.trendData.map((item) => item.pressure),
      },
      {
        name: '摩阻损失',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbolSize: 8,
        lineStyle: { width: 3, color: '#12b981' },
        itemStyle: { color: '#12b981' },
        data: reportViewModel.trendData.map((item) => item.frictionLoss),
      },
    ],
  };

  const trendTableColumns: ColumnsType<(typeof reportViewModel.trendData)[number] & { key: string }> = [
    { title: '变化比例', dataIndex: 'changeRateLabel', key: 'changeRateLabel', width: 120 },
    {
      title: '压力',
      dataIndex: 'pressure',
      key: 'pressure',
      width: 120,
      render: (value: number | null) => formatValue(value),
    },
    {
      title: '压力变化',
      dataIndex: 'pressureChangePercent',
      key: 'pressureChangePercent',
      width: 140,
      render: (value: number | null) => formatValue(value, '%'),
    },
    {
      title: '摩阻损失',
      dataIndex: 'frictionLoss',
      key: 'frictionLoss',
      width: 140,
      render: (value: number | null) => formatValue(value),
    },
    {
      title: '摩阻变化',
      dataIndex: 'frictionChangePercent',
      key: 'frictionChangePercent',
      width: 140,
      render: (value: number | null) => formatValue(value, '%'),
    },
    { title: '流态', dataIndex: 'flowState', key: 'flowState', width: 120 },
  ];

  const trendTableDataSource = reportViewModel.trendData.map((item, index) => ({
    key: `${item.changeRateLabel}-${index}`,
    ...item,
  }));

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" title="参数区">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 12 }}>核心参数卡</div>
            <HydraulicMetricPanelGrid items={coreParameterItems} minWidth={180} valueFontSize="clamp(20px, 2.3vw, 28px)" />
          </div>
        </div>
      </Card>

      <Card size="small" title={SENSITIVITY_REPORT_PAGE_COPY.sectionTitles.coreResults}>
        <HydraulicMetricPanelGrid items={coreResultItems} minWidth={190} valueFontSize="clamp(20px, 2.3vw, 28px)" />
      </Card>

      <Card size="small" title={SENSITIVITY_REPORT_PAGE_COPY.sectionTitles.chartAnalysis}>
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={14}>
            <Card size="small" title={reportViewModel.chartMeta.sensitivityRanking.title} style={{ height: '100%' }}>
              {reportViewModel.rankingData.length ? (
                <Row gutter={[16, 16]}>
                  {reportViewModel.rankingData.map((item) => (
                    <Col
                      xs={24}
                      {...getSensitivityGaugeColSpan(reportViewModel.rankingData.length)}
                      key={`${item.rank}-${item.variableName}`}
                    >
                      <SensitivityGaugePanel item={item} gaugeMax={sensitivityGaugeMax} />
                    </Col>
                  ))}
                </Row>
              ) : (
                <Empty description="暂无敏感系数仪表盘数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>
          </Col>
          <Col xs={24} xl={10}>
            {renderSensitivityInsightCard(rankingInsightBlock, '#7c6cff')}
          </Col>

          <Col xs={24} xl={14}>
            <Card size="small" title={reportViewModel.chartMeta.changeTrend.title}>
              <Chart option={trendChartOption} height={300} />
            </Card>
          </Col>
          <Col xs={24} xl={10}>
            {renderSensitivityInsightCard(trendInsightBlock, '#4e86f7')}
          </Col>

          <Col xs={24} xl={14}>
            <Card size="small" title={reportViewModel.chartMeta.maxImpact.title}>
              <SensitivityImpactBandList items={reportViewModel.impactData} />
            </Card>
          </Col>
          <Col xs={24} xl={10}>
            {renderSensitivityInsightCard(impactInsightBlock, '#f59e0b')}
          </Col>

          <Col xs={24}>
            <Card size="small" title={SENSITIVITY_REPORT_PAGE_COPY.sectionTitles.trendTable}>
              <Table
                columns={trendTableColumns}
                dataSource={trendTableDataSource}
                size="small"
                pagination={false}
                scroll={{ x: 860 }}
              />
            </Card>
          </Col>

          <Col xs={24}>
            {renderSensitivityInsightCard(tableConclusionBlock, '#12b981')}
          </Col>
        </Row>
      </Card>

      <Card size="small" title={SENSITIVITY_REPORT_PAGE_COPY.sectionTitles.riskRecognition}>
        {riskItems.length ? (
          <Row gutter={[16, 16]}>
            {riskItems.map((item, index) => (
              <Col xs={24} xl={12} key={`${item.target}-${index}`}>
                <div
                  style={{
                    height: '100%',
                    borderRadius: 18,
                    padding: 18,
                    background: 'linear-gradient(180deg, rgba(254, 242, 242, 0.95) 0%, rgba(255, 255, 255, 1) 100%)',
                    border: '1px solid #fecaca',
                    boxShadow: '0 10px 24px rgba(239, 68, 68, 0.08)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <Text strong style={{ fontSize: 16, color: '#0f172a' }}>
                      {item.target || '当前对象'}
                    </Text>
                    <Tag color={getSensitivityLevelTagColor(item.level)} style={{ marginInlineEnd: 0 }}>
                      {item.level || '中'}
                    </Tag>
                  </div>
                  <Paragraph style={{ margin: '14px 0 8px', color: '#334155' }}>
                    <Text strong style={{ color: '#991b1b' }}>
                      风险原因：
                    </Text>
                    {item.message || item.reason}
                  </Paragraph>
                  <Paragraph style={{ margin: 0, color: '#334155' }}>
                    <Text strong style={{ color: '#991b1b' }}>
                      对结果的影响：
                    </Text>
                    {item.impact || item.suggestion || '会对结果稳定性和运行边界判断带来额外扰动。'}
                  </Paragraph>
                </div>
              </Col>
            ))}
          </Row>
        ) : (
          renderSummaryList(reportViewModel.analysis.riskRecognition)
        )}
      </Card>

      <Card size="small" title={SENSITIVITY_REPORT_PAGE_COPY.sectionTitles.optimizationSuggestions}>
        {suggestionItems.length ? (
          <Row gutter={[16, 16]}>
            {suggestionItems.map((item, index) => (
              <Col xs={24} xl={12} key={`${item.target}-${index}`}>
                <div
                  style={{
                    height: '100%',
                    borderRadius: 18,
                    padding: 18,
                    background: 'linear-gradient(180deg, rgba(239, 246, 255, 0.96) 0%, rgba(255, 255, 255, 1) 100%)',
                    border: '1px solid #bfdbfe',
                    boxShadow: '0 10px 24px rgba(59, 130, 246, 0.08)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <Text strong style={{ fontSize: 16, color: '#0f172a' }}>
                      {item.target || '当前对象'}
                    </Text>
                    <Tag color={getSensitivityPriorityTagColor(item.priority)} style={{ marginInlineEnd: 0 }}>
                      {getSensitivityPriorityLabel(item.priority)}
                    </Tag>
                  </div>
                  <Paragraph style={{ margin: '14px 0 8px', color: '#334155' }}>
                    <Text strong style={{ color: '#1d4ed8' }}>
                      建议：
                    </Text>
                    {item.text || item.action}
                  </Paragraph>
                  <Paragraph style={{ margin: '0 0 8px', color: '#334155' }}>
                    <Text strong style={{ color: '#1d4ed8' }}>
                      原因：
                    </Text>
                    {item.reason}
                  </Paragraph>
                  <Paragraph style={{ margin: 0, color: '#334155' }}>
                    <Text strong style={{ color: '#1d4ed8' }}>
                      预期：
                    </Text>
                    {item.expected}
                  </Paragraph>
                </div>
              </Col>
            ))}
          </Row>
        ) : (
          renderSummaryList(reportViewModel.analysis.optimizationSuggestions)
        )}
      </Card>
    </Space>
  );
}

function renderReportContent(report: DynamicReportResponsePayload) {
  const sensitivitySnapshot = extractSensitivityReportSnapshotFromReport(report);
  if (sensitivitySnapshot) {
    return renderSensitivityAiReportContentV2(report, sensitivitySnapshot);
  }

  const optimizationComparisonSnapshot = extractOptimizationComparisonSnapshotFromReport(report);
  if (optimizationComparisonSnapshot) {
    return renderOptimizationComparisonAiReportContent(report, optimizationComparisonSnapshot);
  }

  const optimizationSnapshot = extractOptimizationSnapshotFromReport(report);
  if (optimizationSnapshot) {
    return renderOptimizationAiReportContentV2(report, optimizationSnapshot);
  }

  const hydraulicSnapshot = extractHydraulicSnapshotFromReport(report);
  if (hydraulicSnapshot) {
    return renderHydraulicAiReportContentV2(report, hydraulicSnapshot);
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" title="摘要">
        {renderSummaryList(report.summary)}
      </Card>

      <Card size="small" title="亮点">
        {renderSummaryList(report.highlights)}
      </Card>

      <Card size="small" title="结论">
        <Paragraph style={{ marginBottom: 0 }}>{report.conclusion || '暂无结论'}</Paragraph>
      </Card>

      {report.risks.length ? (
        <Card size="small" title="风险提示">
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {report.risks.map((item, index) => (
              <div key={`${item.target}-${index}`}>
                <Space wrap>
                  <Tag color="red">{item.level}</Tag>
                  <Text strong>{item.target}</Text>
                  <Text>{item.riskType}</Text>
                </Space>
                <Paragraph style={{ margin: '8px 0 0' }}>{item.reason}</Paragraph>
              </div>
            ))}
          </Space>
        </Card>
      ) : null}

      <Card size="small" title="原始结果">
        <pre
          style={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          {report.raw_text || JSON.stringify(report, null, 2)}
        </pre>
      </Card>
    </Space>
  );
}

function renderDetailMetricCard(item: DetailMetricCardItem, options: DetailMetricCardRenderOptions = {}) {
  const tone = detailMetricToneMap[item.tone ?? 'blue'];
  const singleLine = options.singleLine ?? false;
  const compact = options.compact ?? false;

  return (
    <div
      style={{
        minHeight: options.minHeight ?? 94,
        minWidth: 0,
        borderRadius: 18,
        padding: compact ? '12px 16px' : '14px 16px',
        background: tone.background,
        border: `1px solid ${tone.border}`,
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.9)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: compact ? 'flex-start' : 'space-between',
        gap: compact ? 6 : 10,
      }}
      title={item.value === '-' ? item.label : `${item.label}: ${item.value}`}
    >
      <div
        style={{
          color: tone.label,
          fontSize: compact ? 12 : 13,
          fontWeight: 600,
          lineHeight: 1.4,
          ...(singleLine
            ? {
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }
            : {}),
        }}
        title={item.label}
      >
        {item.label}
      </div>
      <div
        style={{
          color: tone.value,
          fontSize: options.valueFontSize ?? 26,
          fontWeight: 700,
          lineHeight: compact ? 1.15 : 1.2,
          minWidth: 0,
          ...(singleLine
            ? {
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                wordBreak: 'normal',
              }
            : {
                wordBreak: 'break-word',
              }),
        }}
        title={item.value}
      >
        {item.value}
      </div>
    </div>
  );
}

function renderDetailMetricCards(items: DetailMetricCardItem[], options: DetailMetricCardRenderOptions = {}) {
  const visibleItems = filterMetricCards(items);

  if (!visibleItems.length) {
    return null;
  }

  if (options.equalWidth) {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fit, minmax(${options.minColumnWidth ?? 180}px, 1fr))`,
          gap: 12,
        }}
      >
        {visibleItems.map((item) => (
          <div key={`${item.label}-${item.value}`} style={{ minWidth: 0 }}>
            {renderDetailMetricCard(item, options)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <Row gutter={[12, 12]}>
      {visibleItems.map((item) => (
        <Col xs={24} md={12} xl={item.span ?? 6} key={`${item.label}-${item.value}`}>
          {renderDetailMetricCard(item, options)}
        </Col>
      ))}
    </Row>
  );
}

function ReportHistoryDetailContent({ row }: { row: HistoryTableRow }) {
  const detailPayload = useMemo(
    () => parseJson(row.outputResult) ?? parseJson(row.inputParams),
    [row.inputParams, row.outputResult],
  );

  const detailReport = useMemo(() => {
    if (!detailPayload) {
      return null;
    }
    if (isDynamicReportResponsePayload(detailPayload)) {
      return detailPayload;
    }

    const nestedPayload = (detailPayload as { data?: unknown }).data;
    return isDynamicReportResponsePayload(nestedPayload) ? nestedPayload : null;
  }, [detailPayload]);

  const historyInputPayload = useMemo(() => parseJson(row.inputParams), [row.inputParams]);

  const historyOutputPayload = useMemo(() => {
    const parsed = parseJson(row.outputResult);
    return asRecord(getValueByPath(parsed, 'data')) ?? asRecord(parsed);
  }, [row.outputResult]);

  const historyInputBase = useMemo(
    () => asRecord(getValueByPath(historyInputPayload, 'baseParams')) ?? historyInputPayload,
    [historyInputPayload],
  );

  const sensitivityVariableResults = useMemo(
    () => asRecordArray(getValueByPath(historyOutputPayload, 'variableResults')),
    [historyOutputPayload],
  );

  const sensitivityRankingRows = useMemo(
    () => asRecordArray(getValueByPath(historyOutputPayload, 'sensitivityRanking')),
    [historyOutputPayload],
  );

  const sensitivityDetailRows = useMemo<SensitivityDetailRow[]>(
    () =>
      sensitivityVariableResults.flatMap((result, resultIndex) => {
        const variableName = String(result.variableName ?? result.variableType ?? '敏感变量');
        return asRecordArray(result.dataPoints).map((point, pointIndex) => ({
          key: `${resultIndex}-${pointIndex}`,
          variableName,
          changePercent: formatValue(point.changePercent, '%'),
          endStationPressure: formatValue(point.endStationPressure),
          frictionHeadLoss: formatValue(point.frictionHeadLoss),
          flowRegime: formatValue(point.flowRegime),
          hydraulicSlope: formatValue(point.hydraulicSlope),
          reynoldsNumber: formatValue(point.reynoldsNumber),
        }));
      }),
    [sensitivityVariableResults],
  );

  const inputValueSources = useMemo(() => [historyInputBase, historyInputPayload] as unknown[], [historyInputBase, historyInputPayload]);
  const outputValueSources = useMemo(() => [historyOutputPayload] as unknown[], [historyOutputPayload]);
  const baseResultSources = useMemo(
    () => [asRecord(getValueByPath(historyOutputPayload, 'baseResult')), historyOutputPayload].filter(Boolean) as unknown[],
    [historyOutputPayload],
  );

  const detailInfoCards = useMemo<DetailMetricCardItem[]>(
    () =>
      filterMetricCards([
        { label: '项目名称', value: row.projectName || '-', tone: 'blue', span: 8 },
        { label: '项目编号', value: row.projectNumber || '-', tone: 'cyan', span: 4 },
        { label: '负责人', value: row.responsible || '-', tone: 'green', span: 4 },
        { label: '计算类型', value: row.calcTypeLabel || '-', tone: 'purple', span: 4 },
        { label: '更新时间', value: row.updateTimeText || '-', tone: 'amber', span: 4 },
        { label: '备注', value: row.remark || '-', tone: 'blue', span: 8 },
      ]),
    [row],
  );

  const inputMetricCards = useMemo<DetailMetricCardItem[]>(() => {
    const startAltitude = formatValue(pickFirstValue(inputValueSources, ['startAltitude', 'startElevation']));
    const endAltitude = formatValue(pickFirstValue(inputValueSources, ['endAltitude', 'endElevation']));

    return filterMetricCards([
      { label: '流量', value: formatValue(pickFirstValue(inputValueSources, ['flowRate', 'throughput', 'flow'])), tone: 'blue' },
      { label: '密度', value: formatValue(pickFirstValue(inputValueSources, ['density'])), tone: 'cyan' },
      { label: '粘度', value: formatValue(pickFirstValue(inputValueSources, ['viscosity'])), tone: 'green' },
      { label: '长度', value: formatValue(pickFirstValue(inputValueSources, ['length', 'pipelineLength'])), tone: 'amber' },
      { label: '管径', value: formatValue(pickFirstValue(inputValueSources, ['diameter', 'pipeDiameter'])), tone: 'purple' },
      { label: '壁厚', value: formatValue(pickFirstValue(inputValueSources, ['thickness', 'wallThickness'])), tone: 'blue' },
      { label: '粗糙度', value: formatValue(pickFirstValue(inputValueSources, ['roughness'])), tone: 'cyan' },
      {
        label: '首站进站压头',
        value: formatValue(pickFirstValue(inputValueSources, ['inletPressure', 'firstStationInPressure', 'stationInPressure'])),
        tone: 'amber',
      },
      { label: '起点高程', value: startAltitude, tone: 'green' },
      { label: '终点高程', value: endAltitude, tone: 'green' },
      { label: '泵数量', value: buildPumpCountDisplay(inputValueSources), tone: 'purple', span: 12 },
      { label: '扬程', value: buildPumpHeadDisplay(inputValueSources), tone: 'purple', span: 12 },
      { label: '效率', value: buildEfficiencyDisplay(inputValueSources), tone: 'blue' },
      { label: '电价', value: formatValue(pickFirstValue(inputValueSources, ['electricityPrice', 'powerPrice']), '元/kWh'), tone: 'cyan' },
      { label: '工作天数', value: formatValue(pickFirstValue(inputValueSources, ['workingDays']), '天'), tone: 'green' },
      { label: '敏感变量类型', value: buildSensitiveVariableDisplay(historyInputPayload, historyInputBase), tone: 'amber' },
    ]);
  }, [historyInputBase, historyInputPayload, inputValueSources]);

  const hydraulicResultCards = useMemo<DetailMetricCardItem[]>(
    () => [
      { label: '雷诺数', value: formatValue(pickFirstValue(outputValueSources, ['reynoldsNumber'])), tone: 'blue' },
      { label: '流态', value: formatValue(pickFirstValue(outputValueSources, ['flowRegime', 'regime'])), tone: 'cyan' },
      { label: '摩阻损失', value: formatValue(pickFirstValue(outputValueSources, ['frictionHeadLoss', 'frictionLoss'])), tone: 'green' },
      { label: '水力坡降', value: formatValue(pickFirstValue(outputValueSources, ['hydraulicSlope', 'slope'])), tone: 'amber' },
      { label: '总扬程', value: formatValue(pickFirstValue(outputValueSources, ['totalHead'])), tone: 'purple' },
      { label: '首站出站压头', value: formatValue(pickFirstValue(outputValueSources, ['firstStationOutPressure', 'outletPressure'])), tone: 'blue' },
      { label: '末站进站压头', value: formatValue(pickFirstValue(outputValueSources, ['endStationInPressure', 'terminalInPressure'])), tone: 'cyan' },
    ],
    [outputValueSources],
  );

  const optimizationResultCards = useMemo<DetailMetricCardItem[]>(
    () => [
      {
        label: '推荐泵组合',
        value:
          formatValue(pickFirstValue(outputValueSources, ['recommendedPumpCombination', 'pumpCombination'])) !== '-'
            ? formatValue(pickFirstValue(outputValueSources, ['recommendedPumpCombination', 'pumpCombination']))
            : buildPumpDisplay(outputValueSources),
        tone: 'purple',
        span: 8,
      },
      { label: '总扬程', value: formatValue(pickFirstValue(outputValueSources, ['totalHead'])), tone: 'blue' },
      { label: '总压降', value: formatValue(pickFirstValue(outputValueSources, ['totalPressureDrop', 'pressureDrop'])), tone: 'cyan' },
      { label: '末站进站压头', value: formatValue(pickFirstValue(outputValueSources, ['endStationInPressure', 'terminalInPressure'])), tone: 'green' },
      { label: '可行性', value: formatValue(pickFirstValue(outputValueSources, ['isFeasible', 'feasible'])), tone: 'amber' },
      { label: '年能耗', value: formatValue(pickFirstValue(outputValueSources, ['totalEnergyConsumption', 'annualEnergyConsumption', 'energyConsumption'])), tone: 'blue' },
      { label: '总成本', value: formatValue(pickFirstValue(outputValueSources, ['totalCost', 'annualCost'])), tone: 'cyan' },
      {
        label: '推荐说明',
        value: formatValue(pickFirstValue(outputValueSources, ['description', 'recommendation', 'remark'])),
        tone: 'purple',
        span: 8,
      },
    ],
    [outputValueSources],
  );

  const sensitivityBaseResultCards = useMemo<DetailMetricCardItem[]>(
    () => [
      { label: '雷诺数', value: formatValue(pickFirstValue(baseResultSources, ['reynoldsNumber'])), tone: 'blue' },
      { label: '流态', value: formatValue(pickFirstValue(baseResultSources, ['flowRegime', 'regime'])), tone: 'cyan' },
      { label: '摩阻损失', value: formatValue(pickFirstValue(baseResultSources, ['frictionHeadLoss', 'frictionLoss'])), tone: 'green' },
      { label: '水力坡降', value: formatValue(pickFirstValue(baseResultSources, ['hydraulicSlope', 'slope'])), tone: 'amber' },
      { label: '总扬程', value: formatValue(pickFirstValue(baseResultSources, ['totalHead'])), tone: 'purple' },
      { label: '首站出站压头', value: formatValue(pickFirstValue(baseResultSources, ['firstStationOutPressure', 'outletPressure'])), tone: 'blue' },
      { label: '末站进站压头', value: formatValue(pickFirstValue(baseResultSources, ['endStationInPressure', 'terminalInPressure'])), tone: 'cyan' },
    ],
    [baseResultSources],
  );

  const sensitivitySummaryCards = useMemo<DetailMetricCardItem[]>(
    () =>
      sensitivityVariableResults.map((item, index) => {
        const rankItem = sensitivityRankingRows.find(
          (rank) => String(rank.variableType ?? '') === String(item.variableType ?? ''),
        );

        return {
          label: `${String(item.variableName ?? item.variableType ?? `变量 ${index + 1}`)} / 排名 ${formatValue(rankItem?.rank)}`,
          value: `敏感系数 ${formatValue(item.sensitivityCoefficient)}，最大影响 ${formatValue(item.maxImpactPercent, '%')}`,
          tone: (['purple', 'blue', 'cyan', 'green'] as DetailMetricTone[])[index % 4],
          span: 8,
        };
      }),
    [sensitivityRankingRows, sensitivityVariableResults],
  );

  const sensitivityDetailColumns = useMemo<ColumnsType<SensitivityDetailRow>>(
    () => [
      { title: '变量', dataIndex: 'variableName', key: 'variableName' },
      { title: '变化比例', dataIndex: 'changePercent', key: 'changePercent', width: 120 },
      { title: '压力', dataIndex: 'endStationPressure', key: 'endStationPressure', width: 120 },
      { title: '摩阻', dataIndex: 'frictionHeadLoss', key: 'frictionHeadLoss', width: 120 },
      { title: '流态', dataIndex: 'flowRegime', key: 'flowRegime', width: 120 },
      { title: '水力坡降', dataIndex: 'hydraulicSlope', key: 'hydraulicSlope', width: 120 },
      { title: '雷诺数', dataIndex: 'reynoldsNumber', key: 'reynoldsNumber', width: 120 },
    ],
    [],
  );

  const currentHistoryCalcType = String(row.calcType ?? '');
  const isAiReportRecord = isAiReportHistory(row);
  const isHydraulicRecord = currentHistoryCalcType === 'HYDRAULIC' || row.calcTypeLabel.includes('水力');
  const isOptimizationRecord = currentHistoryCalcType === 'OPTIMIZATION' || row.calcTypeLabel.includes('优化');
  const isSensitivityRecord = currentHistoryCalcType === 'SENSITIVITY' || row.calcTypeLabel.includes('敏感');
  const shouldHideDetailInfoCard = isAiReportRecord;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {shouldHideDetailInfoCard ? null : (
        <Card style={detailSectionStyle} bodyStyle={detailSectionBodyStyle} title="计算基本信息">
          {renderDetailMetricCards(detailInfoCards, {
            equalWidth: true,
            singleLine: true,
            compact: true,
            minColumnWidth: 180,
            minHeight: 88,
            valueFontSize: 'clamp(14px, 1.8vw, 18px)',
          })}
        </Card>
      )}

      {isAiReportRecord && detailReport ? (
        renderReportContent(detailReport)
      ) : (
        <>
          <Card style={detailSectionStyle} bodyStyle={detailSectionBodyStyle} title="计算入参">
            {renderDetailMetricCards(inputMetricCards, {
              singleLine: true,
              valueFontSize: 'clamp(16px, 1.8vw, 22px)',
            })}
          </Card>

          {isHydraulicRecord ? (
            <Card style={detailSectionStyle} bodyStyle={detailSectionBodyStyle} title="水力结果">
              {renderDetailMetricCards(hydraulicResultCards)}
            </Card>
          ) : null}

          {isOptimizationRecord ? (
            <Card style={detailSectionStyle} bodyStyle={detailSectionBodyStyle} title="优化结果">
              {renderDetailMetricCards(optimizationResultCards)}
            </Card>
          ) : null}

          {isSensitivityRecord ? (
            <>
              <Card style={detailSectionStyle} bodyStyle={detailSectionBodyStyle} title="敏感性结果">
                <Space direction="vertical" size={20} style={{ width: '100%' }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 12 }}>基准结果</div>
                    {renderDetailMetricCards(sensitivityBaseResultCards)}
                  </div>

                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 12 }}>
                      敏感系数 / 最大影响 / 排名
                    </div>
                    {sensitivitySummaryCards.length ? (
                      renderDetailMetricCards(sensitivitySummaryCards)
                    ) : (
                      <Empty description="暂无敏感性摘要数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    )}
                  </div>
                </Space>
              </Card>

              <Card
                style={detailSectionStyle}
                bodyStyle={tableCardBodyStyle}
                title="各变化比例下的压力 / 摩阻 / 流态明细"
              >
                <Table
                  columns={sensitivityDetailColumns}
                  dataSource={sensitivityDetailRows}
                  rowKey="key"
                  pagination={false}
                  scroll={{ x: 900, y: 360 }}
                  locale={{
                    emptyText: <Empty description="暂无敏感性变化明细" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
                  }}
                />
              </Card>
            </>
          ) : null}

          {!isHydraulicRecord && !isOptimizationRecord && !isSensitivityRecord ? (
            <Card style={detailSectionStyle} bodyStyle={detailSectionBodyStyle} title="计算结果">
              <pre
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: 12,
                  lineHeight: 1.6,
                }}
              >
                {row.outputResult || row.inputParams || (detailPayload ? JSON.stringify(detailPayload, null, 2) : '暂无结果数据')}
              </pre>
            </Card>
          ) : null}
        </>
      )}
    </Space>
  );
}

export function ReportHistoryDetailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { historyId } = useParams<{ historyId: string }>();

  const initialRow = useMemo(() => {
    const state = location.state as ReportHistoryDetailLocationState | null;
    const candidate = state?.row;

    if (!candidate || Number(candidate.id) !== Number(historyId)) {
      return null;
    }

    return candidate;
  }, [historyId, location.state]);

  const [loading, setLoading] = useState(!initialRow);
  const [row, setRow] = useState<HistoryTableRow | null>(initialRow);
  const [error, setError] = useState('');

  useEffect(() => {
    const targetId = Number(historyId);
    if (!Number.isFinite(targetId)) {
      setRow(null);
      setLoading(false);
      setError('记录编号无效。');
      return;
    }

    let active = true;
    setLoading(true);
    setError('');

    void Promise.all([calculationHistoryApi.detail(targetId), projectApi.list()])
      .then(([historyResponse, projectResponse]) => {
        if (!active) {
          return;
        }

        const history = historyResponse.data;
        if (!history) {
          setRow(null);
          setError('未找到对应的计算记录。');
          return;
        }

        const projectLookup = new Map((projectResponse.data ?? []).map((project) => [project.proId, project]));
        setRow(toHistoryTableRow(history, projectLookup));
      })
      .catch(() => {
        if (!active) {
          return;
        }

        if (!initialRow) {
          setRow(null);
          setError('读取详情失败，请稍后重试。');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [historyId, initialRow]);

  const detailReport = useMemo(() => (row ? extractDynamicReportFromOutput(row.outputResult) : null), [row]);
  const projectScope = useMemo(
    () => resolveReportProjectScope(detailReport, row?.projectName),
    [detailReport, row?.projectName],
  );
  const comparisonCount = useMemo(() => getReportComparisonCount(detailReport), [detailReport]);

  const reportTitle = useMemo(() => {
    if (!row) {
      return '计算详情';
    }

    return buildScopedReportTitle({
      projectNames: projectScope.projectNames,
      reportKind: getReportKindFromPayload(detailReport),
      comparisonCount,
      fallbackTitle: detailReport?.title || `${row.projectName || '未命名项目'} ${row.calcTypeLabel || '计算详情'}`,
    });
  }, [comparisonCount, detailReport, projectScope.projectNames, row]);

  const reportAbstract = useMemo(() => {
    if (!row) {
      return '';
    }

    return normalizeReportAbstract(detailReport?.abstract || row.remark, comparisonCount);
  }, [comparisonCount, detailReport, row]);

  return (
    <AnimatedPage>
      <div style={{ padding: 24 }}>
        <Space direction="vertical" size={24} style={{ width: '100%' }}>
          <Card style={cardStyle} bodyStyle={{ padding: 24 }}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/ai/report')} style={{ width: 'fit-content' }}>
                返回记录列表
              </Button>

              <Space wrap size={[8, 8]}>
                <Tag color="geekblue">{row?.calcTypeLabel || '计算记录'}</Tag>
                {projectScope.projectNames.length ? (
                  <Tag color="blue">{buildProjectScopeBadge(projectScope.projectNames, row?.projectName || '未命名项目')}</Tag>
                ) : null}
                {row?.updateTimeText ? <Tag>{row.updateTimeText}</Tag> : null}
              </Space>

              <div>
                <Title level={2} style={{ margin: 0, color: '#0f172a' }}>
                  {reportTitle}
                </Title>
                <Paragraph type="secondary" style={{ margin: '12px 0 0' }}>
                  {reportAbstract || '查看该记录的完整分析结果、图表和明细内容。'}
                </Paragraph>
              </div>
            </Space>
          </Card>

          {error ? (
            <Alert
              type={row ? 'warning' : 'error'}
              showIcon
              message={row ? '详情已展示本地缓存数据' : '读取报告详情失败'}
              description={error}
            />
          ) : null}

          {loading && !row ? (
            <Card style={cardStyle}>
              <div style={{ textAlign: 'center', padding: '56px 0' }}>
                <Spin size="large" />
              </div>
            </Card>
          ) : row ? (
            <ReportHistoryDetailContent row={row} />
            ) : (
              <Card style={cardStyle}>
                <div style={{ padding: 40 }}>
                  <Empty description="暂无可展示的记录详情" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                </div>
              </Card>
            )}
        </Space>
      </div>
    </AnimatedPage>
  );
}

export default function ReportPreview() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [histories, setHistories] = useState<HistoryRow[]>([]);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedProjectIds, setSelectedProjectIds] = useState<number[]>([]);
  const [selectedCalcType, setSelectedCalcType] = useState<string>(ALL_CALC_TYPE_OPTION);
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [report, setReport] = useState<DynamicReportResponsePayload | null>(null);
  const [reportError, setReportError] = useState('');
  const [detailPreview, setDetailPreview] = useState<DetailPreviewState>(null);
  const [selectedHistoryKeys, setSelectedHistoryKeys] = useState<number[]>([]);
  const [deletingHistoryIds, setDeletingHistoryIds] = useState<number[]>([]);
  const reportType = DEFAULT_REPORT_TYPE;
  const latestHydraulicLink = useCalculationLinkStore((state) => state.latestByType.HYDRAULIC);
  const latestOptimizationLink = useCalculationLinkStore((state) => state.latestByType.OPTIMIZATION);
  const latestSensitivityLink = useCalculationLinkStore((state) => state.latestByType.SENSITIVITY);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [projectResponse, historyList] = await Promise.all([
        projectApi.list(),
        fetchAllPagedList<CalculationHistory>((pageNum, pageSize) =>
          calculationHistoryApi.page({ pageNum, pageSize }),
        ),
      ]);

      setProjects(projectResponse.data ?? []);
      setHistories(
        historyList
          .map((item) => ({
            ...item,
            key: item.id,
          }))
          .sort((a, b) => dayjs(b.createTime).valueOf() - dayjs(a.createTime).valueOf()),
      );
    } catch {
      message.error('读取智能报告页面数据失败，请稍后重试。');
      setProjects([]);
      setHistories([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const projectLookup = useMemo(
    () => new Map(projects.map((project) => [project.proId, project])),
    [projects],
  );

  const calcTypeOptions = useMemo(
    () => [
      { label: '全部类型', value: ALL_CALC_TYPE_OPTION },
      ...Array.from(
        new Map(
          histories
            .filter((item) => !isAiReportHistory(item))
            .map((item) => {
              const value = item.calcType || item.calcTypeName;
              const label = item.calcTypeName || item.calcType || '未知类型';
              return value ? [value, { label, value }] : null;
            })
            .filter((item): item is [string, { label: string; value: string }] => Boolean(item)),
        ).values(),
      ),
    ],
    [histories],
  );

  const filteredHistories = useMemo(() => {
    const normalizedKeyword = searchKeyword.trim().toLowerCase();

    return histories.filter((item) => {
      const project = projectLookup.get(Number(item.projectId));

      if (normalizedKeyword) {
        const matched = [
          item.projectName,
          project?.number,
          project?.responsible,
          item.userName,
          item.calcTypeName,
          item.calcType,
          item.remark,
          item.errorMessage,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedKeyword));

        if (!matched) {
          return false;
        }
      }

      if (selectedProjectIds.length && !selectedProjectIds.includes(Number(item.projectId))) {
        return false;
      }

      if (selectedCalcType !== ALL_CALC_TYPE_OPTION) {
        const currentCalcType = item.calcType || item.calcTypeName;
        if (currentCalcType !== selectedCalcType) {
          return false;
        }
      }

      if (dateRange) {
        const createdAt = dayjs(item.createTime);
        if (createdAt.isValid()) {
          const [start, end] = dateRange;
          if (createdAt.isBefore(start.startOf('day')) || createdAt.isAfter(end.endOf('day'))) {
            return false;
          }
        }
      }

      return true;
    });
  }, [dateRange, histories, projectLookup, searchKeyword, selectedCalcType, selectedProjectIds]);

  const allProjectIds = useMemo(() => projects.map((project) => project.proId), [projects]);

  const projectOptions = useMemo(
    () =>
      projects.map((project) => ({
        label: `${project.name}${project.number ? ` / ${project.number}` : ''}`,
        value: project.proId,
      })),
    [projects],
  );

  const projectSelectionLabel = useMemo(() => {
    if (!selectedProjectIds.length) {
      return '全部项目';
    }

    if (
      allProjectIds.length > 0 &&
      selectedProjectIds.length === allProjectIds.length &&
      allProjectIds.every((projectId) => selectedProjectIds.includes(projectId))
    ) {
      return '全部项目';
    }

    return `已选 ${selectedProjectIds.length} 个项目`;
  }, [allProjectIds, selectedProjectIds]);

  const historyTableRows = useMemo<HistoryTableRow[]>(
    () =>
      filteredHistories
        .filter((item) => item.outputResult)
        .map((item) => toHistoryTableRow(item, projectLookup)),
    [filteredHistories, projectLookup],
  );

  const reportHistoryRows = useMemo<HistoryTableRow[]>(
    () => {
      const normalizedKeyword = searchKeyword.trim().toLowerCase();

      return histories
        .filter((item) => {
          if (!item.outputResult || !isAiReportHistory(item)) {
            return false;
          }

          const project = projectLookup.get(Number(item.projectId));

          if (normalizedKeyword) {
            const matched = [
              item.projectName,
              project?.number,
              project?.responsible,
              item.userName,
              item.calcTypeName,
              item.calcType,
              item.remark,
              item.errorMessage,
            ]
              .filter(Boolean)
              .some((value) => String(value).toLowerCase().includes(normalizedKeyword));

            if (!matched) {
              return false;
            }
          }

          if (selectedProjectIds.length && !selectedProjectIds.includes(Number(item.projectId))) {
            return false;
          }

          if (dateRange) {
            const createdAt = dayjs(item.createTime);
            if (createdAt.isValid()) {
              const [start, end] = dateRange;
              if (createdAt.isBefore(start.startOf('day')) || createdAt.isAfter(end.endOf('day'))) {
                return false;
              }
            }
          }

          return true;
        })
        .map((item) => toHistoryTableRow(item, projectLookup));
    },
    [dateRange, histories, projectLookup, searchKeyword, selectedProjectIds],
  );

  const calculationRecords = useMemo(
    () => historyTableRows.filter((item) => !isAiReportHistory(item)).slice(0, 10),
    [historyTableRows],
  );

  const selectedGenerationRecords = useMemo(
    () => calculationRecords.filter((record) => selectedHistoryKeys.includes(record.key)),
    [calculationRecords, selectedHistoryKeys],
  );

  const aiReportRecords = useMemo<AiReportHistoryRow[]>(
    () =>
      reportHistoryRows
        .map((item) => {
          const reportPayload = extractDynamicReportFromOutput(item.outputResult);
          const projectScope = resolveReportProjectScope(reportPayload, item.projectName);
          const comparisonCount = getReportComparisonCount(reportPayload);
          const reportTitle = buildScopedReportTitle({
            projectNames: projectScope.projectNames,
            reportKind: getReportKindFromPayload(reportPayload),
            comparisonCount,
            fallbackTitle: reportPayload?.title || `${item.projectName || '未命名项目'}智能报告`,
          });

          return {
            ...item,
            projectName: buildProjectScopeBadge(projectScope.projectNames, item.projectName || '未命名项目'),
            reportTitle,
            reportAbstract: normalizeReportAbstract(reportPayload?.abstract || item.remark, comparisonCount),
          };
        }),
    [reportHistoryRows],
  );

  const visibleHistoryCount = useMemo(
    () => calculationRecords.length + aiReportRecords.length,
    [aiReportRecords.length, calculationRecords.length],
  );

  const completedCount = useMemo(
    () =>
      calculationRecords.filter(isCompletedHistoryRecord).length +
      aiReportRecords.filter(isCompletedHistoryRecord).length,
    [aiReportRecords, calculationRecords],
  );

  const aiCount = useMemo(() => aiReportRecords.length, [aiReportRecords.length]);

  const latestRecords = calculationRecords;

  const selectedHydraulicRecord = useMemo(
    () =>
      calculationRecords.find(
        (record) =>
          selectedHistoryKeys.includes(record.key) &&
          (record.calcType === 'HYDRAULIC' || record.calcTypeLabel.includes('姘村姏')),
      ) ??
      calculationRecords.find((record) => record.calcType === 'HYDRAULIC' || record.calcTypeLabel.includes('姘村姏')),
    [calculationRecords, selectedHistoryKeys],
  );

  const preferredHydraulicSnapshot = useMemo(
    () =>
      buildHydraulicSnapshotFromHistory(selectedHydraulicRecord) ??
      buildHydraulicSnapshotFromLinkedRecord(latestHydraulicLink),
    [latestHydraulicLink, selectedHydraulicRecord],
  );

  const selectedOptimizationRecord = useMemo(
    () =>
      calculationRecords.find(
        (record) =>
          selectedHistoryKeys.includes(record.key) &&
          (record.calcType === 'OPTIMIZATION' || record.calcTypeLabel.includes('优化')),
      ) ??
      (selectedCalcType === 'OPTIMIZATION'
        ? calculationRecords.find((record) => record.calcType === 'OPTIMIZATION' || record.calcTypeLabel.includes('优化'))
        : null),
    [calculationRecords, selectedCalcType, selectedHistoryKeys],
  );

  const preferredOptimizationSnapshot = useMemo(
    () =>
      createOptimizationReportSnapshotFromHistory(selectedOptimizationRecord) ??
      ((selectedOptimizationRecord || selectedCalcType === 'OPTIMIZATION') && latestOptimizationLink
        ? createOptimizationReportSnapshotFromLinkedRecord(latestOptimizationLink)
        : null),
    [latestOptimizationLink, selectedCalcType, selectedOptimizationRecord],
  );

  const selectedOptimizationRecords = useMemo(
    () =>
      selectedGenerationRecords.filter(
        (record) => record.calcType === 'OPTIMIZATION' || record.calcTypeLabel.includes('优化'),
      ),
    [selectedGenerationRecords],
  );

  const preferredOptimizationComparisonSnapshot = useMemo(() => {
    if (selectedGenerationRecords.length < 2) {
      return null;
    }

    if (selectedOptimizationRecords.length !== selectedGenerationRecords.length) {
      return null;
    }

    const projectMap = new Map<string, OptimizationComparisonProjectSnapshot>();
    selectedOptimizationRecords.forEach((record) => {
      const snapshot = createOptimizationComparisonProjectSnapshotFromHistory(record);
      if (!snapshot) {
        return;
      }
      const uniqueKey = `${snapshot.projectId ?? ''}-${snapshot.projectName ?? ''}`;
      if (!projectMap.has(uniqueKey)) {
        projectMap.set(uniqueKey, snapshot);
      }
    });

    const projects = [...projectMap.values()];
    if (projects.length < 2) {
      return null;
    }

    return {
      projects,
    } satisfies OptimizationComparisonReportSnapshot;
  }, [selectedGenerationRecords, selectedOptimizationRecords]);

  const selectedSensitivityRecord = useMemo(
    () =>
      calculationRecords.find(
        (record) =>
          selectedHistoryKeys.includes(record.key) &&
          (record.calcType === 'SENSITIVITY' || record.calcTypeLabel.includes('敏感')),
      ) ??
      (selectedCalcType === 'SENSITIVITY'
        ? calculationRecords.find((record) => record.calcType === 'SENSITIVITY' || record.calcTypeLabel.includes('敏感'))
        : null),
    [calculationRecords, selectedCalcType, selectedHistoryKeys],
  );

  const preferredSensitivitySnapshot = useMemo(
    () =>
      createSensitivityReportSnapshotFromHistory(selectedSensitivityRecord) ??
      ((selectedSensitivityRecord || selectedCalcType === 'SENSITIVITY') && latestSensitivityLink
        ? createSensitivityReportSnapshotFromLinkedRecord(latestSensitivityLink)
        : null),
    [latestSensitivityLink, selectedCalcType, selectedSensitivityRecord],
  );

  useEffect(() => {
    setSelectedHistoryKeys((currentKeys) =>
      currentKeys.filter((key) => calculationRecords.some((record) => record.key === key)),
    );
  }, [calculationRecords]);

  const handleDeleteHistory = useCallback(async (record: HistoryTableRow) => {
    const targetId = Number(record.id);
    if (!Number.isFinite(targetId)) {
      message.error('删除失败，记录编号无效。');
      return;
    }

    setDeletingHistoryIds((current) => (current.includes(targetId) ? current : [...current, targetId]));

    try {
      await calculationHistoryApi.delete(targetId);

      setSelectedHistoryKeys((current) => current.filter((key) => Number(key) !== targetId));
      setDetailPreview((current) =>
        current?.mode === 'history' && Number(current.row.id) === targetId ? null : current,
      );
      await loadData();

      message.success('删除成功。');
    } catch {
      message.error('删除失败，请稍后重试。');
    } finally {
      setDeletingHistoryIds((current) => current.filter((item) => item !== targetId));
    }
  }, [loadData]);

  const detailPayload = useMemo(() => {
    if (!detailPreview || detailPreview.mode !== 'history') {
      return null;
    }

    return parseJson(detailPreview.row.outputResult) ?? parseJson(detailPreview.row.inputParams);
  }, [detailPreview]);

  const detailReport = useMemo(() => {
    if (detailPreview?.mode === 'generated') {
      return detailPreview.report;
    }
    if (!detailPayload) {
      return null;
    }
    if (isDynamicReportResponsePayload(detailPayload)) {
      return detailPayload;
    }

    const nestedPayload = (detailPayload as { data?: unknown }).data;
    return isDynamicReportResponsePayload(nestedPayload) ? nestedPayload : null;
  }, [detailPayload, detailPreview]);

  const historyInputPayload = useMemo(
    () => (detailPreview?.mode === 'history' ? parseJson(detailPreview.row.inputParams) : null),
    [detailPreview],
  );

  const historyOutputPayload = useMemo(() => {
    if (detailPreview?.mode !== 'history') {
      return null;
    }

    const parsed = parseJson(detailPreview.row.outputResult);
    return asRecord(getValueByPath(parsed, 'data')) ?? asRecord(parsed);
  }, [detailPreview]);

  const historyInputBase = useMemo(
    () => asRecord(getValueByPath(historyInputPayload, 'baseParams')) ?? historyInputPayload,
    [historyInputPayload],
  );

  const sensitivityVariableResults = useMemo(
    () => asRecordArray(getValueByPath(historyOutputPayload, 'variableResults')),
    [historyOutputPayload],
  );

  const sensitivityRankingRows = useMemo(
    () => asRecordArray(getValueByPath(historyOutputPayload, 'sensitivityRanking')),
    [historyOutputPayload],
  );

  const sensitivityDetailRows = useMemo<SensitivityDetailRow[]>(
    () =>
      sensitivityVariableResults.flatMap((result, resultIndex) => {
        const variableName = String(result.variableName ?? result.variableType ?? '敏感变量');
        return asRecordArray(result.dataPoints).map((point, pointIndex) => ({
          key: `${resultIndex}-${pointIndex}`,
          variableName,
          changePercent: formatValue(point.changePercent, '%'),
          endStationPressure: formatValue(point.endStationPressure),
          frictionHeadLoss: formatValue(point.frictionHeadLoss),
          flowRegime: formatValue(point.flowRegime),
          hydraulicSlope: formatValue(point.hydraulicSlope),
          reynoldsNumber: formatValue(point.reynoldsNumber),
        }));
      }),
    [sensitivityVariableResults],
  );

  const inputValueSources = useMemo(
    () => [historyInputBase, historyInputPayload] as unknown[],
    [historyInputBase, historyInputPayload],
  );

  const outputValueSources = useMemo(
    () => [historyOutputPayload] as unknown[],
    [historyOutputPayload],
  );

  const baseResultSources = useMemo(
    () => [asRecord(getValueByPath(historyOutputPayload, 'baseResult')), historyOutputPayload].filter(Boolean) as unknown[],
    [historyOutputPayload],
  );

  const detailInfoCards = useMemo<DetailMetricCardItem[]>(
    () =>
      detailPreview?.mode === 'history'
        ? filterMetricCards([
            { label: '项目名称', value: detailPreview.row.projectName || '-', tone: 'blue', span: 8 },
            { label: '项目编号', value: detailPreview.row.projectNumber || '-', tone: 'cyan', span: 4 },
            { label: '负责人', value: detailPreview.row.responsible || '-', tone: 'green', span: 4 },
            { label: '计算类型', value: detailPreview.row.calcTypeLabel || '-', tone: 'purple', span: 4 },
            { label: '更新时间', value: detailPreview.row.updateTimeText || '-', tone: 'amber', span: 4 },
            { label: '备注', value: detailPreview.row.remark || '-', tone: 'blue', span: 8 },
          ])
        : [],
    [detailPreview],
  );

  const inputMetricCards = useMemo<DetailMetricCardItem[]>(
    () => {
      const startAltitude = formatValue(pickFirstValue(inputValueSources, ['startAltitude', 'startElevation']));
      const endAltitude = formatValue(pickFirstValue(inputValueSources, ['endAltitude', 'endElevation']));

      return filterMetricCards([
        { label: '流量', value: formatValue(pickFirstValue(inputValueSources, ['flowRate', 'throughput', 'flow'])), tone: 'blue' },
        { label: '密度', value: formatValue(pickFirstValue(inputValueSources, ['density'])), tone: 'cyan' },
        { label: '粘度', value: formatValue(pickFirstValue(inputValueSources, ['viscosity'])), tone: 'green' },
        { label: '长度', value: formatValue(pickFirstValue(inputValueSources, ['length', 'pipelineLength'])), tone: 'amber' },
        { label: '管径', value: formatValue(pickFirstValue(inputValueSources, ['diameter', 'pipeDiameter'])), tone: 'purple' },
        { label: '壁厚', value: formatValue(pickFirstValue(inputValueSources, ['thickness', 'wallThickness'])), tone: 'blue' },
        { label: '粗糙度', value: formatValue(pickFirstValue(inputValueSources, ['roughness'])), tone: 'cyan' },
        {
          label: '首站进站压头',
          value: formatValue(pickFirstValue(inputValueSources, ['inletPressure', 'firstStationInPressure', 'stationInPressure'])),
          tone: 'amber',
        },
        { label: '起点高程', value: startAltitude, tone: 'green' },
        { label: '终点高程', value: endAltitude, tone: 'green' },
        { label: '泵数量', value: buildPumpCountDisplay(inputValueSources), tone: 'purple', span: 12 },
        { label: '扬程', value: buildPumpHeadDisplay(inputValueSources), tone: 'purple', span: 12 },
        { label: '效率', value: buildEfficiencyDisplay(inputValueSources), tone: 'blue' },
        { label: '电价', value: formatValue(pickFirstValue(inputValueSources, ['electricityPrice', 'powerPrice']), '元/kWh'), tone: 'cyan' },
        { label: '工作天数', value: formatValue(pickFirstValue(inputValueSources, ['workingDays']), '天'), tone: 'green' },
        { label: '敏感变量类型', value: buildSensitiveVariableDisplay(historyInputPayload, historyInputBase), tone: 'amber' },
      ]);
    },
    [historyInputBase, historyInputPayload, inputValueSources],
  );

  const hydraulicResultCards = useMemo<DetailMetricCardItem[]>(
    () => [
      { label: '雷诺数', value: formatValue(pickFirstValue(outputValueSources, ['reynoldsNumber'])), tone: 'blue' },
      { label: '流态', value: formatValue(pickFirstValue(outputValueSources, ['flowRegime', 'regime'])), tone: 'cyan' },
      { label: '摩阻损失', value: formatValue(pickFirstValue(outputValueSources, ['frictionHeadLoss', 'frictionLoss'])), tone: 'green' },
      { label: '水力坡降', value: formatValue(pickFirstValue(outputValueSources, ['hydraulicSlope', 'slope'])), tone: 'amber' },
      { label: '总扬程', value: formatValue(pickFirstValue(outputValueSources, ['totalHead'])), tone: 'purple' },
      { label: '首站出站压头', value: formatValue(pickFirstValue(outputValueSources, ['firstStationOutPressure', 'outletPressure'])), tone: 'blue' },
      { label: '末站进站压头', value: formatValue(pickFirstValue(outputValueSources, ['endStationInPressure', 'terminalInPressure'])), tone: 'cyan' },
    ],
    [outputValueSources],
  );

  const optimizationResultCards = useMemo<DetailMetricCardItem[]>(
    () => [
      {
        label: '推荐泵组合',
        value:
          formatValue(pickFirstValue(outputValueSources, ['recommendedPumpCombination', 'pumpCombination'])) !== '-'
            ? formatValue(pickFirstValue(outputValueSources, ['recommendedPumpCombination', 'pumpCombination']))
            : buildPumpDisplay(outputValueSources),
        tone: 'purple',
        span: 8,
      },
      { label: '总扬程', value: formatValue(pickFirstValue(outputValueSources, ['totalHead'])), tone: 'blue' },
      { label: '总压降', value: formatValue(pickFirstValue(outputValueSources, ['totalPressureDrop', 'pressureDrop'])), tone: 'cyan' },
      { label: '末站进站压头', value: formatValue(pickFirstValue(outputValueSources, ['endStationInPressure', 'terminalInPressure'])), tone: 'green' },
      { label: '可行性', value: formatValue(pickFirstValue(outputValueSources, ['isFeasible', 'feasible'])), tone: 'amber' },
      { label: '年能耗', value: formatValue(pickFirstValue(outputValueSources, ['totalEnergyConsumption', 'annualEnergyConsumption', 'energyConsumption'])), tone: 'blue' },
      { label: '总成本', value: formatValue(pickFirstValue(outputValueSources, ['totalCost', 'annualCost'])), tone: 'cyan' },
      {
        label: '推荐说明',
        value: formatValue(pickFirstValue(outputValueSources, ['description', 'recommendation', 'remark'])),
        tone: 'purple',
        span: 8,
      },
    ],
    [outputValueSources],
  );

  const sensitivityBaseResultCards = useMemo<DetailMetricCardItem[]>(
    () => [
      { label: '雷诺数', value: formatValue(pickFirstValue(baseResultSources, ['reynoldsNumber'])), tone: 'blue' },
      { label: '流态', value: formatValue(pickFirstValue(baseResultSources, ['flowRegime', 'regime'])), tone: 'cyan' },
      { label: '摩阻损失', value: formatValue(pickFirstValue(baseResultSources, ['frictionHeadLoss', 'frictionLoss'])), tone: 'green' },
      { label: '水力坡降', value: formatValue(pickFirstValue(baseResultSources, ['hydraulicSlope', 'slope'])), tone: 'amber' },
      { label: '总扬程', value: formatValue(pickFirstValue(baseResultSources, ['totalHead'])), tone: 'purple' },
      { label: '首站出站压头', value: formatValue(pickFirstValue(baseResultSources, ['firstStationOutPressure', 'outletPressure'])), tone: 'blue' },
      { label: '末站进站压头', value: formatValue(pickFirstValue(baseResultSources, ['endStationInPressure', 'terminalInPressure'])), tone: 'cyan' },
    ],
    [baseResultSources],
  );

  const sensitivitySummaryCards = useMemo<DetailMetricCardItem[]>(
    () =>
      sensitivityVariableResults.map((item, index) => {
        const rankItem = sensitivityRankingRows.find(
          (rank) => String(rank.variableType ?? '') === String(item.variableType ?? ''),
        );

        return {
          label: `${String(item.variableName ?? item.variableType ?? `变量 ${index + 1}`)} / 排名 ${formatValue(rankItem?.rank)}`,
          value: `敏感系数 ${formatValue(item.sensitivityCoefficient)}，最大影响 ${formatValue(item.maxImpactPercent, '%')}`,
          tone: (['purple', 'blue', 'cyan', 'green'] as DetailMetricTone[])[index % 4],
          span: 8,
        };
      }),
    [sensitivityRankingRows, sensitivityVariableResults],
  );

  const sensitivityDetailColumns = useMemo<ColumnsType<SensitivityDetailRow>>(
    () => [
      { title: '变量', dataIndex: 'variableName', key: 'variableName' },
      { title: '变化比例', dataIndex: 'changePercent', key: 'changePercent', width: 120 },
      { title: '压力', dataIndex: 'endStationPressure', key: 'endStationPressure', width: 120 },
      { title: '摩阻', dataIndex: 'frictionHeadLoss', key: 'frictionHeadLoss', width: 120 },
      { title: '流态', dataIndex: 'flowRegime', key: 'flowRegime', width: 120 },
      { title: '水力坡降', dataIndex: 'hydraulicSlope', key: 'hydraulicSlope', width: 120 },
      { title: '雷诺数', dataIndex: 'reynoldsNumber', key: 'reynoldsNumber', width: 120 },
    ],
    [],
  );

  const currentHistoryCalcType = detailPreview?.mode === 'history' ? String(detailPreview.row.calcType ?? '') : '';
  const isAiReportRecord = detailPreview?.mode === 'history' && isAiReportHistory(detailPreview.row);
  const isHydraulicRecord =
    detailPreview?.mode === 'history' &&
    (currentHistoryCalcType === 'HYDRAULIC' || detailPreview.row.calcTypeLabel.includes('水力'));
  const isOptimizationRecord =
    detailPreview?.mode === 'history' &&
    (currentHistoryCalcType === 'OPTIMIZATION' || detailPreview.row.calcTypeLabel.includes('优化'));
  const isSensitivityRecord =
    detailPreview?.mode === 'history' &&
    (currentHistoryCalcType === 'SENSITIVITY' || detailPreview.row.calcTypeLabel.includes('敏感'));
  const shouldHideDetailInfoCard = isAiReportRecord;

  const historyColumns = useMemo<ColumnsType<HistoryTableRow>>(
    () => [
      {
        title: '项目名称',
        dataIndex: 'projectName',
        key: 'projectName',
        width: 220,
        onHeaderCell: () => ({ style: tableHeaderCellStyle }),
        onCell: () => ({ style: tableCellStyle }),
        render: (value?: string) => value || '-',
      },
      {
        title: '项目编号',
        dataIndex: 'projectNumber',
        key: 'projectNumber',
        width: 150,
        onHeaderCell: () => ({ style: tableHeaderCellStyle }),
        onCell: () => ({ style: tableCellStyle }),
        render: (value?: string) => value || '-',
      },
      {
        title: '负责人',
        dataIndex: 'responsible',
        key: 'responsible',
        width: 140,
        onHeaderCell: () => ({ style: tableHeaderCellStyle }),
        onCell: () => ({ style: tableCellStyle }),
        render: (value?: string) => value || '-',
      },
      {
        title: '计算类型',
        dataIndex: 'calcTypeLabel',
        key: 'calcTypeLabel',
        width: 150,
        onHeaderCell: () => ({ style: tableHeaderCellStyle }),
        onCell: () => ({ style: tableCellStyle }),
        render: (value?: string) => (
          <Tag
            style={{
              marginInlineEnd: 0,
              borderRadius: 999,
              paddingInline: 10,
              color: '#3b82f6',
              background: '#eaf3ff',
              border: 'none',
            }}
          >
            {value || '-'}
          </Tag>
        ),
      },
      {
        title: '更新时间',
        dataIndex: 'updateTimeText',
        key: 'updateTimeText',
        width: 180,
        onHeaderCell: () => ({ style: tableHeaderCellStyle }),
        onCell: () => ({ style: tableCellStyle }),
      },
      {
        title: '操作',
        key: 'action',
        width: 132,
        align: 'center',
        onHeaderCell: () => ({ style: tableHeaderCellStyle }),
        onCell: () => ({ style: tableCellStyle }),
        render: (_, record) => (
          <Space size={4}>
            <Button
              type="text"
              icon={<EyeOutlined style={{ color: '#22c1ff', fontSize: 18 }} />}
              onClick={() =>
                navigate(`/ai/report/detail/${record.id}`, {
                  state: { row: record } satisfies ReportHistoryDetailLocationState,
                })
              }
              disabled={deletingHistoryIds.includes(Number(record.id))}
            />
            <Popconfirm
              title="确认删除这条记录？"
              description="删除后不可恢复。"
              okText="删除"
              cancelText="取消"
              onConfirm={() => void handleDeleteHistory(record)}
            >
              <Button
                type="text"
                danger
                icon={<DeleteOutlined style={{ fontSize: 18 }} />}
                loading={deletingHistoryIds.includes(Number(record.id))}
              />
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [deletingHistoryIds, handleDeleteHistory, navigate],
  );

  const handleGenerate = useCallback(async () => {
    let activeProjectIds = selectedProjectIds.length ? selectedProjectIds : allProjectIds;

    if (!activeProjectIds.length) {
      message.warning('暂无可用项目。');
      return;
    }

    setGenerating(true);
    setReport(null);
    setReportError('');

    try {
      let selectedNames = projects
        .filter((project) => activeProjectIds.includes(project.proId))
        .map((project) => project.name);
      let reportKind: ReportKind = 'generic';
      const selectedSensitivityRows = selectedGenerationRecords.filter(
        (record) => record.calcType === 'SENSITIVITY' || record.calcTypeLabel.includes('敏感'),
      );
      const selectedOptimizationRows = selectedGenerationRecords.filter(
        (record) => record.calcType === 'OPTIMIZATION' || record.calcTypeLabel.includes('优化'),
      );
      const selectedHydraulicRows = selectedGenerationRecords.filter(
        (record) => record.calcType === 'HYDRAULIC' || record.calcTypeLabel.includes('姘村姏'),
      );

      const hydraulicPrompt = preferredHydraulicSnapshot
        ? '请基于真实水力计算结果生成水力分析智能报告，按以下结构组织：第一块参数表（流量、密度、粘度、长度、管径、粗糙度、高程、泵参数）；第二块结果卡片（雷诺数、流态、摩阻损失、水力坡降、总扬程、末站进站压头）；第三块图表（压头变化图、扬程构成图）；第四块 AI 分析（结果摘要、指标分析、风险判断、运行建议）。'
        : undefined;

      const normalizedHydraulicPrompt = preferredHydraulicSnapshot ? buildHydraulicUserPrompt() : hydraulicPrompt;
      const normalizedOptimizationPrompt = preferredOptimizationComparisonSnapshot
        ? buildOptimizationComparisonSmartPrompt(preferredOptimizationComparisonSnapshot)
        : preferredOptimizationSnapshot
          ? buildOptimizationUserPrompt()
          : undefined;
      const normalizedSensitivityPrompt = preferredSensitivitySnapshot ? buildSensitivityUserPrompt() : undefined;
      const activePrompt = normalizedSensitivityPrompt ?? normalizedOptimizationPrompt ?? normalizedHydraulicPrompt;

      if (preferredOptimizationComparisonSnapshot) {
        const projectScope = buildProjectScopeFromOptimizationComparisonSnapshot(preferredOptimizationComparisonSnapshot);
        if (projectScope.projectIds.length) {
          activeProjectIds = projectScope.projectIds;
        }
        if (projectScope.projectNames.length) {
          selectedNames = projectScope.projectNames;
        }
        reportKind = 'optimization-comparison';
      } else if (preferredSensitivitySnapshot) {
        const projectScope = buildProjectScopeFromHistoryRows(
          selectedSensitivityRows.length > 1
            ? selectedSensitivityRows
            : selectedSensitivityRecord
              ? [selectedSensitivityRecord]
              : [],
        );
        if (projectScope.projectIds.length) {
          activeProjectIds = projectScope.projectIds;
        }
        if (projectScope.projectNames.length) {
          selectedNames = projectScope.projectNames;
        }
        reportKind = 'sensitivity';
      } else if (preferredOptimizationSnapshot) {
        const projectScope = buildProjectScopeFromHistoryRows(
          selectedOptimizationRows.length > 1
            ? selectedOptimizationRows
            : selectedOptimizationRecord
              ? [selectedOptimizationRecord]
              : [],
        );
        if (projectScope.projectIds.length) {
          activeProjectIds = projectScope.projectIds;
        }
        if (projectScope.projectNames.length) {
          selectedNames = projectScope.projectNames;
        }
        reportKind = 'optimization';
      } else if (preferredHydraulicSnapshot) {
        const projectScope = buildProjectScopeFromHistoryRows(
          selectedHydraulicRows.length > 1
            ? selectedHydraulicRows
            : selectedHydraulicRecord
              ? [selectedHydraulicRecord]
              : [],
        );
        if (projectScope.projectIds.length) {
          activeProjectIds = projectScope.projectIds;
        }
        if (projectScope.projectNames.length) {
          selectedNames = projectScope.projectNames;
        }
        reportKind = 'hydraulic';
      }

      selectedNames = dedupeProjectNames(selectedNames);
      const activeFocuses = preferredSensitivitySnapshot
        ? ['基准结果', '敏感系数', '最大影响幅度', '排名', '压力变化趋势', '摩阻损失变化趋势', '流态变化']
        : preferredOptimizationComparisonSnapshot
          ? ['综合评分', '总成本', '年能耗', '末站进站压头', '总扬程', '可行性', '风险等级']
          : preferredOptimizationSnapshot
            ? ['推荐泵组', '末站进站压头', '总扬程', '年能耗', '总成本', '方案解读', '水力可行性解读', '经济性解读', '风险识别', '优化建议']
            : preferredHydraulicSnapshot
              ? ['总扬程', '摩阻损失', '末站进站压头', '压头变化图', '扬程构成图', '风险识别', '运行建议']
              : undefined;
      const reportTypeLabel = preferredOptimizationComparisonSnapshot
        ? '多项目泵站优化对比报告'
        : '智能报告';
      const result = await agentApi.generateDynamicReport({
        selected_project_ids: activeProjectIds,
        project_names: selectedNames,
        report_type: reportType,
        report_type_label: reportTypeLabel,
        intelligence_level: 'enhanced',
        output_format: 'markdown',
        include_summary: true,
        include_risk: true,
        include_suggestions: true,
        include_conclusion: true,
        range_preset: dateRange ? 'custom' : 'all',
        custom_start: dateRange ? dateRange[0].format('YYYY-MM-DD') : undefined,
        custom_end: dateRange ? dateRange[1].format('YYYY-MM-DD') : undefined,
        focuses: activeFocuses,
        user_prompt: activePrompt,
        hydraulic_snapshot: preferredHydraulicSnapshot ?? undefined,
        optimization_snapshot:
          preferredOptimizationComparisonSnapshot ? undefined : preferredOptimizationSnapshot ?? undefined,
      });

      const selectedReportCount = Math.max(selectedGenerationRecords.length, 1);
      const optimizationComparisonPresentation = preferredOptimizationComparisonSnapshot
        ? createOptimizationComparisonReportPresentation(result, preferredOptimizationComparisonSnapshot)
        : null;

      const reportWithSnapshots: DynamicReportResponsePayload = preferredSensitivitySnapshot
        ? {
            ...result,
            metadata: {
              ...(result.metadata ?? {}),
              selected_report_count: selectedReportCount,
              sensitivitySnapshot: preferredSensitivitySnapshot,
            },
          }
        : preferredOptimizationComparisonSnapshot
          ? {
              ...(optimizationComparisonPresentation ?? result),
              metadata: {
                ...(optimizationComparisonPresentation?.metadata ?? {}),
                selected_report_count: selectedReportCount,
              },
            }
        : preferredOptimizationSnapshot
          ? {
              ...result,
              metadata: {
                ...(result.metadata ?? {}),
                selected_report_count: selectedReportCount,
                optimizationSnapshot: preferredOptimizationSnapshot,
              },
            }
        : preferredHydraulicSnapshot
          ? {
              ...result,
              metadata: {
                ...(result.metadata ?? {}),
                selected_report_count: selectedReportCount,
                hydraulicSnapshot: preferredHydraulicSnapshot,
              },
            }
          : {
              ...result,
              metadata: {
                ...(result.metadata ?? {}),
                selected_report_count: selectedReportCount,
              },
            };

      const enrichedReport: DynamicReportResponsePayload = {
        ...reportWithSnapshots,
        title: buildScopedReportTitle({
          projectNames: selectedNames,
          reportKind,
          comparisonCount: selectedReportCount,
          fallbackTitle: reportWithSnapshots.title,
        }),
        abstract: normalizeReportAbstract(reportWithSnapshots.abstract, selectedReportCount),
      };

      setReport(enrichedReport);
      setDetailPreview({ mode: 'generated', report: enrichedReport });

      const archivePayload: SaveReportRequest = {
        title: enrichedReport.title,
        reportType,
        reportTypeLabel: reportTypeLabel || '智能报告',
        selectedProjectIds: activeProjectIds,
        projectNames: selectedNames,
        rangeLabel: dateRange
          ? `${dateRange[0].format('YYYY-MM-DD')} 至 ${dateRange[1].format('YYYY-MM-DD')}`
          : '全部时间',
        intelligenceLabel: '增强分析',
        outputFormat: 'markdown',
        sourceLabel: '智能报告中心',
        result: {
          source: enrichedReport.source === 'rules' ? 'fallback' : 'ai',
          highlights: enrichedReport.highlights,
          summary: enrichedReport.summary,
          risks: enrichedReport.risks,
          suggestions: enrichedReport.suggestions,
          conclusion: enrichedReport.conclusion,
          rawText: enrichedReport.raw_text,
          report: enrichedReport,
        },
      };

      try {
        const archiveResponse = await calculationHistoryApi.report(archivePayload);
        const archivedHistory = archiveResponse.data;

        if (archivedHistory) {
          setHistories((current) =>
            [{ ...archivedHistory, key: archivedHistory.id }, ...current.filter((item) => item.id !== archivedHistory.id)].sort(
              (a, b) => dayjs(b.createTime).valueOf() - dayjs(a.createTime).valueOf(),
            ),
          );
        }
      } catch (archiveError) {
        const archiveMessage =
          archiveError instanceof Error ? archiveError.message : '智能报告已生成，但归档失败。';
        message.warning(`智能报告已生成，但历史区归档失败：${archiveMessage}`);
      }
      message.success('智能报告生成成功。');
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : '智能报告生成失败。';
      setReportError(nextMessage);
      message.error(nextMessage);
    } finally {
      setGenerating(false);
    }
  }, [
    allProjectIds,
    dateRange,
    preferredHydraulicSnapshot,
    preferredOptimizationComparisonSnapshot,
    preferredOptimizationSnapshot,
    preferredSensitivitySnapshot,
    projects,
    selectedGenerationRecords,
    selectedHydraulicRecord,
    selectedOptimizationRecord,
    selectedProjectIds,
    selectedSensitivityRecord,
  ]);

  return (
    <AnimatedPage className="min-h-full">
      <div style={{ maxWidth: 1760, margin: '0 auto', padding: 24 }}>
        <style>{`
          .report-history-table .ant-table-thead .ant-table-selection-column {
            background: #edf4ff !important;
          }

          .report-history-table .ant-table-thead .ant-table-selection-column::before {
            display: none !important;
          }

          .report-history-table .ant-table-thead .ant-table-selection-column,
          .report-history-table .ant-table-tbody .ant-table-selection-column {
            width: 112px !important;
            min-width: 112px !important;
            padding: 0 16px 0 24px !important;
            text-align: left !important;
            border-right: 1px solid #d8e6f8 !important;
          }

          .report-history-table .ant-table-selection-column .ant-space {
            width: 100%;
            align-items: center;
            justify-content: flex-start;
          }

          .report-history-table .ant-table-selection-column .ant-checkbox {
            top: 0;
          }

          .report-history-table .ant-table-selection-column .ant-checkbox .ant-checkbox-inner {
            width: 18px;
            height: 18px;
            border-radius: 6px;
            border: 1.5px solid #111111 !important;
            background: #ffffff;
            box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08);
          }

          .report-history-table .ant-table-selection-column .ant-checkbox:hover .ant-checkbox-inner,
          .report-history-table .ant-table-selection-column .ant-checkbox-wrapper:hover .ant-checkbox-inner {
            border-color: #111111 !important;
          }

          .report-history-table .ant-table-selection-column .ant-checkbox-checked .ant-checkbox-inner,
          .report-history-table .ant-table-selection-column .ant-checkbox-indeterminate .ant-checkbox-inner {
            border-color: #111111 !important;
            background: #111111 !important;
            box-shadow: 0 6px 14px rgba(15, 23, 42, 0.18);
          }

          .report-hero-title span + span {
            display: none !important;
          }

          .report-hero-copy {
            display: none !important;
          }
        `}</style>
        <Space direction="vertical" size={24} style={{ width: '100%' }}>
          <Card style={cardStyle} bodyStyle={{ padding: 28 }}>
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Title className="report-hero-title" level={2} style={{ margin: 0, lineHeight: 1.1 }}>
                <span
                  style={{
                    display: 'inline-block',
                    fontSize: 'clamp(34px, 4vw, 56px)',
                    fontWeight: 900,
                    letterSpacing: '-0.04em',
                    background: 'linear-gradient(90deg, #4a86ff 0%, #7367ff 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  智能报告
                </span>
                <span style={{ marginLeft: 8 }}>工作台</span>
              </Title>
              <Paragraph className="report-hero-copy" type="secondary" style={{ margin: 0, maxWidth: 900 }}>
                保留原页面的核心用途：按项目和时间范围生成智能报告，同时查看当前计算历史概览。当前仅修复为可编译可打开版本，不包含你刚刚撤销的“落库并按 reportId 查看”逻辑。
              </Paragraph>
            </Space>
          </Card>

          <Row gutter={[16, 16]} align="stretch">
            <Col xs={24} sm={12} lg={6}>
              <MetricCard
                icon={<AppstoreOutlined />}
                tone={metricCardTones[0]}
                statistic={<Statistic title="项目数量" value={projects.length} />}
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <MetricCard
                icon={<HistoryOutlined />}
                tone={metricCardTones[1]}
                statistic={<Statistic title="历史记录" value={visibleHistoryCount} />}
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <MetricCard
                icon={<CheckCircleOutlined />}
                tone={metricCardTones[2]}
                statistic={<Statistic title="已完成记录" value={completedCount} />}
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <MetricCard
                icon={<RobotOutlined />}
                tone={metricCardTones[3]}
                statistic={<Statistic title="AI 报告记录" value={aiCount} />}
              />
            </Col>
          </Row>

          <Card style={cardStyle} title="生成条件">
            <Row gutter={[12, 12]} align="middle">
              <Col xs={24} md={12} xl={5}>
                <Input
                  allowClear
                  value={searchKeyword}
                  onChange={(event) => setSearchKeyword(event.target.value)}
                  placeholder="搜索项目名称或备注..."
                  prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
                />
              </Col>
              <Col xs={24} md={12} xl={5}>
                <Select
                  mode="multiple"
                  style={{ width: '100%' }}
                  placeholder="全部项目"
                  value={selectedProjectIds}
                  onChange={(value) => setSelectedProjectIds(value as number[])}
                  options={projectOptions}
                  maxTagCount={0}
                  maxTagPlaceholder={() => projectSelectionLabel}
                  allowClear
                  showSearch
                  optionFilterProp="label"
                />
              </Col>
              <Col xs={24} md={12} xl={4}>
                <Select
                  style={{ width: '100%' }}
                  value={selectedCalcType}
                  onChange={(value) => setSelectedCalcType(value)}
                  options={calcTypeOptions}
                />
              </Col>
              <Col xs={24} md={24} xl={6}>
                <RangePicker
                  style={{ width: '100%' }}
                  value={dateRange}
                  onChange={(value) => setDateRange(value as [Dayjs, Dayjs] | null)}
                  placeholder={['起始日期', '截止日期']}
                />
              </Col>
            </Row>
            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
              <Space wrap>
                <Button
                  type="primary"
                  icon={<RobotOutlined />}
                  onClick={() => void handleGenerate()}
                  loading={generating}
                >
                  开始生成智能报告
                </Button>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => {
                    setSearchKeyword('');
                    setSelectedProjectIds([]);
                    setSelectedCalcType(ALL_CALC_TYPE_OPTION);
                    setDateRange(null);
                    setReport(null);
                    setReportError('');
                  }}
                >
                  重置
                </Button>
                <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>
                  刷新
                </Button>
              </Space>
            </div>
          </Card>

          <Row gutter={[16, 16]} align="stretch">
            <Col xs={24} xl={24}>
              <Card
                style={{ ...cardStyle, height: '100%' }}
                bodyStyle={tableCardBodyStyle}
                title="计算记录表"
                extra={<Text type="secondary">最近 10 条数据库真实记录</Text>}
              >
                {loading ? (
                  <div style={{ textAlign: 'center', padding: '48px 0' }}>
                    <Spin />
                  </div>
                ) : latestRecords.length ? (
                  <Table
                    className="report-history-table"
                    columns={historyColumns}
                    dataSource={latestRecords}
                    rowKey="key"
                    rowSelection={{
                      selectedRowKeys: selectedHistoryKeys,
                      onChange: (keys) => setSelectedHistoryKeys(keys as number[]),
                      columnTitle: (checkboxNode) => (
                        <Space size={6} style={{ width: '100%', whiteSpace: 'nowrap', justifyContent: 'flex-start' }}>
                          {checkboxNode}
                          <span style={{ color: '#7c8aa5', fontSize: 14, fontWeight: 600 }}>全选</span>
                        </Space>
                      ),
                      columnWidth: 112,
                    }}
                    loading={loading}
                    pagination={false}
                    scroll={{ x: 980, y: 520 }}
                    size="middle"
                    locale={{
                      emptyText: <Empty description="暂无可展示的计算结果记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
                    }}
                  />
                ) : (
                  <Empty description="暂无可展示的计算结果记录" />
                )}
              </Card>
            </Col>

            <Col xs={24} xl={12} style={{ display: 'none' }}>
              <Card
                style={{ ...cardStyle, height: '100%' }}
                title="报告生成结果"
                extra={<FileTextOutlined />}
              >
                {generating ? (
                  <div style={{ textAlign: 'center', padding: '60px 0' }}>
                    <Spin />
                    <div style={{ marginTop: 12, color: '#64748b' }}>正在生成智能报告...</div>
                  </div>
                ) : reportError ? (
                  <Alert type="error" showIcon message="生成失败" description={reportError} />
                ) : report ? (
                  <Space direction="vertical" size={16} style={{ width: '100%' }}>
                    <div>
                      <Title level={4} style={{ marginBottom: 8 }}>
                        {report.title}
                      </Title>
                      <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                        {report.abstract}
                      </Paragraph>
                    </div>

                    <Card size="small" title="摘要">
                      {renderSummaryList(report.summary)}
                    </Card>

                    <Card size="small" title="亮点">
                      {renderSummaryList(report.highlights)}
                    </Card>

                    <Card size="small" title="结论">
                      <Paragraph style={{ marginBottom: 0 }}>
                        {report.conclusion || '暂无结论'}
                      </Paragraph>
                    </Card>

                    {report.risks.length ? (
                      <Card size="small" title="风险提示">
                        <Space direction="vertical" size={12} style={{ width: '100%' }}>
                          {report.risks.map((item, index) => (
                            <div key={`${item.target}-${index}`}>
                              <Space wrap>
                                <Tag color="red">{item.level}</Tag>
                                <Text strong>{item.target}</Text>
                                <Text>{item.riskType}</Text>
                              </Space>
                              <Paragraph style={{ margin: '8px 0 0' }}>{item.reason}</Paragraph>
                            </div>
                          ))}
                        </Space>
                      </Card>
                    ) : null}

                    <Card size="small" title="原始结果">
                      <pre
                        style={{
                          margin: 0,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          fontSize: 12,
                          lineHeight: 1.6,
                        }}
                      >
                        {report.raw_text || JSON.stringify(report, null, 2)}
                      </pre>
                    </Card>
                  </Space>
                ) : (
                  <Empty description="设置条件后生成智能报告，结果会显示在这里" />
                )}
              </Card>
            </Col>
          </Row>

          <Modal
            open={Boolean(detailPreview)}
            footer={null}
            destroyOnClose
            width={960}
            title={
              detailPreview?.mode === 'history'
                ? `${detailPreview.row.projectName || '未命名项目'} / ${detailPreview.row.calcTypeLabel}`
                : '智能报告生成结果'
            }
            onCancel={() => setDetailPreview(null)}
          >
            {detailPreview?.mode === 'history' ? (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                {shouldHideDetailInfoCard ? null : (
                  <Card style={detailSectionStyle} bodyStyle={detailSectionBodyStyle} title="计算基本信息">
                    {renderDetailMetricCards(detailInfoCards, {
                      equalWidth: true,
                      singleLine: true,
                      compact: true,
                      minColumnWidth: 180,
                      minHeight: 88,
                      valueFontSize: 'clamp(14px, 1.8vw, 18px)',
                    })}
                  </Card>
                )}

                {isAiReportRecord && detailReport ? (
                  renderReportContent(detailReport)
                ) : (
                  <>
                    <Card style={detailSectionStyle} bodyStyle={detailSectionBodyStyle} title="计算入参">
                      {renderDetailMetricCards(inputMetricCards, {
                        singleLine: true,
                        valueFontSize: 'clamp(16px, 1.8vw, 22px)',
                      })}
                    </Card>

                    {isHydraulicRecord ? (
                      <Card style={detailSectionStyle} bodyStyle={detailSectionBodyStyle} title="水力结果">
                        {renderDetailMetricCards(hydraulicResultCards)}
                      </Card>
                    ) : null}

                    {isOptimizationRecord ? (
                      <Card style={detailSectionStyle} bodyStyle={detailSectionBodyStyle} title="优化结果">
                        {renderDetailMetricCards(optimizationResultCards)}
                      </Card>
                    ) : null}

                    {isSensitivityRecord ? (
                      <>
                        <Card style={detailSectionStyle} bodyStyle={detailSectionBodyStyle} title="敏感性结果">
                          <Space direction="vertical" size={20} style={{ width: '100%' }}>
                            <div>
                              <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 12 }}>基准结果</div>
                              {renderDetailMetricCards(sensitivityBaseResultCards)}
                            </div>

                            <div>
                              <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 12 }}>敏感系数 / 最大影响 / 排名</div>
                              {sensitivitySummaryCards.length ? (
                                renderDetailMetricCards(sensitivitySummaryCards)
                              ) : (
                                <Empty description="暂无敏感性摘要数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                              )}
                            </div>
                          </Space>
                        </Card>

                        <Card style={detailSectionStyle} bodyStyle={tableCardBodyStyle} title="各变化比例下的压力 / 摩阻 / 流态明细">
                          <Table
                            columns={sensitivityDetailColumns}
                            dataSource={sensitivityDetailRows}
                            rowKey="key"
                            pagination={false}
                            scroll={{ x: 900, y: 360 }}
                            locale={{
                              emptyText: <Empty description="暂无敏感性变化明细" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
                            }}
                          />
                        </Card>
                      </>
                    ) : null}

                    {!isHydraulicRecord && !isOptimizationRecord && !isSensitivityRecord ? (
                      <Card style={detailSectionStyle} bodyStyle={detailSectionBodyStyle} title="计算结果">
                        <pre
                          style={{
                            margin: 0,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            fontSize: 12,
                            lineHeight: 1.6,
                          }}
                        >
                          {detailPreview.row.outputResult ||
                            detailPreview.row.inputParams ||
                            (detailPayload ? JSON.stringify(detailPayload, null, 2) : '暂无结果数据')}
                        </pre>
                      </Card>
                    ) : null}
                  </>
                )}

                {/*
                  <>
                <Row gutter={[12, 12]}>
                  {[
                    { label: '项目名称', value: detailPreview.row.projectName || '-' },
                    { label: '项目编号', value: detailPreview.row.projectNumber || '-' },
                    { label: '负责人', value: detailPreview.row.responsible || '-' },
                    { label: '计算类型', value: detailPreview.row.calcTypeLabel || '-' },
                    { label: '更新时间', value: detailPreview.row.updateTimeText || '-' },
                    { label: '备注', value: detailPreview.row.remark || '-' },
                  ].map((item) => (
                    <Col xs={24} md={12} key={item.label}>
                      <Card size="small">
                        <Text type="secondary">{item.label}</Text>
                        <div style={{ marginTop: 8, color: '#0f172a', wordBreak: 'break-word' }}>{item.value}</div>
                      </Card>
                    </Col>
                  ))}
                </Row>

                {detailReport ? (
                  renderReportContent(detailReport)
                ) : (
                  <Card size="small" title="原始结果">
                    <pre
                      style={{
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        fontSize: 12,
                        lineHeight: 1.6,
                      }}
                    >
                      {detailPreview.row.outputResult ||
                        detailPreview.row.inputParams ||
                        (detailPayload ? JSON.stringify(detailPayload, null, 2) : '暂无结果数据')}
                    </pre>
                  </Card>
                )}
                  </>
                */}
              </Space>
            ) : detailReport ? (
              renderReportContent(detailReport)
            ) : (
              <Empty description="暂无可展示的报告详情" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Modal>

          <Card
            style={cardStyle}
            bodyStyle={tableCardBodyStyle}
            title="智能报告历史区"
            extra={<Text type="secondary">已归档 {aiReportRecords.length} 条智能报告</Text>}
          >
            {aiReportRecords.length ? (
              <div style={{ padding: 20, background: '#f8fbff' }}>
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  {aiReportRecords.map((record) => {
                    const isDeleting = deletingHistoryIds.includes(Number(record.id));
                    return (
                      <div
                        key={record.key}
                        style={{
                          border: '1px solid #e5edf8',
                          borderRadius: 22,
                          background: 'linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)',
                          boxShadow: '0 10px 28px rgba(15, 23, 42, 0.05)',
                          padding: 24,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 20,
                            alignItems: 'flex-start',
                          }}
                        >
                          <div style={{ flex: '1 1 100%', minWidth: 0 }}>
                            <Space wrap size={[8, 8]} style={{ marginBottom: 12 }}>
                              <Tag color="geekblue">{record.calcTypeLabel}</Tag>
                              {record.projectName ? <Tag color="blue">{record.projectName}</Tag> : null}
                            </Space>

                            <div
                              style={{
                                fontSize: 20,
                                fontWeight: 700,
                                lineHeight: 1.45,
                                color: '#0f172a',
                                wordBreak: 'break-word',
                              }}
                              title={record.reportTitle}
                            >
                              {record.reportTitle}
                            </div>

                            <div
                              style={{
                                marginTop: 10,
                                fontSize: 14,
                                lineHeight: 1.85,
                                color: '#64748b',
                                wordBreak: 'break-word',
                              }}
                              title={record.reportAbstract}
                            >
                              {record.reportAbstract}
                            </div>
                            <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end' }}>
                              <Space wrap>
                                <Button
                                  icon={<EyeOutlined style={{ color: '#22c1ff' }} />}
                                  onClick={() =>
                                    navigate(`/ai/report/detail/${record.id}`, {
                                      state: { row: record } satisfies ReportHistoryDetailLocationState,
                                    })
                                  }
                                  disabled={isDeleting}
                                >
                                  查看
                                </Button>
                                <Popconfirm
                                  title="确认删除这条智能报告？"
                                  description="删除后不可恢复。"
                                  okText="删除"
                                  cancelText="取消"
                                  onConfirm={() => void handleDeleteHistory(record)}
                                >
                                  <Button danger loading={isDeleting} icon={<DeleteOutlined />}>
                                    删除
                                  </Button>
                                </Popconfirm>
                              </Space>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </Space>
              </div>
            ) : (
              <div style={{ padding: 40 }}>
                <Empty description="暂无智能报告历史记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              </div>
            )}
          </Card>
        </Space>
      </div>
    </AnimatedPage>
  );
}
