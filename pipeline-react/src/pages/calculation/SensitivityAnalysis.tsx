import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Col,
  Form,
  InputNumber,
  Row,
  Select,
  Table,
  message,
} from 'antd';
import { BarChartOutlined } from '@ant-design/icons';
import { CircleDotDashed, Droplets, Gauge, Waves } from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import AnimatedPage from '../../components/common/AnimatedPage';
import styles from './SensitivityAnalysis.module.css';
import { calculationApi, oilPropertyApi, pipelineApi, projectApi, pumpStationApi } from '../../api';
import { useCalculationLinkStore } from '../../stores/calculationLinkStore';
import { convertPressureMpaToHeadMeters, convertViscosityMm2PerSecToM2PerSec } from '../../utils/calculationUnits';
import type {
  HydraulicAnalysisParams,
  OilProperty,
  Pipeline,
  Project,
  PumpStation,
  SensitivityPoint,
  SensitivityResult,
  SensitivityVariableInfo,
  VariableSensitivityResult,
} from '../../types';

const ZERO_IMPACT_THRESHOLD = 0.005;
const VARIABLE_VISUALS = {
  FLOW_RATE: { color: '#0891b2', background: '#ecfeff', Icon: Gauge },
  OIL_VISCOSITY: { color: '#7c3aed', background: '#f5f3ff', Icon: Droplets },
  PIPE_DIAMETER: { color: '#059669', background: '#ecfdf5', Icon: CircleDotDashed },
  PIPE_ROUGHNESS: { color: '#d97706', background: '#fffbeb', Icon: Waves },
} as const;

function getVariablePrecision(variableType?: string) {
  switch (variableType) {
    case 'OIL_VISCOSITY':
      return 8;
    case 'PIPE_ROUGHNESS':
      return 6;
    default:
      return 2;
  }
}

function getVariableDisplayUnit(variableType?: string, fallbackUnit?: string) {
  switch (variableType) {
    case 'FLOW_RATE':
      return 'm³/h';
    case 'OIL_VISCOSITY':
      return 'm²/s';
    case 'PIPE_DIAMETER':
      return 'mm';
    case 'PIPE_ROUGHNESS':
      return 'm';
    default:
      return fallbackUnit ?? '';
  }
}

function formatVariableValue(value: number, variableType?: string) {
  return Number.isFinite(value) ? value.toFixed(getVariablePrecision(variableType)) : '-';
}

function formatResultValue(value: number) {
  if (!Number.isFinite(value)) return '-';
  const absoluteValue = Math.abs(value);
  if (absoluteValue > 0 && absoluteValue < 0.01) return value.toFixed(6);
  if (absoluteValue < 1) return value.toFixed(4);
  return value.toFixed(2);
}

function formatChangePercent(value: number) {
  if (!Number.isFinite(value)) return '-';
  const absoluteValue = Math.abs(value);
  const digits = absoluteValue > 0 && absoluteValue < 0.01 ? 6 : absoluteValue < 1 ? 4 : 2;
  const normalized = absoluteValue < 10 ** -digits ? 0 : value;
  return `${normalized > 0 ? '+' : ''}${normalized.toFixed(digits)}%`;
}

type SensitivityFormValues = HydraulicAnalysisParams & {
  pipelineId?: number;
  oilId?: number;
  pumpStationId?: number;
  variableType: string;
};

const INITIAL_VALUES: SensitivityFormValues = {
  variableType: 'FLOW_RATE',
  flowRate: 850,
  density: 860,
  viscosity: 0.00002,
  length: 150,
  diameter: 508,
  thickness: 8,
  roughness: 0.00003,
  startAltitude: 0,
  endAltitude: 35,
  inletPressure: 6.5,
  pump480Num: 2,
  pump375Num: 1,
  pump480Head: 280,
  pump375Head: 220,
};

