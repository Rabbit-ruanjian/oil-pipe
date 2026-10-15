import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  InputNumber,
  Row,
  Select,
  Space,
  Tag,
  message,
} from 'antd';
import { CalculatorOutlined, SettingOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { calculationApi, oilPropertyApi, pipelineApi, projectApi, pumpStationApi } from '../../api';
import type { OilProperty, OptimizationParams, OptimizationResult, Pipeline, Project, PumpStation } from '../../types';
import AnimatedPage from '../../components/common/AnimatedPage';
import { useCalculationLinkStore } from '../../stores/calculationLinkStore';
import { convertPressureMpaToHeadMeters, convertViscosityMm2PerSecToM2PerSec } from '../../utils/calculationUnits';
import styles from './Optimization.module.css';

const FORM_ITEM_SPAN = { xs: 24, md: 12, xl: 8 } as const;

type OptimizationFormValues = OptimizationParams & {
  pipelineId?: number;
  oilId?: number;
  pumpStationId?: number;
};

type StrategyCandidate = {
  pump480Num: number;
  pump375Num: number;
  totalHead: number;
  endPressure: number;
  friction: number;
  annualEnergy: number;
  annualCost: number;
  unitEnergy: number;
  feasible: boolean;
};

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

export default function Optimization() {
  const [form] = Form.useForm<OptimizationFormValues>();
  const selectedStationId = Form.useWatch('pumpStationId', form);
  const watchedDensity = Form.useWatch('density', form);
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [oils, setOils] = useState<OilProperty[]>([]);
  const [stations, setStations] = useState<PumpStation[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [candidates, setCandidates] = useState<StrategyCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<StrategyCandidate | null>(null);

  const loadBaseData = useCallback(async () => {
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
  }, []);

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
      form.setFieldValue('projectId', selectedProjectId);
    }
  }, [form, loadPipelines, selectedProjectId]);

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
    if (nextInletPressure !== undefined) {
      nextValues.inletPressure = nextInletPressure;
    }

    form.setFieldsValue(nextValues);
    setResult(null);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const payload = {
      ...values,
      projectId: selectedProjectId ?? values.projectId,
    };
    delete payload.pipelineId;
    delete payload.oilId;
    delete payload.pumpStationId;
    setLoading(true);
    try {
      const project = projects.find((item) => item.proId === (payload.projectId ?? null));
      const response = await calculationApi.optimization(payload, project?.name);
      const nextResult = response.data ?? null;
      setResult(nextResult);
      const pumpCombos = [[0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3]];
      const candidateResults = await Promise.all(pumpCombos.map(async ([pump480Num, pump375Num]) => {
        const hydraulic = (await calculationApi.hydraulicAnalysis({ ...payload, pump480Num, pump375Num }, project?.name)).data;
        if (!hydraulic) return null;
        const flowM3s = Number(payload.flowRate) / 3600;
        const efficiency = Math.max(Number(payload.pumpEfficiency ?? 0.8) * Number(payload.motorEfficiency ?? 0.95), 0.01);
        const powerKw = Number(payload.density) * 9.81 * flowM3s * Number(hydraulic.totalHead) / efficiency / 1000;
        const annualEnergy = powerKw * Number(payload.workingDays ?? 350) * 24;
        const annualCost = annualEnergy * Number(payload.electricityPrice ?? 0.8);
        const unitEnergy = Number(payload.flowRate) > 0 ? powerKw / Number(payload.flowRate) : 0;
        return { pump480Num, pump375Num, totalHead: Number(hydraulic.totalHead), endPressure: Number(hydraulic.endStationInPressure), friction: Number(hydraulic.frictionHeadLoss), annualEnergy, annualCost, unitEnergy, feasible: hydraulic.endStationInPressure > 0 && pump480Num + pump375Num > 0 } satisfies StrategyCandidate;
      }));
      const nextCandidates = candidateResults.filter((item): item is StrategyCandidate => Boolean(item));
      setCandidates(nextCandidates);
      const recommended = nextCandidates.find((item) => item.pump480Num === nextResult?.pump480Num && item.pump375Num === nextResult?.pump375Num) ?? nextCandidates[0] ?? null;
      setSelectedCandidate(recommended);
      if (nextResult) {
        useCalculationLinkStore.getState().linkCalculation({
          calcType: 'OPTIMIZATION',
          projectId: payload.projectId ?? null,
          projectName: project?.name ?? null,
          input: payload as unknown as Record<string, unknown>,
          output: nextResult as unknown as Record<string, unknown>,
          updatedAt: new Date().toISOString(),
        });
      }
      message.success('优化计算完成');
    } finally {
      setLoading(false);
    }
  };

  const chartOption = useMemo(() => {
    if (!candidates.length) {
      return null;
    }

    return {
      tooltip: { trigger: 'item', formatter: (params: { data: [number, number, string] }) => `${params.data[2]}<br/>单位能耗：${params.data[0].toFixed(3)}<br/>末站压力：${params.data[1].toFixed(2)} m` },
      grid: { left: 58, right: 24, top: 38, bottom: 48 },
      xAxis: { type: 'value', name: '单位输量能耗', nameLocation: 'middle', nameGap: 28 },
      yAxis: { type: 'value', name: '末站压力 / m' },
      series: [{ type: 'scatter', symbolSize: 18, data: candidates.map((item) => ({ value: [item.unitEnergy, item.endPressure, `${item.pump480Num}×480 + ${item.pump375Num}×375`], itemStyle: { color: item.pump480Num === result?.pump480Num && item.pump375Num === result?.pump375Num ? '#f59e0b' : item.feasible ? '#22c55e' : '#ef4444' } })) }],
    };
  }, [candidates, result]);

  return (
    <AnimatedPage>
      <div className={styles.calculationLayout}>
        <div className={styles.paramPanel}>
          <div className="page-header">
            <h2><SettingOutlined /> 泵站优化</h2>
            <p>由后端遍历泵组合并给出可行工况下的推荐运行方案。压头与扬程单位均为 m。</p>
          </div>

          <Card title="优化参数" className="page-card">
            <Form<OptimizationFormValues> form={form} layout="vertical" className={styles.paramForm} onFinish={() => void handleSubmit()}>
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
                      placeholder="带入管道参数"
                      onChange={(value) => {
                        if (value) {
                          handlePipelineChange(value);
                          return;
                        }
                        form.setFieldValue('pipelineId', undefined);
                        setResult(null);
                      }}
                      options={pipelines.map((pipeline) => ({ value: pipeline.id, label: pipeline.name }))}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="oilId" label="油品参数">
                    <Select<number>
                      allowClear
                      placeholder="带入油品参数"
                      onChange={(value) => {
                        if (value) {
                          handleOilChange(value);
                          return;
                        }
                        form.setFieldValue('oilId', undefined);
                        setResult(null);
                      }}
                      options={oils.map((oil) => ({ value: oil.id, label: oil.name }))}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="pumpStationId" label="泵站参数">
                    <Select<number>
                      allowClear
                      placeholder="带入泵站参数"
                      onChange={(value) => {
                        if (value) {
                          handleStationChange(value);
                          return;
                        }
                        form.setFieldValue('pumpStationId', undefined);
                        setResult(null);
                      }}
                      options={stations.map((station) => ({ value: station.id, label: station.name }))}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={16}>
                <Col {...FORM_ITEM_SPAN}><Form.Item name="flowRate" label="流量(m³/h)" rules={[{ required: true }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
                <Col {...FORM_ITEM_SPAN}><Form.Item name="density" label="密度(kg/m³)" rules={[{ required: true }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
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
                <Col {...FORM_ITEM_SPAN}><Form.Item name="pump480Head" label="ZMI480 扬程(m)" rules={[{ required: true }]}><InputNumber min={0} precision={2} style={{ width: '100%' }} /></Form.Item></Col>
                <Col {...FORM_ITEM_SPAN}><Form.Item name="pump375Head" label="ZMI375 扬程(m)" rules={[{ required: true }]}><InputNumber min={0} precision={2} style={{ width: '100%' }} /></Form.Item></Col>
              </Row>
              <Row gutter={16}>
                <Col {...FORM_ITEM_SPAN}><Form.Item name="pumpEfficiency" label="泵效率(0-1)"><InputNumber min={0} max={1} precision={2} style={{ width: '100%' }} /></Form.Item></Col>
                <Col {...FORM_ITEM_SPAN}><Form.Item name="motorEfficiency" label="电机效率(0-1)"><InputNumber min={0} max={1} precision={2} style={{ width: '100%' }} /></Form.Item></Col>
                <Col {...FORM_ITEM_SPAN}><Form.Item name="workingDays" label="年工作天数"><InputNumber min={1} precision={0} style={{ width: '100%' }} /></Form.Item></Col>
              </Row>
              <Row gutter={16}>
                <Col span={24}><Form.Item name="electricityPrice" label="电价(元/kWh)"><InputNumber min={0} precision={2} style={{ width: '100%' }} /></Form.Item></Col>
              </Row>
              <Button type="primary" htmlType="submit" loading={loading} icon={<CalculatorOutlined />} block>
                开始优化
              </Button>
            </Form>
          </Card>
        </div>

        <div className={styles.resultPanel}>
          {result ? (
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <div className={styles.recommendationHero}><div style={{ fontSize: 12, opacity: 0.78 }}>系统推荐运行策略</div><div style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>{result.pump480Num} × ZMI480 + {result.pump375Num} × ZMI375</div><div style={{ marginTop: 8, opacity: 0.88 }}>{result.description || '满足基本压力约束的综合候选方案'}</div></div>
              <div className={styles.metricGrid}><div className={styles.metricCard}><div className={styles.metricLabel}>推荐末站压力</div><div className={styles.metricValue}>{Number(result.endStationInPressure).toFixed(2)} m</div></div><div className={styles.metricCard}><div className={styles.metricLabel}>总扬程</div><div className={styles.metricValue}>{Number(result.totalHead).toFixed(2)} m</div></div><div className={styles.metricCard}><div className={styles.metricLabel}>年能耗</div><div className={styles.metricValue}>{Number(result.totalEnergyConsumption).toLocaleString()} kWh</div></div><div className={styles.metricCard}><div className={styles.metricLabel}>预计成本</div><div className={styles.metricValue}>¥{Number(result.totalCost).toLocaleString()}</div></div></div>
              <Card title="泵组策略对比" className="page-card"><Row gutter={[12, 12]}>{candidates.map((candidate) => { const recommended = candidate.pump480Num === result.pump480Num && candidate.pump375Num === result.pump375Num; const selected = selectedCandidate?.pump480Num === candidate.pump480Num && selectedCandidate?.pump375Num === candidate.pump375Num; return <Col xs={24} sm={12} lg={8} key={`${candidate.pump480Num}-${candidate.pump375Num}`}><Card size="small" onClick={() => setSelectedCandidate(candidate)} className={`${styles.strategyCard} ${selected ? styles.strategyCardSelected : ''}`} title={<Space><span>{candidate.pump480Num}×480 + {candidate.pump375Num}×375</span>{recommended && <Tag color="gold">推荐</Tag>}</Space>}><Space direction="vertical" size={4}><span>末站压力：{candidate.endPressure.toFixed(2)} m</span><span>单位能耗：{candidate.unitEnergy.toFixed(3)}</span><span>年成本：¥{candidate.annualCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span><Tag color={candidate.feasible ? 'success' : 'error'}>{candidate.feasible ? '满足约束' : '不可行'}</Tag></Space></Card></Col>; })}</Row></Card>
              <Card title="能效—压力策略前沿" className="page-card">{chartOption && <ReactECharts option={chartOption} style={{ height: 340 }} />}</Card>
              {selectedCandidate && <Card title="当前选中策略的计算证据" className="page-card"><Descriptions column={2} bordered><Descriptions.Item label="泵组">{selectedCandidate.pump480Num} × ZMI480 + {selectedCandidate.pump375Num} × ZMI375</Descriptions.Item><Descriptions.Item label="方案状态">{selectedCandidate.feasible ? '满足约束' : '不可行'}</Descriptions.Item><Descriptions.Item label="总扬程">{selectedCandidate.totalHead.toFixed(2)} m</Descriptions.Item><Descriptions.Item label="末站压力">{selectedCandidate.endPressure.toFixed(2)} m</Descriptions.Item><Descriptions.Item label="沿程摩阻">{selectedCandidate.friction.toFixed(2)} m</Descriptions.Item><Descriptions.Item label="年能耗">{selectedCandidate.annualEnergy.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh</Descriptions.Item></Descriptions></Card>}
            </Space>
          ) : (
            <Card className="page-card" style={{ minHeight: 420, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center', color: '#8c8c8c' }}>
                <SettingOutlined style={{ fontSize: 52, marginBottom: 16 }} />
                <div>带入现有基础数据后即可直接计算推荐方案。</div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </AnimatedPage>
  );
}

