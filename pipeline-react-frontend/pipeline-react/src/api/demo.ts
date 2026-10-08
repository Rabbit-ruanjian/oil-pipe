import { useUserStore } from '../stores/userStore';
import type {
  CalculationHistory,
  HydraulicAnalysisParams,
  HydraulicAnalysisResult,
  KnowledgeDocument,
  KnowledgeIngestTask,
  OilProperty,
  OptimizationParams,
  OptimizationResult,
  PageResult,
  Pipeline,
  Project,
  PumpStation,
  R,
  SaveReportRequest,
  SensitivityPoint,
  SensitivityResult,
  SensitivityVariableInfo,
  VariableSensitivityResult,
} from '../types';
import type {
  KnowledgeDeleteResponse,
  KnowledgeDocumentListPayload,
  KnowledgeDocumentSummary,
  KnowledgeGraphQueryPayload,
  KnowledgeReindexResponse,
  KnowledgeSearchDebugPayload,
  KnowledgeSearchDebugRequest,
  KnowledgeStageBaseline,
  KnowledgeStatsPayload,
  KnowledgeUploadResponse,
} from '../types/agent';

const DEMO_TOKEN = 'demo-token';
const DEMO_STORE_KEY = 'pipeline-react-demo-store-v1';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

type DemoRequestConfig = {
  params?: Record<string, unknown>;
};

type DemoNextIds = {
  project: number;
  pipeline: number;
  pumpStation: number;
  oilProperty: number;
  history: number;
  knowledgeDocument: number;
  knowledgeTask: number;
};

type DemoStore = {
  projects: Project[];
  pipelines: Pipeline[];
  pumpStations: PumpStation[];
  oilProperties: OilProperty[];
  histories: CalculationHistory[];
  knowledgeDocuments: KnowledgeDocument[];
  knowledgeTasks: KnowledgeIngestTask[];
  nextIds: DemoNextIds;
};

let memoryStore: DemoStore | null = null;