export default function SensitivityAnalysis() {
  const [form] = Form.useForm<SensitivityFormValues>();
  const [loading, setLoading] = useState(false);
  const selectedVariableType = Form.useWatch('variableType', form);
  const watchedDensity = Form.useWatch('density', form);
  const [projects, setProjects] = useState<Project[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [oils, setOils] = useState<OilProperty[]>([]);
  const [stations, setStations] = useState<PumpStation[]>([]);
  const [variables, setVariables] = useState<SensitivityVariableInfo[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedStationId, setSelectedStationId] = useState<number | null>(null);
  const [result, setResult] = useState<SensitivityResult | null>(null);

  const loadBaseData = useCallback(async () => {
    const [projectRes, oilRes, stationRes, variableRes] = await Promise.all([
      projectApi.list(),
      oilPropertyApi.list(),
      pumpStationApi.list(),
      calculationApi.getSensitivityVariables(),
    ]);

    const projectList = projectRes.data ?? [];
    const variableList = variableRes.data ?? [];

    setProjects(projectList);
    setOils(oilRes.data ?? []);
    setStations(stationRes.data ?? []);
    setVariables(variableList);

    if (projectList.length > 0) {
      setSelectedProjectId(projectList[0].proId);
    }
    if (variableList.length > 0) {
      form.setFieldValue('variableType', variableList[0].code);
    }
  }, [form]);

  const loadPipelines = useCallback(async (projectId: number) => {
    const response = await pipelineApi.listByProject(projectId);
    const pipelineList = response.data ?? [];
    setPipelines(pipelineList);

    if (pipelineList.length > 0) {
      const [firstPipeline] = pipelineList;
      form.setFieldsValue({
        pipelineId: firstPipeline.id,
        length: firstPipeline.length,
        diameter: firstPipeline.diameter,
        thickness: firstPipeline.thickness,
        roughness: firstPipeline.roughness ?? INITIAL_VALUES.roughness,
        startAltitude: firstPipeline.startAltitude,
        endAltitude: firstPipeline.endAltitude,
      });
    } else {
      form.setFieldValue('pipelineId', undefined);
    }
  }, [form]);

  useEffect(() => {
    form.setFieldsValue(INITIAL_VALUES);
    void loadBaseData();
  }, [form, loadBaseData]);

  useEffect(() => {
    if (selectedProjectId) {
      setResult(null);
      void loadPipelines(selectedProjectId);
    }
  }, [loadPipelines, selectedProjectId]);

  useEffect(() => {
    if (!selectedStationId) {
      return;
    }

    const station = stations.find((item) => item.id === selectedStationId);
    const nextInletPressure = convertPressureMpaToHeadMeters(station?.comePower, Number(watchedDensity));
    if (nextInletPressure === undefined || nextInletPressure === form.getFieldValue('inletPressure')) {
      return;
    }

    form.setFieldValue('inletPressure', nextInletPressure);
  }, [form, selectedStationId, stations, watchedDensity]);

  const handlePipelineChange = (pipelineId: number) => {
    const pipeline = pipelines.find((item) => item.id === pipelineId);
    if (!pipeline) {
      return;
    }

    form.setFieldsValue({
      pipelineId,
      length: pipeline.length,
      diameter: pipeline.diameter,
      thickness: pipeline.thickness,
      roughness: pipeline.roughness ?? INITIAL_VALUES.roughness,
      startAltitude: pipeline.startAltitude,
      endAltitude: pipeline.endAltitude,
    });
    setResult(null);
  };

  const handleOilChange = (oilId: number) => {
    const oil = oils.find((item) => item.id === oilId);
    if (!oil) {
      return;
    }

    form.setFieldsValue({
      oilId,
      density: oil.density,
      viscosity: convertViscosityMm2PerSecToM2PerSec(oil.viscosity) ?? oil.viscosity,
    });
    setResult(null);
  };

  const handleStationChange = (stationId: number) => {
    const station = stations.find((item) => item.id === stationId);
    if (!station) {
      return;
    }

    setSelectedStationId(stationId);
    const nextValues: Partial<SensitivityFormValues> = {
      pumpStationId: stationId,
      pump480Head: station.zmi480Lift,
      pump375Head: station.zmi375Lift,
    };
    const nextInletPressure = convertPressureMpaToHeadMeters(station.comePower, Number(form.getFieldValue('density')));
    if (nextInletPressure !== undefined) {
      nextValues.inletPressure = nextInletPressure;
    }

    form.setFieldsValue(nextValues);
    setResult(null);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const { variableType, ...params } = values;
    const payload = {
      ...params,
      projectId: selectedProjectId ?? params.projectId,
    };
    setLoading(true);
    try {
      const project = projects.find((item) => item.proId === (payload.projectId ?? null));
      const analysisVariables = (variables.length > 0 ? variables : [
        { code: 'FLOW_RATE', name: '输送流量', unit: 'm³/h', minChangePercent: -20, maxChangePercent: 20 },
        { code: 'OIL_VISCOSITY', name: '运动黏度', unit: 'm²/s', minChangePercent: -30, maxChangePercent: 30 },
        { code: 'PIPE_DIAMETER', name: '管道直径', unit: 'mm', minChangePercent: -5, maxChangePercent: 5 },
        { code: 'PIPE_ROUGHNESS', name: '粗糙度', unit: 'm', minChangePercent: -50, maxChangePercent: 50 },
      ]).map((item) => ({
        variableType: item.code,
        variableName: item.name,
        unit: item.code === 'OIL_VISCOSITY' ? 'm²/s' : item.code === 'PIPE_ROUGHNESS' ? 'm' : item.unit,
        startPercent: -20,
        endPercent: 20,
        stepPercent: 5,
      }));
      const response = await calculationApi.sensitivityAnalysisAndSave({
        projectId: payload.projectId,
        projectName: project?.name,
        baseParams: payload,
        variables: analysisVariables,
        analysisType: 'SINGLE',
      });
      const nextResult = response.data ?? null;
      setResult(nextResult);
      if (nextResult) {
        useCalculationLinkStore.getState().linkCalculation({
          calcType: 'SENSITIVITY',
          projectId: payload.projectId ?? null,
          projectName: project?.name ?? null,
          input: {
            projectId: payload.projectId ?? null,
            projectName: project?.name ?? null,
            analysisType: 'SINGLE',
            baseParams: payload,
            variables: analysisVariables,
          },
          output: nextResult as unknown as Record<string, unknown>,
          updatedAt: new Date().toISOString(),
        });
      }
      message.success('敏感性分析完成');
    } finally {
      setLoading(false);
    }
  };

  const activeVariableResult: VariableSensitivityResult | null = useMemo(() => {
    if (!result || result.variableResults.length === 0) {
      return null;
    }
    return (
      result.variableResults.find((item) => item.variableType === selectedVariableType) ??
      result.variableResults[0]
    );
  }, [result, selectedVariableType]);

  const activeVariable = useMemo(
    () => variables.find((item) => item.code === activeVariableResult?.variableType),
    [activeVariableResult?.variableType, variables],
  );

  const noMeasurableImpact = Boolean(
    activeVariableResult &&
      Math.abs(activeVariableResult.sensitivityCoefficient) < ZERO_IMPACT_THRESHOLD &&
      Math.abs(activeVariableResult.maxImpactPercent) < ZERO_IMPACT_THRESHOLD,
  );

  const trendLabel = useMemo(() => {
    if (!activeVariableResult) return '未知';
    if (noMeasurableImpact) return '无明显影响';
    if (activeVariableResult.trend === 'POSITIVE') return '正相关';
    if (activeVariableResult.trend === 'NEGATIVE') return '负相关';
    if (activeVariableResult.trend === 'MIXED') return '混合';
    return '未知';
  }, [activeVariableResult, noMeasurableImpact]);

  const resultInterpretation = useMemo(() => {
    if (!activeVariableResult || !noMeasurableImpact) return null;

    const regimes = new Set(activeVariableResult.dataPoints.map((point) => point.flowRegime));
    const staysHydraulicSmooth = regimes.size === 1 && regimes.has('水力光滑区');

    if (activeVariableResult.variableType === 'PIPE_ROUGHNESS' && staysHydraulicSmooth) {
      return {
        title: '为什么粗糙度变化后结果基本不变？',
        description:
          '当前全部扰动工况均处于水力光滑区。在本系统采用的分区摩阻模型中，水力光滑区的摩阻系数主要由流态决定，粗糙度不会直接进入该区间的摩阻公式，因此 ±20% 的粗糙度变化未产生可测的摩阻和末站压头变化。这是当前模型与工况共同产生的结果，并非参数没有参与扰动。若管壁进一步老化，或流态进入混合摩擦区、粗糙区，粗糙度影响会明显增强。',
      };
    }

    return {
      title: '当前变化区间内未检测到明显影响',
      description:
        '该变量在当前基准工况及 ±20% 扰动范围内，对摩阻和末站压头的影响低于当前计算与展示精度，因此相关方向记为“无明显影响”，不再判定为正相关或负相关。',
    };
  }, [activeVariableResult, noMeasurableImpact]);

  const chartOption = useMemo(() => {
    if (!activeVariableResult) {
      return null;
    }

    return {
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value: number | string) =>
          typeof value === 'number' ? formatResultValue(value) : String(value),
      },
      legend: { data: ['末站压头变化率', '摩阻增加', '摩阻减少'], top: 0 },
      xAxis: {
        type: 'category',
        name: '变化比例',
        data: activeVariableResult.dataPoints.map((point) => `${point.changePercent}%`),
      },
      yAxis: { type: 'value', name: '相对变化 (%)' },
      series: [
        {
          name: '末站压头变化率',
          type: 'line',
          smooth: true,
          data: activeVariableResult.dataPoints.map((point) => Number(point.pressureChangePercent.toFixed(4))),
          lineStyle: { width: 2.5, color: '#0891b2' },
          itemStyle: { color: '#0891b2' },
          areaStyle: { color: 'rgba(8,145,178,0.12)' },
        },
        {
          name: '摩阻增加',
          type: 'bar',
          data: activeVariableResult.dataPoints.map((point) => point.frictionChangePercent > 0 ? Number(point.frictionChangePercent.toFixed(4)) : null),
          itemStyle: { color: '#f59e0b', borderRadius: [3, 3, 0, 0] },
        },
        {
          name: '摩阻减少',
          type: 'bar',
          data: activeVariableResult.dataPoints.map((point) => point.frictionChangePercent < 0 ? Number(point.frictionChangePercent.toFixed(4)) : null),
          itemStyle: { color: '#059669', borderRadius: [0, 0, 3, 3] },
        },
      ],
    };
  }, [activeVariableResult]);

  const gaugeOption = useMemo(() => {
    const value = activeVariableResult?.sensitivityCoefficient ?? 0;
    const max = Math.max(1.5, Math.ceil(value * 1.1 * 10) / 10);
    const color = value > 1.5 ? '#e11d48' : value > 0.5 ? '#d97706' : '#059669';
    return {
      series: [{
        type: 'gauge',
        startAngle: 200,
        endAngle: -20,
        min: 0,
        max,
        progress: { show: true, width: 12, itemStyle: { color } },
        axisLine: { lineStyle: { width: 12, color: [[0.17, '#059669'], [0.5, '#d97706'], [1, '#e11d48']] } },
        pointer: { width: 4, length: '65%' },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { distance: 12, fontSize: 10, color: '#94a3b8' },
        detail: { valueAnimation: true, formatter: (current: number) => current.toFixed(3), fontSize: 24, color, offsetCenter: [0, '70%'] },
        data: [{ value }],
      }],
    };
  }, [activeVariableResult]);

  const tornadoRows = useMemo(() => {
    return (result?.variableResults ?? []).map((item) => {
      const pressureChanges = item.dataPoints
        .map((point) => point.pressureChangePercent)
        .filter((value) => Number.isFinite(value));
      const minimum = pressureChanges.length ? Math.min(...pressureChanges) : 0;
      const maximum = pressureChanges.length ? Math.max(...pressureChanges) : 0;
      return {
        variableType: item.variableType,
        name: item.variableName,
        minimum,
        maximum,
        span: maximum - minimum,
      };
    }).sort((a, b) => b.span - a.span);
  }, [result]);

  const tornadoOption = useMemo(() => ({
    grid: { left: 90, right: 60, top: 20, bottom: 38 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (items: Array<{ dataIndex: number }>) => {
        const row = tornadoRows[items[0]?.dataIndex ?? 0];
        if (!row) return '';
        return `<b>${row.name}</b><br/>压头下降端：${formatChangePercent(row.minimum)}<br/>压头上升端：${formatChangePercent(row.maximum)}<br/><b>总冲击范围：${row.span.toFixed(4)}%</b>`;
      },
    },
    xAxis: {
      type: 'value',
      name: '末站压头变化 (%)',
      nameLocation: 'middle',
      nameGap: 28,
      axisLabel: { formatter: '{value}%', color: '#7188a8' },
      splitLine: { lineStyle: { color: '#eff4f9' } },
    },
    yAxis: {
      type: 'category',
      data: tornadoRows.map((row) => row.name),
      axisLabel: { color: '#3d557a', fontWeight: 600 },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        name: '压头下降端',
        type: 'bar',
        stack: 'impact',
        barWidth: 18,
        data: tornadoRows.map((row) => row.minimum < 0 ? Number(row.minimum.toFixed(4)) : 0),
        itemStyle: { color: '#f59e0b', borderRadius: [4, 0, 0, 4] },
      },
      {
        name: '压头上升端',
        type: 'bar',
        stack: 'impact',
        barWidth: 18,
        data: tornadoRows.map((row) => row.maximum > 0 ? Number(row.maximum.toFixed(4)) : 0),
        itemStyle: { color: '#0891b2', borderRadius: [0, 4, 4, 0] },
      },
    ],
  }), [tornadoRows]);

  const thresholdRows = useMemo(() => {
    return (result?.variableResults ?? []).map((item) => {
      const negativeFailure = [...item.dataPoints]
        .filter((point) => point.changePercent < 0 && point.endStationPressure <= 0)
        .sort((a, b) => b.changePercent - a.changePercent)[0];
      const positiveFailure = [...item.dataPoints]
        .filter((point) => point.changePercent > 0 && point.endStationPressure <= 0)
        .sort((a, b) => a.changePercent - b.changePercent)[0];
      const minimumPressure = item.dataPoints.reduce(
        (minimum, point) => Math.min(minimum, point.endStationPressure),
        Number.POSITIVE_INFINITY,
      );
      return {
        variableType: item.variableType,
        name: item.variableName,
        negativeFailure,
        positiveFailure,
        minimumPressure: Number.isFinite(minimumPressure) ? minimumPressure : null,
      };
    });
  }, [result]);

  const sortedRankings = useMemo(
    () => [...(result?.sensitivityRanking ?? [])].sort((a, b) => a.rank - b.rank),
    [result],
  );

  const sensitivityLevel = useMemo(() => {
    const value = activeVariableResult?.sensitivityCoefficient ?? 0;
    if (value > 1.5) return { label: '高敏感', className: styles.highBadge };
    if (value > 0.5) return { label: '中敏感', className: styles.mediumBadge };
    return { label: '低敏感', className: styles.lowBadge };
  }, [activeVariableResult]);

  const explanationText = useMemo(() => {
    if (resultInterpretation) return resultInterpretation.description;
    if (!activeVariableResult) return '';
    const coefficient = activeVariableResult.sensitivityCoefficient.toFixed(3);
    if (activeVariableResult.variableType === 'PIPE_DIAMETER') {
      return `管径在沿程摩阻公式中位于高次幂分母，内径减小会显著抬高流速与摩阻，因此有效管径通常是高敏感参数。当前每变化 1%，摩阻平均变化约 ${coefficient}%。`;
    }
    if (activeVariableResult.variableType === 'FLOW_RATE') {
      return `输送流量通过流速、雷诺数和摩阻项共同影响管道工况。当前每变化 1%，摩阻平均变化约 ${coefficient}%，调高输量前应同步校核末站压力余量。`;
    }
    if (activeVariableResult.variableType === 'OIL_VISCOSITY') {
      return `运动黏度同时影响雷诺数和流态分区。当前每变化 1%，摩阻平均变化约 ${coefficient}%，其影响程度取决于当前流态以及是否接近流态切换边界。`;
    }
    return `当前变量的综合敏感系数为 ${coefficient}，在 ±20% 扰动范围内与摩阻呈${trendLabel}关系。`;
  }, [activeVariableResult, resultInterpretation, trendLabel]);

  const conclusionText = useMemo(() => {
    if (!result || !activeVariableResult) return '';
    const top = sortedRankings[0];
    const second = sortedRankings[1];
    return `本次基于真实水力计算结果，对 ${result.variableResults.length} 个关键参数进行 ±20% 单因素分析。${top ? `${top.variableName}最敏感（S=${top.sensitivityCoefficient.toFixed(3)}）` : ''}${second ? `，其次为${second.variableName}（S=${second.sensitivityCoefficient.toFixed(3)}）` : ''}。当前选中的${activeVariableResult.variableName}属于${sensitivityLevel.label}。`;
  }, [activeVariableResult, result, sensitivityLevel.label, sortedRankings]);

  const adviceText = useMemo(() => {
    if (!result || !activeVariableResult) return '';
    if (result.baseResult.endStationInPressure <= 0) {
      return '当前基准工况的末站进站压头已不满足输送要求，应优先调整泵组组合、降低流量或复核边界参数后重新分析。';
    }
    const top = sortedRankings[0];
    return `当前末站进站压头为 ${formatResultValue(result.baseResult.endStationInPressure)} m，暂无负压风险。建议优先监测${top?.variableName ?? activeVariableResult.variableName}，参数调整前同步校核末站压力、摩阻和流态变化。`;
  }, [activeVariableResult, result, sortedRankings]);

  const columns = [
    {
      title: '变化比例',
      dataIndex: 'changePercent',
      key: 'changePercent',
      render: (value: number) => `${value}%`,
    },
    {
      title: `变量值${getVariableDisplayUnit(activeVariableResult?.variableType, activeVariable?.unit) ? ` (${getVariableDisplayUnit(activeVariableResult?.variableType, activeVariable?.unit)})` : ''}`,
      dataIndex: 'variableValue',
      key: 'variableValue',
      render: (value: number) => formatVariableValue(value, activeVariableResult?.variableType),
    },
    {
      title: '摩阻(m)',
      dataIndex: 'frictionHeadLoss',
      key: 'frictionHeadLoss',
      render: (value: number) => formatResultValue(value),
    },
    {
      title: '摩阻变化',
      dataIndex: 'frictionChangePercent',
      key: 'frictionChangePercent',
      render: (value: number) => formatChangePercent(value),
    },
    {
      title: '末站进站压力',
      dataIndex: 'endStationPressure',
      key: 'endStationPressure',
      render: (value: number) => formatResultValue(value),
    },
    {
      title: '压力变化率',
      dataIndex: 'pressureChangePercent',
      key: 'pressureChangePercent',
      render: (value: number) => formatChangePercent(value),
    },
    {
      title: '流态',
      dataIndex: 'flowRegime',
      key: 'flowRegime',
    },
  ];

  return (
    <AnimatedPage className={styles.page}>
      <div className={styles.calculationLayout}>
        <aside className={styles.paramPanel}>
          <div className={styles.panelTitle}><span />分析参数</div>
          <div className={styles.variableHint}>选择敏感变量（±20% 控制变量法）</div>

          <div className={styles.variableGrid}>
            {variables.map((item) => {
              const visual = VARIABLE_VISUALS[item.code as keyof typeof VARIABLE_VISUALS] ?? VARIABLE_VISUALS.FLOW_RATE;
              const selected = item.code === selectedVariableType;
              return (
                <button
                  key={item.code}
                  type="button"
                  className={`${styles.variableCard} ${selected ? styles.variableSelected : ''}`}
                  onClick={() => form.setFieldValue('variableType', item.code)}
                >
                  <span className={styles.variableIcon} style={{ color: visual.color, background: visual.background }}>
                    <visual.Icon size={17} />
                  </span>
                  <span><strong>{item.name}</strong><small>{getVariableDisplayUnit(item.code, item.unit)}</small></span>
                </button>
              );
            })}
          </div>

          <Form<SensitivityFormValues> form={form} layout="vertical" className={styles.paramForm} onFinish={() => void handleSubmit()}>
            <Form.Item name="variableType" hidden><input /></Form.Item>
            <Row gutter={10}>
              <Col span={12}><Form.Item label="所属项目"><Select<number> value={selectedProjectId ?? undefined} placeholder="选择项目" onChange={setSelectedProjectId} options={projects.map((project) => ({ value: project.proId, label: project.name }))} /></Form.Item></Col>
              <Col span={12}><Form.Item name="pipelineId" label="管道参数"><Select<number> allowClear placeholder="带入管道参数" onChange={(value) => value && handlePipelineChange(value)} options={pipelines.map((pipeline) => ({ value: pipeline.id, label: pipeline.name }))} /></Form.Item></Col>
              <Col span={12}><Form.Item name="oilId" label="油品参数"><Select<number> allowClear placeholder="带入油品参数" onChange={(value) => value && handleOilChange(value)} options={oils.map((oil) => ({ value: oil.id, label: oil.name }))} /></Form.Item></Col>
              <Col span={12}><Form.Item name="pumpStationId" label="泵站参数"><Select<number> allowClear placeholder="带入泵站参数" onChange={(value) => value ? handleStationChange(value) : setSelectedStationId(null)} options={stations.map((station) => ({ value: station.id, label: station.name }))} /></Form.Item></Col>
            </Row>
            <Row gutter={8}>
              <Col span={8}><Form.Item name="flowRate" label="流量(m³/h)" rules={[{ required: true }]}><InputNumber min={0} /></Form.Item></Col>
              <Col span={8}><Form.Item name="density" label="密度(kg/m³)"><InputNumber min={0} /></Form.Item></Col>
              <Col span={8}><Form.Item name="viscosity" label="黏度(m²/s)" rules={[{ required: true }]}><InputNumber min={0} precision={8} /></Form.Item></Col>
              <Col span={8}><Form.Item name="length" label="长度(km)" rules={[{ required: true }]}><InputNumber min={0} precision={2} /></Form.Item></Col>
              <Col span={8}><Form.Item name="diameter" label="外径(mm)" rules={[{ required: true }]}><InputNumber min={0} precision={2} /></Form.Item></Col>
              <Col span={8}><Form.Item name="thickness" label="壁厚(mm)" rules={[{ required: true }]}><InputNumber min={0} precision={2} /></Form.Item></Col>
              <Col span={8}><Form.Item name="roughness" label="粗糙度(m)" rules={[{ required: true }]}><InputNumber min={0} precision={6} /></Form.Item></Col>
              <Col span={8}><Form.Item name="startAltitude" label="起点高程(m)" rules={[{ required: true }]}><InputNumber precision={2} /></Form.Item></Col>
              <Col span={8}><Form.Item name="endAltitude" label="终点高程(m)" rules={[{ required: true }]}><InputNumber precision={2} /></Form.Item></Col>
              <Col span={8}><Form.Item name="inletPressure" label="进站压头(m)" rules={[{ required: true }]}><InputNumber min={0} precision={2} /></Form.Item></Col>
              <Col span={8}><Form.Item name="pump480Num" label="ZMI480台数" rules={[{ required: true }]}><InputNumber min={0} precision={0} /></Form.Item></Col>
              <Col span={8}><Form.Item name="pump375Num" label="ZMI375台数" rules={[{ required: true }]}><InputNumber min={0} precision={0} /></Form.Item></Col>
              <Col span={12}><Form.Item name="pump480Head" label="ZMI480扬程(m)" rules={[{ required: true }]}><InputNumber min={0} precision={2} /></Form.Item></Col>
              <Col span={12}><Form.Item name="pump375Head" label="ZMI375扬程(m)" rules={[{ required: true }]}><InputNumber min={0} precision={2} /></Form.Item></Col>
            </Row>
            <Button type="primary" htmlType="submit" loading={loading} icon={<BarChartOutlined />} block className={styles.analyzeButton}>开始敏感性分析</Button>
            <div className={styles.formNote}>参数修改后点击分析，系统将调用真实后端引擎计算四个敏感变量。</div>
          </Form>
        </aside>

        <main className={styles.resultPanel}>
          {result && activeVariableResult ? (
            <>
              <section className={styles.resultCard}>
                <div className={styles.cardHeader}>
                  <div><h3>{activeVariableResult.variableName}敏感性分析</h3><small>基准值 {formatVariableValue(activeVariableResult.baseValue, activeVariableResult.variableType)} {getVariableDisplayUnit(activeVariableResult.variableType, activeVariable?.unit)}</small></div>
                  <span className={`${styles.levelBadge} ${sensitivityLevel.className}`}>{sensitivityLevel.label}</span>
                </div>
                <div className={styles.heroGrid}>
                  <ReactECharts option={gaugeOption} style={{ height: 170 }} />
                  <div className={styles.metricGrid}>
                    <div className={styles.metric}><strong className={styles.violet}>{activeVariableResult.sensitivityCoefficient.toFixed(3)}</strong><span>综合敏感系数 S</span></div>
                    <div className={styles.metric}><strong className={styles.red}>{formatChangePercent(activeVariableResult.maxImpactPercent)}</strong><span>最大影响幅度</span></div>
                    <div className={styles.metric}><strong className={styles.cyan}>{trendLabel}</strong><span>相关方向</span></div>
                    <div className={styles.metric}><strong className={styles.cyan}>{Math.round(result.baseResult.reynoldsNumber).toLocaleString('zh-CN')}</strong><span>基准雷诺数</span></div>
                    <div className={styles.metric}><strong className={styles.amber}>{formatResultValue(result.baseResult.frictionHeadLoss)}</strong><span>基准摩阻(m)</span></div>
                    <div className={styles.metric}><strong className={styles.green}>{formatResultValue(result.baseResult.endStationInPressure)}</strong><span>基准末站压头(m)</span></div>
                  </div>
                </div>
              </section>

              <section className={styles.resultCard}>
                <div className={styles.cardHeader}><h3>敏感性曲线 · 相对变化率</h3><small>点击或悬停查看各工况详情</small></div>
                {chartOption && <ReactECharts option={chartOption} style={{ height: 300 }} />}
                {noMeasurableImpact ? <div className={styles.chartNote}>当前变化区间内的最大相对变化低于展示阈值。系统已完成计算，该变量在此工况下确实影响较小。</div> : null}
              </section>

              <section className={styles.resultCard}>
                <div className={styles.cardHeader}><h3>龙卷风图 · 末站压头冲击范围</h3><small>条形跨度越大，对末站压头影响越明显</small></div>
                <ReactECharts option={tornadoOption} style={{ height: 240 }} />
              </section>

              <section className={styles.resultCard}>
                <div className={styles.cardHeader}><h3>风险临界值 · 当前分析窗口</h3><small>末站压头 ≤ 0 表示该工况失效</small></div>
                <div className={styles.thresholdList}>
                  {thresholdRows.map((row) => {
                    const visual = VARIABLE_VISUALS[row.variableType as keyof typeof VARIABLE_VISUALS] ?? VARIABLE_VISUALS.FLOW_RATE;
                    return (
                      <div className={styles.thresholdRow} key={row.variableType}>
                        <span className={styles.thresholdDot} style={{ background: visual.color }} />
                        <strong>{row.name}</strong>
                        <span>减小临界：{row.negativeFailure ? <b className={styles.dangerText}>{row.negativeFailure.changePercent}%</b> : <b className={styles.safeText}>-20%内安全</b>}</span>
                        <span>增大临界：{row.positiveFailure ? <b className={styles.dangerText}>+{row.positiveFailure.changePercent}%</b> : <b className={styles.safeText}>+20%内安全</b>}</span>
                        <small>最低末站压头 {row.minimumPressure === null ? '-' : `${formatResultValue(row.minimumPressure)} m`}</small>
                      </div>
                    );
                  })}
                </div>
                <div className={styles.thresholdNote}>本模块仅报告后端本次真实计算的 ±20% 工况窗口，不对窗口之外的失效点进行前端外推。</div>
              </section>

              <section className={styles.resultCard}>
                <div className={styles.cardHeader}><h3>敏感参数排名</h3><small>按沿程摩阻变化敏感系数排序 · 点击切换</small></div>
                <div className={styles.rankingList}>
                  {sortedRankings.map((item) => {
                    const selected = item.variableType === activeVariableResult.variableType;
                    const maxCoefficient = sortedRankings[0]?.sensitivityCoefficient || 1;
                    const color = item.sensitivityCoefficient > 1.5 ? '#e11d48' : item.sensitivityCoefficient > 0.5 ? '#d97706' : '#059669';
                    return <button key={item.variableType} type="button" className={`${styles.rankRow} ${selected ? styles.rankSelected : ''}`} onClick={() => form.setFieldValue('variableType', item.variableType)}>
                      <span className={styles.rankNumber}>{item.rank}</span><span className={styles.rankName}><strong>{item.variableName}</strong><small>{getVariableDisplayUnit(item.variableType)}</small></span>
                      <span className={styles.rankBar}><i style={{ width: `${Math.max(0, item.sensitivityCoefficient / maxCoefficient * 100)}%`, background: color }} /></span>
                      <strong style={{ color }}>{item.sensitivityCoefficient.toFixed(3)}</strong>
                    </button>;
                  })}
                </div>
              </section>

              <section className={styles.resultCard}>
                <div className={styles.cardHeader}><h3>结果解释与运行建议</h3></div>
                <div className={styles.whyBox}><strong>{resultInterpretation?.title ?? '为什么会得到这个结果？'}</strong><p>{explanationText}</p></div>
                <div className={styles.insightGrid}><div className={styles.conclusionBox}><strong>自动结论</strong><p>{conclusionText}</p></div><div className={styles.adviceBox}><strong>风险与建议</strong><p>{adviceText}</p></div></div>
              </section>

              <section className={styles.resultCard}>
                <div className={styles.cardHeader}><h3>工况明细（±20%，共 {activeVariableResult.dataPoints.length} 点）</h3><small>基准行高亮</small></div>
                <Table<SensitivityPoint> className={styles.detailTable} columns={columns} dataSource={activeVariableResult.dataPoints} rowKey={(record) => `${record.variableValue}-${record.changePercent}`} rowClassName={(record) => record.changePercent === 0 ? styles.baseRow : ''} pagination={false} size="small" scroll={{ x: 900 }} />
              </section>
            </>
          ) : (
            <section className={`${styles.resultCard} ${styles.emptyState}`}><BarChartOutlined /><h3>等待敏感性分析</h3><p>选择项目并确认基础参数后，点击“开始敏感性分析”，即可得到四变量排名、曲线、自动结论和工况明细。</p></section>
          )}
        </main>
      </div>
    </AnimatedPage>
  );
}
