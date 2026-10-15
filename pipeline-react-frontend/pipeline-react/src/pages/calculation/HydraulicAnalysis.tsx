import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Col, Descriptions, Form, InputNumber, Row, Select, Space, Tag, Progress } from 'antd';
import { SafetyCertificateOutlined, ThunderboltOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { calculationApi, oilPropertyApi, pipelineApi, projectApi, pumpStationApi } from '../../api';
import type { HydraulicAnalysisParams, HydraulicAnalysisResult, OilProperty, Pipeline, Project, PumpStation } from '../../types';
import AnimatedPage from '../../components/common/AnimatedPage';
import { useCalculationLinkStore } from '../../stores/calculationLinkStore';
import { convertPressureMpaToHeadMeters, convertViscosityMm2PerSecToM2PerSec } from '../../utils/calculationUnits';
import styles from './HydraulicAnalysis.module.css';

const FORM_ITEM_SPAN = { xs: 24, md: 12, xl: 8 } as const;
type HydraulicFormValues = HydraulicAnalysisParams & { pipelineId?: number; oilId?: number; pumpStationId?: number };
type EnvelopePoint = { flow: number; pressure: number; friction: number; velocity: number };

const INITIAL_VALUES: HydraulicAnalysisParams = {
  flowRate: 850, density: 860, viscosity: 0.00002, length: 150, diameter: 508, thickness: 8,
  roughness: 0.00003, startAltitude: 0, endAltitude: 35, inletPressure: 6.5,
  pump480Num: 2, pump375Num: 1, pump480Head: 280, pump375Head: 220,
};

export default function HydraulicAnalysis() {
  const [form] = Form.useForm<HydraulicFormValues>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [oils, setOils] = useState<OilProperty[]>([]);
  const [stations, setStations] = useState<PumpStation[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedStationId, setSelectedStationId] = useState<number | null>(null);
  const [result, setResult] = useState<HydraulicAnalysisResult | null>(null);
  const [envelope, setEnvelope] = useState<EnvelopePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [envelopeLoading, setEnvelopeLoading] = useState(false);
  const [limits, setLimits] = useState({ minPressure: 20, maxPressure: 260, minVelocity: 0.6, maxVelocity: 2.5 });
  const timerRef = useRef<number | undefined>(undefined);

  const watched = {
    pipelineId: Form.useWatch('pipelineId', form), oilId: Form.useWatch('oilId', form), pumpStationId: Form.useWatch('pumpStationId', form),
    flowRate: Form.useWatch('flowRate', form), density: Form.useWatch('density', form), viscosity: Form.useWatch('viscosity', form),
    length: Form.useWatch('length', form), diameter: Form.useWatch('diameter', form), thickness: Form.useWatch('thickness', form),
    roughness: Form.useWatch('roughness', form), startAltitude: Form.useWatch('startAltitude', form), endAltitude: Form.useWatch('endAltitude', form),
    inletPressure: Form.useWatch('inletPressure', form), pump480Num: Form.useWatch('pump480Num', form), pump375Num: Form.useWatch('pump375Num', form),
    pump480Head: Form.useWatch('pump480Head', form), pump375Head: Form.useWatch('pump375Head', form),
  };

  const loadBaseData = useCallback(async () => {
    const [projectRes, oilRes, stationRes] = await Promise.all([projectApi.list(), oilPropertyApi.list(), pumpStationApi.list()]);
    const projectList = projectRes.data ?? [];
    setProjects(projectList); setOils(oilRes.data ?? []); setStations(stationRes.data ?? []);
    if (projectList.length > 0) setSelectedProjectId(projectList[0].proId);
  }, []);

  const loadPipelines = useCallback(async (projectId: number) => {
    const pipelineList = (await pipelineApi.listByProject(projectId)).data ?? [];
    setPipelines(pipelineList);
    const first = pipelineList[0];
    if (first) form.setFieldsValue({ pipelineId: first.id, length: first.length, diameter: first.diameter, thickness: first.thickness, roughness: first.roughness ?? INITIAL_VALUES.roughness, startAltitude: first.startAltitude, endAltitude: first.endAltitude });
    else form.setFieldValue('pipelineId', undefined);
  }, [form]);

  useEffect(() => { form.setFieldsValue(INITIAL_VALUES); void loadBaseData(); }, [form, loadBaseData]);
  useEffect(() => { if (selectedProjectId) { setResult(null); void loadPipelines(selectedProjectId); } }, [loadPipelines, selectedProjectId]);

  useEffect(() => {
    if (!selectedStationId) return;
    const station = stations.find((item) => item.id === selectedStationId);
    const next = convertPressureMpaToHeadMeters(station?.comePower, Number(watched.density));
    if (next !== undefined && next !== form.getFieldValue('inletPressure')) form.setFieldValue('inletPressure', next);
  }, [form, selectedStationId, stations, watched.density]);

  const runAnalysis = useCallback(async () => {
    const values = form.getFieldsValue();
    if (!selectedProjectId || !values.pipelineId || !values.flowRate || !values.length || !values.diameter) return;
    const payload = { ...values, projectId: selectedProjectId } as HydraulicAnalysisParams;
    setLoading(true);
    try {
      const project = projects.find((item) => item.proId === selectedProjectId);
      const response = await calculationApi.hydraulicAnalysis(payload, project?.name);
      const nextResult = response.data ?? null;
      setResult(nextResult);
      if (nextResult) useCalculationLinkStore.getState().linkCalculation({ calcType: 'HYDRAULIC', projectId: selectedProjectId, projectName: project?.name ?? null, input: payload as unknown as Record<string, unknown>, output: nextResult as unknown as Record<string, unknown>, updatedAt: new Date().toISOString() });

      setEnvelopeLoading(true);
      const baseFlow = Number(payload.flowRate);
      const flows = Array.from({ length: 9 }, (_, index) => Math.max(1, Math.round(baseFlow * (0.55 + index * 0.12))));
      const points = await Promise.all(flows.map(async (flow) => {
        const item = (await calculationApi.hydraulicAnalysis({ ...payload, flowRate: flow }, project?.name)).data;
        const innerDiameter = (Number(payload.diameter) - 2 * Number(payload.thickness)) / 1000;
        const area = Math.PI * innerDiameter * innerDiameter / 4;
        const velocity = area > 0 ? (flow / 3600) / area : 0;
        return item ? { flow, pressure: Number(item.endStationInPressure), friction: Number(item.frictionHeadLoss), velocity } : null;
      }));
      setEnvelope(points.filter((item): item is EnvelopePoint => Boolean(item)));
    } finally {
      setEnvelopeLoading(false); setLoading(false);
    }
  }, [form, projects, selectedProjectId]);

  const signature = JSON.stringify([selectedProjectId, ...Object.values(watched)]);
  useEffect(() => {
    if (!selectedProjectId || !watched.pipelineId || !watched.flowRate) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { void runAnalysis(); }, 750);
    return () => window.clearTimeout(timerRef.current);
  }, [runAnalysis, selectedProjectId, signature, watched.flowRate, watched.pipelineId]);

  const handlePipelineChange = (pipelineId: number) => {
    const pipeline = pipelines.find((item) => item.id === pipelineId); if (!pipeline) return;
    form.setFieldsValue({ pipelineId, length: pipeline.length, diameter: pipeline.diameter, thickness: pipeline.thickness, roughness: pipeline.roughness ?? INITIAL_VALUES.roughness, startAltitude: pipeline.startAltitude, endAltitude: pipeline.endAltitude });
  };
  const handleOilChange = (oilId: number) => {
    const oil = oils.find((item) => item.id === oilId); if (!oil) return;
    form.setFieldsValue({ oilId, density: oil.density, viscosity: convertViscosityMm2PerSecToM2PerSec(oil.viscosity) ?? oil.viscosity });
  };
  const handleStationChange = (stationId: number) => {
    const station = stations.find((item) => item.id === stationId); if (!station) return;
    setSelectedStationId(stationId);
    const nextPressure = convertPressureMpaToHeadMeters(station.comePower, Number(form.getFieldValue('density')));
    form.setFieldsValue({ pumpStationId: stationId, pump480Head: station.zmi480Lift, pump375Head: station.zmi375Lift, ...(nextPressure === undefined ? {} : { inletPressure: nextPressure }) });
  };

  const currentVelocity = result && watched.diameter && watched.thickness ? ((Number(watched.flowRate) / 3600) / (Math.PI * Math.pow((Number(watched.diameter) - 2 * Number(watched.thickness)) / 1000, 2) / 4)) : 0;
  const pressureMargin = result ? Math.max(0, Math.min(100, Math.min((Number(result.endStationInPressure) - limits.minPressure) / Math.max(limits.maxPressure - limits.minPressure, 1), (limits.maxPressure - Number(result.endStationInPressure)) / Math.max(limits.maxPressure - limits.minPressure, 1)) * 100)) : 0;
  const riskLabel = pressureMargin >= 35 && currentVelocity >= limits.minVelocity && currentVelocity <= limits.maxVelocity ? '健康运行' : pressureMargin >= 15 ? '需要关注' : '存在风险';
  const riskColor = riskLabel === '健康运行' ? 'success' : riskLabel === '需要关注' ? 'warning' : 'error';
  const maxSafeFlow = envelope.filter((item) => item.pressure >= limits.minPressure && item.pressure <= limits.maxPressure && item.velocity >= limits.minVelocity && item.velocity <= limits.maxVelocity).reduce((max, item) => Math.max(max, item.flow), 0);

  const pressureChartOption = useMemo(() => ({
    tooltip: { trigger: 'axis' }, legend: { data: ['末站压力', '摩阻损失'] },
    xAxis: { type: 'category', name: '流量 m³/h', data: envelope.map((item) => item.flow) },
    yAxis: [{ type: 'value', name: '压头 / m' }, { type: 'value', name: '摩阻 / m' }],
    series: [
      { name: '末站压力', type: 'line', smooth: true, symbolSize: 8, data: envelope.map((item) => item.pressure), markArea: { itemStyle: { color: 'rgba(34, 197, 94, 0.10)' }, data: [[{ yAxis: limits.minPressure }, { yAxis: limits.maxPressure }]] } },
      { name: '摩阻损失', type: 'bar', yAxisIndex: 1, barMaxWidth: 16, data: envelope.map((item) => item.friction) },
    ],
  }), [envelope, limits.maxPressure, limits.minPressure]);

  const pressureProfileOption = useMemo(() => {
    if (!result) return null;
    return { tooltip: { trigger: 'axis' }, legend: { data: ['压力线', '高程线'] }, xAxis: { type: 'category', data: ['首站入口', '首站出口', '末站入口'] }, yAxis: { type: 'value', name: '压头 / 高程 (m)' }, series: [{ name: '压力线', type: 'line', smooth: true, symbolSize: 10, data: [watched.inletPressure, result.firstStationOutPressure, result.endStationInPressure] }, { name: '高程线', type: 'line', smooth: true, lineStyle: { type: 'dashed', color: '#f59e0b' }, data: [watched.startAltitude, watched.startAltitude, watched.endAltitude] }] };
  }, [result, watched.endAltitude, watched.inletPressure, watched.startAltitude]);

  return <AnimatedPage><div className={styles.calculationLayout}>
    <div className={styles.paramPanel}>
      <div className="page-header"><h2><ThunderboltOutlined /> 输送能力与瓶颈诊断</h2><p>自动调用现有水力计算，拖动或修改参数后实时刷新安全输送区间。</p></div>
      <Card title="数据来源" className="page-card"><Form<HydraulicFormValues> form={form} layout="vertical" className={styles.paramForm}>
        <Form.Item label="所属项目"><Select value={selectedProjectId ?? undefined} placeholder="选择项目" onChange={setSelectedProjectId} options={projects.map((item) => ({ value: item.proId, label: item.name }))} /></Form.Item>
        <Form.Item name="pipelineId" label="管道参数"><Select allowClear placeholder="从数据中心带入" onChange={(value) => value && handlePipelineChange(value)} options={pipelines.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
        <Form.Item name="oilId" label="油品参数"><Select allowClear placeholder="从数据中心带入" onChange={(value) => value && handleOilChange(value)} options={oils.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
        <Form.Item name="pumpStationId" label="泵站参数"><Select allowClear placeholder="从数据中心带入" onChange={(value) => value && handleStationChange(value)} options={stations.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
      </Form></Card>
      <Card title="运行场景约束" className={`${styles.scenarioCard} page-card`} style={{ marginTop: 16 }}><Row gutter={12}>
        <Col span={12}><div style={{ fontSize: 12, marginBottom: 6 }}>最低压力(m)</div><InputNumber value={limits.minPressure} min={0} onChange={(value) => setLimits((old) => ({ ...old, minPressure: Number(value ?? 0) }))} style={{ width: '100%' }} /></Col>
        <Col span={12}><div style={{ fontSize: 12, marginBottom: 6 }}>最高压力(m)</div><InputNumber value={limits.maxPressure} min={1} onChange={(value) => setLimits((old) => ({ ...old, maxPressure: Number(value ?? 1) }))} style={{ width: '100%' }} /></Col>
        <Col span={12}><div style={{ fontSize: 12, marginBottom: 6 }}>最低流速(m/s)</div><InputNumber value={limits.minVelocity} min={0} step={0.1} onChange={(value) => setLimits((old) => ({ ...old, minVelocity: Number(value ?? 0) }))} style={{ width: '100%' }} /></Col>
        <Col span={12}><div style={{ fontSize: 12, marginBottom: 6 }}>最高流速(m/s)</div><InputNumber value={limits.maxVelocity} min={0.1} step={0.1} onChange={(value) => setLimits((old) => ({ ...old, maxVelocity: Number(value ?? 0.1) }))} style={{ width: '100%' }} /></Col>
      </Row></Card>
      <Card title="机理参数" className="page-card" style={{ marginTop: 16 }}><Form<HydraulicFormValues> form={form} layout="vertical" className={styles.paramForm}>
        <Row gutter={12}><Col {...FORM_ITEM_SPAN}><Form.Item name="flowRate" label="流量(m³/h)"><InputNumber min={1} style={{ width: '100%' }} /></Form.Item></Col><Col {...FORM_ITEM_SPAN}><Form.Item name="density" label="密度(kg/m³)"><InputNumber min={1} style={{ width: '100%' }} /></Form.Item></Col><Col {...FORM_ITEM_SPAN}><Form.Item name="viscosity" label="运动粘度(m²/s)"><InputNumber min={0} precision={8} style={{ width: '100%' }} /></Form.Item></Col></Row>
        <Row gutter={12}><Col {...FORM_ITEM_SPAN}><Form.Item name="length" label="长度(km)"><InputNumber min={1} style={{ width: '100%' }} /></Form.Item></Col><Col {...FORM_ITEM_SPAN}><Form.Item name="diameter" label="外径(mm)"><InputNumber min={1} style={{ width: '100%' }} /></Form.Item></Col><Col {...FORM_ITEM_SPAN}><Form.Item name="thickness" label="壁厚(mm)"><InputNumber min={0.1} style={{ width: '100%' }} /></Form.Item></Col></Row>
        <Row gutter={12}><Col {...FORM_ITEM_SPAN}><Form.Item name="roughness" label="粗糙度(m)"><InputNumber min={0} precision={6} style={{ width: '100%' }} /></Form.Item></Col><Col {...FORM_ITEM_SPAN}><Form.Item name="startAltitude" label="起点高程(m)"><InputNumber style={{ width: '100%' }} /></Form.Item></Col><Col {...FORM_ITEM_SPAN}><Form.Item name="endAltitude" label="终点高程(m)"><InputNumber style={{ width: '100%' }} /></Form.Item></Col></Row>
        <Row gutter={12}><Col {...FORM_ITEM_SPAN}><Form.Item name="inletPressure" label="首站进站压头(m)"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col><Col {...FORM_ITEM_SPAN}><Form.Item name="pump480Num" label="ZMI480 台数"><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item></Col><Col {...FORM_ITEM_SPAN}><Form.Item name="pump375Num" label="ZMI375 台数"><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item></Col></Row>
        <Row gutter={12}><Col span={12}><Form.Item name="pump480Head" label="ZMI480 单泵扬程(m)"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col><Col span={12}><Form.Item name="pump375Head" label="ZMI375 单泵扬程(m)"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col></Row>
      </Form></Card>
    </div>
    <div className={styles.resultPanel}>
      {result ? <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <div className={styles.decisionBanner}><div><div style={{ fontSize: 12, opacity: 0.75 }}>运行决策结论</div><div style={{ fontSize: 25, fontWeight: 700 }}>{riskLabel}</div><div style={{ marginTop: 6, opacity: 0.82 }}>系统已根据真实项目数据完成自动计算</div></div><Progress type="circle" percent={Math.round(pressureMargin)} strokeColor="#fef3c7" trailColor="rgba(255,255,255,.22)" format={(percent) => `${percent}%`} /></div>
        <div className={styles.metricGrid}><div className={styles.metricCard}><div className={styles.metricLabel}>末站压力</div><div className={styles.metricValue}>{Number(result.endStationInPressure).toFixed(2)} m</div><div className={styles.metricHint}>允许范围 {limits.minPressure}—{limits.maxPressure} m</div></div><div className={styles.metricCard}><div className={styles.metricLabel}>当前流速</div><div className={styles.metricValue}>{currentVelocity.toFixed(2)} m/s</div><div className={styles.metricHint}>目标范围 {limits.minVelocity}—{limits.maxVelocity}</div></div><div className={styles.metricCard}><div className={styles.metricLabel}>最大安全输量</div><div className={styles.metricValue}>{maxSafeFlow || '—'}</div><div className={styles.metricHint}>基于当前泵组与约束</div></div><div className={styles.metricCard}><div className={styles.metricLabel}>自动状态</div><div className={styles.metricValue}><Tag color={riskColor}>{riskLabel}</Tag></div><div className={styles.metricHint}>{loading || envelopeLoading ? '正在刷新' : '已同步'}</div></div></div>
        <Card className="page-card"><div className={styles.pipelineScene}><div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between' }}><div><div style={{ fontSize: 12, opacity: 0.7 }}>首站</div><b>{Number(watched.startAltitude ?? 0).toFixed(0)} m</b></div><div style={{ textAlign: 'center' }}><SafetyCertificateOutlined style={{ fontSize: 22, color: '#fef3c7' }} /><div style={{ fontSize: 12, opacity: 0.78 }}>压力—高程纵断面</div></div><div style={{ textAlign: 'right' }}><div style={{ fontSize: 12, opacity: 0.7 }}>末站</div><b>{Number(watched.endAltitude ?? 0).toFixed(0)} m</b></div></div><div className={styles.pipelineLine} /><div className={`${styles.pipelineNode} ${styles.pipelineNodeStart}`} /><div className={`${styles.pipelineNode} ${styles.pipelineNodeEnd}`} /><div className={styles.flowDot} /></div></Card>
        <Card title="安全输送能力边界" className="page-card" extra={<Tag color={envelopeLoading ? 'processing' : 'success'}>{envelopeLoading ? '计算中' : '自动更新'}</Tag>}>{envelope.length > 0 && <ReactECharts option={pressureChartOption} style={{ height: 350 }} />}</Card>
        <Card title="压力线与地形高程" className="page-card">{pressureProfileOption && <ReactECharts option={pressureProfileOption} style={{ height: 300 }} />}</Card>
        <Card title="机理计算证据" className="page-card"><Descriptions column={{ xs: 1, sm: 2 }} bordered><Descriptions.Item label="雷诺数">{Number(result.reynoldsNumber).toLocaleString()}</Descriptions.Item><Descriptions.Item label="流态">{result.flowRegime}</Descriptions.Item><Descriptions.Item label="摩阻损失">{result.frictionHeadLoss} m</Descriptions.Item><Descriptions.Item label="水力坡降">{result.hydraulicSlope}</Descriptions.Item><Descriptions.Item label="总扬程">{result.totalHead} m</Descriptions.Item><Descriptions.Item label="首站出站压头">{result.firstStationOutPressure} m</Descriptions.Item></Descriptions></Card>
      </Space> : <Card className="page-card" style={{ minHeight: 480, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ textAlign: 'center', color: '#8c8c8c' }}><ThunderboltOutlined style={{ fontSize: 52, marginBottom: 16 }} /><div>从数据中心选择项目、管道、油品和泵站后，系统会自动生成运行能力图。</div></div></Card>}
    </div>
  </div></AnimatedPage>;
}
