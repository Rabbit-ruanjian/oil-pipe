import type { DynamicReportResponsePayload } from './agent';

export interface R<T> {
  code: number;
  msg: string;
  data: T;
}

export interface PageQuery {
  pageNum: number;
  pageSize: number;
}

export interface PageResult<T> {
  list: T[];
  total: number;
  pageNum: number;
  pageSize: number;
}

export interface CalculationHistory {
  id: number;
  calcType?: string;
  calcTypeName?: string;
  projectId?: number;
  projectName?: string;
  userId?: number;
  userName?: string;
  inputParams?: string;
  outputResult?: string;
  status?: number;
  statusName?: string;
  errorMessage?: string;
  calcDuration?: number;
  calcDurationFormatted?: string;
  remark?: string;
  createTime?: string;
}

export interface ReportResultPayload {
  source?: 'ai' | 'fallback' | 'history';
  highlights?: string[];
  summary?: string[];
  risks?: unknown[];
  suggestions?: unknown[];
  conclusion?: string;
  rawText?: string;
  report?: DynamicReportResponsePayload | null;
}

export interface SaveReportRequest {
  title: string;
  reportType: string;
  reportTypeLabel: string;
  selectedProjectIds: number[];
  projectNames: string[];
  rangeLabel: string;
  intelligenceLabel: string;
  outputFormat: 'markdown' | 'docx' | 'pdf';
  sourceLabel: string;
  result: ReportResultPayload;
}

export interface LoginParams {
  username: string;
  password: string;
}

export interface LoginResult {
  token: string;
  userId: number;
  username: string;
  nickname: string;
}

export interface UserInfo {
  userId: number;
  username: string;
  nickname: string;
  avatar?: string;
  roles: string[];
}

export interface Project {
  proId: number;
  number: string;
  name: string;
  responsible?: string;
  buildDate?: string;
  createTime?: string;
  updateTime?: string;
  isDeleted?: number;
}

export interface Pipeline {
  id: number;
  proId: number;
  name: string;
  length: number;
  diameter: number;
  thickness: number;
  throughput: number;
  startAltitude: number;
  endAltitude: number;
  roughness?: number;
  workTime?: number;
  createTime?: string;
  updateTime?: string;
}

export interface PumpStation {
  id: number;
  name: string;
  pumpEfficiency: number;
  electricEfficiency: number;
  displacement: number;
  comePower: number;
  zmi480Lift: number;
  zmi375Lift: number;
  createTime?: string;
  updateTime?: string;
}

export interface OilProperty {
  id: number;
  name: string;
  density: number;
  viscosity: number;
  createTime?: string;
  updateTime?: string;
}

export interface KnowledgeDocument {
  id: number;
  title: string;
  category?: string;
  sourceType?: string;
  tags?: string;
  remark?: string;
  author?: string;
  summary?: string;
  language?: string;
  version?: string;
  externalId?: string;
  effectiveAt?: string;
  fileName: string;
  fileExtension?: string;
  fileSize?: number;
  fileHash?: string;
  storageType?: string;
  storageBucket?: string;
  storageObjectKey?: string;
  agentDocId?: string;
  chunkCount?: number;
  retryCount?: number;
  status: string;
  ingestStage?: string;
  progressPercent?: number;
  failureReason?: string;
  lastIngestTime?: string;
  createBy?: string;
  createTime?: string;
  updateTime?: string;
}

export interface KnowledgeIngestTask {
  id: number;
  documentId: number;
  taskType: string;
  attemptNo?: number;
  status: string;
  ingestStage?: string;
  progressPercent?: number;
  agentDocId?: string;
  chunkCount?: number;
  failureReason?: string;
  createBy?: string;
  startedAt?: string;
  finishedAt?: string;
  createTime?: string;
  updateTime?: string;
}

export interface HydraulicAnalysisParams {
  projectId?: number;
  pipelineId?: number;
  oilId?: number;
  flowRate: number;
  density: number;
  viscosity: number;
  length: number;
  diameter: number;
  thickness: number;
  roughness: number;
  startAltitude: number;
  endAltitude: number;
  inletPressure: number;
  pump480Num: number;
  pump375Num: number;
  pump480Head: number;
  pump375Head: number;
}

export interface HydraulicAnalysisResult {
  frictionHeadLoss: number;
  reynoldsNumber: number;
  flowRegime: string;
  hydraulicSlope: number;
  totalHead: number;
  firstStationOutPressure: number;
  endStationInPressure: number;
}

export interface OptimizationParams {
  projectId?: number;
  objectiveStrategy?: 'ENERGY' | 'BALANCED' | 'STABLE' | string;
  minEndPressure?: number;
  maxEndPressure?: number;
  maxPump480Num?: number;
  maxPump375Num?: number;
  robustnessPercent?: number;
  flowRate: number;
  density: number;
  viscosity: number;
  length: number;
  diameter: number;
  thickness: number;
  roughness: number;
  startAltitude: number;
  endAltitude: number;
  inletPressure: number;
  pump480Head: number;
  pump375Head: number;
  pumpEfficiency?: number;
  motorEfficiency?: number;
  workingDays?: number;
  electricityPrice?: number;
}

