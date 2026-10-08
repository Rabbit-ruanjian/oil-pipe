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
  Table,
  Tag,
  message,
} from 'antd';
import { BarChartOutlined } from '@ant-design/icons';
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

const FORM_ITEM_SPAN = { xs: 24, md: 12, xl: 8 } as const;

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
      const response = await calculationApi.quickSensitivityAnalysis(variableType, payload, project?.name);
      const nextResult = response.data ?? null;
      setResult(nextResult);
      if (nextResult) {
        const selectedVariable = variables.find((item) => item.code === variableType);
        useCalculationLinkStore.getState().linkCalculation({
          calcType: 'SENSITIVITY',
          projectId: payload.projectId ?? null,
          projectName: project?.name ?? null,
          input: {
            projectId: payload.projectId ?? null,
            projectName: project?.name ?? null,
            analysisType: 'SINGLE',
            baseParams: payload,
            variables: [
              {
                variableType,
                variableName: selectedVariable?.name ?? variableType,
                unit: selectedVariable?.unit ?? '',
                startPercent: selectedVariable?.minChangePercent ?? -20,
                endPercent: selectedVariable?.maxChangePercent ?? 20,
                stepPercent: 5,
              },
            ],
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

  const chartOption = useMemo(() => {
    if (!activeVariableResult) {
      return null;
    }

    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['末站进站压力', '摩阻变化率'] },
      xAxis: {
        type: 'category',
        name: '变化比例',
        data: activeVariableResult.dataPoints.map((point) => `${point.changePercent}%`),
      },
      yAxis: [
        {
          type: 'value',
          name: '压力(MPa)',
        },
        {
          type: 'value',
          name: '摩阻变化(%)',
        },
      ],
      series: [
        {
          name: '末站进站压力',
          type: 'line',
          smooth: true,
          data: activeVariableResult.dataPoints.map((point) => point.endStationPressure),
        },
        {
          name: '摩阻变化率',
          type: 'bar',
          yAxisIndex: 1,
          data: activeVariableResult.dataPoints.map((point) => point.frictionChangePercent),
        },
      ],
    };
  }, [activeVariableResult]);

  const columns = [
    {
      title: '变化比例',
      dataIndex: 'changePercent',
      key: 'changePercent',
      render: (value: number) => `${value}%`,
    },
    {
      title: '变量值',
      dataIndex: 'variableValue',
      key: 'variableValue',
    },
    {
      title: '末站进站压力',
      dataIndex: 'endStationPressure',
      key: 'endStationPressure',
    },
    {
      title: '压力变化率',
      dataIndex: 'pressureChangePercent',
      key: 'pressureChangePercent',
      render: (value: number) => `${value}%`,
    },
    {
      title: '流态',
      dataIndex: 'flowRegime',
      key: 'flowRegime',
    },
  ];

  return (
    <AnimatedPage>
      <div className={styles.calculationLayout}>
        <div className={styles.paramPanel}>
          <div className="page-header">
            <h2><BarChartOutlined /> 敏感性分析</h2>
            <p>直接调用后端敏感性分析引擎，评估关键参数变化对输送工况的影响。压头与扬程单位均为 m，当前仅展示已实现变量。</p>
          </div>

          <Card title="分析参数" className="page-card">
            <Form<SensitivityFormValues>
              form={form}
              layout="vertical"
              className={styles.paramForm}
              onFinish={() => void handleSubmit()}
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
                  <Form.Item name="variableType" label="敏感变量" rules={[{ required: true, message: '请选择分析变量' }]}>
                    <Select
                      options={variables.map((item) => ({
                        value: item.code,
                        label: `${item.name}${item.unit ? ` (${item.unit})` : ''}`,
                      }))}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="管道参数">
                    <Select<number>
                      allowClear
                      placeholder="带入管道参数"
                      onChange={(value) => value && handlePipelineChange(value)}
                      options={pipelines.map((pipeline) => ({ value: pipeline.id, label: pipeline.name }))}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="oilId" label="油品参数">
                    <Select<number>
                      allowClear
                      placeholder="带入油品参数"
                      onChange={(value) => value && handleOilChange(value)}
                      options={oils.map((oil) => ({ value: oil.id, label: oil.name }))}
                    />
                  </Form.Item>
                </Col>
                <Col span={24}>
                  <Form.Item name="pumpStationId" label="泵站参数">
                    <Select<number>
                      allowClear
                      placeholder="带入泵站参数"
                      onChange={(value) => {
                        if (value) {
                          handleStationChange(value);
                          return;
                        }
                        setSelectedStationId(null);
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
                <Col {...FORM_ITEM_SPAN}><Form.Item name="density" label="密度(kg/m³)"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
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
              <Button type="primary" htmlType="submit" loading={loading} icon={<BarChartOutlined />} block>
                开始分析
              </Button>
            </Form>
          </Card>
        </div>

        <div className={styles.resultPanel}>
          {result && activeVariableResult ? (
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Card
                title="分析结论"
                className="page-card"
                extra={<Tag color={activeVariableResult.maxImpactPercent >= 20 ? 'warning' : 'success'}>{activeVariableResult.trend === 'POSITIVE' ? '正相关' : activeVariableResult.trend === 'NEGATIVE' ? '负相关' : activeVariableResult.trend === 'MIXED' ? '混合' : '未知'}</Tag>}
              >
                <Descriptions column={2} bordered>
                  <Descriptions.Item label="基准流态">{result.baseResult.flowRegime}</Descriptions.Item>
                  <Descriptions.Item label="基准雷诺数">{result.baseResult.reynoldsNumber}</Descriptions.Item>
                  <Descriptions.Item label="基准末站进站压头">{result.baseResult.endStationInPressure}</Descriptions.Item>
                  <Descriptions.Item label="敏感系数">{activeVariableResult.sensitivityCoefficient}</Descriptions.Item>
                  <Descriptions.Item label="最大影响幅度">{activeVariableResult.maxImpactPercent}%</Descriptions.Item>
                  <Descriptions.Item label="总计算次数">{result.totalCalculations}</Descriptions.Item>
                </Descriptions>
              </Card>

              <Card title="敏感性曲线" className="page-card">
                {chartOption && <ReactECharts option={chartOption} style={{ height: 320 }} />}
              </Card>

              <Card title="排名结果" className="page-card">
                <Space wrap>
                  {result.sensitivityRanking.map((item) => (
                    <Tag key={`${item.rank}-${item.variableType}`} color={item.rank === 1 ? 'gold' : 'blue'}>
                      TOP {item.rank} · {item.variableName} · 系数 {item.sensitivityCoefficient}
                    </Tag>
                  ))}
                </Space>
              </Card>

              <Card title="明细数据" className="page-card">
                <Table<SensitivityPoint>
                  columns={columns}
                  dataSource={activeVariableResult.dataPoints}
                  rowKey={(record) => `${record.variableValue}-${record.changePercent}`}
                  pagination={false}
                  size="small"
                />
              </Card>
            </Space>
          ) : (
            <Card className="page-card" style={{ minHeight: 420, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center', color: '#8c8c8c' }}>
                <BarChartOutlined style={{ fontSize: 52, marginBottom: 16 }} />
                <div>选择敏感变量并带入基础参数后，即可获得真实分析结果。</div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </AnimatedPage>
  );
}




