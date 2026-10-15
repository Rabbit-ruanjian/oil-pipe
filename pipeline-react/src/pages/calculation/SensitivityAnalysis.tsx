import { useCallback, useEffect, useState } from "react";
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
  AlertOutlined,
  DatabaseOutlined,
  PlayCircleOutlined,
  ThunderboltOutlined,
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
  HydraulicAnalysisParams,
  OilProperty,
  Pipeline,
  Project,
  PumpStation,
  TransientRiskParams,
  TransientRiskResult,
} from "../../types";
import {
  convertPressureMpaToHeadMeters,
  convertViscosityMm2PerSecToM2PerSec,
} from "../../utils/calculationUnits";
import styles from "./SensitivityAnalysis.module.css";

type FormValues = HydraulicAnalysisParams & {
  pipelineId?: number;
  oilId?: number;
  pumpStationId?: number;
  eventType: "PUMP_TRIP" | "VALVE_CLOSURE";
  flowChangePercent: number;
  eventDurationSeconds: number;
  waveSpeed: number;
  minAllowableHead: number;
  maxAllowableHead?: number;
};
const INITIAL_VALUES: FormValues = {
  eventType: "PUMP_TRIP",
  flowChangePercent: 100,
  eventDurationSeconds: 10,
  waveSpeed: 1000,
  minAllowableHead: 0,
  flowRate: 0,
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
const number = (value: unknown, digits = 1) =>
  Number.isFinite(Number(value))
    ? Number(value).toLocaleString("zh-CN", { maximumFractionDigits: digits })
    : "—";

export default function TransientRisk() {
  const [form] = Form.useForm<FormValues>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [oils, setOils] = useState<OilProperty[]>([]);
  const [stations, setStations] = useState<PumpStation[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [result, setResult] = useState<TransientRiskResult | null>(null);
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
      const allValues = form.getFieldsValue(true) as FormValues;
      const mergedValues = { ...allValues, ...values };
      if (!Number.isFinite(mergedValues.flowRate) || mergedValues.flowRate <= 0) {
        message.error("请输入大于 0 的基准流量");
        return;
      }
      const project = projects.find((item) => item.proId === projectId);
      const {
        pipelineId,
        oilId,
        pumpStationId,
        eventType,
        flowChangePercent,
        eventDurationSeconds,
        waveSpeed,
        minAllowableHead,
        maxAllowableHead,
        ...baseParams
      } = mergedValues;
      const payload: TransientRiskParams = {
        projectId: projectId ?? undefined,
        projectName: project?.name,
        baseParams,
        eventType,
        flowChangePercent,
        eventDurationSeconds,
        waveSpeed,
        minAllowableHead,
        maxAllowableHead,
      };
      setLoading(true);
      const response = await calculationApi.evaluateTransientRisk(
        payload,
        project?.name,
      );
      setResult(response.data ?? null);
      message.success("启停冲击风险评估完成");
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : "启停冲击风险评估失败",
      );
    } finally {
      setLoading(false);
    }
  };
  const chart = result
    ? {
        grid: { left: 55, right: 30, top: 25, bottom: 42 },
        xAxis: {
          type: "category",
          data: ["预测最低压头", "基准末站压头", "预测最高压头"],
        },
        yAxis: { type: "value", name: "压头 (m)" },
        series: [
          {
            type: "bar",
            barWidth: 56,
            data: [
              {
                value: result.predictedMinimumHead,
                itemStyle: { color: "#e5a43b", borderRadius: [7, 7, 0, 0] },
              },
              {
                value: result.baseResult.endStationInPressure,
                itemStyle: { color: "#2a92a4", borderRadius: [7, 7, 0, 0] },
              },
              {
                value: result.predictedMaximumHead,
                itemStyle: { color: "#dc6078", borderRadius: [7, 7, 0, 0] },
              },
            ],
            label: {
              show: true,
              position: "top",
              formatter: (item: { value: number }) =>
                `${number(item.value, 1)} m`,
            },
          },
        ],
      }
    : null;
  const riskClass =
    result?.riskLevel === "HIGH"
      ? styles.highRisk
      : result?.riskLevel === "MEDIUM"
        ? styles.mediumRisk
        : styles.lowRisk;
  return (
    <AnimatedPage className={styles.page}>
      <div className={styles.riskShell}>
        <header className={styles.riskHero}>
          <div>
            <div className={styles.eyebrow}>
              TRANSIENT SAFETY · 瞬态安全筛查
            </div>
            <h1>启停冲击风险</h1>
            <p>把泵跳停、阀门关闭从“经验操作”变成可解释的压力波风险预演。</p>
          </div>
          <div className={styles.riskOrb}>
            <AlertOutlined />
          </div>
        </header>
        <div className={styles.riskGrid}>
          <Card
            className={styles.riskControl}
            bordered={false}
            title={
              <span>
                <DatabaseOutlined /> 当前项目工况
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
              <div className={styles.subLabel}>操作事件</div>
              <Form.Item name="eventType" label="事件类型">
                <Select
                  options={[
                    { value: "PUMP_TRIP", label: "泵站跳停 / 突然失去扬程" },
                    { value: "VALVE_CLOSURE", label: "阀门快速关闭" },
                  ]}
                />
              </Form.Item>
              <Row gutter={10}>
                <Col span={12}>
                  <Form.Item name="flowChangePercent" label="流量变化比例">
                    <InputNumber min={1} max={100} precision={0} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="eventDurationSeconds"
                    label="操作完成时间(s)"
                  >
                    <InputNumber min={0.1} precision={1} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="waveSpeed" label="等效波速(m/s)">
                    <InputNumber min={100} max={1800} precision={0} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="minAllowableHead" label="最低允许压头(m)">
                    <InputNumber min={0} precision={1} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="maxAllowableHead" label="最高允许压头(m)">
                    <InputNumber min={0} precision={1} placeholder="可选" />
                  </Form.Item>
                </Col>
              </Row>
              <div className={styles.readonlyHint}>
                结果是基于 Joukowsky 压力波近似的运行前筛查，不替代 SPS
                等完整瞬态仿真；输入值均可按项目资料修正。
              </div>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                icon={<PlayCircleOutlined />}
                block
                className={styles.riskButton}
              >
                预演这次操作
              </Button>
            </Form>
          </Card>
          <main className={styles.riskResults}>
            {result ? (
              <>
                <section className={styles.riskKpis}>
                  <div className={`${styles.riskKpi} ${riskClass}`}>
                    <span>风险等级</span>
                    <strong>
                      {result.riskLevel === "HIGH"
                        ? "高"
                        : result.riskLevel === "MEDIUM"
                          ? "中"
                          : "低"}
                    </strong>
                    <em>
                      {result.pressureBoundaryExceeded
                        ? "已触碰压力边界"
                        : "未触碰压力边界"}
                    </em>
                  </div>
                  <div className={styles.riskKpi}>
                    <span>压力波动幅度</span>
                    <strong>{number(result.surgeHead, 1)}</strong>
                    <em>m 压头</em>
                  </div>
                  <div className={styles.riskKpi}>
                    <span>临界操作时间</span>
                    <strong>{number(result.criticalDurationSeconds, 1)}</strong>
                    <em>s</em>
                  </div>
                  <div className={styles.riskKpi}>
                    <span>基准流速</span>
                    <strong>{number(result.baseVelocity, 2)}</strong>
                    <em>m/s</em>
                  </div>
                </section>
                <Card className={styles.riskCard} bordered={false}>
                  <div className={styles.cardTitle}>
                    <div>
                      <span className={styles.index}>01</span>
                      <h2>压力冲击预演</h2>
                    </div>
                    <Tag
                      color={
                        result.riskLevel === "HIGH"
                          ? "error"
                          : result.riskLevel === "MEDIUM"
                            ? "warning"
                            : "success"
                      }
                    >
                      {result.eventType === "PUMP_TRIP" ? "泵跳停" : "阀门关闭"}
                    </Tag>
                  </div>
                  {chart && (
                    <ReactECharts option={chart} style={{ height: 320 }} />
                  )}
                  <div className={styles.rangeStrip}>
                    <span>
                      预测最低 {number(result.predictedMinimumHead, 1)} m
                    </span>
                    <i />
                    <span>
                      基准 {number(result.baseResult.endStationInPressure, 1)} m
                    </span>
                    <i />
                    <span>
                      预测最高 {number(result.predictedMaximumHead, 1)} m
                    </span>
                  </div>
                </Card>
                <Card className={styles.riskCard} bordered={false}>
                  <div className={styles.cardTitle}>
                    <div>
                      <span className={styles.index}>02</span>
                      <h2>操作建议</h2>
                    </div>
                    <ThunderboltOutlined className={styles.cardIcon} />
                  </div>
                  <div className={`${styles.adviceBox} ${riskClass}`}>
                    <strong>{result.conclusion}</strong>
                    <p>{result.recommendation}</p>
                  </div>
                  <div className={styles.formulaNote}>
                    估算逻辑：ΔH = a·Δv/g；当操作时间短于 2L/a
                    时按突变工况计算，超过临界时间则按时间比例衰减。
                  </div>
                </Card>
              </>
            ) : (
              <section className={styles.emptyState}>
                <AlertOutlined />
                <h2>等待压力冲击预演</h2>
                <p>
                  选择项目真实数据，输入泵跳停或阀门操作时间，系统会给出预测压力区间和可执行建议。
                </p>
              </section>
            )}
          </main>
        </div>
      </div>
    </AnimatedPage>
  );
}