export interface OptimizationCandidateResult {
  score?: number;
  pressureMargin?: number;
  robustMinEndPressure?: number;
  robustFeasible?: boolean;
  energySavingPercent?: number;
  recommendationLabel?: string;
  pump480Num: number;
  pump375Num: number;
  totalHead: number;
  totalPressureDrop: number;
  endStationInPressure: number;
  isFeasible: boolean;
  totalEnergyConsumption: number;
  totalCost: number;
  description: string;
  recommended: boolean;
}

export interface OptimizationResult extends Omit<OptimizationCandidateResult, 'recommended'> {
  candidates?: OptimizationCandidateResult[];
  objectiveStrategy?: string;
  feasibleCount?: number;
  robustFeasibleCount?: number;
}

export interface CapacityEvaluationParams {
  projectId?: number;
  projectName?: string;
  baseParams: HydraulicAnalysisParams;
  minFlowRate?: number;
  maxFlowRate?: number;
  flowStep?: number;
  minEndPressure?: number;
  maxEndPressure?: number;
  maxVelocity?: number;
}

export interface CapacityPoint {
  flowRate: number;
  velocity: number;
  endStationPressure: number;
  pressureMargin: number;
  frictionHeadLoss: number;
  hydraulicSlope: number;
  reynoldsNumber: number;
  flowRegime: string;
  feasible: boolean;
  constraintMessage: string;
}

export interface CapacityEvaluationResult {
  baseResult: HydraulicAnalysisResult;
  points: CapacityPoint[];
  feasibleMinFlow?: number;
  feasibleMaxFlow?: number;
  recommendedFlow?: number;
  minEndPressure: number;
  maxEndPressure?: number;
  maxVelocity?: number;
  totalCalculations: number;
  bottleneck: string;
  conclusion: string;
}

export interface TransientRiskParams {
  projectId?: number;
  projectName?: string;
  baseParams: HydraulicAnalysisParams;
  eventType: 'PUMP_TRIP' | 'VALVE_CLOSURE';
  flowChangePercent: number;
  eventDurationSeconds: number;
  waveSpeed: number;
  minAllowableHead: number;
  maxAllowableHead?: number;
}

export interface TransientRiskResult {
  baseResult: HydraulicAnalysisResult;
  eventType: string;
  baseVelocity: number;
  waveSpeed: number;
  criticalDurationSeconds: number;
  eventDurationSeconds: number;
  flowChangePercent: number;
  surgeHead: number;
  predictedMaximumHead: number;
  predictedMinimumHead: number;
  maxAllowableHead?: number;
  minAllowableHead: number;
  riskLevel: 'HIGH' | 'MEDIUM' | 'LOW' | string;
  pressureBoundaryExceeded: boolean;
  conclusion: string;
  recommendation: string;
}

export interface SensitivityVariableConfig {
  variableType: string;
  variableName: string;
  unit: string;
  startPercent: number;
  endPercent: number;
  stepPercent: number;
}

export interface SensitivityVariableInfo {
  code: string;
  name: string;
  unit: string;
  minChangePercent: number;
  maxChangePercent: number;
}

export interface SensitivityParams {
  projectId?: number;
  projectName?: string;
  baseParams: HydraulicAnalysisParams;
  variables: SensitivityVariableConfig[];
  analysisType: 'SINGLE' | 'MULTI' | 'CROSS';
  pressureLowerBound?: number;
  pressureUpperBound?: number;
  morrisTrajectories?: number;
  morrisLevels?: number;
}

export interface SensitivityResult {
  baseResult: HydraulicAnalysisResult;
  variableResults: VariableSensitivityResult[];
  sensitivityRanking: SensitivityRanking[];
  duration: number;
  totalCalculations: number;
  pressureLowerBound?: number;
  pressureUpperBound?: number;
}

export interface VariableSensitivityResult {
  variableType: string;
  variableName: string;
  unit: string;
  baseValue: number;
  dataPoints: SensitivityPoint[];
  sensitivityCoefficient: number;
  trend: string;
  maxImpactPercent: number;
  pressureSensitivityCoefficient?: number;
  morrisMuStar?: number;
  morrisSigma?: number;
  riskLevel?: 'HIGH' | 'MEDIUM' | 'LOW' | string;
  recommendation?: string;
  unsafePointCount?: number;
}

export interface SensitivityPoint {
  changePercent: number;
  variableValue: number;
  frictionHeadLoss: number;
  frictionChangePercent: number;
  endStationPressure: number;
  pressureChangePercent: number;
  hydraulicSlope: number;
  reynoldsNumber: number;
  flowRegime: string;
  pressureUnsafe?: boolean;
  fullResult: HydraulicAnalysisResult;
}

export interface SensitivityRanking {
  rank: number;
  variableType: string;
  variableName: string;
  sensitivityCoefficient: number;
  description: string;
}

export * from './agent';
