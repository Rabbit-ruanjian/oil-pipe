import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Col, Form, InputNumber, Modal, Row, Select, Slider, Spin, Tag } from 'antd';
import { CheckCircleFilled, ExclamationCircleFilled, ExpandOutlined, SettingOutlined } from '@ant-design/icons';
import type { EChartsOption } from 'echarts';
import { useLocation } from 'react-router-dom';
import Chart from '../../components/common/Chart';
import { calculationApi, oilPropertyApi, pipelineApi, projectApi, pumpStationApi } from '../../api';
import type {
  OilProperty,
  OptimizationCandidateResult,
  OptimizationParams,
  OptimizationResult,
  Pipeline,
  Project,
  PumpStation,
} from '../../types';
import AnimatedPage from '../../components/common/AnimatedPage';
import { useCalculationLinkStore } from '../../stores/calculationLinkStore';
import { convertPressureMpaToHeadMeters, convertViscosityMm2PerSecToM2PerSec } from '../../utils/calculationUnits';
import styles from './Optimization.module.css';

type OptimizationFormValues = OptimizationParams & {
  pipelineId?: number;
  oilId?: number;
  pumpStationId?: number;
};

type PumpSkidProps = {
  pump480Num: number;
  pump375Num: number;
  pump480Head: number;
  pump375Head: number;
};

type SmartReportOptimizationPrefill = {
  source?: string;
  projectId?: number | null;
  projectName?: string | null;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  recommendation?: string | null;
};

type SmartReportLocationState = {
  smartReportPrefill?: SmartReportOptimizationPrefill;
};

const SMART_REPORT_PREFILL_KEY = 'smart-report-optimization-prefill';

const INITIAL_VALUES: OptimizationParams = {
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
  pump480Head: 280,
  pump375Head: 220,
  pumpEfficiency: 0.8,
  motorEfficiency: 0.95,
  workingDays: 350,
  electricityPrice: 0.8,
};

