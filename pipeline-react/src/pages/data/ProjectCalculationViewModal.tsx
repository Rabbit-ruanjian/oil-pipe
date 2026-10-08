import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Card,
  Collapse,
  Descriptions,
  Empty,
  Modal,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { calculationHistoryApi } from '../../api';
import type { CalculationHistory, Project } from '../../types';

const { Paragraph, Text } = Typography;

type ProjectCalculationViewModalProps = {
  open: boolean;
  project: Project | null;
  onClose: () => void;
};

type JsonRecord = Record<string, unknown>;

type ParsedHistory = {
  id: number;
  calcType?: string;
  calcTypeName?: string;
  createTime?: string;
  remark?: string;
  input: JsonRecord;
  output: JsonRecord;
};

type FieldConfig = {
  label: string;
  key: string;
  unit?: string;
};

const CALCULATION_TYPE_LABELS: Record<string, string> = {
  HYDRAULIC: '水力分析',
  OPTIMIZATION: '泵站优化',
  SENSITIVITY: '敏感性分析',
};

const CALCULATION_TYPE_ORDER: Record<string, number> = {
  HYDRAULIC: 0,
  OPTIMIZATION: 1,
  SENSITIVITY: 2,
};

const INPUT_FIELDS: FieldConfig[] = [
  { label: '流量', key: 'flowRate', unit: 'm³/h' },
  { label: '密度', key: 'density', unit: 'kg/m³' },
  { label: '粘度', key: 'viscosity', unit: 'Pa·s' },
  { label: '长度', key: 'length', unit: 'km' },
  { label: '管径', key: 'diameter', unit: 'mm' },
  { label: '壁厚', key: 'thickness', unit: 'mm' },
  { label: '粗糙度', key: 'roughness', unit: 'm' },
  { label: '起点高程', key: 'startAltitude', unit: 'm' },
  { label: '终点高程', key: 'endAltitude', unit: 'm' },
  { label: '首站进站压头', key: 'inletPressure', unit: 'MPa' },
  { label: 'ZMI480 数量', key: 'pump480Num', unit: '台' },
  { label: 'ZMI480 扬程', key: 'pump480Head', unit: 'm' },
  { label: 'ZMI375 数量', key: 'pump375Num', unit: '台' },
  { label: 'ZMI375 扬程', key: 'pump375Head', unit: 'm' },
  { label: '泵效率', key: 'pumpEfficiency' },
  { label: '电机效率', key: 'motorEfficiency' },
  { label: '电价', key: 'electricityPrice', unit: '元/kWh' },
  { label: '工作天数', key: 'workingDays', unit: '天' },
];

const RESULT_FIELDS: FieldConfig[] = [
  { label: '雷诺数', key: 'reynoldsNumber' },
  { label: '流态', key: 'flowRegime' },
  { label: '摩阻损失', key: 'frictionHeadLoss', unit: 'm' },
  { label: '水力坡降', key: 'hydraulicSlope' },
  { label: '总扬程', key: 'totalHead', unit: 'm' },
  { label: '首站出站压头', key: 'firstStationOutPressure', unit: 'm' },
  { label: '末站进站压头', key: 'endStationInPressure', unit: 'm' },
];

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(value?: string): JsonRecord | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function hasValue(value: unknown) {
  return value !== null && value !== undefined && value !== '';
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(value);
}

function formatValue(value: unknown, unit?: string) {
  if (!hasValue(value)) {
    return '-';
  }

  if (typeof value === 'boolean') {
    return value ? '是' : '否';
  }

  if (typeof value === 'number') {
    return unit ? `${formatNumber(value)} ${unit}` : formatNumber(value);
  }

  if (Array.isArray(value)) {
    const text = value
      .map((item) => (typeof item === 'string' || typeof item === 'number' ? String(item) : ''))
      .filter(Boolean)
      .join('，');
    return text || '-';
  }

  return unit ? `${String(value)} ${unit}` : String(value);
}

function buildDescriptionItems(source: JsonRecord, fields: FieldConfig[]) {
  return fields
    .filter(({ key }) => hasValue(source[key]))
    .map(({ key, label, unit }) => ({
      key,
      label,
      children: formatValue(source[key], unit),
    }));
}

function getCalculationTypeLabel(history: ParsedHistory) {
  if (history.calcTypeName && history.calcTypeName !== '未知类型') {
    return history.calcTypeName;
  }

  if (history.calcType) {
    return CALCULATION_TYPE_LABELS[history.calcType] ?? history.calcType;
  }

  return '计算记录';
}

function getBaseInput(history: ParsedHistory) {
  if (history.calcType === 'SENSITIVITY' && isRecord(history.input.baseParams)) {
    return history.input.baseParams;
  }

  return history.input;
}

function getHydraulicResultSource(history: ParsedHistory) {
  if (history.calcType === 'SENSITIVITY' && isRecord(history.output.baseResult)) {
    return history.output.baseResult;
  }

  return history.output;
}

