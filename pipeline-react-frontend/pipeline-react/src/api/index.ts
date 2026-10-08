import { http } from './request';
import type {
  CalculationHistory,
  HydraulicAnalysisParams,
  HydraulicAnalysisResult,
  KnowledgeDocument,
  KnowledgeIngestTask,
  LoginParams,
  LoginResult,
  OilProperty,
  OptimizationParams,
  OptimizationResult,
  PageResult,
  Pipeline,
  Project,
  PumpStation,
  R,
  SaveReportRequest,
  SensitivityResult,
  SensitivityVariableInfo,
} from '../types';

export const authApi = {
  login: (params: LoginParams) => http.post<R<LoginResult>>('/auth/login', params),
};

export const projectApi = {
  list: () => http.get<R<Project[]>>('/project/list'),
  get: (id: number) => http.get<R<Project>>(`/project/${id}`),
  create: (data: Partial<Project>) => http.post<R<boolean>>('/project', data),
  update: (data: Partial<Project>) => http.put<R<boolean>>('/project', data),
  delete: (ids: number[]) => http.delete<R<boolean>>(`/project/${ids.join(',')}`),
};

export const pipelineApi = {
  listByProject: (projectId: number) => http.get<R<Pipeline[]>>(`/pipeline/list/${projectId}`),
  get: (id: number) => http.get<R<Pipeline>>(`/pipeline/${id}`),
  create: (data: Partial<Pipeline>) => http.post<R<boolean>>('/pipeline', data),
  update: (data: Partial<Pipeline>) => http.put<R<boolean>>('/pipeline', data),
  delete: (ids: number[]) => http.delete<R<boolean>>(`/pipeline/${ids.join(',')}`),
};

export const pumpStationApi = {
  list: () => http.get<R<PumpStation[]>>('/pump-station/list'),
  get: (id: number) => http.get<R<PumpStation>>(`/pump-station/${id}`),
  create: (data: Partial<PumpStation>) => http.post<R<boolean>>('/pump-station', data),
  update: (data: Partial<PumpStation>) => http.put<R<boolean>>('/pump-station', data),
  delete: (ids: number[]) => http.delete<R<boolean>>(`/pump-station/${ids.join(',')}`),
};

export const oilPropertyApi = {
  list: () => http.get<R<OilProperty[]>>('/oil-property/list'),
  get: (id: number) => http.get<R<OilProperty>>(`/oil-property/${id}`),
  create: (data: Partial<OilProperty>) => http.post<R<boolean>>('/oil-property', data),
  update: (data: Partial<OilProperty>) => http.put<R<boolean>>('/oil-property', data),
  delete: (ids: number[]) => http.delete<R<boolean>>(`/oil-property/${ids.join(',')}`),
};

export const knowledgeDocumentApi = {
  list: () => http.get<R<KnowledgeDocument[]>>('/knowledge-doc/list'),
  listTasks: (id: number) => http.get<R<KnowledgeIngestTask[]>>(`/knowledge-doc/${id}/tasks`),
  upload: (formData: FormData) =>
    http.post<R<KnowledgeDocument>>('/knowledge-doc/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }),
  retry: (id: number) => http.post<R<KnowledgeDocument>>(`/knowledge-doc/${id}/retry`),
  delete: (id: number) => http.delete<R<boolean>>(`/knowledge-doc/${id}`),
};

export const calculationApi = {
  hydraulicAnalysis: (params: HydraulicAnalysisParams, projectName?: string) =>
    http.post<R<HydraulicAnalysisResult>>('/calculation/hydraulic-analysis', params, {
      params: projectName ? { projectName } : undefined,
    }),
  optimization: (params: OptimizationParams, projectName?: string) =>
    http.post<R<OptimizationResult>>('/calculation/optimization', params, {
      params: projectName ? { projectName } : undefined,
    }),
  sensitivityAnalysis: (params: Record<string, unknown>) =>
    http.post<R<SensitivityResult>>('/calculation/sensitivity/analyze', params),
  quickSensitivityAnalysis: (variableType: string, params: HydraulicAnalysisParams, projectName?: string) =>
    http.post<R<SensitivityResult>>(
      `/calculation/sensitivity/quick-single?variableType=${encodeURIComponent(variableType)}`,
      params,
      {
        params: projectName ? { projectName } : undefined,
      },
    ),
  getSensitivityVariables: () =>
    http.get<R<SensitivityVariableInfo[]>>('/calculation/sensitivity/variables'),
};

export const statisticsApi = {
  getOverview: () => http.get<R<unknown>>('/calculation/statistics/overview'),
  getDailyTrend: (startDate: string, endDate: string) =>
    http.get<R<unknown>>('/calculation/statistics/trend/daily', {
      params: { startDate, endDate },
    }),
};

export const calculationHistoryApi = {
  page: (params?: {
    calcType?: string;
    projectId?: number;
    userId?: number;
    status?: number;
    pageNum?: number;
    pageSize?: number;
    keyword?: string;
  }) => http.get<R<PageResult<CalculationHistory>>>('/calculation/history/page', { params }),
  byProject: (
    projectId: number,
    params?: {
      pageNum?: number;
      pageSize?: number;
      calcType?: string;
    },
  ) =>
    http.get<R<PageResult<CalculationHistory>>>(`/calculation/history/project/${projectId}`, {
      params,
    }),
  detail: (id: number) => http.get<R<CalculationHistory>>(`/calculation/history/${id}`),
  report: (payload: SaveReportRequest) => http.post<R<CalculationHistory>>('/calculation/history/report', payload),
  delete: (id: number) => http.delete<R<void>>(`/calculation/history/${id}`),
  batchDelete: (ids: number[]) => http.post<R<number>>('/calculation/history/batch-delete', ids),
};

