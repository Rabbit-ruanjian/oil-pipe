export type TraceStatus =
  | 'idle'
  | 'planning'
  | 'executing'
  | 'waiting_hitl'
  | 'completed'
  | 'stopped'
  | 'error';

export interface PlanStep {
  step_id?: string;
  step_number: number;
  description: string;
  agent: string;
  expected_output?: string;
  depends_on?: Array<string | number>;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: unknown;
  error?: string | null;
  duration_ms?: number | null;
  retry_count?: number;
}

export interface TraceLog {
  timestamp: string;
  type: string;
  text: string;
  stepNumber?: number;
  agent?: string;
}

export interface TraceMetrics {
  total_duration_ms: number;
  llm_calls: number;
  tool_calls: number;
  total_tokens: number;
  steps_completed: number;
  steps_failed: number;
  retries: number;
}

export interface HITLOption {
  id: string;
  label: string;
  energy?: number;
  end_pressure?: number;
  saving_rate?: number;
  risk_level?: 'high' | 'normal';
}

export interface HITLRequest {
  request_id?: string;
  type: string;
  title: string;
  description: string;
  options: HITLOption[];
  data?: Record<string, unknown>;
}

export interface HITLResponse {
  request_id?: string;
  selected_option: string;
  modified_data?: Record<string, unknown>;
  comment?: string;
}

export interface TraceEvent {
  event: string;
  data: Record<string, unknown>;
}

export interface ToolSearchScore {
  name: string;
  score: number;
  forced?: boolean;
}

export interface ToolSearchFilters {
  categories?: string[];
  sources?: string[];
}

export interface ToolSearchSnapshot {
  query: string;
  selected_tools: string[];
  selected_scores: ToolSearchScore[];
  total_tools: number;
  duration_ms: number;
  mode: string;
  filters?: ToolSearchFilters;
  timestamp: string;
}

export interface ToolExecutionEvent {
  tool: string;
  call_id?: string;
  input?: Record<string, unknown>;
  output?: string;
  timestamp?: string;
  status: 'running' | 'completed' | 'failed';
}

export interface AgentTraceState {
  traceId: string | null;
  plan: PlanStep[];
  currentStep: number;
  thinking: string;
  logs: TraceLog[];
  metrics: TraceMetrics;
  hitlRequest: HITLRequest | null;
  status: TraceStatus;
  finalResponse: string;
  sessionId: string;
  activeTools: ToolExecutionEvent[];
  lastToolSearch: ToolSearchSnapshot | null;
  errorMessage?: string | null;
}

export interface ChatMessageItem {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  tools?: ToolExecutionEvent[];
}

