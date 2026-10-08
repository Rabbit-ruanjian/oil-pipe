import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRef } from 'react';
import {
  Card,
  Col,
  Form,
  InputNumber,
  Row,
  Select,
  Slider,
  Tag,
  message,
} from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { calculationApi, oilPropertyApi, pipelineApi, projectApi, pumpStationApi } from '../../api';
import type {
  HydraulicAnalysisParams,
  HydraulicAnalysisResult,
  OilProperty,
  Pipeline,
  Project,
  PumpStation,
} from '../../types';
import AnimatedPage from '../../components/common/AnimatedPage';
import { useCalculationLinkStore } from '../../stores/calculationLinkStore';
import { convertPressureMpaToHeadMeters, convertViscosityMm2PerSecToM2PerSec } from '../../utils/calculationUnits';
import styles from './HydraulicAnalysis.module.css';

const FORM_ITEM_SPAN = { xs: 24, md: 12, xl: 8 } as const;

type HydraulicAnalysisFormValues = HydraulicAnalysisParams & {
  pipelineId?: number;
  oilId?: number;
  pumpStationId?: number;
};

const INITIAL_VALUES: HydraulicAnalysisParams = {
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

function formatMetric(value: unknown, maximumFractionDigits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '—';
  }
  return numeric.toLocaleString('zh-CN', { maximumFractionDigits });
}