function getSensitivityVariableTypeItems(history: ParsedHistory) {
  if (history.calcType !== 'SENSITIVITY' || !Array.isArray(history.input.variables)) {
    return [];
  }

  return history.input.variables
    .filter(isRecord)
    .map((item, index) => {
      const values = [item.variableName, item.variableType]
        .filter((value) => hasValue(value))
        .map((value) => String(value));

      if (values.length === 0) {
        return null;
      }

      return {
        key: `sensitivity-variable-${index}`,
        label: `敏感变量类型 ${index + 1}`,
        children: values.join(' / '),
      };
    })
    .filter((item): item is { key: string; label: string; children: string } => Boolean(item));
}

function renderDescriptions(title: string, items: ReturnType<typeof buildDescriptionItems> | Array<{ key: string; label: string; children: string }>) {
  if (items.length === 0) {
    return null;
  }

  return (
    <Card size="small" title={title} style={{ borderRadius: 16 }}>
      <Descriptions size="small" bordered column={{ xs: 1, sm: 2, lg: 3 }} items={items} />
    </Card>
  );
}

export default function ProjectCalculationViewModal({
  open,
  project,
  onClose,
}: ProjectCalculationViewModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [histories, setHistories] = useState<CalculationHistory[]>([]);

  useEffect(() => {
    if (!open || !project?.proId) {
      return;
    }

    let active = true;

    const loadHistories = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await calculationHistoryApi.byProject(project.proId, {
          pageNum: 1,
          pageSize: 50,
        });

        if (!active) {
          return;
        }

        setHistories(response.data?.list ?? []);
      } catch {
        if (!active) {
          return;
        }

        setError('读取项目计算记录失败，请确认计算服务和数据库可用。');
        setHistories([]);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadHistories();

    return () => {
      active = false;
    };
  }, [open, project?.proId]);

  const parsedHistories = useMemo(() => {
    return histories
      .map((history): ParsedHistory | null => {
        const input = parseJson(history.inputParams) ?? {};
        const output = parseJson(history.outputResult) ?? {};

        if (!isRecord(input) || !isRecord(output)) {
          return null;
        }

        return {
          id: history.id,
          calcType: history.calcType,
          calcTypeName: history.calcTypeName,
          createTime: history.createTime,
          remark: history.remark,
          input,
          output,
        };
      })
      .filter((item): item is ParsedHistory => Boolean(item))
      .sort((left, right) => {
        const leftOrder = CALCULATION_TYPE_ORDER[left.calcType ?? ''] ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = CALCULATION_TYPE_ORDER[right.calcType ?? ''] ?? Number.MAX_SAFE_INTEGER;

        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }

        const rightTime = right.createTime ? new Date(right.createTime).getTime() : 0;
        const leftTime = left.createTime ? new Date(left.createTime).getTime() : 0;
        return rightTime - leftTime;
      });
  }, [histories]);

  const collapseItems = parsedHistories.map((history) => {
    const inputSource = getBaseInput(history);
    const resultSource = getHydraulicResultSource(history);
    const inputItems = buildDescriptionItems(inputSource, INPUT_FIELDS);
    const sensitivityVariableItems = getSensitivityVariableTypeItems(history);
    const resultItems = buildDescriptionItems(resultSource, RESULT_FIELDS);

    return {
      key: String(history.id),
      label: (
        <Space size={8} wrap>
          <span>{getCalculationTypeLabel(history)}</span>
          {history.createTime ? <Tag color="blue">{history.createTime}</Tag> : null}
        </Space>
      ),
      children: (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {renderDescriptions('计算入参', inputItems)}
          {renderDescriptions('敏感变量类型', sensitivityVariableItems)}
          {renderDescriptions('计算结果', resultItems)}
          {history.remark ? (
            <Card size="small" title="备注" style={{ borderRadius: 16 }}>
              <Paragraph style={{ marginBottom: 0 }}>{history.remark}</Paragraph>
            </Card>
          ) : null}
        </Space>
      ),
    };
  });

  return (
    <Modal
      title={project ? `${project.name} - 计算详情` : '计算详情'}
      open={open}
      onCancel={onClose}
      footer={null}
      width={1080}
      destroyOnClose
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="只展示数据库中实际落库的计算入参和水力结果字段"
          description="不会展示优化结果、敏感性结果，也不会补出数据库中不存在的字段。"
        />

        {loading ? (
          <div style={{ padding: '48px 0', textAlign: 'center' }}>
            <Spin size="large" />
          </div>
        ) : null}

        {!loading && error ? <Alert type="error" showIcon message={error} /> : null}

        {!loading && !error && parsedHistories.length === 0 ? (
          <Empty description="该项目暂无计算记录" />
        ) : null}

        {!loading && !error && parsedHistories.length > 0 ? (
          <>
            <Card size="small" style={{ borderRadius: 16 }}>
              <Space size={24} wrap>
                <div>
                  <Text type="secondary">项目编号</Text>
                  <br />
                  <Text strong>{project?.number || '-'}</Text>
                </div>
                <div>
                  <Text type="secondary">负责人</Text>
                  <br />
                  <Text strong>{project?.responsible || '-'}</Text>
                </div>
                <div>
                  <Text type="secondary">计算记录数</Text>
                  <br />
                  <Text strong>{parsedHistories.length}</Text>
                </div>
              </Space>
            </Card>

            <Collapse
              items={collapseItems}
              defaultActiveKey={collapseItems[0] ? [collapseItems[0].key] : []}
            />
          </>
        ) : null}
      </Space>
    </Modal>
  );
}