export interface KnowledgeDocumentSummary {
  doc_id: string;
  title: string;
  source?: string;
  category: string;
  tags: string[];
  author?: string | null;
  summary?: string | null;
  language?: string | null;
  version?: string | null;
  external_id?: string | null;
  effective_at?: string | null;
  file_name: string;
  relative_path?: string;
  file_type?: string;
  file_size_bytes: number;
  source_type?: string;
  status: string;
  chunk_count?: number;
  ingest_stage?: string;
  progress_percent?: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface KnowledgeStageBaseline {
  supported_file_types: string[];
  required_metadata_fields: string[];
  minimal_pipeline: string[];
  module_boundaries?: Record<string, string[]>;
}

export interface KnowledgeStatsPayload {
  total_documents: number;
  documents_by_category?: Record<string, number>;
  collection_name?: string;
  total_chunks: number;
  index_exists: boolean;
  knowledge_root?: string;
}

export interface KnowledgeRetrievalDebugItem {
  chunk_id: string;
  doc_id: string;
  doc_title: string;
  source: string;
  category?: string | null;
  content_preview: string;
  full_text_preview?: string | null;
  score: number;
  match_type: string;
}

export interface KnowledgeRerankDebugItem {
  chunk_id: string;
  doc_id: string;
  doc_title: string;
  source: string;
  category?: string | null;
  match_type: string;
  original_score: number;
  rerank_score: number;
  final_score: number;
  content_preview: string;
  context_preview?: string | null;
  full_text_preview: string;
}

export interface KnowledgeSearchDebugMetrics {
  use_hybrid?: boolean;
  sparse_enabled?: boolean;
  sparse_index_built: boolean;
  dense_weight: number;
  sparse_weight: number;
  dense_candidates: number;
  sparse_candidates: number;
  hybrid_candidates: number;
  dense_duration_ms: number;
  sparse_duration_ms: number;
  fusion_duration_ms: number;
  total_duration_ms: number;
}

export interface KnowledgeRerankDebugMetrics {
  reranker_class: string;
  reranker_threshold: number;
  reranker_enabled?: boolean;
  rerank_candidates_before: number;
  rerank_candidates_after: number;
  rerank_duration_ms: number;
  contextual_enabled: boolean;
  contextual_results: number;
}

export interface KnowledgeSearchDebugPayload {
  query: string;
  top_k?: number;
  category_filter?: string | null;
  dense_results: KnowledgeRetrievalDebugItem[];
  sparse_results: KnowledgeRetrievalDebugItem[];
  hybrid_results: KnowledgeRetrievalDebugItem[];
  rerank_results: KnowledgeRerankDebugItem[];
  debug: KnowledgeSearchDebugMetrics;
  rerank_debug: KnowledgeRerankDebugMetrics;
}

export interface KnowledgeGraphNode {
  id: string;
  name: string;
  type?: string | null;
}

export interface KnowledgeGraphEdge {
  source: string;
  target: string;
  type?: string | null;
}

export interface KnowledgeGraphQueryPayload {
  query: string;
  result: {
    message?: string;
    total_matches?: number;
    center_node?: string | null;
    matched_nodes: KnowledgeGraphNode[];
    visualization: {
      nodes: KnowledgeGraphNode[];
      edges: KnowledgeGraphEdge[];
    };
  };
}

export interface KnowledgeDocumentListPayload {
  documents: KnowledgeDocumentSummary[];
  total: number;
}

export interface DynamicReportRiskItem {
  target: string;
  riskType: string;
  level: string;
  reason: string;
  impact?: string | null;
  suggestion: string;
  code?: string | null;
  message?: string | null;
}

export interface DynamicReportSuggestionItem {
  target: string;
  reason: string;
  action: string;
  expected: string;
  priority: string;
  text?: string | null;
}

export interface DynamicReportMetricItem {
  label: string;
  value: string;
  note?: string | null;
}

export interface DynamicReportBulletItem {
  title?: string | null;
  content: string;
}

export interface DynamicReportTableData {
  columns: string[];
  rows: string[][];
}

export interface DynamicReportSectionPayload {
  id: string;
  kind: 'metrics' | 'bullets' | 'table' | 'markdown' | 'callout';
  title: string;
  summary?: string | null;
  content?: string | null;
  metrics: DynamicReportMetricItem[];
  items: DynamicReportBulletItem[];
  table?: DynamicReportTableData | null;
}

export interface DynamicReportSensitivityInsightBlockPayload {
  title: string;
  content: string;
}

export interface DynamicReportSensitivityInsightsPayload {
  rankingInsight?: DynamicReportSensitivityInsightBlockPayload | null;
  trendInsight?: DynamicReportSensitivityInsightBlockPayload | null;
  impactInsight?: DynamicReportSensitivityInsightBlockPayload | null;
  tableConclusion?: DynamicReportSensitivityInsightBlockPayload | null;
}

export interface DynamicReportOptimizationInsightBlockPayload {
  title: string;
  content: string;
}

export interface DynamicReportOptimizationInsightsPayload {
  schemeInsight?: DynamicReportOptimizationInsightBlockPayload | null;
  feasibilityInsight?: DynamicReportOptimizationInsightBlockPayload | null;
  economicInsight?: DynamicReportOptimizationInsightBlockPayload | null;
}

export interface DynamicReportAiAnalysisPayload {
  summary: string[];
  metricAnalysis: string[];
  schemeExplain?: string[];
  comparison?: string[];
  changeAnalysis?: string[];
  riskJudgement: DynamicReportRiskItem[];
  riskIdentify?: DynamicReportRiskItem[];
  suggestions: DynamicReportSuggestionItem[];
  sensitivityInsights?: DynamicReportSensitivityInsightsPayload | null;
  optimizationInsights?: DynamicReportOptimizationInsightsPayload | null;
}

export interface DynamicReportHydraulicSnapshotPayload {
  projectName?: string | null;
  generatedAt?: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export interface DynamicReportOptimizationSnapshotPayload {
  projectName?: string | null;
  generatedAt?: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export interface DynamicReportSensitivitySnapshotPayload {
  projectName?: string | null;
  generatedAt?: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export interface DynamicReportRequestPayload {
  selected_project_ids: number[];
  project_names?: string[];
  selected_pipeline_id?: number;
  selected_pipeline_name?: string;
  selected_pump_station_ids?: number[];
  selected_pump_station_names?: string[];
  selected_oil_id?: number;
  selected_oil_name?: string;
  report_type: string;
  report_type_label?: string;
  range_preset?: string;
  range_label?: string;
  custom_start?: string;
  custom_end?: string;
  intelligence_level: string;
  output_format: string;
  include_summary?: boolean;
  include_risk?: boolean;
  include_suggestions?: boolean;
  include_conclusion?: boolean;
  analysis_object?: string;
  output_style?: string;
  focuses?: string[];
  target_throughput?: number;
  min_pressure?: number;
  optimization_goal?: string;
  allow_pump_adjust?: boolean;
  remark?: string;
  user_prompt?: string;
  hydraulic_snapshot?: DynamicReportHydraulicSnapshotPayload;
  optimization_snapshot?: DynamicReportOptimizationSnapshotPayload;
  sensitivity_snapshot?: DynamicReportSensitivitySnapshotPayload;
}

export interface DynamicReportResponsePayload {
  title: string;
  abstract: string;
  source: 'ai' | 'rules' | 'hybrid';
  aiAnalysis?: DynamicReportAiAnalysisPayload;
  summary: string[];
  highlights: string[];
  risks: DynamicReportRiskItem[];
  suggestions: DynamicReportSuggestionItem[];
  conclusion: string;
  sections: DynamicReportSectionPayload[];
  metadata?: Record<string, unknown>;
  raw_text?: string;
}

export interface KnowledgeUploadPayload {
  file: File;
  title: string;
  source: string;
  category: string;
  tags: string[];
  author?: string;
  summary?: string;
  language?: string;
  version?: string;
  external_id?: string;
  effective_at?: string;
}

export interface KnowledgeUploadResponse {
  success: boolean;
  document?: KnowledgeDocumentSummary;
  message?: string;
}

export interface KnowledgeDeleteResponse {
  success: boolean;
  doc_id: string;
  file_deleted?: boolean;
  index_deleted?: boolean;
  message?: string;
}

export interface KnowledgeReindexResponse {
  success: boolean;
  documents_indexed?: number;
  registry_total?: number;
  recreate?: boolean;
  message?: string;
}

export interface KnowledgeSearchDebugRequest {
  query: string;
  top_k?: number;
  category?: string;
}