const SENSITIVITY_VARIABLES: SensitivityVariableInfo[] = [
  { code: 'FLOW_RATE', name: '流量', unit: 'm3/h', minChangePercent: -20, maxChangePercent: 20 },
  { code: 'VISCOSITY', name: '运动粘度', unit: 'm²/s', minChangePercent: -20, maxChangePercent: 20 },
  { code: 'ROUGHNESS', name: '粗糙度', unit: 'm', minChangePercent: -20, maxChangePercent: 20 },
  { code: 'DIAMETER', name: '管径', unit: 'mm', minChangePercent: -15, maxChangePercent: 15 },
  { code: 'INLET_PRESSURE', name: '首站进站压头', unit: 'm', minChangePercent: -15, maxChangePercent: 15 },
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function success<T>(data: T, msg = '操作成功'): R<T> {
  return {
    code: 200,
    msg,
    data,
  };
}

function parseNumberList(value: string) {
  return value
    .split(',')
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readJsonBody<T>(body: BodyInit | null | undefined): T | null {
  if (typeof body !== 'string' || !body.trim()) {
    return null;
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

function sortByCreateTimeDesc<T extends { createTime?: string }>(items: T[]) {
  return [...items].sort((left, right) => {
    const rightTime = right.createTime ? new Date(right.createTime).getTime() : 0;
    const leftTime = left.createTime ? new Date(left.createTime).getTime() : 0;
    return rightTime - leftTime;
  });
}

function statusToAgentStatus(status: string) {
  switch (status.toUpperCase()) {
    case 'INDEXED':
      return 'indexed';
    case 'PROCESSING':
      return 'parsing';
    case 'UPLOADED':
      return 'uploaded';
    case 'FAILED':
      return 'failed';
    default:
      return status.toLowerCase();
  }
}

function createInitialStore(): DemoStore {
  const projects: Project[] = [
    {
      proId: 1,
      number: 'P-2026-001',
      name: '东部输油干线',
      responsible: '调度中心',
      buildDate: '2026-03-01',
      createTime: '2026-04-01T09:00:00',
      updateTime: '2026-04-02T08:00:00',
    },
    {
      proId: 2,
      number: 'P-2026-002',
      name: '沿海成品油管道',
      responsible: '运行二部',
      buildDate: '2026-02-18',
      createTime: '2026-03-28T14:30:00',
      updateTime: '2026-04-02T09:30:00',
    },
    {
      proId: 3,
      number: 'P-2026-003',
      name: '西北增输走廊',
      responsible: '工艺优化组',
      buildDate: '2026-01-12',
      createTime: '2026-03-25T11:20:00',
      updateTime: '2026-04-01T16:10:00',
    },
  ];

  const pipelines: Pipeline[] = [
    {
      id: 101,
      proId: 1,
      name: '一线主管道',
      length: 186.5,
      diameter: 720,
      thickness: 14,
      throughput: 3280,
      startAltitude: 126,
      endAltitude: 214,
      roughness: 0.12,
      workTime: 8200,
      createTime: '2026-04-01T09:30:00',
      updateTime: '2026-04-02T08:15:00',
    },
    {
      id: 102,
      proId: 1,
      name: '东部联络段',
      length: 94.2,
      diameter: 630,
      thickness: 12,
      throughput: 2680,
      startAltitude: 98,
      endAltitude: 166,
      roughness: 0.15,
      workTime: 8100,
      createTime: '2026-04-01T09:50:00',
      updateTime: '2026-04-02T08:20:00',
    },
    {
      id: 201,
      proId: 2,
      name: '沿海主干段',
      length: 210.4,
      diameter: 660,
      thickness: 13,
      throughput: 3010,
      startAltitude: 54,
      endAltitude: 148,
      roughness: 0.11,
      workTime: 8400,
      createTime: '2026-03-29T10:40:00',
      updateTime: '2026-04-02T09:20:00',
    },
    {
      id: 301,
      proId: 3,
      name: '西北增输段',
      length: 158.8,
      diameter: 610,
      thickness: 11,
      throughput: 2440,
      startAltitude: 168,
      endAltitude: 236,
      roughness: 0.13,
      workTime: 7960,
      createTime: '2026-03-27T12:10:00',
      updateTime: '2026-04-01T17:10:00',
    },
  ];

  const pumpStations: PumpStation[] = [
    {
      id: 1,
      name: '1号泵站',
      pumpEfficiency: 84,
      electricEfficiency: 92,
      displacement: 3200,
      comePower: 6.8,
      zmi480Lift: 480,
      zmi375Lift: 375,
      createTime: '2026-04-01T10:10:00',
      updateTime: '2026-04-02T08:40:00',
    },
    {
      id: 2,
      name: '2号泵站',
      pumpEfficiency: 78,
      electricEfficiency: 90,
      displacement: 2950,
      comePower: 6.1,
      zmi480Lift: 470,
      zmi375Lift: 365,
      createTime: '2026-03-29T14:20:00',
      updateTime: '2026-04-02T09:10:00',
    },
    {
      id: 3,
      name: '3号泵站',
      pumpEfficiency: 81,
      electricEfficiency: 91,
      displacement: 3080,
      comePower: 6.4,
      zmi480Lift: 476,
      zmi375Lift: 372,
      createTime: '2026-03-28T15:50:00',
      updateTime: '2026-04-01T18:00:00',
    },
  ];

  const oilProperties: OilProperty[] = [
    {
      id: 1,
      name: '0#原油',
      density: 842,
      viscosity: 0.000023,
      createTime: '2026-04-01T10:30:00',
      updateTime: '2026-04-02T08:50:00',
    },
    {
      id: 2,
      name: '高凝原油',
      density: 865,
      viscosity: 0.000031,
      createTime: '2026-03-30T11:30:00',
      updateTime: '2026-04-02T09:00:00',
    },
    {
      id: 3,
      name: '轻质原油',
      density: 816,
      viscosity: 0.000017,
      createTime: '2026-03-28T17:20:00',
      updateTime: '2026-04-01T16:50:00',
    },
  ];

  const histories: CalculationHistory[] = [
    {
      id: 1,
      calcType: 'HYDRAULIC',
      calcTypeName: '水力分析',
      projectId: 1,
      projectName: '东部输油干线',
      userId: 1,
      userName: 'demo',
      inputParams: JSON.stringify({
        projectId: 1,
        flowRate: 3280,
        density: 842,
        viscosity: 0.000023,
        length: 186.5,
        diameter: 720,
        thickness: 14,
        roughness: 0.12,
        startAltitude: 126,
        endAltitude: 214,
        inletPressure: 6.8,
        pump480Num: 2,
        pump375Num: 1,
        pump480Head: 480,
        pump375Head: 375,
      }),
      outputResult: JSON.stringify({
        frictionHeadLoss: 18.6,
        reynoldsNumber: 32680,
        flowRegime: '湍流',
        hydraulicSlope: 0.01,
        totalHead: 66.75,
        firstStationOutPressure: 25.49,
        endStationInPressure: 12.52,
      }),
      status: 1,
      statusName: '已完成',
      remark: '东部输油干线近期运行平稳。',
      createTime: '2026-04-02T08:30:00',
    },
    {
      id: 2,
      calcType: 'OPTIMIZATION',
      calcTypeName: '泵站优化',
      projectId: 1,
      projectName: '东部输油干线',
      userId: 1,
      userName: 'demo',
      inputParams: JSON.stringify({
        projectId: 1,
        flowRate: 3150,
        density: 842,
        viscosity: 0.000023,
        length: 186.5,
        diameter: 720,
        thickness: 14,
        roughness: 0.12,
        startAltitude: 126,
        endAltitude: 214,
        inletPressure: 6.8,
        pump480Head: 480,
        pump375Head: 375,
        pumpEfficiency: 0.84,
        motorEfficiency: 0.92,
        workingDays: 350,
        electricityPrice: 0.8,
      }),
      outputResult: JSON.stringify({
        pump480Num: 1,
        pump375Num: 1,
        totalHead: 42.75,
        totalPressureDrop: 16.24,
        endStationInPressure: 8.72,
        isFeasible: true,
        totalEnergyConsumption: 542880,
        totalCost: 434304,
        description: '建议采用 1 台 ZMI480 + 1 台 ZMI375 的组合，满足末站压力约束且能耗更低。',
      }),
      status: 1,
      statusName: '已完成',
      remark: '建议作为当前班次推荐方案。',
      createTime: '2026-04-01T14:20:00',
    },
    {
      id: 3,
      calcType: 'HYDRAULIC',
      calcTypeName: '水力分析',
      projectId: 2,
      projectName: '沿海成品油管道',
      userId: 1,
      userName: 'demo',
      inputParams: JSON.stringify({
        projectId: 2,
        flowRate: 3010,
        density: 865,
        viscosity: 0.000031,
        length: 210.4,
        diameter: 660,
        thickness: 13,
        roughness: 0.11,
        startAltitude: 54,
        endAltitude: 148,
        inletPressure: 6.1,
        pump480Num: 2,
        pump375Num: 1,
        pump480Head: 470,
        pump375Head: 365,
      }),
      outputResult: JSON.stringify({
        frictionHeadLoss: 22.34,
        reynoldsNumber: 27450,
        flowRegime: '过渡流',
        hydraulicSlope: 0.01,
        totalHead: 65.25,
        firstStationOutPressure: 24.37,
        endStationInPressure: 9.37,
      }),
      status: 1,
      statusName: '已完成',
      remark: '沿海段最近风浪期建议保留更高安全裕度。',
      createTime: '2026-04-02T09:15:00',
    },
    {
      id: 4,
      calcType: 'SENSITIVITY',
      calcTypeName: '敏感性分析',
      projectId: 3,
      projectName: '西北增输走廊',
      userId: 1,
      userName: 'demo',
      inputParams: JSON.stringify({
        projectId: 3,
        analysisType: 'SINGLE',
        baseParams: {
          projectId: 3,
          flowRate: 2440,
          density: 816,
          viscosity: 0.000017,
          length: 158.8,
          diameter: 610,
          thickness: 11,
          roughness: 0.13,
          startAltitude: 168,
          endAltitude: 236,
          inletPressure: 6.4,
          pump480Num: 2,
          pump375Num: 1,
          pump480Head: 476,
          pump375Head: 372,
        },
        variables: [
          {
            variableType: 'FLOW_RATE',
            variableName: '流量',
            unit: 'm3/h',
            startPercent: -20,
            endPercent: 20,
            stepPercent: 5,
          },
        ],
      }),
      outputResult: JSON.stringify({
        baseResult: {
          frictionHeadLoss: 14.21,
          reynoldsNumber: 28920,
          flowRegime: '湍流',
          hydraulicSlope: 0.01,
          totalHead: 66.2,
          firstStationOutPressure: 24.94,
          endStationInPressure: 14.24,
        },
        variableResults: [],
        sensitivityRanking: [
          {
            rank: 1,
            variableType: 'FLOW_RATE',
            variableName: '流量',
            sensitivityCoefficient: 0.87,
            description: '流量变化对末站压力影响最明显。',
          },
        ],
        duration: 180,
        totalCalculations: 9,
      }),
      status: 1,
      statusName: '已完成',
      remark: '流量是西北增输走廊当前最敏感的调节变量。',
      createTime: '2026-03-31T17:40:00',
    },
  ];

  const knowledgeDocuments: KnowledgeDocument[] = [
    {
      id: 1,
      title: '输油管道启停操作规范',
      category: 'operations',
      sourceType: 'manual',
      tags: '操作规程,启停',
      fileName: 'pipeline-start-stop-guide.pdf',
      fileExtension: 'pdf',
      fileSize: 2485760,
      fileHash: 'demo-hash-1',
      storageType: 'DEMO',
      storageBucket: 'demo-bucket',
      storageObjectKey: 'knowledge/demo/pipeline-start-stop-guide.pdf',
      agentDocId: 'demo-doc-1',
      chunkCount: 18,
      retryCount: 0,
      status: 'INDEXED',
      lastIngestTime: '2026-04-02T08:55:00',
      createBy: 'demo',
      createTime: '2026-04-01T15:20:00',
      updateTime: '2026-04-02T08:55:00',
    },
    {
      id: 2,
      title: '泵站能耗优化案例集',
      category: 'cases',
      sourceType: 'manual',
      tags: '案例分析,节能',
      fileName: 'pump-station-energy-cases.docx',
      fileExtension: 'docx',
      fileSize: 1835008,
      fileHash: 'demo-hash-2',
      storageType: 'DEMO',
      storageBucket: 'demo-bucket',
      storageObjectKey: 'knowledge/demo/pump-station-energy-cases.docx',
      agentDocId: 'demo-doc-2',
      chunkCount: 12,
      retryCount: 1,
      status: 'INDEXED',
      lastIngestTime: '2026-04-02T09:05:00',
      createBy: 'demo',
      createTime: '2026-04-01T16:10:00',
      updateTime: '2026-04-02T09:05:00',
    },
    {
      id: 3,
      title: '敏感性分析参数口径说明',
      category: 'formulas',
      sourceType: 'manual',
      tags: '计算公式,敏感性分析',
      fileName: 'sensitivity-parameter-spec.md',
      fileExtension: 'md',
      fileSize: 16512,
      fileHash: 'demo-hash-3',
      storageType: 'DEMO',
      storageBucket: 'demo-bucket',
      storageObjectKey: 'knowledge/demo/sensitivity-parameter-spec.md',
      agentDocId: 'demo-doc-3',
      chunkCount: 9,
      retryCount: 0,
      status: 'FAILED',
      failureReason: '演示模式下保留一条失败样例，便于查看任务历史。',
      lastIngestTime: '2026-04-02T09:12:00',
      createBy: 'demo',
      createTime: '2026-04-01T17:30:00',
      updateTime: '2026-04-02T09:12:00',
    },
  ];

  const knowledgeTasks: KnowledgeIngestTask[] = [
    {
      id: 1,
      documentId: 1,
      taskType: 'UPLOAD',
      attemptNo: 1,
      status: 'SUCCESS',
      agentDocId: 'demo-doc-1',
      chunkCount: 18,
      createBy: 'demo',
      startedAt: '2026-04-02T08:53:00',
      finishedAt: '2026-04-02T08:55:00',
      createTime: '2026-04-02T08:53:00',
      updateTime: '2026-04-02T08:55:00',
    },
    {
      id: 2,
      documentId: 2,
      taskType: 'UPLOAD',
      attemptNo: 1,
      status: 'FAILED',
      agentDocId: 'demo-doc-2',
      chunkCount: 0,
      failureReason: '首次解析时出现文档索引超时。',
      createBy: 'demo',
      startedAt: '2026-04-02T08:58:00',
      finishedAt: '2026-04-02T09:00:00',
      createTime: '2026-04-02T08:58:00',
      updateTime: '2026-04-02T09:00:00',
    },
    {
      id: 3,
      documentId: 2,
      taskType: 'RETRY',
      attemptNo: 2,
      status: 'SUCCESS',
      agentDocId: 'demo-doc-2',
      chunkCount: 12,
      createBy: 'demo',
      startedAt: '2026-04-02T09:02:00',
      finishedAt: '2026-04-02T09:05:00',
      createTime: '2026-04-02T09:02:00',
      updateTime: '2026-04-02T09:05:00',
    },
    {
      id: 4,
      documentId: 3,
      taskType: 'UPLOAD',
      attemptNo: 1,
      status: 'FAILED',
      agentDocId: 'demo-doc-3',
      chunkCount: 0,
      failureReason: '演示模式下保留一条失败样例，便于核对失败态 UI。',
      createBy: 'demo',
      startedAt: '2026-04-02T09:10:00',
      finishedAt: '2026-04-02T09:12:00',
      createTime: '2026-04-02T09:10:00',
      updateTime: '2026-04-02T09:12:00',
    },
  ];

  return {
    projects,
    pipelines,
    pumpStations,
    oilProperties,
    histories,
    knowledgeDocuments,
    knowledgeTasks,
    nextIds: {
      project: 4,
      pipeline: 302,
      pumpStation: 4,
      oilProperty: 4,
      history: 5,
      knowledgeDocument: 4,
      knowledgeTask: 5,
    },
  };
}

function persistStore(store: DemoStore) {
  memoryStore = store;
  const storage = getStorage();
  if (!storage) {
    return;
  }
  storage.setItem(DEMO_STORE_KEY, JSON.stringify(store));
}

function getStore(): DemoStore {
  if (memoryStore) {
    return memoryStore;
  }

  const storage = getStorage();
  if (storage) {
    const raw = storage.getItem(DEMO_STORE_KEY);
    if (raw) {
      try {
        memoryStore = JSON.parse(raw) as DemoStore;
        return memoryStore;
      } catch {
        storage.removeItem(DEMO_STORE_KEY);
      }
    }
  }

  const initialStore = createInitialStore();
  persistStore(initialStore);
  return initialStore;
}

function updateStore<T>(updater: (store: DemoStore) => T): T {
  const store = getStore();
  const result = updater(store);
  persistStore(store);
  return result;
}

function getProjectName(store: DemoStore, projectId?: number) {
  if (typeof projectId !== 'number') {
    return '未命名项目';
  }
  return store.projects.find((item) => item.proId === projectId)?.name ?? `项目 ${projectId}`;
}

function buildPageResult<T>(
  records: T[],
  params?: {
    pageNum?: number;
    pageSize?: number;
  },
): PageResult<T> {
  const pageNum = Math.max(1, toFiniteNumber(params?.pageNum) ?? 1);
  const pageSize = Math.max(1, toFiniteNumber(params?.pageSize) ?? 10);
  const start = (pageNum - 1) * pageSize;
  const list = records.slice(start, start + pageSize);
  return {
    list,
    total: records.length,
    pageNum,
    pageSize,
  };
}

function normalizeRoughness(value: number) {
  if (value > 1) {
    return value / 1000;
  }
  if (value > 0.01) {
    return value / 100;
  }
  return value;
}

function determineFlowRegime(reynoldsNumber: number) {
  if (reynoldsNumber < 2300) {
    return '层流';
  }
  if (reynoldsNumber < 4000) {
    return '过渡流';
  }
  return '湍流';
}

function computeHydraulicResult(params: HydraulicAnalysisParams): HydraulicAnalysisResult {
  const flowRate = Math.max(params.flowRate ?? 0, 1);
  const diameter = Math.max(params.diameter ?? 0, 80);
  const thickness = Math.max(params.thickness ?? 0, 1);
  const innerDiameterMeters = Math.max(diameter - thickness * 2, 60) / 1000;
  const area = Math.PI * innerDiameterMeters * innerDiameterMeters / 4;
  const viscosity = Math.max(params.viscosity ?? 0, 0.000001);
  const velocity = flowRate / 3600 / Math.max(area, 0.0001);
  const reynoldsNumber = round((velocity * innerDiameterMeters) / viscosity, 0);
  const roughnessImpact = normalizeRoughness(Math.max(params.roughness ?? 0, 0)) * 1200;
  const frictionHeadLoss = round(
    Math.max(
      (params.length ?? 0) * 0.06 +
        flowRate / 350 +
        (params.viscosity ?? 0) * 60000 +
        roughnessImpact -
        diameter / 120,
      4,
    ),
    2,
  );
  const totalHead = round(
    (((params.pump480Num ?? 0) * (params.pump480Head ?? 0)) +
      ((params.pump375Num ?? 0) * (params.pump375Head ?? 0))) /
      20,
    2,
  );
  const firstStationOutPressure = round((params.inletPressure ?? 0) + totalHead * 0.28, 2);
  const altitudePenalty = Math.max(((params.endAltitude ?? 0) - (params.startAltitude ?? 0)) / 40, -2);
  const endStationInPressure = round(firstStationOutPressure - frictionHeadLoss * 0.65 - altitudePenalty, 2);
  const hydraulicSlope = round(frictionHeadLoss / Math.max((params.length ?? 1) * 10, 1), 4);

  return {
    frictionHeadLoss,
    reynoldsNumber,
    flowRegime: determineFlowRegime(reynoldsNumber),
    hydraulicSlope,
    totalHead,
    firstStationOutPressure,
    endStationInPressure,
  };
}

function createHydraulicHistory(
  store: DemoStore,
  payload: HydraulicAnalysisParams,
  result: HydraulicAnalysisResult,
  remark: string,
) {
  const historyId = store.nextIds.history++;
  const history: CalculationHistory = {
    id: historyId,
    calcType: 'HYDRAULIC',
    calcTypeName: '水力分析',
    projectId: payload.projectId,
    projectName: getProjectName(store, payload.projectId),
    userId: 1,
    userName: 'demo',
    inputParams: JSON.stringify(payload),
    outputResult: JSON.stringify(result),
    status: 1,
    statusName: '已完成',
    remark,
    createTime: nowIso(),
  };
  store.histories.unshift(history);
  return history;
}

type OptimizationCandidate = {
  pump480Num: number;
  pump375Num: number;
  totalHead: number;
  totalPressureDrop: number;
  endStationInPressure: number;
  isFeasible: boolean;
};

function evaluateOptimizationCandidate(
  params: OptimizationParams,
  pump480Num: number,
  pump375Num: number,
): OptimizationCandidate {
  const frictionDrop = round(
    Math.max(
      (params.length ?? 0) * 0.055 +
        (params.flowRate ?? 0) / 380 +
        normalizeRoughness(Math.max(params.roughness ?? 0, 0)) * 1000 -
        (params.diameter ?? 0) / 140,
      3,
    ),
    2,
  );
  const altitudeDrop = Math.max(((params.endAltitude ?? 0) - (params.startAltitude ?? 0)) / 35, 0);
  const totalPressureDrop = round(frictionDrop + altitudeDrop, 2);
  const totalHead = round(
    (pump480Num * (params.pump480Head ?? 0) + pump375Num * (params.pump375Head ?? 0)) / 20,
    2,
  );
  const endStationInPressure = round(
    (params.inletPressure ?? 0) + totalHead * 0.28 - totalPressureDrop * 0.55,
    2,
  );
  return {
    pump480Num,
    pump375Num,
    totalHead,
    totalPressureDrop,
    endStationInPressure,
    isFeasible: endStationInPressure > 1,
  };
}

function computeOptimizationResult(params: OptimizationParams): OptimizationResult {
  const candidates: OptimizationCandidate[] = [];
  for (let pump480Num = 0; pump480Num <= 3; pump480Num += 1) {
    for (let pump375Num = 0; pump375Num <= 3; pump375Num += 1) {
      if (pump480Num === 0 && pump375Num === 0) {
        continue;
      }
      candidates.push(evaluateOptimizationCandidate(params, pump480Num, pump375Num));
    }
  }

  const feasibleCandidates = candidates.filter((item) => item.isFeasible);
  const bestCandidate =
    feasibleCandidates.sort((left, right) => {
      if (left.totalHead !== right.totalHead) {
        return left.totalHead - right.totalHead;
      }
      return left.endStationInPressure - right.endStationInPressure;
    })[0] ??
    candidates.sort((left, right) => right.endStationInPressure - left.endStationInPressure)[0];

  const efficiency = Math.max(params.pumpEfficiency ?? 0.8, 0.1) * Math.max(params.motorEfficiency ?? 0.9, 0.1);
  const annualHours = Math.max(params.workingDays ?? 350, 1) * 24;
  const totalEnergyConsumption = round(
    ((params.flowRate ?? 0) * bestCandidate.totalHead * annualHours * 0.0018) / efficiency,
    2,
  );
  const totalCost = round(totalEnergyConsumption * Math.max(params.electricityPrice ?? 0.8, 0), 2);
  const description = bestCandidate.isFeasible
    ? `建议采用 ${bestCandidate.pump480Num} 台 ZMI480 + ${bestCandidate.pump375Num} 台 ZMI375 的组合，在满足末站压力约束的前提下兼顾能耗与成本。`
    : '当前参数下未找到满足末站压力约束的组合，建议提高进站压头或降低输量后重新评估。';

  return {
    pump480Num: bestCandidate.pump480Num,
    pump375Num: bestCandidate.pump375Num,
    totalHead: bestCandidate.totalHead,
    totalPressureDrop: bestCandidate.totalPressureDrop,
    endStationInPressure: bestCandidate.endStationInPressure,
    isFeasible: bestCandidate.isFeasible,
    totalEnergyConsumption,
    totalCost,
    description,
  };
}

function createOptimizationHistory(
  store: DemoStore,
  payload: OptimizationParams,
  result: OptimizationResult,
  remark: string,
) {
  const historyId = store.nextIds.history++;
  const history: CalculationHistory = {
    id: historyId,
    calcType: 'OPTIMIZATION',
    calcTypeName: '泵站优化',
    projectId: payload.projectId,
    projectName: getProjectName(store, payload.projectId),
    userId: 1,
    userName: 'demo',
    inputParams: JSON.stringify(payload),
    outputResult: JSON.stringify(result),
    status: 1,
    statusName: '已完成',
    remark,
    createTime: nowIso(),
  };
  store.histories.unshift(history);
  return history;
}

function adjustValueByVariable(
  params: HydraulicAnalysisParams,
  variableType: string,
  changePercent: number,
) {
  const multiplier = 1 + changePercent / 100;
  const nextParams = { ...params };
  switch (variableType) {
    case 'FLOW_RATE':
      nextParams.flowRate = round(Math.max((params.flowRate ?? 0) * multiplier, 1), 2);
      return { nextParams, variableValue: nextParams.flowRate };
    case 'VISCOSITY':
      nextParams.viscosity = round(Math.max((params.viscosity ?? 0) * multiplier, 0.000001), 8);
      return { nextParams, variableValue: nextParams.viscosity };
    case 'ROUGHNESS':
      nextParams.roughness = round(Math.max((params.roughness ?? 0) * multiplier, 0.000001), 6);
      return { nextParams, variableValue: nextParams.roughness };
    case 'DIAMETER':
      nextParams.diameter = round(Math.max((params.diameter ?? 0) * multiplier, 60), 2);
      return { nextParams, variableValue: nextParams.diameter };
    case 'INLET_PRESSURE':
      nextParams.inletPressure = round(Math.max((params.inletPressure ?? 0) * multiplier, 0), 2);
      return { nextParams, variableValue: nextParams.inletPressure };
    default:
      return {
        nextParams,
        variableValue: 0,
      };
  }
}

function computeQuickSensitivityResult(
  variableType: string,
  params: HydraulicAnalysisParams,
): SensitivityResult {
  const variableInfo =
    SENSITIVITY_VARIABLES.find((item) => item.code === variableType) ?? SENSITIVITY_VARIABLES[0];
  const baseResult = computeHydraulicResult(params);
  const points: SensitivityPoint[] = [];
  const baseValue = (() => {
    switch (variableInfo.code) {
      case 'FLOW_RATE':
        return params.flowRate;
      case 'VISCOSITY':
        return params.viscosity;
      case 'ROUGHNESS':
        return params.roughness;
      case 'DIAMETER':
        return params.diameter;
      case 'INLET_PRESSURE':
        return params.inletPressure;
      default:
        return 0;
    }
  })();

  for (let percent = variableInfo.minChangePercent; percent <= variableInfo.maxChangePercent; percent += 5) {
    const { nextParams, variableValue } = adjustValueByVariable(params, variableInfo.code, percent);
    const fullResult = computeHydraulicResult(nextParams);
    const frictionChangePercent = baseResult.frictionHeadLoss
      ? round(((fullResult.frictionHeadLoss - baseResult.frictionHeadLoss) / baseResult.frictionHeadLoss) * 100, 2)
      : 0;
    const pressureChangePercent = baseResult.endStationInPressure
      ? round(((fullResult.endStationInPressure - baseResult.endStationInPressure) / Math.abs(baseResult.endStationInPressure)) * 100, 2)
      : 0;
    points.push({
      changePercent: percent,
      variableValue,
      frictionHeadLoss: fullResult.frictionHeadLoss,
      frictionChangePercent,
      endStationPressure: fullResult.endStationInPressure,
      pressureChangePercent,
      hydraulicSlope: fullResult.hydraulicSlope,
      reynoldsNumber: fullResult.reynoldsNumber,
      flowRegime: fullResult.flowRegime,
      fullResult,
    });
  }

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const trend =
    lastPoint.endStationPressure > firstPoint.endStationPressure
      ? 'POSITIVE'
      : lastPoint.endStationPressure < firstPoint.endStationPressure
        ? 'NEGATIVE'
        : 'MIXED';
  const maxImpactPercent = round(
    Math.max(...points.map((item) => Math.abs(item.pressureChangePercent))),
    2,
  );
  const sensitivityCoefficient = round(maxImpactPercent / Math.max(variableInfo.maxChangePercent, 1), 2);

  const variableResult: VariableSensitivityResult = {
    variableType: variableInfo.code,
    variableName: variableInfo.name,
    unit: variableInfo.unit,
    baseValue: baseValue ?? 0,
    dataPoints: points,
    sensitivityCoefficient,
    trend,
    maxImpactPercent,
  };

  return {
    baseResult,
    variableResults: [variableResult],
    sensitivityRanking: [
      {
        rank: 1,
        variableType: variableInfo.code,
        variableName: variableInfo.name,
        sensitivityCoefficient,
        description: `${variableInfo.name} 对末站压力的影响最显著。`,
      },
    ],
    duration: 160,
    totalCalculations: points.length,
  };
}

function createSensitivityHistory(
  store: DemoStore,
  variableType: string,
  payload: HydraulicAnalysisParams,
  result: SensitivityResult,
) {
  const variableInfo =
    SENSITIVITY_VARIABLES.find((item) => item.code === variableType) ?? SENSITIVITY_VARIABLES[0];
  const historyId = store.nextIds.history++;
  const history: CalculationHistory = {
    id: historyId,
    calcType: 'SENSITIVITY',
    calcTypeName: '敏感性分析',
    projectId: payload.projectId,
    projectName: getProjectName(store, payload.projectId),
    userId: 1,
    userName: 'demo',
    inputParams: JSON.stringify({
      projectId: payload.projectId,
      analysisType: 'SINGLE',
      baseParams: payload,
      variables: [
        {
          variableType: variableInfo.code,
          variableName: variableInfo.name,
          unit: variableInfo.unit,
          startPercent: variableInfo.minChangePercent,
          endPercent: variableInfo.maxChangePercent,
          stepPercent: 5,
        },
      ],
    }),
    outputResult: JSON.stringify(result),
    status: 1,
    statusName: '已完成',
    remark: `${variableInfo.name} 是当前演示样例中的重点敏感变量。`,
    createTime: nowIso(),
  };
  store.histories.unshift(history);
  return history;
}

function buildKnowledgeSummary(document: KnowledgeDocument): KnowledgeDocumentSummary {
  return {
    doc_id: document.agentDocId || `demo-doc-${document.id}`,
    title: document.title,
    source: document.sourceType,
    category: document.category || 'faq',
    tags: (document.tags || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    file_name: document.fileName,
    file_type: document.fileExtension,
    file_size_bytes: document.fileSize || 0,
    source_type: document.sourceType,
    status: statusToAgentStatus(document.status),
    created_at: document.createTime,
    updated_at: document.updateTime,
    summary: document.remark,
  };
}

function createKnowledgeDocumentFromFormData(
  store: DemoStore,
  formData: FormData,
  options?: {
    sourceType?: string;
    tags?: string;
  },
) {
  const file = formData.get('file');
  const title = String(formData.get('title') || (file instanceof File ? file.name.replace(/\.[^.]+$/, '') : '未命名文档'));
  const category = String(formData.get('category') || 'faq');
  const documentId = store.nextIds.knowledgeDocument++;
  const timestamp = nowIso();
  const document: KnowledgeDocument = {
    id: documentId,
    title,
    category,
    sourceType: options?.sourceType || 'manual',
    tags: options?.tags ?? '',
    fileName: file instanceof File ? file.name : `demo-document-${documentId}.txt`,
    fileExtension: file instanceof File ? file.name.split('.').pop() || 'txt' : 'txt',
    fileSize: file instanceof File ? file.size : 0,
    fileHash: `demo-hash-${documentId}`,
    storageType: 'DEMO',
    storageBucket: 'demo-bucket',
    storageObjectKey: `knowledge/demo/${documentId}-${Date.now()}`,
    agentDocId: `demo-doc-${documentId}`,
    chunkCount: Math.max(4, Math.round((file instanceof File ? file.size : 20480) / 180000)),
    retryCount: 0,
    status: 'INDEXED',
    lastIngestTime: timestamp,
    createBy: 'demo',
    createTime: timestamp,
    updateTime: timestamp,
  };

  const taskId = store.nextIds.knowledgeTask++;
  const task: KnowledgeIngestTask = {
    id: taskId,
    documentId,
    taskType: 'UPLOAD',
    attemptNo: 1,
    status: 'SUCCESS',
    agentDocId: document.agentDocId,
    chunkCount: document.chunkCount,
    createBy: 'demo',
    startedAt: timestamp,
    finishedAt: timestamp,
    createTime: timestamp,
    updateTime: timestamp,
  };

  store.knowledgeDocuments.unshift(document);
  store.knowledgeTasks.unshift(task);
  return document;
}

function buildKnowledgeStats(documents: KnowledgeDocument[]): KnowledgeStatsPayload {
  return {
    total_documents: documents.length,
    documents_by_category: documents.reduce<Record<string, number>>((acc, item) => {
      const key = item.category || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    collection_name: 'pipeline-demo-knowledge',
    total_chunks: documents.reduce((acc, item) => acc + (item.chunkCount || 0), 0),
    index_exists: true,
    knowledge_root: 'demo://knowledge',
  };
}

function buildGraphQueryPayload(query: string): KnowledgeGraphQueryPayload {
  const nodes = [
    { id: 'project-energy', name: '项目能耗', type: 'topic' },
    { id: 'pump-station', name: '泵站组合', type: 'entity' },
    { id: 'pressure-drop', name: '压力损失', type: 'metric' },
  ];
  return {
    query,
    result: {
      message: `已在演示知识图谱中检索到与“${query}”相关的 3 个节点。`,
      total_matches: nodes.length,
      center_node: nodes[0].id,
      matched_nodes: nodes,
      visualization: {
        nodes,
        edges: [
          { source: 'project-energy', target: 'pump-station', type: 'related' },
          { source: 'pump-station', target: 'pressure-drop', type: 'influences' },
        ],
      },
    },
  };
}

function buildKnowledgeSearchDebugPayload(
  request: KnowledgeSearchDebugRequest,
  documents: KnowledgeDocument[],
): KnowledgeSearchDebugPayload {
  const summaries = documents.slice(0, 3).map((item, index) => ({
    chunk_id: `chunk-${item.id}-${index + 1}`,
    doc_id: item.agentDocId || `demo-doc-${item.id}`,
    doc_title: item.title,
    source: item.sourceType || 'manual',
    category: item.category || 'faq',
    content_preview: `${item.title} 与 ${request.query} 相关的演示内容片段。`,
    full_text_preview: `${item.title}：这是为演示模式准备的检索结果，用于验证前端调试视图。`,
    score: round(0.92 - index * 0.12, 2),
    match_type: index === 0 ? 'hybrid' : 'dense',
  }));

  return {
    query: request.query,
    top_k: request.top_k,
    category_filter: request.category || null,
    dense_results: summaries,
    sparse_results: summaries.slice(0, 2),
    hybrid_results: summaries,
    rerank_results: summaries.map((item, index) => ({
      ...item,
      original_score: item.score,
      rerank_score: round(item.score - 0.03, 2),
      final_score: round(item.score - index * 0.01, 2),
      context_preview: item.full_text_preview,
      full_text_preview: item.full_text_preview || item.content_preview,
    })),
    debug: {
      use_hybrid: true,
      sparse_enabled: true,
      sparse_index_built: true,
      dense_weight: 0.6,
      sparse_weight: 0.4,
      dense_candidates: 8,
      sparse_candidates: 5,
      hybrid_candidates: 5,
      dense_duration_ms: 12,
      sparse_duration_ms: 7,
      fusion_duration_ms: 4,
      total_duration_ms: 23,
    },
    rerank_debug: {
      reranker_class: 'demo-reranker',
      reranker_threshold: 0.35,
      reranker_enabled: true,
      rerank_candidates_before: summaries.length,
      rerank_candidates_after: summaries.length,
      rerank_duration_ms: 9,
      contextual_enabled: true,
      contextual_results: summaries.length,
    },
  };
}

function stripChatPrefix(message: string) {
  const marker = '用户问题：';
  if (message.includes(marker)) {
    return message.split(marker).pop()?.trim() || message.trim();
  }
  return message.trim();
}

export function buildDemoAssistantReply(message: string) {
  const question = stripChatPrefix(message);
  if (!question) {
    return '演示模式下未收到有效问题。你可以继续询问项目、管道、泵站、能耗或优化相关内容。';
  }

  if (question.includes('优化') || question.includes('节能')) {
    return [
      '这是演示模式下的本地回复。',
      `针对“${question}”，建议优先检查泵站组合、单位输量能耗和末站压力裕度。`,
      '可执行动作：',
      '1. 先对比最近一周高负荷时段的泵站启停策略。',
      '2. 对末站压力偏低的管段提高监测频率，避免在高摩阻工况下持续满负荷运行。',
      '3. 在满足输量约束的前提下，优先选择更低总扬程的可行组合。',
    ].join('\n');
  }

  if (question.includes('压力') || question.includes('水力')) {
    return [
      '这是演示模式下的本地回复。',
      `针对“${question}”，当前应重点关注摩阻损失、海拔落差和进站压头三个因素。`,
      '一般判断顺序是：先看末站压力是否为正，再看摩阻损失占总扬程的比例，最后检查油品粘度和管径是否放大了压降。',
    ].join('\n');
  }

  return [
    '这是演示模式下的本地回复。',
    `已收到你的问题：${question}`,
    '当前前端不会访问真实 AI 服务，而是直接返回本地示例结论，方便你验证聊天、知识库和报告工作台的交互流程。',
  ].join('\n');
}

export function isDemoModeToken(token: string | null | undefined) {
  return token === DEMO_TOKEN;
}

export function isDemoModeActive() {
  return isDemoModeToken(useUserStore.getState().token);
}

export async function handleDemoHttpRequest<T>(
  method: HttpMethod,
  url: string,
  data?: unknown,
  config?: DemoRequestConfig,
): Promise<T> {
  const parsedUrl = new URL(url, 'https://demo.local');
  const path = parsedUrl.pathname;
  const params = config?.params ?? {};

  if (method === 'GET' && path === '/project/list') {
    return success(clone(getStore().projects), '获取项目列表成功') as T;
  }

  if (method === 'GET' && /^\/project\/\d+$/.test(path)) {
    const id = Number(path.split('/').pop());
    const project = getStore().projects.find((item) => item.proId === id);
    return success(clone(project ?? null), '获取项目成功') as T;
  }

  if (method === 'POST' && path === '/project') {
    return updateStore((store) => {
      const payload = (data as Partial<Project>) ?? {};
      const project: Project = {
        proId: store.nextIds.project++,
        number:
          payload.number?.trim() ||
          `P-${new Date().getFullYear()}-${String(store.nextIds.project + 996).slice(-3)}`,
        name: payload.name?.trim() || `演示项目 ${store.nextIds.project}`,
        responsible: payload.responsible?.trim() || '演示用户',
        buildDate: payload.buildDate,
        createTime: nowIso(),
        updateTime: nowIso(),
      };
      store.projects.unshift(project);
      return success(true, '新增项目成功') as T;
    });
  }

  if (method === 'PUT' && path === '/project') {
    return updateStore((store) => {
      const payload = (data as Partial<Project>) ?? {};
      const target = store.projects.find((item) => item.proId === payload.proId);
      if (target) {
        Object.assign(target, payload, { updateTime: nowIso() });
      }
      return success(true, '更新项目成功') as T;
    });
  }

  if (method === 'DELETE' && /^\/project\/.+$/.test(path)) {
    const ids = parseNumberList(path.replace('/project/', ''));
    return updateStore((store) => {
      store.projects = store.projects.filter((item) => !ids.includes(item.proId));
      store.pipelines = store.pipelines.filter((item) => !ids.includes(item.proId));
      store.histories = store.histories.filter((item) => !ids.includes(item.projectId ?? -1));
      return success(true, '删除项目成功') as T;
    });
  }

  if (method === 'GET' && /^\/pipeline\/list\/\d+$/.test(path)) {
    const projectId = Number(path.split('/').pop());
    const pipelines = getStore().pipelines
      .filter((item) => item.proId === projectId)
      .sort((left, right) => left.id - right.id);
    return success(clone(pipelines), '获取管道列表成功') as T;
  }

  if (method === 'GET' && /^\/pipeline\/\d+$/.test(path)) {
    const id = Number(path.split('/').pop());
    const pipeline = getStore().pipelines.find((item) => item.id === id);
    return success(clone(pipeline ?? null), '获取管道成功') as T;
  }

  if (method === 'POST' && path === '/pipeline') {
    return updateStore((store) => {
      const payload = (data as Partial<Pipeline>) ?? {};
      const pipeline: Pipeline = {
        id: store.nextIds.pipeline++,
        proId: payload.proId ?? store.projects[0]?.proId ?? 1,
        name: payload.name?.trim() || `演示管道 ${store.nextIds.pipeline}`,
        length: payload.length ?? 120,
        diameter: payload.diameter ?? 610,
        thickness: payload.thickness ?? 10,
        throughput: payload.throughput ?? 2200,
        startAltitude: payload.startAltitude ?? 0,
        endAltitude: payload.endAltitude ?? 0,
        roughness: payload.roughness ?? 0.12,
        workTime: payload.workTime,
        createTime: nowIso(),
        updateTime: nowIso(),
      };
      store.pipelines.unshift(pipeline);
      return success(true, '新增管道成功') as T;
    });
  }

  if (method === 'PUT' && path === '/pipeline') {
    return updateStore((store) => {
      const payload = (data as Partial<Pipeline>) ?? {};
      const target = store.pipelines.find((item) => item.id === payload.id);
      if (target) {
        Object.assign(target, payload, { updateTime: nowIso() });
      }
      return success(true, '更新管道成功') as T;
    });
  }

  if (method === 'DELETE' && /^\/pipeline\/.+$/.test(path)) {
    const ids = parseNumberList(path.replace('/pipeline/', ''));
    return updateStore((store) => {
      store.pipelines = store.pipelines.filter((item) => !ids.includes(item.id));
      return success(true, '删除管道成功') as T;
    });
  }

  if (method === 'GET' && path === '/pump-station/list') {
    return success(clone(getStore().pumpStations), '获取泵站列表成功') as T;
  }

  if (method === 'GET' && /^\/pump-station\/\d+$/.test(path)) {
    const id = Number(path.split('/').pop());
    const station = getStore().pumpStations.find((item) => item.id === id);
    return success(clone(station ?? null), '获取泵站成功') as T;
  }

  if (method === 'POST' && path === '/pump-station') {
    return updateStore((store) => {
      const payload = (data as Partial<PumpStation>) ?? {};
      const station: PumpStation = {
        id: store.nextIds.pumpStation++,
        name: payload.name?.trim() || `演示泵站 ${store.nextIds.pumpStation}`,
        pumpEfficiency: payload.pumpEfficiency ?? 82,
        electricEfficiency: payload.electricEfficiency ?? 91,
        displacement: payload.displacement ?? 2800,
        comePower: payload.comePower ?? 6.2,
        zmi480Lift: payload.zmi480Lift ?? 470,
        zmi375Lift: payload.zmi375Lift ?? 368,
        createTime: nowIso(),
        updateTime: nowIso(),
      };
      store.pumpStations.unshift(station);
      return success(true, '新增泵站成功') as T;
    });
  }

  if (method === 'PUT' && path === '/pump-station') {
    return updateStore((store) => {
      const payload = (data as Partial<PumpStation>) ?? {};
      const target = store.pumpStations.find((item) => item.id === payload.id);
      if (target) {
        Object.assign(target, payload, { updateTime: nowIso() });
      }
      return success(true, '更新泵站成功') as T;
    });
  }

  if (method === 'DELETE' && /^\/pump-station\/.+$/.test(path)) {
    const ids = parseNumberList(path.replace('/pump-station/', ''));
    return updateStore((store) => {
      store.pumpStations = store.pumpStations.filter((item) => !ids.includes(item.id));
      return success(true, '删除泵站成功') as T;
    });
  }

  if (method === 'GET' && path === '/oil-property/list') {
    return success(clone(getStore().oilProperties), '获取油品列表成功') as T;
  }

  if (method === 'GET' && /^\/oil-property\/\d+$/.test(path)) {
    const id = Number(path.split('/').pop());
    const oilProperty = getStore().oilProperties.find((item) => item.id === id);
    return success(clone(oilProperty ?? null), '获取油品成功') as T;
  }

  if (method === 'POST' && path === '/oil-property') {
    return updateStore((store) => {
      const payload = (data as Partial<OilProperty>) ?? {};
      const oilProperty: OilProperty = {
        id: store.nextIds.oilProperty++,
        name: payload.name?.trim() || `演示油品 ${store.nextIds.oilProperty}`,
        density: payload.density ?? 850,
        viscosity: payload.viscosity ?? 0.00002,
        createTime: nowIso(),
        updateTime: nowIso(),
      };
      store.oilProperties.unshift(oilProperty);
      return success(true, '新增油品成功') as T;
    });
  }

  if (method === 'PUT' && path === '/oil-property') {
    return updateStore((store) => {
      const payload = (data as Partial<OilProperty>) ?? {};
      const target = store.oilProperties.find((item) => item.id === payload.id);
      if (target) {
        Object.assign(target, payload, { updateTime: nowIso() });
      }
      return success(true, '更新油品成功') as T;
    });
  }

  if (method === 'DELETE' && /^\/oil-property\/.+$/.test(path)) {
    const ids = parseNumberList(path.replace('/oil-property/', ''));
    return updateStore((store) => {
      store.oilProperties = store.oilProperties.filter((item) => !ids.includes(item.id));
      return success(true, '删除油品成功') as T;
    });
  }

  if (method === 'GET' && path === '/knowledge-doc/list') {
    return success(sortByCreateTimeDesc(clone(getStore().knowledgeDocuments)), '获取知识文档成功') as T;
  }

  if (method === 'GET' && /^\/knowledge-doc\/\d+\/tasks$/.test(path)) {
    const documentId = Number(path.split('/')[2]);
    const tasks = getStore().knowledgeTasks.filter((item) => item.documentId === documentId);
    return success(sortByCreateTimeDesc(clone(tasks)), '获取任务历史成功') as T;
  }

  if (method === 'POST' && path === '/knowledge-doc/upload' && data instanceof FormData) {
    return updateStore((store) => {
      const document = createKnowledgeDocumentFromFormData(store, data);
      return success(clone(document), '知识文档已接收并完成演示入库') as T;
    });
  }

  if (method === 'POST' && /^\/knowledge-doc\/\d+\/retry$/.test(path)) {
    const documentId = Number(path.split('/')[2]);
    return updateStore((store) => {
      const document = store.knowledgeDocuments.find((item) => item.id === documentId);
      if (document) {
        document.retryCount = (document.retryCount || 0) + 1;
        document.status = 'INDEXED';
        document.failureReason = undefined;
        document.lastIngestTime = nowIso();
        document.updateTime = nowIso();
        const task: KnowledgeIngestTask = {
          id: store.nextIds.knowledgeTask++,
          documentId,
          taskType: 'RETRY',
          attemptNo: document.retryCount + 1,
          status: 'SUCCESS',
          agentDocId: document.agentDocId,
          chunkCount: document.chunkCount,
          createBy: 'demo',
          startedAt: nowIso(),
          finishedAt: nowIso(),
          createTime: nowIso(),
          updateTime: nowIso(),
        };
        store.knowledgeTasks.unshift(task);
      }
      return success(clone(document ?? null), '已重新加入演示入库队列') as T;
    });
  }

  if (method === 'DELETE' && /^\/knowledge-doc\/\d+$/.test(path)) {
    const documentId = Number(path.split('/').pop());
    return updateStore((store) => {
      store.knowledgeDocuments = store.knowledgeDocuments.filter((item) => item.id !== documentId);
      store.knowledgeTasks = store.knowledgeTasks.filter((item) => item.documentId !== documentId);
      return success(true, '删除知识文档成功') as T;
    });
  }

  if (method === 'POST' && path === '/calculation/hydraulic-analysis') {
    return updateStore((store) => {
      const payload = (data as HydraulicAnalysisParams) ?? ({} as HydraulicAnalysisParams);
      const result = computeHydraulicResult(payload);
      createHydraulicHistory(store, payload, result, '演示模式下已自动写入本地历史记录。');
      return success(result, '水力分析完成') as T;
    });
  }

  if (method === 'POST' && path === '/calculation/optimization') {
    return updateStore((store) => {
      const payload = (data as OptimizationParams) ?? ({} as OptimizationParams);
      const result = computeOptimizationResult(payload);
      createOptimizationHistory(store, payload, result, '演示模式下已自动写入本地历史记录。');
      return success(result, '优化计算完成') as T;
    });
  }

  if (method === 'POST' && path === '/calculation/sensitivity/analyze') {
    const payload =
      (data as {
        baseParams?: HydraulicAnalysisParams;
        variables?: Array<{ variableType?: string }>;
      }) ?? {};
    const variableType = payload.variables?.[0]?.variableType || SENSITIVITY_VARIABLES[0].code;
    return updateStore((store) => {
      const result = computeQuickSensitivityResult(
        variableType,
        payload.baseParams ?? ({} as HydraulicAnalysisParams),
      );
      createSensitivityHistory(
        store,
        variableType,
        payload.baseParams ?? ({} as HydraulicAnalysisParams),
        result,
      );
      return success(result, '敏感性分析完成') as T;
    });
  }

  if (method === 'POST' && path === '/calculation/sensitivity/quick-single') {
    const variableType = parsedUrl.searchParams.get('variableType') || SENSITIVITY_VARIABLES[0].code;
    return updateStore((store) => {
      const payload = (data as HydraulicAnalysisParams) ?? ({} as HydraulicAnalysisParams);
      const result = computeQuickSensitivityResult(variableType, payload);
      createSensitivityHistory(store, variableType, payload, result);
      return success(result, '敏感性分析完成') as T;
    });
  }

  if (method === 'GET' && path === '/calculation/sensitivity/variables') {
    return success(clone(SENSITIVITY_VARIABLES), '获取敏感变量成功') as T;
  }

  if (method === 'GET' && path === '/calculation/history/page') {
    const calcType = typeof params.calcType === 'string' ? params.calcType.trim().toUpperCase() : '';
    const projectId = toFiniteNumber(params.projectId);
    const status = toFiniteNumber(params.status);
    const keyword = typeof params.keyword === 'string' ? params.keyword.trim().toLowerCase() : '';
    const histories = sortByCreateTimeDesc(
      getStore().histories.filter((item) => {
        if (calcType && item.calcType?.toUpperCase() !== calcType) {
          return false;
        }
        if (projectId !== null && item.projectId !== projectId) {
          return false;
        }
        if (status !== null && item.status !== status) {
          return false;
        }
        if (keyword) {
          const text = [
            item.projectName,
            item.calcTypeName,
            item.calcType,
            item.remark,
            item.errorMessage,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!text.includes(keyword)) {
            return false;
          }
        }
        return true;
      }),
    );
    return success(buildPageResult(clone(histories), params), '获取计算历史成功') as T;
  }

  if (method === 'GET' && /^\/calculation\/history\/project\/\d+$/.test(path)) {
    const projectId = Number(path.split('/').pop());
    const calcType = typeof params.calcType === 'string' ? params.calcType.trim().toUpperCase() : '';
    const histories = sortByCreateTimeDesc(
      getStore().histories.filter((item) => {
        if (item.projectId !== projectId) {
          return false;
        }
        if (calcType && item.calcType?.toUpperCase() !== calcType) {
          return false;
        }
        return true;
      }),
    );
    return success(buildPageResult(clone(histories), params), '获取项目计算历史成功') as T;
  }

  if (method === 'GET' && /^\/calculation\/history\/\d+$/.test(path)) {
    const historyId = Number(path.split('/').pop());
    const history = getStore().histories.find((item) => item.id === historyId) ?? null;
    return success(clone(history), '获取历史详情成功') as T;
  }

  if (method === 'DELETE' && /^\/calculation\/history\/\d+$/.test(path)) {
    const historyId = Number(path.split('/').pop());
    return updateStore((store) => {
      store.histories = store.histories.filter((item) => item.id !== historyId);
      return success(undefined as void, '删除历史记录成功') as T;
    });
  }

  if (method === 'POST' && path === '/calculation/history/batch-delete') {
    const ids = Array.isArray(data)
      ? data.map((item) => Number(item)).filter((item) => Number.isFinite(item))
      : [];
    return updateStore((store) => {
      const before = store.histories.length;
      store.histories = store.histories.filter((item) => !ids.includes(item.id));
      return success(before - store.histories.length, '批量删除成功') as T;
    });
  }

  if (method === 'POST' && path === '/calculation/history/report') {
    return updateStore((store) => {
      const payload = (data as SaveReportRequest) ?? ({} as SaveReportRequest);
      const historyId = store.nextIds.history++;
      const history: CalculationHistory = {
        id: historyId,
        calcType: 'AI_REPORT',
        calcTypeName: payload.reportTypeLabel || '智能报告',
        projectId: payload.selectedProjectIds?.[0],
        projectName: payload.projectNames?.join('、') || '演示项目',
        userId: 1,
        userName: 'demo',
        inputParams: JSON.stringify(payload),
        outputResult: JSON.stringify(payload.result ?? {}),
        status: 1,
        statusName: '已完成',
        remark: payload.result?.conclusion || '演示模式下生成的本地报告归档记录。',
        createTime: nowIso(),
      };
      store.histories.unshift(history);
      return success(clone(history), '智能报告已归档') as T;
    });
  }

  if (method === 'GET' && path === '/calculation/statistics/overview') {
    const store = getStore();
    return success(
      {
        projectCount: store.projects.length,
        pipelineCount: store.pipelines.length,
        pumpStationCount: store.pumpStations.length,
        oilPropertyCount: store.oilProperties.length,
        historyCount: store.histories.length,
      },
      '获取统计概览成功',
    ) as T;
  }

  if (method === 'GET' && path === '/calculation/statistics/trend/daily') {
    const histories = sortByCreateTimeDesc(getStore().histories).slice(0, 7).reverse();
    return success(
      histories.map((item, index) => ({
        date: item.createTime?.slice(0, 10) || `Day-${index + 1}`,
        count: index + 1,
      })),
      '获取趋势数据成功',
    ) as T;
  }

  throw new Error(`演示模式暂未实现接口: ${method} ${path}`);
}

export async function handleDemoAgentRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const parsedUrl = new URL(path, 'https://demo.local');
  const pathname = parsedUrl.pathname;

  if (pathname === '/chat' && init?.method === 'POST') {
    const payload = readJsonBody<{ message?: string; session_id?: string }>(init.body);
    return {
      response: buildDemoAssistantReply(payload?.message || ''),
      session_id: payload?.session_id || `demo-session-${Date.now()}`,
      trace_id: `demo-trace-${Date.now()}`,
    } as T;
  }

  if (pathname === '/chat/confirm' && init?.method === 'POST') {
    const payload = readJsonBody<{ selected_option?: string }>(init.body);
    return {
      response: `演示模式已确认选项：${payload?.selected_option || '默认选项'}。`,
    } as T;
  }

  if (/^\/trace\/.+$/.test(pathname)) {
    return {
      trace_id: pathname.split('/').pop(),
      status: 'completed',
      message: '演示模式下未连接真实链路跟踪服务。',
    } as T;
  }

  if (pathname === '/graph/query') {
    const query = parsedUrl.searchParams.get('query') || '';
    return buildGraphQueryPayload(query) as T;
  }

  if (pathname === '/knowledge/baseline') {
    const baseline: KnowledgeStageBaseline = {
      supported_file_types: ['pdf', 'docx', 'md', 'txt'],
      required_metadata_fields: ['title', 'category'],
      minimal_pipeline: ['文件上传', '文本切片', '向量写入', '索引登记'],
      module_boundaries: {
        frontend: ['上传页面', '任务历史', '状态展示'],
        backend: ['文档登记', '任务调度', '向量索引'],
      },
    };
    return baseline as T;
  }

  if (pathname === '/knowledge/documents' && (!init?.method || init.method === 'GET')) {
    const statusFilter = parsedUrl.searchParams.get('status') || '';
    const categoryFilter = parsedUrl.searchParams.get('category') || '';
    const documents = getStore().knowledgeDocuments
      .filter((item) => !statusFilter || statusToAgentStatus(item.status) === statusFilter)
      .filter((item) => !categoryFilter || item.category === categoryFilter)
      .map(buildKnowledgeSummary);
    const payload: KnowledgeDocumentListPayload = {
      documents,
      total: documents.length,
    };
    return payload as T;
  }

  if (pathname === '/knowledge/stats') {
    return buildKnowledgeStats(getStore().knowledgeDocuments) as T;
  }

  if (
    pathname === '/knowledge/documents/upload' &&
    init?.method === 'POST' &&
    init.body instanceof FormData
  ) {
    const formData = init.body;
    return updateStore((store) => {
      const title = String(formData.get('title') || '未命名文档');
      const tagsValue = String(formData.get('tags') || '');
      const document = createKnowledgeDocumentFromFormData(store, formData, {
        sourceType: String(formData.get('source') || 'manual'),
        tags: tagsValue,
      });
      document.title = title || document.title;
      document.tags = tagsValue;
      const response: KnowledgeUploadResponse = {
        success: true,
        document: buildKnowledgeSummary(document),
        message: '演示知识文档已写入本地示例库',
      };
      return response as T;
    });
  }

  if (/^\/knowledge\/documents\/.+$/.test(pathname) && init?.method === 'DELETE') {
    const docId = decodeURIComponent(pathname.split('/').pop() || '');
    return updateStore((store) => {
      const document = store.knowledgeDocuments.find(
        (item) => (item.agentDocId || `demo-doc-${item.id}`) === docId,
      );
      if (document) {
        store.knowledgeDocuments = store.knowledgeDocuments.filter((item) => item.id !== document.id);
        store.knowledgeTasks = store.knowledgeTasks.filter((item) => item.documentId !== document.id);
      }
      const response: KnowledgeDeleteResponse = {
        success: true,
        doc_id: docId,
        file_deleted: true,
        index_deleted: true,
        message: '演示知识文档已删除',
      };
      return response as T;
    });
  }

  if (pathname === '/knowledge/reindex' && init?.method === 'POST') {
    const payload = readJsonBody<{ recreate?: boolean }>(init.body);
    const response: KnowledgeReindexResponse = {
      success: true,
      recreate: payload?.recreate ?? true,
      documents_indexed: getStore().knowledgeDocuments.length,
      registry_total: getStore().knowledgeDocuments.length,
      message: '演示模式下已完成本地重建索引',
    };
    return response as T;
  }

  if (pathname === '/knowledge/search/debug' && init?.method === 'POST') {
    const payload = readJsonBody<KnowledgeSearchDebugRequest>(init.body) ?? { query: '' };
    return buildKnowledgeSearchDebugPayload(payload, getStore().knowledgeDocuments) as T;
  }

  throw new Error(`演示模式暂未实现 Agent 接口: ${pathname}`);
}