function getCalculationErrorMessage(error: unknown) {
  if (typeof error === 'object' && error !== null) {
    const response = (error as { response?: { data?: { msg?: unknown } } }).response;
    if (typeof response?.data?.msg === 'string' && response.data.msg.trim()) {
      return response.data.msg;
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return '当前参数未能生成可行方案，请调整流量或泵站参数。';
}

function formatNumber(value: number | string | null | undefined, digits = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '—';
  return parsed.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function getCombinationKey(candidate: Pick<OptimizationCandidateResult, 'pump480Num' | 'pump375Num'>) {
  return `${candidate.pump480Num}-${candidate.pump375Num}`;
}

function PumpSkid({ pump480Num, pump375Num, pump480Head, pump375Head }: PumpSkidProps) {
  const pumps = [
    ...Array.from({ length: Math.max(0, pump480Num) }, () => ({
      type: 'ZMI480', head: pump480Head, color: '#0891b2', dark: '#0e7490', light: '#22d3ee',
    })),
    ...Array.from({ length: Math.max(0, pump375Num) }, () => ({
      type: 'ZMI375', head: pump375Head, color: '#d97706', dark: '#b45309', light: '#fbbf24',
    })),
  ];

  if (pumps.length === 0) return <div className={styles.emptyPump}>暂无开泵方案</div>;

  const pipeY = 182;
  const startX = 110;
  const endX = 890;
  const gap = (endX - startX) / (pumps.length + 1);
  const centers = pumps.map((_, index) => startX + gap * (index + 1));
  const totalHead = pumps.reduce((sum, pump) => sum + Number(pump.head), 0);

  const renderPipe = (key: string, x1: number, x2: number) => (
    <g key={key}>
      <rect x={x1} y={pipeY - 7} width={Math.max(0, x2 - x1)} height="14" rx="4" fill="#94a3b8" />
      <rect x={x1} y={pipeY - 7} width={Math.max(0, x2 - x1)} height="7" rx="4" fill="#cbd5e1" />
      <rect x={x1} y={pipeY - 4} width={Math.max(0, x2 - x1)} height="8" rx="4" fill="#06b6d4" opacity="0.84" />
    </g>
  );

  return (
    <svg className={styles.pumpSvg} viewBox="0 0 1000 340" role="img" aria-label="泵组配置数字孪生视图">
      <defs>
        <linearGradient id="optimization-base-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#94a3b8" />
        </linearGradient>
      </defs>

      <text x="60" y={pipeY - 18} fontSize="12" fill="currentColor" textAnchor="middle">进站</text>
      <text x="60" y={pipeY + 30} fontSize="10" fill="#94a3b8" textAnchor="middle">H_in</text>
      <text x="945" y={pipeY - 18} fontSize="12" fill="currentColor" textAnchor="middle">出站</text>
      <text x="945" y={pipeY + 30} fontSize="10" fill="#94a3b8" textAnchor="middle">H_out</text>
      <text x="60" y="32" fontSize="11" fill="currentColor">扬程叠加</text>
      <text x="945" y="47" fontSize="15" fontWeight="800" fill="currentColor" textAnchor="middle">
        Σ {formatNumber(totalHead, 0)}m
      </text>

      {centers.map((center, index) => renderPipe(
        `pipe-${index}`,
        index === 0 ? 60 : centers[index - 1] + 43,
        center - 43,
      ))}
      {renderPipe('pipe-out', centers[centers.length - 1] + 43, 945)}

      {pumps.map((pump, index) => {
        const centerX = centers[index];
        return (
          <g className={styles.digitalPump} style={{ animationDelay: `${index * 0.15}s` }} key={`${pump.type}-${index}`}>
            <line x1={centerX} y1="50" x2={centerX} y2="72" stroke={pump.color} strokeWidth="3" />
            <text x={centerX} y="44" textAnchor="middle" fill={pump.color} fontSize="12" fontWeight="800">
              +{formatNumber(pump.head, 0)}
            </text>

            <ellipse cx={centerX} cy={pipeY + 52} rx="48" ry="10" fill="rgba(19,37,66,.15)" />
            <polygon points={`${centerX - 50},${pipeY + 30} ${centerX},${pipeY + 50} ${centerX + 50},${pipeY + 30} ${centerX},${pipeY + 10}`} fill="#cbd5e1" />
            <polygon points={`${centerX - 50},${pipeY + 30} ${centerX},${pipeY + 50} ${centerX + 50},${pipeY + 30} ${centerX},${pipeY + 10}`} fill="url(#optimization-base-gradient)" opacity="0.34" />

            <ellipse cx={centerX} cy={pipeY - 5} rx="30" ry="28" fill={pump.dark} />
            <ellipse cx={centerX} cy={pipeY - 8} rx="28" ry="26" fill={pump.color} />
            <path d={`M ${centerX - 14} ${pipeY - 8} A 14 13 0 1 1 ${centerX + 13} ${pipeY - 3}`} fill="none" stroke={pump.light} strokeWidth="2.5" opacity="0.72" />
            <circle cx={centerX} cy={pipeY - 8} r="6" fill={pump.light} />
            <circle cx={centerX} cy={pipeY - 8} r="3" fill="#fff" opacity="0.92" />

            <rect x={centerX - 16} y={pipeY - 52} width="32" height="26" rx="4" fill={pump.dark} />
            <rect x={centerX - 16} y={pipeY - 52} width="32" height="22" rx="4" fill={pump.color} />
            {Array.from({ length: 5 }, (_, lineIndex) => (
              <line key={lineIndex} x1={centerX - 13 + lineIndex * 6.5} y1={pipeY - 48} x2={centerX - 13 + lineIndex * 6.5} y2={pipeY - 34} stroke={pump.dark} strokeWidth="1.2" opacity="0.65" />
            ))}
            <ellipse cx={centerX} cy={pipeY - 52} rx="16" ry="5" fill={pump.light} />
            <rect x={centerX - 42} y={pipeY - 12} width="12" height="10" rx="2" fill="#64748b" />
            <rect x={centerX + 30} y={pipeY - 12} width="12" height="10" rx="2" fill="#64748b" />
            <circle cx={centerX + 22} cy={pipeY - 46} r="3" fill="#22c55e">
              <animate attributeName="opacity" values="1;.3;1" dur="1.4s" repeatCount="indefinite" />
            </circle>

            <text x={centerX} y={pipeY + 76} textAnchor="middle" fill={pump.color} fontSize="13" fontWeight="800">{pump.type}</text>
            <text x={centerX} y={pipeY + 92} textAnchor="middle" fill="currentColor" fontSize="10">扬程 {formatNumber(pump.head, 0)}m</text>
          </g>
        );
      })}

      {Array.from({ length: 14 }, (_, index) => (
        <circle key={index} r="3.2" fill="#fff" opacity="0.95">
          <animateMotion dur="2.5s" begin={`${-(index * 2.5 / 14)}s`} repeatCount="indefinite" path={`M 70 ${pipeY} L 940 ${pipeY}`} />
        </circle>
      ))}
    </svg>
  );
}

export default function Optimization() {
  const location = useLocation();
  const [form] = Form.useForm<OptimizationFormValues>();
  const selectedStationId = Form.useWatch('pumpStationId', form);
  const watchedDensity = Form.useWatch('density', form);
  const watchedFlowRate = Number(Form.useWatch('flowRate', form) ?? INITIAL_VALUES.flowRate);
  const watchedWorkingDays = Number(Form.useWatch('workingDays', form) ?? INITIAL_VALUES.workingDays);
  const watchedPump480Head = Number(Form.useWatch('pump480Head', form) ?? INITIAL_VALUES.pump480Head);
  const watchedPump375Head = Number(Form.useWatch('pump375Head', form) ?? INITIAL_VALUES.pump375Head);
  const watchedInletPressure = Number(Form.useWatch('inletPressure', form) ?? INITIAL_VALUES.inletPressure);
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [oils, setOils] = useState<OilProperty[]>([]);
  const [stations, setStations] = useState<PumpStation[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [selectedCombinationKey, setSelectedCombinationKey] = useState<string | null>(null);
  const [calculationError, setCalculationError] = useState<string | null>(null);
  const [pumpPreviewOpen, setPumpPreviewOpen] = useState(false);
  const autoSubmitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitRequestId = useRef(0);
  const prefillAppliedRef = useRef(false);

  const smartReportPrefill = useMemo<SmartReportOptimizationPrefill | null>(() => {
    const routeState = location.state as SmartReportLocationState | null;
    if (routeState?.smartReportPrefill) return routeState.smartReportPrefill;
    try {
      const stored = window.sessionStorage.getItem(SMART_REPORT_PREFILL_KEY);
      return stored ? (JSON.parse(stored) as SmartReportOptimizationPrefill) : null;
    } catch {
      return null;
    }
  }, [location.state]);

  const loadBaseData = useCallback(async () => {
    const [projectRes, oilRes, stationRes] = await Promise.all([
      projectApi.list(), oilPropertyApi.list(), pumpStationApi.list(),
    ]);
    const projectList = projectRes.data ?? [];
    setProjects(projectList);
    setOils(oilRes.data ?? []);
    setStations(stationRes.data ?? []);
    if (projectList.length > 0) {
      const requestedProjectId = Number(smartReportPrefill?.projectId);
      const requestedProject = projectList.find((project) => project.proId === requestedProjectId);
      setSelectedProjectId(requestedProject?.proId ?? projectList[0].proId);
    }
  }, [smartReportPrefill?.projectId]);

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
    form.setFieldsValue({
      ...INITIAL_VALUES,
      ...(smartReportPrefill?.input as Partial<OptimizationFormValues> | undefined),
    });
    void loadBaseData();
  }, [form, loadBaseData, smartReportPrefill?.input]);

  useEffect(() => {
    if (selectedProjectId) {
      setResult(null);
      void loadPipelines(selectedProjectId);
      form.setFieldValue('projectId', selectedProjectId);
    }
  }, [form, loadPipelines, selectedProjectId]);

  useEffect(() => {
    if (!smartReportPrefill?.input || prefillAppliedRef.current || !selectedProjectId || !pipelines.length) return;
    form.setFieldsValue({
      ...(smartReportPrefill.input as Partial<OptimizationFormValues>),
      projectId: selectedProjectId,
    });
    prefillAppliedRef.current = true;
    window.sessionStorage.removeItem(SMART_REPORT_PREFILL_KEY);
  }, [form, pipelines.length, selectedProjectId, smartReportPrefill]);

  useEffect(() => {
    if (!selectedStationId) return;
    const station = stations.find((item) => item.id === selectedStationId);
    const nextInletPressure = convertPressureMpaToHeadMeters(station?.comePower, Number(watchedDensity));
    if (nextInletPressure === undefined || nextInletPressure === form.getFieldValue('inletPressure')) return;
    form.setFieldValue('inletPressure', nextInletPressure);
  }, [form, selectedStationId, stations, watchedDensity]);

  const handlePipelineChange = (pipelineId: number) => {
    const pipeline = pipelines.find((item) => item.id === pipelineId);
    if (!pipeline) return;
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
    if (!oil) return;
    form.setFieldsValue({
      oilId,
      density: oil.density,
      viscosity: convertViscosityMm2PerSecToM2PerSec(oil.viscosity) ?? oil.viscosity,
    });
    setResult(null);
  };

  const handleStationChange = (stationId: number) => {
    const station = stations.find((item) => item.id === stationId);
    if (!station) return;
    const nextValues: Partial<OptimizationFormValues> = {
      pumpStationId: stationId,
      pump480Head: station.zmi480Lift,
      pump375Head: station.zmi375Lift,
      pumpEfficiency: station.pumpEfficiency / 100,
      motorEfficiency: station.electricEfficiency / 100,
    };
    const nextInletPressure = convertPressureMpaToHeadMeters(station.comePower, Number(form.getFieldValue('density')));
    if (nextInletPressure !== undefined) nextValues.inletPressure = nextInletPressure;
    form.setFieldsValue(nextValues);
    setResult(null);
  };

  const handleSubmit = async () => {
    let values: OptimizationFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const payload = { ...values, projectId: selectedProjectId ?? values.projectId };
    // 保留完整来源参数用于智能报告联动；仅从发给优化算法的请求中移除关联 ID。
    const reportInput = { ...payload };
    delete payload.pipelineId;
    delete payload.oilId;
    delete payload.pumpStationId;
    const requestId = ++submitRequestId.current;
    setLoading(true);
    setCalculationError(null);
    try {
      const project = projects.find((item) => item.proId === (payload.projectId ?? null));
      const response = await calculationApi.optimization(
        payload,
        project?.name,
        { headers: { 'X-Silent-Error': 'true' } },
      );
      if (requestId !== submitRequestId.current) return;
      const nextResult = response.data ?? null;
      setSelectedCombinationKey(null);
      setResult(nextResult);
      if (nextResult) {
        useCalculationLinkStore.getState().linkCalculation({
          calcType: 'OPTIMIZATION',
          projectId: payload.projectId ?? null,
          projectName: project?.name ?? null,
          input: reportInput as unknown as Record<string, unknown>,
          output: nextResult as unknown as Record<string, unknown>,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      if (requestId !== submitRequestId.current) return;
      setSelectedCombinationKey(null);
      setResult(null);
      setCalculationError(getCalculationErrorMessage(error));
    } finally {
      if (requestId === submitRequestId.current) setLoading(false);
    }
  };

  const scheduleAutoSubmit = (delay = 350) => {
    if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current);
    autoSubmitTimer.current = setTimeout(() => {
      autoSubmitTimer.current = null;
      void handleSubmit();
    }, delay);
  };

  useEffect(() => () => {
    if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current);
  }, []);

  useEffect(() => {
    if (selectedProjectId && pipelines.length > 0) scheduleAutoSubmit();
  }, [selectedProjectId, pipelines.length]);

  const candidateResults = useMemo<OptimizationCandidateResult[]>(() => {
    if (!result) return [];
    if (result.candidates?.length) return result.candidates;
    return [{ ...result, recommended: true }];
  }, [result]);

  const recommendedCandidate = useMemo(
    () => candidateResults.find((candidate) => candidate.recommended) ?? candidateResults[0] ?? null,
    [candidateResults],
  );

  const activeCandidate = useMemo(
    () => candidateResults.find((candidate) => getCombinationKey(candidate) === selectedCombinationKey)
      ?? recommendedCandidate,
    [candidateResults, recommendedCandidate, selectedCombinationKey],
  );

  const annualVolume = watchedFlowRate * 24 * watchedWorkingDays;
  const unitEnergy = activeCandidate && annualVolume > 0
    ? Number(activeCandidate.totalEnergyConsumption) / annualVolume
    : 0;
  const annualCostWan = activeCandidate ? Number(activeCandidate.totalCost) / 10000 : 0;

  const chartOption = useMemo<EChartsOption | null>(() => {
    if (!activeCandidate) return null;
    return {
      color: ['#0891b2', '#7c3aed', '#059669', '#d97706'],
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (value) => `${formatNumber(Number(value), 2)} m`,
      },
      grid: { left: 58, right: 24, top: 24, bottom: 42 },
      xAxis: {
        type: 'category',
        data: ['首站进站压头', '泵组总扬程', '管道总压降', '末站进站压头'],
        axisTick: { show: false },
        axisLabel: { interval: 0, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        name: '压头 / 扬程 (m)',
        splitLine: { lineStyle: { color: '#e8eef6' } },
      },
      series: [{
        type: 'bar',
        barMaxWidth: 58,
        data: [
          { value: watchedInletPressure, itemStyle: { color: '#0891b2', borderRadius: [7, 7, 0, 0] } },
          { value: Number(activeCandidate.totalHead), itemStyle: { color: '#7c3aed', borderRadius: [7, 7, 0, 0] } },
          { value: Number(activeCandidate.totalPressureDrop), itemStyle: { color: '#d97706', borderRadius: [7, 7, 0, 0] } },
          { value: Number(activeCandidate.endStationInPressure), itemStyle: { color: '#059669', borderRadius: [7, 7, 0, 0] } },
        ],
        label: {
          show: true,
          position: 'top',
          formatter: (params) => formatNumber(Number(params.value), 1),
          fontWeight: 600,
        },
      }],
    };
  }, [activeCandidate, watchedInletPressure]);

  const maxCandidateHead = Math.max(
    1,
    ...candidateResults.map((candidate) => Number(candidate.totalHead)),
  );

  return (
    <AnimatedPage>
      <div className={styles.optimizationPage}>
        <section className={styles.parameterCard}>
          <div className={styles.sectionHeading}>
            <span className={styles.headingMark} />
            <div>
              <h2><SettingOutlined /> 优化参数</h2>
              <p>选择基础数据后，由后端在至少开启一台泵的组合中推荐可行方案。</p>
            </div>
          </div>

          <Form<OptimizationFormValues>
            form={form}
            layout="vertical"
            className={styles.paramForm}
            onValuesChange={(changedValues) => {
              if (Object.keys(changedValues).length > 0) scheduleAutoSubmit();
            }}
          >
            <div className={styles.flowControl}>
              <div className={styles.flowLabelRow}>
                <label>流量 Q <span>*</span></label>
                <strong>{formatNumber(watchedFlowRate, 0)} m³/h</strong>
              </div>
              <Slider
                min={200}
                max={3000}
                step={10}
                value={watchedFlowRate}
                tooltip={{ formatter: (value) => `${value} m³/h` }}
                onChange={(value) => {
                  form.setFieldValue('flowRate', value);
                  scheduleAutoSubmit(220);
                }}
                onChangeComplete={() => scheduleAutoSubmit(0)}
              />
              <Form.Item name="flowRate" hidden><InputNumber /></Form.Item>
            </div>

            <Row gutter={10}>
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
                    placeholder="带入管道参数"
                    onChange={(value) => {
                      if (value) handlePipelineChange(value);
                      else { form.setFieldValue('pipelineId', undefined); setResult(null); }
                    }}
                    options={pipelines.map((pipeline) => ({ value: pipeline.id, label: pipeline.name }))}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="oilId" label="油品参数" rules={[{ required: true, message: '请选择油品参数' }]}>
                  <Select<number>
                    allowClear
                    placeholder="带入油品参数"
                    onChange={(value) => {
                      if (value) handleOilChange(value);
                      else { form.setFieldValue('oilId', undefined); setResult(null); }
                    }}
                    options={oils.map((oil) => ({ value: oil.id, label: oil.name }))}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="pumpStationId" label="泵站参数" rules={[{ required: true, message: '请选择泵站参数' }]}>
                  <Select<number>
                    allowClear
                    placeholder="带入泵站参数"
                    onChange={(value) => {
                      if (value) handleStationChange(value);
                      else { form.setFieldValue('pumpStationId', undefined); setResult(null); }
                    }}
                    options={stations.map((station) => ({ value: station.id, label: station.name }))}
                  />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={8}>
              <Col span={8}><Form.Item name="density" label="密度(kg/m³)" rules={[{ required: true }]}><InputNumber min={0} /></Form.Item></Col>
              <Col span={8}><Form.Item name="viscosity" label="粘度(m²/s)" rules={[{ required: true }]}><InputNumber min={0} precision={8} /></Form.Item></Col>
              <Col span={8}><Form.Item name="length" label="长度(km)" rules={[{ required: true }]}><InputNumber min={0} precision={2} /></Form.Item></Col>
              <Col span={8}><Form.Item name="diameter" label="外径(mm)" rules={[{ required: true }]}><InputNumber min={0} precision={2} /></Form.Item></Col>
              <Col span={8}><Form.Item name="thickness" label="壁厚(mm)" rules={[{ required: true }]}><InputNumber min={0} precision={2} /></Form.Item></Col>
              <Col span={8}><Form.Item name="roughness" label="粗糙度(m)" rules={[{ required: true }]}><InputNumber min={0} precision={6} /></Form.Item></Col>
              <Col span={8}><Form.Item name="startAltitude" label="起点高程(m)" rules={[{ required: true }]}><InputNumber precision={2} /></Form.Item></Col>
              <Col span={8}><Form.Item name="endAltitude" label="终点高程(m)" rules={[{ required: true }]}><InputNumber precision={2} /></Form.Item></Col>
              <Col span={8}><Form.Item name="inletPressure" label="进站压头(m)" rules={[{ required: true }]}><InputNumber min={0} precision={2} /></Form.Item></Col>
              <Col span={8}><Form.Item name="pump480Head" label="ZMI480扬程(m)" rules={[{ required: true }]}><InputNumber min={0} precision={2} /></Form.Item></Col>
              <Col span={8}><Form.Item name="pump375Head" label="ZMI375扬程(m)" rules={[{ required: true }]}><InputNumber min={0} precision={2} /></Form.Item></Col>
              <Col span={8}><Form.Item name="pumpEfficiency" label="泵效率"><InputNumber min={0} max={1} precision={3} /></Form.Item></Col>
              <Col span={8}><Form.Item name="motorEfficiency" label="电机效率"><InputNumber min={0} max={1} precision={3} /></Form.Item></Col>
              <Col span={8}><Form.Item name="workingDays" label="年运行天数"><InputNumber min={1} precision={0} /></Form.Item></Col>
              <Col span={8}><Form.Item name="electricityPrice" label="电价(元/kWh)"><InputNumber min={0} precision={2} /></Form.Item></Col>
            </Row>

            <div className={styles.formHint}>拖动流量滑块或修改参数后，系统会自动调用后端重新计算。</div>
          </Form>
        </section>

        <section className={styles.outputColumn}>
          <Spin spinning={loading} tip="后端正在计算推荐方案...">
            {result && activeCandidate ? (
              <div className={styles.resultStack}>
                <article className={styles.resultCard}>
                  <div className={styles.cardHeader}>
                    <div>
                      <h3>{activeCandidate.recommended ? '推荐方案' : '组合方案详情'}</h3>
                      <span>{activeCandidate.recommended ? '默认展示后端最终推荐组合' : '当前正在查看所选泵组组合的后端计算结果'}</span>
                    </div>
                    <Tag className={styles.statusTag} color={activeCandidate.recommended ? 'gold' : activeCandidate.isFeasible ? 'success' : 'error'}>
                      {activeCandidate.recommended
                        ? '★ 后端推荐'
                        : activeCandidate.isFeasible
                          ? <><CheckCircleFilled /> 可行候选</>
                          : '不可行候选'}
                    </Tag>
                  </div>

                  <div className={styles.heroGrid}>
                    <div className={styles.pumpPreview}>
                      <div className={styles.previewTitle}>泵组配置 · 数字孪生视图</div>
                      <button
                        type="button"
                        className={`${styles.twinScene} ${styles.twinSceneButton}`}
                        onClick={() => setPumpPreviewOpen(true)}
                        aria-label="放大查看泵组配置数字孪生视图"
                      >
                        <div className={styles.gridFloor} />
                        <PumpSkid
                          pump480Num={activeCandidate.pump480Num}
                          pump375Num={activeCandidate.pump375Num}
                          pump480Head={watchedPump480Head}
                          pump375Head={watchedPump375Head}
                        />
                        <span className={styles.expandHint}><ExpandOutlined /> 点击放大</span>
                      </button>
                      <div className={styles.twinLegend}>
                        <span><i className={styles.legend480} />ZMI480</span>
                        <span><i className={styles.legend375} />ZMI375</span>
                        <span><i className={styles.legendFlow} />油品流向</span>
                        <span><i className={styles.legendPipe} />管道/基座</span>
                      </div>
                    </div>
                    <div>
                      <div className={styles.metricGrid}>
                        <div className={`${styles.metricTile} ${styles.cyanMetric}`}><strong>{activeCandidate.pump480Num} + {activeCandidate.pump375Num}</strong><span>ZMI480 + ZMI375</span></div>
                        <div className={`${styles.metricTile} ${styles.purpleMetric}`}><strong>{formatNumber(activeCandidate.totalHead, 0)}</strong><span>总扬程 (m)</span></div>
                        <div className={`${styles.metricTile} ${styles.greenMetric}`}><strong>{formatNumber(activeCandidate.endStationInPressure, 1)}</strong><span>末站压头 (m)</span></div>
                        <div className={`${styles.metricTile} ${styles.amberMetric}`}><strong>{formatNumber(annualCostWan, 2)}</strong><span>年费用 (万元)</span></div>
                        <div className={`${styles.metricTile} ${styles.wideMetric}`}><strong>{formatNumber(activeCandidate.totalEnergyConsumption, 0)}</strong><span>年能耗 (kWh)</span></div>
                        <div className={`${styles.metricTile} ${styles.wideMetric}`}><strong>{formatNumber(unitEnergy, 4)}</strong><span>单位输量能耗 (kWh/m³)</span></div>
                      </div>
                      <div className={styles.recommendationNote}>
                        <b>{activeCandidate.recommended ? '推荐说明：' : '组合说明：'}</b>{activeCandidate.description}
                      </div>
                    </div>
                  </div>
                </article>

                <article className={styles.resultCard}>
                  <div className={styles.cardHeader}>
                    <div><h3>水力平衡指标</h3><span>全部数值来自当前表单与后端优化结果，单位统一为米</span></div>
                    <span className={styles.cardCaption}>当前流量 {formatNumber(watchedFlowRate, 0)} m³/h</span>
                  </div>
                  {chartOption && <Chart option={chartOption} height={310} />}
                </article>

                <article className={styles.resultCard}>
                  <div className={styles.cardHeader}>
                    <div><h3>后端候选组合</h3><span>点击组合查看其真实计算结果，金色组合始终为后端最终推荐</span></div>
                    <span className={styles.cardCaption}>当前总压降 {formatNumber(activeCandidate.totalPressureDrop, 2)} m</span>
                  </div>
                  <div className={styles.candidateRows}>
                    {candidateResults.map((candidate) => {
                      const candidateHead = Number(candidate.totalHead);
                      const selected = getCombinationKey(candidate) === getCombinationKey(activeCandidate);
                      return (
                        <button
                          type="button"
                          className={`${styles.candidateRow} ${selected ? styles.activeCandidateRow : ''} ${candidate.recommended ? styles.recommendedCandidate : ''} ${candidate.isFeasible && !candidate.recommended ? styles.feasibleCandidate : ''} ${!candidate.isFeasible ? styles.infeasibleCandidate : ''}`}
                          key={getCombinationKey(candidate)}
                          onClick={() => setSelectedCombinationKey(getCombinationKey(candidate))}
                          aria-pressed={selected}
                        >
                          <div className={styles.candidateName}>
                            <span>{candidate.recommended ? '★ 推荐' : candidate.isFeasible ? '候选' : '不可行'}</span>
                            {candidate.pump480Num}×ZMI480 + {candidate.pump375Num}×ZMI375
                          </div>
                          <div className={styles.headTrack}><div style={{ width: `${Math.max(4, candidateHead / maxCandidateHead * 100)}%` }} /></div>
                          <strong>{formatNumber(candidateHead, 0)} m</strong>
                        </button>
                      );
                    })}
                  </div>
                  <div className={styles.candidateFootnote}>每一行均来自后端本次计算。点击候选组合后，上方泵组、压力、能耗、费用及水力平衡图会同步切换。</div>
                </article>
              </div>
            ) : calculationError ? (
              <article className={`${styles.resultCard} ${styles.emptyResult} ${styles.calculationError}`}>
                <div className={`${styles.emptyIcon} ${styles.errorIcon}`}><ExclamationCircleFilled /></div>
                <h3>当前流量暂无可行开泵方案</h3>
                <p>{calculationError}</p>
                <div className={styles.errorFlow}>
                  当前流量 {formatNumber(watchedFlowRate, 0)} m³/h · 可降低流量或选择扬程更高的泵站后自动重算
                </div>
              </article>
            ) : (
              <article className={`${styles.resultCard} ${styles.emptyResult}`}>
                <div className={styles.emptyIcon}><SettingOutlined /></div>
                <h3>等待泵站优化计算</h3>
                <p>带入项目基础数据或调整流量、参数后，系统会自动调用后端生成真实推荐方案。</p>
              </article>
            )}
          </Spin>
        </section>
      </div>

      <Modal
        open={pumpPreviewOpen}
        onCancel={() => setPumpPreviewOpen(false)}
        footer={null}
        centered
        width="min(1200px, 94vw)"
        title="泵组配置 · 数字孪生视图"
        destroyOnClose
      >
        {activeCandidate && (
          <div className={`${styles.twinScene} ${styles.expandedTwinScene}`}>
            <div className={styles.gridFloor} />
            <PumpSkid
              pump480Num={activeCandidate.pump480Num}
              pump375Num={activeCandidate.pump375Num}
              pump480Head={watchedPump480Head}
              pump375Head={watchedPump375Head}
            />
          </div>
        )}
      </Modal>
    </AnimatedPage>
  );
}