function ResultKpi({
  label,
  value,
  unit,
  tone = 'cyan',
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  tone?: 'cyan' | 'amber' | 'violet' | 'green';
}) {
  return (
    <div className={`${styles.resultKpi} ${styles[`resultKpi${tone[0].toUpperCase()}${tone.slice(1)}`]}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {unit ? <em>{unit}</em> : null}
    </div>
  );
}

function RegimeVisualization({
  reynoldsNumber,
  flowRegime,
  relativeRoughness,
}: {
  reynoldsNumber: number;
  flowRegime: string;
  relativeRoughness: number;
}) {
  const minRe = 1_000;
  const maxRe = 1_000_000;
  const left = 72;
  const right = 566;
  const width = right - left;
  const position = (value: number) => left + ((Math.log10(Math.max(minRe, Math.min(maxRe, value))) - 3) / 3) * width;
  const smoothUpper = relativeRoughness > 0
    ? 59.5 / Math.pow(relativeRoughness, 8 / 7)
    : maxRe;
  const mixedUpper = relativeRoughness > 0
    ? 665 - 765 * Math.log10(relativeRoughness)
    : maxRe;
  const zones = [
    { start: 1_000, end: 2_000, label: '层流', fill: '#DBEAFE' },
    { start: 2_000, end: 3_000, label: '过渡', fill: '#E5E7EB' },
    { start: 3_000, end: Math.max(3_000, smoothUpper), label: '光滑', fill: '#CFFAFE' },
    { start: Math.max(3_000, smoothUpper), end: Math.max(smoothUpper, mixedUpper), label: '混合', fill: '#FEF3C7' },
    { start: Math.max(smoothUpper, mixedUpper), end: maxRe, label: '粗糙', fill: '#FEE2E2' },
  ];
  const markerX = position(reynoldsNumber);
  const isLaminar = reynoldsNumber < 2_000 || flowRegime === '层流';
  const profileLines = Array.from({ length: 7 }, (_, index) => {
    const y = 181 + index * 8;
    const offset = index - 3;
    const halfLength = isLaminar ? 27 * Math.max(0.16, 1 - (offset * offset) / 12) : 24;
    return { y, x1: 60 - halfLength, x2: 60 + halfLength, opacity: isLaminar ? 0.35 + halfLength / 45 : 0.78 };
  });

  return (
    <div className={styles.regimeVisualization}>
      <svg className={styles.regimeSvg} viewBox="0 0 620 252" role="img" aria-label="雷诺数对数刻度流态分区">
        <text x={left} y="14" fill="#7188A8" fontSize="11">Re 对数刻度</text>
        {zones.map((zone) => {
          const x1 = position(zone.start);
          const x2 = position(zone.end);
          if (x2 <= x1) {
            return null;
          }
          return (
            <g key={`${zone.label}-${zone.start}`}>
              <rect x={x1} y="27" width={x2 - x1} height="40" fill={zone.fill} />
              {x2 - x1 > 42 ? <text x={(x1 + x2) / 2} y="52" textAnchor="middle" fill="#3D557A" fontSize="12">{zone.label}</text> : null}
            </g>
          );
        })}
        <line x1={left} y1="67" x2={right} y2="67" stroke="#9DB0CC" />
        {[1_000, 10_000, 100_000, 1_000_000].map((tick) => {
          const x = position(tick);
          return (
            <g key={tick}>
              <line x1={x} y1="67" x2={x} y2="75" stroke="#9DB0CC" />
              <text x={x} y="94" textAnchor="middle" fill="#7188A8" fontSize="12">{`10${tick === 1_000 ? '³' : tick === 10_000 ? '⁴' : tick === 100_000 ? '⁵' : '⁶'}`}</text>
            </g>
          );
        })}
        <line x1={markerX} y1="18" x2={markerX} y2="74" stroke="#D97706" strokeWidth="3" />
        <text x={markerX} y="120" textAnchor="middle" fill="#D97706" fontSize="13" fontWeight="700">Re={formatMetric(reynoldsNumber, 0)}</text>
        <circle cx="60" cy="207" r="35" fill="#F8FBFF" stroke="#0891B2" strokeWidth="2.5" />
        {profileLines.map((line) => (
          <line key={line.y} x1={line.x1} y1={line.y} x2={line.x2} y2={line.y} stroke="#0891B2" strokeWidth="1.6" opacity={line.opacity} />
        ))}
        <text x="118" y="199" fill="#7188A8" fontSize="12">管内流速剖面：层流=抛物线，紊流=扁平</text>
        <text x="118" y="222" fill="#7188A8" fontSize="12">当前：{isLaminar ? '层流，剖面呈抛物线' : `${flowRegime}，剖面趋于扁平`}</text>
      </svg>
    </div>
  );
}

function SafetyGauge({ value }: { value: number }) {
  const maxValue = 3_000;
  const centerX = 160;
  const centerY = 145;
  const radius = 105;
  const point = (rawValue: number, offset = 0) => {
    const normalized = Math.max(0, Math.min(1, rawValue / maxValue));
    const angle = Math.PI - normalized * Math.PI;
    return [centerX + (radius + offset) * Math.cos(angle), centerY - (radius + offset) * Math.sin(angle)] as const;
  };
  const arc = (from: number, to: number) => {
    const [x1, y1] = point(from);
    const [x2, y2] = point(to);
    return `M ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2}`;
  };
  const clampedValue = Math.max(0, Math.min(maxValue, value));
  const [needleX, needleY] = point(clampedValue, -26);
  const status = value > 500
    ? { text: '安全', color: '#059669' }
    : value > 200
      ? { text: '接近经济区间', color: '#D97706' }
      : { text: value > 0 ? '警戒' : '危险', color: '#E11D48' };
  const ticks = [0, 500, 1_000, 2_000, 3_000];

  return (
    <div className={styles.safetyGaugeWrap}>
      <svg className={styles.safetyGaugeSvg} viewBox="0 0 320 205" role="img" aria-label="末站安全裕度仪表盘">
        <path d={arc(0, 200)} fill="none" stroke="#E11D48" strokeWidth="25" strokeLinecap="round" />
        <path d={arc(200, 500)} fill="none" stroke="#F59E0B" strokeWidth="25" />
        <path d={arc(500, maxValue)} fill="none" stroke="#059669" strokeWidth="25" strokeLinecap="round" />
        {ticks.map((tick) => {
          const [x, y] = point(tick, 28);
          return <text key={tick} x={x} y={y + 4} textAnchor="middle" fill="#7188A8" fontSize="11">{tick}</text>;
        })}
        <line x1={centerX} y1={centerY} x2={needleX} y2={needleY} stroke="#132542" strokeWidth="4" strokeLinecap="round" />
        <circle cx={centerX} cy={centerY} r="11" fill="#132542" />
        <circle cx={centerX} cy={centerY} r="4" fill="#FFFFFF" />
        <text x={centerX} y="119" textAnchor="middle" fill={status.color} fontSize="28" fontWeight="700">{formatMetric(value, 0)}</text>
        <text x={centerX} y="137" textAnchor="middle" fill="#7188A8" fontSize="11">m</text>
        <text x="44" y="181" textAnchor="middle" fill="#E11D48" fontSize="11">危险</text>
        <text x="92" y="181" textAnchor="middle" fill="#D97706" fontSize="11">警戒</text>
        <text x="232" y="181" textAnchor="middle" fill="#059669" fontSize="11">安全</text>
      </svg>
      <div className={styles.safetySummary}>
        末站余压 <strong>{formatMetric(value, 0)}</strong> m · <span style={{ color: status.color }}>{status.text}</span>
      </div>
    </div>
  );
}

function PumpConfiguration({
  pump480Num,
  pump375Num,
  pump480Head,
  pump375Head,
  totalHead,
  inletPressure,
  endPressure,
  hydraulicSlope,
}: {
  pump480Num: number;
  pump375Num: number;
  pump480Head: number;
  pump375Head: number;
  totalHead: number;
  inletPressure: number;
  endPressure: number;
  hydraulicSlope: number;
}) {
  const maxVisiblePumps = 6;
  const pump480Count = Math.max(0, Math.floor(pump480Num));
  const pump375Count = Math.max(0, Math.floor(pump375Num));
  const pump480Visible = Math.min(maxVisiblePumps, pump480Count);
  const pump375Visible = Math.min(maxVisiblePumps - pump480Visible, pump375Count);
  const pumps = [
    ...Array.from({ length: pump480Visible }, (_, index) => ({
      key: `480-${index}`,
      type: 'ZMI480',
      head: pump480Head,
      tone: 'cyan',
    })),
    ...Array.from({ length: pump375Visible }, (_, index) => ({
      key: `375-${index}`,
      type: 'ZMI375',
      head: pump375Head,
      tone: 'amber',
    })),
  ];
  const hiddenCount = Math.max(0, pump480Count + pump375Count - pumps.length);
  const perKmLoss = Number(hydraulicSlope) * 1000;

  return (
    <div className={styles.pumpConfiguration}>
      <div className={styles.pumpFlowMeta}>
        <span>沿程 1 km 压头损失</span>
        <strong>↓ {formatMetric(perKmLoss, 2)} <em>m/km</em></strong>
      </div>
      <div className={styles.pumpFlowDiagram}>
        <div className={styles.pumpEndpoint}>
          <span>首站出站</span>
          <strong>{formatMetric(inletPressure, 1)}<em>m</em></strong>
        </div>
        <div className={styles.pumpFlowLane}>
          <div className={styles.pumpFlowBar}>
            <span className={styles.pumpFlowArrow}>沿程压降</span>
          </div>
          <div className={styles.pumpUnitsCompact}>
            {pumps.length > 0 ? pumps.map((pump) => (
              <div key={pump.key} className={`${styles.pumpUnit} ${styles[`pumpUnit${pump.tone[0].toUpperCase()}${pump.tone.slice(1)}`]}`}>
                <span className={styles.pumpMotor}>M</span>
                <span className={styles.pumpBody}><i /></span>
                <small>{pump.type}</small>
              </div>
            )) : <div className={styles.pumpEmpty}>暂无泵组配置</div>}
          </div>
        </div>
        <div className={styles.pumpEndpoint}>
          <span>末站进站</span>
          <strong>{formatMetric(endPressure, 1)}<em>m</em></strong>
        </div>
      </div>
      {hiddenCount > 0 ? <div className={styles.pumpOverflow}>其余 {hiddenCount} 台泵已折叠显示</div> : null}
      <div className={styles.pumpTotal}>
        <span>泵组扬程叠加（共 {formatMetric(totalHead, 0)} m）</span>
        <strong>{formatMetric(totalHead, 0)} <em>m</em></strong>
      </div>
      <div className={styles.pumpLegend}>
        <span><i className={styles.legendCyan} /> ZMI480 × {pump480Count} 台</span>
        <span><i className={styles.legendAmber} /> ZMI375 × {pump375Count} 台</span>
        <span><i className={styles.legendSlate} /> 进/出站管道</span>
      </div>
    </div>
  );
}

export default function HydraulicAnalysis() {
  const [form] = Form.useForm<HydraulicAnalysisFormValues>();
  const watchedDensity = Form.useWatch('density', form);
  const watchedFlowRate = Form.useWatch('flowRate', form);
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [oils, setOils] = useState<OilProperty[]>([]);
  const [stations, setStations] = useState<PumpStation[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedStationId, setSelectedStationId] = useState<number | null>(null);
  const [result, setResult] = useState<HydraulicAnalysisResult | null>(null);
  const analysisTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSequenceRef = useRef(0);

  const loadBaseData = useCallback(async () => {
    try {
      const [projectRes, oilRes, stationRes] = await Promise.all([
        projectApi.list(),
        oilPropertyApi.list(),
        pumpStationApi.list(),
      ]);

      const projectList = projectRes.data ?? [];
      setProjects(projectList);
      setOils(oilRes.data ?? []);
      setStations(stationRes.data ?? []);

      if (projectList.length > 0) {
        setSelectedProjectId(projectList[0].proId);
      }
    } catch (error) {
      console.error('Failed to load hydraulic analysis base data', error);
      message.error('基础数据加载失败，请确认数据服务已启动后重试。');
    }
  }, []);

  const loadPipelines = useCallback(async (projectId: number) => {
    try {
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
    } catch (error) {
      console.error('Failed to load project pipelines', error);
      setPipelines([]);
      form.setFieldValue('pipelineId', undefined);
      message.error('管道参数加载失败，请稍后重试。');
    }
  }, [form]);

  useEffect(() => {
    form.setFieldsValue(INITIAL_VALUES);
    void loadBaseData();
  }, [form, loadBaseData]);

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

  const runAnalysis = useCallback(async () => {
    let values: HydraulicAnalysisFormValues;
    try {
      values = await form.validateFields();
    } catch {
      // A numeric control can be temporarily empty while it is being edited.
      // Wait for the next input event instead of showing an error per keystroke.
      return;
    }

    const payload = {
      ...values,
      projectId: selectedProjectId ?? values.projectId,
    };
    const requestSequence = ++requestSequenceRef.current;
    setLoading(true);
    try {
      const project = projects.find((item) => item.proId === (payload.projectId ?? null));
      const response = await calculationApi.hydraulicAnalysis(payload, project?.name);
      if (requestSequence !== requestSequenceRef.current) {
        return;
      }

      const nextResult = response.data ?? null;
      setResult(nextResult);
      if (nextResult) {
        useCalculationLinkStore.getState().linkCalculation({
          calcType: 'HYDRAULIC',
          projectId: payload.projectId ?? null,
          projectName: project?.name ?? null,
          input: payload as unknown as Record<string, unknown>,
          output: nextResult as unknown as Record<string, unknown>,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      if (requestSequence === requestSequenceRef.current) {
        console.error('Hydraulic analysis request failed', error);
        message.error('水力分析失败，请检查计算服务和输入参数。');
      }
    } finally {
      if (requestSequence === requestSequenceRef.current) {
        setLoading(false);
      }
    }
  }, [form, projects, selectedProjectId]);

  const scheduleAnalysis = useCallback(() => {
    if (analysisTimerRef.current) {
      clearTimeout(analysisTimerRef.current);
    }
    analysisTimerRef.current = setTimeout(() => {
      analysisTimerRef.current = null;
      void runAnalysis();
    }, 220);
  }, [runAnalysis]);

  useEffect(() => () => {
    if (analysisTimerRef.current) {
      clearTimeout(analysisTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }

    setResult(null);
    void loadPipelines(selectedProjectId).then(scheduleAnalysis);
  }, [loadPipelines, scheduleAnalysis, selectedProjectId]);

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
    scheduleAnalysis();
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
    scheduleAnalysis();
  };

  const handleStationChange = (stationId: number) => {
    const station = stations.find((item) => item.id === stationId);
    if (!station) {
      return;
    }

    setSelectedStationId(stationId);
    const nextValues: Partial<HydraulicAnalysisFormValues> = {
      pumpStationId: stationId,
      pump480Head: station.zmi480Lift,
      pump375Head: station.zmi375Lift,
    };
    const nextInletPressure = convertPressureMpaToHeadMeters(station.comePower, Number(form.getFieldValue('density')));
    if (nextInletPressure !== undefined) {
      nextValues.inletPressure = nextInletPressure;
    }

    form.setFieldsValue(nextValues);
    scheduleAnalysis();
  };

  const pressureChartOption = useMemo(() => {
    if (!result) {
      return null;
    }

    const length = Number(form.getFieldValue('length') ?? 0);
    const inlet = Number(form.getFieldValue('inletPressure') ?? 0);
    const safeLength = Math.max(length, 1);
    const pressureData: [number, number][] = [[0, inlet], [0, result.firstStationOutPressure]];
    for (let index = 1; index <= 24; index += 1) {
      const distance = (safeLength * index) / 24;
      const pressure = result.firstStationOutPressure
        + (result.endStationInPressure - result.firstStationOutPressure) * (index / 24);
      pressureData.push([distance, pressure]);
    }

    return {
      tooltip: { trigger: 'axis' },
      legend: {
        top: 4,
        right: 18,
        textStyle: { color: '#7188A8', fontSize: 11 },
        data: ['压头曲线', '地形高程'],
      },
      grid: { left: 54, right: 24, top: 36, bottom: 48, containLabel: true },
      xAxis: {
        type: 'value',
        min: 0,
        max: safeLength,
        name: '里程 (km)',
        nameLocation: 'end',
        nameTextStyle: { color: '#3D557A', fontSize: 11 },
        axisLine: { lineStyle: { color: '#9DB0CC' } },
        axisLabel: { color: '#7188A8', fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        name: '压头 / 高程 (m)',
        axisLine: { show: false },
        splitLine: { lineStyle: { color: '#EEF3FA' } },
        axisLabel: { color: '#7188A8' },
      },
      series: [
        {
          name: '压头曲线',
          type: 'line',
          smooth: 0.25,
          symbol: 'circle',
          symbolSize: 9,
          lineStyle: { width: 3, color: '#0891B2' },
          itemStyle: { color: '#0891B2', borderColor: '#FFFFFF', borderWidth: 2 },
          areaStyle: { color: 'rgba(8,145,178,.10)' },
          data: pressureData,
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: '#E11D48', type: 'dashed', opacity: 0.6 },
            label: { formatter: '0 m 警戒线', color: '#E11D48', fontSize: 10 },
            data: [{ yAxis: 0 }],
          },
        },
        {
          name: '地形高程',
          type: 'line',
          symbol: 'circle',
          symbolSize: 7,
          z: 3,
          lineStyle: { color: '#526FCB', type: 'dashed', width: 2.5, opacity: 0.95 },
          itemStyle: { color: '#526FCB', borderColor: '#FFFFFF', borderWidth: 1.5 },
          data: [[0, Number(form.getFieldValue('startAltitude') ?? 0)], [safeLength, Number(form.getFieldValue('endAltitude') ?? 0)]],
          markPoint: {
            symbol: 'circle',
            symbolSize: 8,
            itemStyle: { color: '#526FCB', borderColor: '#FFFFFF', borderWidth: 1.5 },
            label: { show: true, color: '#526FCB', fontSize: 11, position: 'top', formatter: '{b}' },
            data: [
              { name: `起点高程 ${formatMetric(Number(form.getFieldValue('startAltitude') ?? 0), 0)} m`, coord: [0, Number(form.getFieldValue('startAltitude') ?? 0)] },
              { name: `终点高程 ${formatMetric(Number(form.getFieldValue('endAltitude') ?? 0), 0)} m`, coord: [safeLength, Number(form.getFieldValue('endAltitude') ?? 0)] },
            ],
          },
        },
      ],
    };
  }, [form, result]);

  const inputLength = Number(form.getFieldValue('length') ?? 0);
  const inletPressure = Number(form.getFieldValue('inletPressure') ?? 0);
  const innerDiameterMm = Number(form.getFieldValue('diameter') ?? 0) - 2 * Number(form.getFieldValue('thickness') ?? 0);
  const relativeRoughness = innerDiameterMm > 0
    ? (2 * Number(form.getFieldValue('roughness') ?? 0)) / innerDiameterMm
    : 0;
  const endPressure = Number(result?.endStationInPressure ?? 0);
  const pressureDrop = Number(result?.firstStationOutPressure ?? 0) - endPressure;
  const safetyPercent = Math.max(0, Math.min(100, endPressure <= 0 ? 0 : endPressure / Math.max(Math.abs(Number(result?.totalHead ?? 0)), 1) * 100));

  return (
    <AnimatedPage>
      <div className={styles.calculationLayout}>
        <div className={styles.paramPanel}>
          <div className="page-header">
            <h2><ThunderboltOutlined /> 水力分析</h2>
            <p>支持从项目基础数据自动带入参数。压头与扬程单位均为 m，密度字段当前主要用于油品记录。</p>
          </div>

          <Card title="参数输入" className="page-card">
            <Form<HydraulicAnalysisFormValues>
              form={form}
              layout="vertical"
              className={styles.paramForm}
              onValuesChange={() => scheduleAnalysis()}
            >
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="所属项目">
                    <Select<number>
                      value={selectedProjectId ?? undefined}
                      placeholder="选择项目"
                      onChange={setSelectedProjectId}
                      options={projects.map((project) => ({ value: project.proId, label: project.name }))}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="pipelineId" label="管道参数">
                    <Select<number>
                      allowClear
                      placeholder="从数据中心带入管道参数"
                      onChange={(value) => value && handlePipelineChange(value)}
                      options={pipelines.map((pipeline) => ({ value: pipeline.id, label: pipeline.name }))}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="oilId" label="油品参数">
                    <Select<number>
                      allowClear
                      placeholder="从数据中心带入油品参数"
                      onChange={(value) => value && handleOilChange(value)}
                      options={oils.map((oil) => ({ value: oil.id, label: oil.name }))}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="pumpStationId" label="泵站参数">
                    <Select<number>
                      allowClear
                      placeholder="从数据中心带入泵站参数"
                      onChange={(value) => {
                        if (value) {
                          handleStationChange(value);
                          return;
                        }
                        setSelectedStationId(null);
                        form.setFieldValue('pumpStationId', undefined);
                        scheduleAnalysis();
                      }}
                      options={stations.map((station) => ({ value: station.id, label: station.name }))}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={16}>
                <Col {...FORM_ITEM_SPAN}>
                  <Form.Item name="flowRate" label="流量(m³/h)" rules={[{ required: true }]}>
                    <InputNumber min={0} style={{ width: '100%' }} />
                  </Form.Item>
                  <div className={styles.flowSlider}>
                    <Slider
                      min={500}
                      max={1400}
                      step={10}
                      value={Number(watchedFlowRate ?? INITIAL_VALUES.flowRate)}
                      onChange={(value) => {
                        if (typeof value === 'number') {
                          form.setFieldValue('flowRate', value);
                          scheduleAnalysis();
                        }
                      }}
                      tooltip={{ formatter: (value) => `${value ?? 0} m³/h` }}
                    />
                    <div className={styles.sliderScale}><span>500</span><span>1400 m³/h</span></div>
                  </div>
                </Col>
                <Col {...FORM_ITEM_SPAN}>
                  <Form.Item name="density" label="密度(kg/m³)" extra="由油品参数自动带入">
                    <InputNumber min={0} disabled style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col {...FORM_ITEM_SPAN}><Form.Item name="viscosity" label="运动粘度(m²/s)" rules={[{ required: true }]}><InputNumber min={0} precision={8} style={{ width: '100%' }} /></Form.Item></Col>
              </Row>
              <Row gutter={16}>
                <Col {...FORM_ITEM_SPAN}><Form.Item name="length" label="长度(km)" rules={[{ required: true }]}><InputNumber min={0} precision={2} style={{ width: '100%' }} /></Form.Item></Col>
                <Col {...FORM_ITEM_SPAN}><Form.Item name="diameter" label="外径(mm)" rules={[{ required: true }]}><InputNumber min={0} precision={2} style={{ width: '100%' }} /></Form.Item></Col>
                <Col {...FORM_ITEM_SPAN}><Form.Item name="thickness" label="壁厚(mm)" rules={[{ required: true }]}><InputNumber min={0} precision={2} style={{ width: '100%' }} /></Form.Item></Col>
              </Row>
              <Row gutter={16}>
                <Col {...FORM_ITEM_SPAN}><Form.Item name="roughness" label="粗糙度(m)" rules={[{ required: true }]}><InputNumber min={0} precision={6} style={{ width: '100%' }} /></Form.Item></Col>
                <Col {...FORM_ITEM_SPAN}><Form.Item name="startAltitude" label="起点高程(m)" rules={[{ required: true }]}><InputNumber precision={2} style={{ width: '100%' }} /></Form.Item></Col>
                <Col {...FORM_ITEM_SPAN}><Form.Item name="endAltitude" label="终点高程(m)" rules={[{ required: true }]}><InputNumber precision={2} style={{ width: '100%' }} /></Form.Item></Col>
              </Row>
              <Row gutter={16}>
                <Col {...FORM_ITEM_SPAN}><Form.Item name="inletPressure" label="首站进站压头(m)" rules={[{ required: true }]}><InputNumber min={0} precision={2} style={{ width: '100%' }} /></Form.Item></Col>
                <Col {...FORM_ITEM_SPAN}><Form.Item name="pump480Num" label="ZMI480 台数" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item></Col>
                <Col {...FORM_ITEM_SPAN}><Form.Item name="pump375Num" label="ZMI375 台数" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item></Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}><Form.Item name="pump480Head" label="ZMI480 单泵扬程(m)" rules={[{ required: true }]}><InputNumber min={0} precision={2} style={{ width: '100%' }} /></Form.Item></Col>
                <Col span={12}><Form.Item name="pump375Head" label="ZMI375 单泵扬程(m)" rules={[{ required: true }]}><InputNumber min={0} precision={2} style={{ width: '100%' }} /></Form.Item></Col>
              </Row>
              <div className={styles.autoHint}>
                <ThunderboltOutlined /> 修改参数或拖动流量滑块，右侧结果将自动联动更新
                {loading ? <span>正在计算…</span> : null}
              </div>
            </Form>
          </Card>
        </div>

        <div className={styles.resultPanel}>
          {result ? (
            <div className={styles.outputStack}>
              <section className={styles.outputCard}>
                <div className={styles.outputHeader}>
                  <span>分析结果</span>
                  <Tag color={endPressure > 0 ? 'success' : 'error'}>{endPressure > 0 ? '✓ 工况可行' : '! 扬程不足'}</Tag>
                </div>
                <div className={styles.outputBody}>
                  <div className={styles.resultKpiGrid}>
                    <ResultKpi label="雷诺数 Re" value={formatMetric(result.reynoldsNumber, 0)} tone="violet" />
                    <ResultKpi label="流态" value={result.flowRegime} />
                    <ResultKpi label="水力坡降 i" value={formatMetric(result.hydraulicSlope, 5)} tone="amber" />
                    <ResultKpi label="摩阻损失" value={formatMetric(result.frictionHeadLoss, 2)} unit="m" />
                    <ResultKpi label="总扬程" value={formatMetric(result.totalHead, 2)} unit="m" tone="green" />
                    <ResultKpi label="首站出站" value={formatMetric(result.firstStationOutPressure, 2)} unit="m" />
                    <ResultKpi label="末站进站" value={formatMetric(result.endStationInPressure, 2)} unit="m" tone="cyan" />
                    <ResultKpi label="沿程压差" value={formatMetric(pressureDrop, 2)} unit="m" tone="amber" />
                  </div>
                  <div className={styles.resultAdvice}>
                    {endPressure > 0
                      ? `${result.flowRegime}，末站进站压头大于 0，当前泵组与管道参数满足基本运行约束。`
                      : '末站进站压头不大于 0，当前泵组扬程不足，请检查泵组配置或输入参数。'}
                  </div>
                </div>
              </section>

              <section className={styles.outputCard}>
                <div className={styles.outputHeader}>
                  <span>压力沿程变化</span>
                  <small>实线为压头，蓝紫虚线为地形高程 · 悬停查看数据</small>
                </div>
                <div className={styles.chartBody}>
                  {pressureChartOption && <ReactECharts option={pressureChartOption} style={{ height: 320 }} />}
                </div>
              </section>

              <section className={styles.outputCard}>
                <div className={styles.outputHeader}><span>流态判定 · Re 分区（log 刻度）</span><small>当前：{result.flowRegime}</small></div>
                <div className={styles.outputBody}>
                  <RegimeVisualization
                    reynoldsNumber={Number(result.reynoldsNumber)}
                    flowRegime={result.flowRegime}
                    relativeRoughness={relativeRoughness}
                  />
                  <div className={styles.regimeNote}>雷诺数和相对粗糙度仅用于标注当前后端返回结果所在的流态区间。</div>
                </div>
              </section>

              <section className={styles.outputCard}>
                <div className={styles.outputHeader}><span>能量平衡 · 压头变化</span><small>单位：m</small></div>
                <div className={styles.outputBody}>
                  <div className={styles.balanceGrid}>
                    <div><span>首站进站</span><strong>{formatMetric(inletPressure, 1)}</strong></div>
                    <div><span>泵组增压</span><strong className={styles.balancePositive}>+{formatMetric(result.totalHead, 1)}</strong></div>
                    <div><span>沿程损失</span><strong className={styles.balanceNegative}>-{formatMetric(result.frictionHeadLoss, 1)}</strong></div>
                    <div><span>末站进站</span><strong>{formatMetric(result.endStationInPressure, 1)}</strong></div>
                  </div>
                  <div className={styles.balanceTrack}><span style={{ width: `${Math.max(8, Math.min(100, safetyPercent))}%` }} /></div>
                </div>
              </section>

              <div className={styles.bottomOutputGrid}>
                <section className={styles.outputCard}>
                  <div className={styles.outputHeader}><span>末站安全裕度</span><small>{formatMetric(inputLength, 2)} km 管线</small></div>
                  <div className={styles.safetyBody}>
                    <SafetyGauge value={endPressure} />
                  </div>
                </section>
                <section className={styles.outputCard}>
                  <div className={styles.outputHeader}><span>每公里损失 &amp; 泵组配置</span><small>本次提交参数</small></div>
                  <PumpConfiguration
                    pump480Num={Number(form.getFieldValue('pump480Num') ?? 0)}
                    pump375Num={Number(form.getFieldValue('pump375Num') ?? 0)}
                    pump480Head={Number(form.getFieldValue('pump480Head') ?? 0)}
                    pump375Head={Number(form.getFieldValue('pump375Head') ?? 0)}
                    totalHead={Number(result.totalHead ?? 0)}
                    inletPressure={Number(result.firstStationOutPressure ?? 0)}
                    endPressure={Number(result.endStationInPressure ?? 0)}
                    hydraulicSlope={Number(result.hydraulicSlope ?? 0)}
                  />
                </section>
              </div>
            </div>
          ) : (
            <div className={styles.emptyOutput}>
              <ThunderboltOutlined />
              <div>{loading ? '正在根据当前参数自动计算…' : '修改参数后将自动计算并更新右侧结果。'}</div>
            </div>
          )}
        </div>
      </div>
    </AnimatedPage>
  );
}
