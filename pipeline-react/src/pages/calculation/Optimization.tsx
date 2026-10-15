import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Col,
  Form,
  InputNumber,
  Row,
  Select,
  Tag,
  message,
} from "antd";
import {
  AimOutlined,
  DatabaseOutlined,
  PlayCircleOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import ReactECharts from "echarts-for-react";
import AnimatedPage from "../../components/common/AnimatedPage";
import {
  calculationApi,
  oilPropertyApi,
  pipelineApi,
  projectApi,
  pumpStationApi,
} from "../../api";
import type {
  CapacityEvaluationParams,
  CapacityEvaluationResult,
  HydraulicAnalysisParams,
  OilProperty,
  Pipeline,
  Project,
  PumpStation,
} from "../../types";
import {
  convertPressureMpaToHeadMeters,
  convertViscosityMm2PerSecToM2PerSec,
} from "../../utils/calculationUnits";
import styles from "./Optimization.module.css";

type FormValues = HydraulicAnalysisParams & {
  pipelineId?: number;
  oilId?: number;
  pumpStationId?: number;
  minFlowRate: number;
  maxFlowRate: number;
  flowStep: number;
  minEndPressure: number;
  maxEndPressure?: number;
  maxVelocity?: number;
};

const INITIAL_VALUES: FormValues = {
  flowRate: 0,
  minFlowRate: 400,
  maxFlowRate: 1300,
  flowStep: 50,
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
  minEndPressure: 0,
  maxVelocity: 3,
};

function number(value: unknown, digits = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? parsed.toLocaleString("zh-CN", { maximumFractionDigits: digits })
    : "—";
}

export default function CapacityEvaluation() {
  const [form] = Form.useForm<FormValues>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [oils, setOils] = useState<OilProperty[]>([]);
  const [stations, setStations] = useState<PumpStation[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [result, setResult] = useState<CapacityEvaluationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    const [projectRes, oilRes, stationRes] = await Promise.all([
      projectApi.list(),
      oilPropertyApi.list(),
      pumpStationApi.list(),
    ]);
    setProjects(projectRes.data ?? []);
    setOils(oilRes.data ?? []);
    setStations(stationRes.data ?? []);
    if (projectRes.data?.length) setProjectId(projectRes.data[0].proId);
  }, []);
  const loadPipelines = useCallback(
    async (id: number) => {
      const response = await pipelineApi.listByProject(id);
      setPipelines(response.data ?? []);
      const first = response.data?.[0];
      if (first)
        form.setFieldsValue({
          pipelineId: first.id,
          length: first.length,
          diameter: first.diameter,
          thickness: first.thickness,
          roughness: first.roughness ?? INITIAL_VALUES.roughness,
          startAltitude: first.startAltitude,
          endAltitude: first.endAltitude,
          flowRate: first.throughput > 0 ? first.throughput : 0,
        });
    },
    [form],
  );
  useEffect(() => {
    form.setFieldsValue(INITIAL_VALUES);
    void load();
  }, [form, load]);
  useEffect(() => {
    if (projectId) void loadPipelines(projectId);
  }, [loadPipelines, projectId]);
  const submit = async () => {
    try {
      const values = await form.validateFields();
      if (!Number.isFinite(values.flowRate) || values.flowRate <= 0) {
        message.error("请输入大于 0 的基准流量");
        return;
      }
      const project = projects.find((item) => item.proId === projectId);
      const {
        pipelineId,
        oilId,
        pumpStationId,
        minFlowRate,
        maxFlowRate,
        flowStep,
        minEndPressure,
        maxEndPressure,
        maxVelocity,
        ...baseParams
      } = values;
      const payload: CapacityEvaluationParams = {
        projectId: projectId ?? undefined,
        projectName: project?.name,
        baseParams,
        minFlowRate,
        maxFlowRate,
        flowStep,
        minEndPressure,
        maxEndPressure,
        maxVelocity,
      };
      setLoading(true);
      const response = await calculationApi.evaluateCapacity(
        payload,
        project?.name,
      );
      setResult(response.data ?? null);
      message.success("输送能力窗口评估完成");
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : "输送能力窗口评估失败",
      );
    } finally {
      setLoading(false);
    }
  };
  const chart = useMemo(() => {
    if (!result) return null;
    return {
      tooltip: { trigger: "axis" },
      legend: { data: ["末站压头", "管内流速"], top: 4 },
      grid: { left: 54, right: 48, top: 42, bottom: 42 },
      xAxis: {
        type: "category",
        name: "流量 (m³/h)",
        data: result.points.map((point) => number(point.flowRate, 0)),
      },
      yAxis: [
        { type: "value", name: "压头 (m)" },
        { type: "value", name: "流速 (m/s)" },
      ],
      series: [
        {
          name: "末站压头",
          type: "line",
          smooth: true,
          data: result.points.map((point) => ({
            value: Number(point.endStationPressure.toFixed(2)),
            itemStyle: { color: point.feasible ? "#16a394" : "#e85d75" },
          })),
          areaStyle: { color: "rgba(22,163,148,.12)" },
          lineStyle: { width: 3, color: "#16a394" },
        },
        {
          name: "管内流速",
          type: "line",
          yAxisIndex: 1,
          smooth: true,
          data: result.points.map((point) => Number(point.velocity.toFixed(3))),
          lineStyle: { width: 2, type: "dashed", color: "#e5a43b" },
        },
      ],
    };
  }, [result]);
  return (
    <AnimatedPage className={styles.page}>
      <div className={styles.capacityShell}>
        <header className={styles.heroHeader}>
          <div>
            <div className={styles.eyebrow}>OPERATING ENVELOPE · 运行边界</div>
            <h1>输送能力窗口</h1>
            <p>
              固定当前项目泵组，扫描流量—压力—流速关系，回答“这条管线现在能安全输送多少”。
            </p>
          </div>
          <div className={styles.heroOrb}>
            <AimOutlined />
          </div>
        </header>
        <div className={styles.capacityGrid}>
          <Card
            className={styles.controlCard}
            bordered={false}
            title={
              <span>
                <DatabaseOutlined /> 项目真实数据
              </span>
            }
          >
            <Form form={form} layout="vertical" onFinish={() => void submit()}>
              <Form.Item label="所属项目">
                <Select
                  value={projectId ?? undefined}
                  onChange={setProjectId}
                  options={projects.map((item) => ({
                    value: item.proId,
                    label: item.name,
                  }))}
                  placeholder="选择项目"
                />
              </Form.Item>
              <Row gutter={10}>
                <Col span={12}>
                  <Form.Item name="pipelineId" label="管道">
                    <Select
                      allowClear
                      onChange={(id) => {
                        const item = pipelines.find((pipe) => pipe.id === id);
                        if (item)
                          form.setFieldsValue({
                            length: item.length,
                            diameter: item.diameter,
                            thickness: item.thickness,
                            roughness:
                              item.roughness ?? INITIAL_VALUES.roughness,
                            startAltitude: item.startAltitude,
                            endAltitude: item.endAltitude,
                            flowRate: item.throughput > 0 ? item.throughput : 0,
                          });
                      }}
                      options={pipelines.map((item) => ({
                        value: item.id,
                        label: item.name,
                      }))}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="oilId" label="油品">
                    <Select
                      allowClear
                      onChange={(id) => {
                        const item = oils.find((oil) => oil.id === id);
                        if (item)
                          form.setFieldsValue({
                            density: item.density,
                            viscosity:
                              convertViscosityMm2PerSecToM2PerSec(
                                item.viscosity,
                              ) ?? item.viscosity,
                          });
                      }}
                      options={oils.map((item) => ({
                        value: item.id,
                        label: item.name,
                      }))}
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="pumpStationId" label="泵站">
                <Select
                  allowClear
                  onChange={(id) => {
                    const item = stations.find((station) => station.id === id);
                    if (item)
                      form.setFieldsValue({
                        pump480Head: item.zmi480Lift,
                        pump375Head: item.zmi375Lift,
                        pump480Num: 1,
                        pump375Num: 1,
                        inletPressure: convertPressureMpaToHeadMeters(
                          item.comePower,
                          Number(form.getFieldValue("density")),
                        ),
                      });
                  }}
                  options={stations.map((item) => ({
                    value: item.id,
                    label: item.name,
                  }))}
                />
              </Form.Item>
              <Form.Item
                name="flowRate"
                label="基准流量 (m³/h)"
                rules={[
                  { required: true, message: "请输入基准流量" },
                  { type: "number", min: 0.01, message: "流量必须大于 0" },
                ]}
              >
                <InputNumber
                  min={0.01}
                  precision={2}
                  style={{ width: "100%" }}
                />
              </Form.Item>
              <div className={styles.subLabel}>窗口扫描</div>
              <Row gutter={10}>
                <Col span={12}>
                  <Form.Item name="minFlowRate" label="起始流量">
                    <InputNumber min={1} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="maxFlowRate" label="终止流量">
                    <InputNumber min={1} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="flowStep" label="扫描步长">
                    <InputNumber min={1} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="maxVelocity" label="最大流速">
                    <InputNumber min={0.1} precision={2} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="minEndPressure" label="末站最低压头">
                    <InputNumber min={0} precision={2} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="maxEndPressure" label="末站最高压头">
                    <InputNumber min={0} precision={2} placeholder="可选" />
                  </Form.Item>
                </Col>
              </Row>
              <div className={styles.readonlyHint}>
                泵组数量、管径、油品黏度等均直接来自当前项目数据；本页面不替换水力分析模型。
              </div>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                icon={<PlayCircleOutlined />}
                block
                className={styles.primaryButton}
              >
                生成输送能力窗口
              </Button>
            </Form>
          </Card>
          <main className={styles.resultsColumn}>
            {result ? (
              <>
                <section className={styles.kpiRow}>
                  <div className={`${styles.kpiCard} ${styles.kpiGreen}`}>
                    <span>可行流量下限</span>
                    <strong>{number(result.feasibleMinFlow, 0)}</strong>
                    <em>m³/h</em>
                  </div>
                  <div className={`${styles.kpiCard} ${styles.kpiBlue}`}>
                    <span>可行流量上限</span>
                    <strong>{number(result.feasibleMaxFlow, 0)}</strong>
                    <em>m³/h</em>
                  </div>
                  <div className={`${styles.kpiCard} ${styles.kpiGold}`}>
                    <span>建议基准流量</span>
                    <strong>{number(result.recommendedFlow, 0)}</strong>
                    <em>m³/h</em>
                  </div>
                  <div className={`${styles.kpiCard} ${styles.kpiRose}`}>
                    <span>当前瓶颈</span>
                    <strong className={styles.textKpi}>
                      {result.bottleneck}
                    </strong>
                    <em>约束识别</em>
                  </div>
                </section>
                <Card className={styles.resultCard} bordered={false}>
                  <div className={styles.cardTitle}>
                    <div>
                      <span className={styles.index}>01</span>
                      <h2>运行边界地图</h2>
                    </div>
                    <Tag color="cyan">
                      {result.totalCalculations} 个真实工况点
                    </Tag>
                  </div>
                  {chart && (
                    <ReactECharts option={chart} style={{ height: 330 }} />
                  )}
                  <div className={styles.legendNote}>
                    <span className={styles.safeDot} />
                    绿色：压力与流速均在边界内{" "}
                    <span className={styles.riskDot} />
                    红色：触发约束，需要调整运行方案
                  </div>
                </Card>
                <Card className={styles.resultCard} bordered={false}>
                  <div className={styles.cardTitle}>
                    <div>
                      <span className={styles.index}>02</span>
                      <h2>调度结论</h2>
                    </div>
                    <SafetyCertificateOutlined className={styles.cardIcon} />
                  </div>
                  <div className={styles.conclusion}>{result.conclusion}</div>
                  <div className={styles.boundaryGrid}>
                    <div>
                      <span>压力下限</span>
                      <strong>{number(result.minEndPressure, 1)} m</strong>
                    </div>
                    <div>
                      <span>压力上限</span>
                      <strong>
                        {result.maxEndPressure == null
                          ? "未设置"
                          : `${number(result.maxEndPressure, 1)} m`}
                      </strong>
                    </div>
                    <div>
                      <span>流速上限</span>
                      <strong>
                        {result.maxVelocity == null
                          ? "未设置"
                          : `${number(result.maxVelocity, 2)} m/s`}
                      </strong>
                    </div>
                  </div>
                </Card>
              </>
            ) : (
              <section className={styles.emptyState}>
                <AimOutlined />
                <h2>等待生成运行边界</h2>
                <p>
                  选择项目、管线、油品和泵站后，输入安全边界，系统会调用后端水力引擎扫描真实流量工况。
                </p>
              </section>
            )}
          </main>
        </div>
      </div>
    </AnimatedPage>
  );
}
