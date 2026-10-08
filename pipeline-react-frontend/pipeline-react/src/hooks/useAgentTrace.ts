import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { agentApi } from '../api/agent';
import { useSSE } from './useSSE';
import { useUserStore } from '../stores/userStore';
import { getToolDisplayStatus, getToolTitle } from '../features/ai-chat/utils/toolOutput';
import type {
  AgentTraceState,
  HITLRequest,
  HITLResponse,
  PlanStep,
  ToolSearchScore,
  ToolSearchSnapshot,
  TraceEvent,
  TraceLog,
  TraceMetrics,
  ToolExecutionEvent,
} from '../types/agent';

const EMPTY_METRICS: TraceMetrics = {
  total_duration_ms: 0,
  llm_calls: 0,
  tool_calls: 0,
  total_tokens: 0,
  steps_completed: 0,
  steps_failed: 0,
  retries: 0,
};
const CHARS_PER_FRAME = 8;

const API_VERSION_SUFFIX_RE = /\/api\/v\d+$/;

function toV2BaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (API_VERSION_SUFFIX_RE.test(normalized)) {
    return normalized.replace(API_VERSION_SUFFIX_RE, '/api/v2');
  }
  return `${normalized}/api/v2`;
}

function findRunningToolIndex(
  tools: ToolExecutionEvent[],
  callId: string | undefined,
  toolName: string,
): number {
  if (callId) {
    const idxByCallId = tools.findIndex((tool) => tool.call_id === callId && tool.status === 'running');
    if (idxByCallId >= 0) return idxByCallId;
  }
  return tools.findIndex((tool) => tool.tool === toolName && tool.status === 'running');
}

function resolveToolStatus(
  baseTool: ToolExecutionEvent,
  nextOutput?: string,
  preferredStatus?: ToolExecutionEvent['status'],
): ToolExecutionEvent['status'] {
  const candidate: ToolExecutionEvent = {
    ...baseTool,
    status: preferredStatus ?? baseTool.status,
    output: nextOutput ?? baseTool.output,
  };

  const derivedStatus = getToolDisplayStatus(candidate);
  if (derivedStatus === 'failed') {
    return 'failed';
  }

  return preferredStatus ?? baseTool.status;
}

function stringifyToolOutput(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeEventTimestamp(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }

  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      const ms = numeric < 1e12 ? numeric * 1000 : numeric;
      return new Date(ms).toISOString();
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
}

function resetDerivedMetricRefs(
  traceStartedAtRef: { current: number | null },
  toolCallKeysRef: { current: Set<string> },
  toolCallCountRef: { current: number },
  llmCallCountRef: { current: number },
) {
  traceStartedAtRef.current = null;
  toolCallKeysRef.current = new Set();
  toolCallCountRef.current = 0;
  llmCallCountRef.current = 0;
}

const V2_BASE_URL = toV2BaseUrl(agentApi.baseUrl);

function initialState(sessionId: string): AgentTraceState {
  return {
    traceId: null,
    plan: [],
    currentStep: 0,
    thinking: '',
    logs: [],
    metrics: { ...EMPTY_METRICS },
    hitlRequest: null,
    status: 'idle',
    finalResponse: '',
    sessionId,
    activeTools: [],
    lastToolSearch: null,
    errorMessage: null,
  };
}

function appendLog(logs: TraceLog[], item: TraceLog): TraceLog[] {
  const next = [...logs, item];
  return next.length > 200 ? next.slice(next.length - 200) : next;
}

export function useAgentTrace(sessionId: string) {
  const [state, setState] = useState<AgentTraceState>(() => initialState(sessionId));

  // Chunk buffering with rAF throttling for response_chunk events
  const chunkBufferRef = useRef('');
  const smoothQueueRef = useRef('');
  const rafIdRef = useRef<number | null>(null);
  const traceStartedAtRef = useRef<number | null>(null);
  const toolCallKeysRef = useRef<Set<string>>(new Set());
  const toolCallCountRef = useRef(0);
  const llmCallCountRef = useRef(0);

  const mergeDerivedMetrics = useCallback((metrics: TraceMetrics): TraceMetrics => {
    const elapsed =
      traceStartedAtRef.current != null
        ? Math.max(0, Date.now() - traceStartedAtRef.current)
        : metrics.total_duration_ms;

    return {
      ...metrics,
      total_duration_ms: Math.max(metrics.total_duration_ms, elapsed),
      llm_calls: Math.max(metrics.llm_calls, llmCallCountRef.current),
      tool_calls: Math.max(metrics.tool_calls, toolCallCountRef.current),
    };
  }, []);

  const flushBuffer = useCallback(() => {
    rafIdRef.current = null;

    if (chunkBufferRef.current) {
      smoothQueueRef.current += chunkBufferRef.current;
      chunkBufferRef.current = '';
    }

    if (!smoothQueueRef.current) return;

    const toConsume = smoothQueueRef.current.slice(0, CHARS_PER_FRAME);
    smoothQueueRef.current = smoothQueueRef.current.slice(CHARS_PER_FRAME);

    if (!toConsume) return;

    setState(prev => ({
      ...prev,
      finalResponse: prev.finalResponse + toConsume,
    }));

    if (smoothQueueRef.current || chunkBufferRef.current) {
      rafIdRef.current = requestAnimationFrame(flushBuffer);
    }
  }, []);

  const drainBufferedChunks = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    const buffered = chunkBufferRef.current + smoothQueueRef.current;
    chunkBufferRef.current = '';
    smoothQueueRef.current = '';
    return buffered;
  }, []);

  const onEvent = useCallback((event: TraceEvent) => {
    if (event.event === 'trace_init') {
      traceStartedAtRef.current = Date.now();
      toolCallKeysRef.current = new Set();
      toolCallCountRef.current = 0;
      llmCallCountRef.current = 0;
    }

    if (event.event === 'tool_start' || event.event === 'tool_use_start') {
      const toolName = String(event.data.name ?? event.data.tool ?? '');
      const callId =
        event.data.tool_id != null
          ? String(event.data.tool_id)
          : event.data.call_id != null
            ? String(event.data.call_id)
            : '';
      const metricKey = callId || `${toolName}-${toolCallKeysRef.current.size + 1}`;
      if (!toolCallKeysRef.current.has(metricKey)) {
        toolCallKeysRef.current.add(metricKey);
        toolCallCountRef.current += 1;
      }
    }

    if (
      event.event === 'thinking_delta' ||
      event.event === 'content_delta' ||
      event.event === 'response_chunk' ||
      event.event === 'content_done' ||
      event.event === 'final_response' ||
      event.event === 'done'
    ) {
      llmCallCountRef.current = Math.max(llmCallCountRef.current, 1);
    }

    setState((prev) => {
      const timestamp = normalizeEventTimestamp(event.data.timestamp);
      const stepNumber = typeof event.data.step_number === 'number' ? event.data.step_number : undefined;
      const agent = typeof event.data.agent === 'string' ? event.data.agent : undefined;
      const eventTraceId = event.data.trace_id != null ? String(event.data.trace_id) : undefined;
      const eventSessionId = event.data.session_id != null ? String(event.data.session_id) : undefined;

      switch (event.event) {
        case 'trace_init': {
          const traceId = String(event.data.trace_id ?? '');
          const newSessionId = String(event.data.session_id ?? prev.sessionId);
          return {
            ...prev,
            traceId,
            sessionId: newSessionId,
            status: 'planning',
            metrics: { ...EMPTY_METRICS },
            logs: appendLog(prev.logs, {
              timestamp,
              type: event.event,
              text: '开始分析问题',
            }),
          };
        }
        case 'tool_search': {
          const looksLikeStreamInit = String(event.data.message ?? '') === 'stream initialized';
          if (looksLikeStreamInit) {
            return {
              ...prev,
              traceId: eventTraceId ?? prev.traceId,
              sessionId: eventSessionId ?? prev.sessionId,
              status: prev.status === 'idle' ? 'planning' : prev.status,
              logs: appendLog(prev.logs, {
                timestamp,
                type: event.event,
                text: '开始建立分析链路',
              }),
            };
          }

          const selectedTools = Array.isArray(event.data.selected_tools)
            ? (event.data.selected_tools as unknown[]).map((item) => String(item))
            : [];
          const selectedScores = Array.isArray(event.data.selected_scores)
            ? (event.data.selected_scores as Array<Record<string, unknown>>)
            : [];
          const selectedScoreItems: ToolSearchScore[] = [];
          for (const item of selectedScores) {
            const name = item.name != null ? String(item.name) : '';
            const score = typeof item.score === 'number' ? item.score : Number(item.score);
            const forced = Boolean(item.forced);
            if (!name || Number.isNaN(score)) continue;
            selectedScoreItems.push({ name, score, forced });
          }

          const filtersRaw =
            event.data.filters && typeof event.data.filters === 'object'
              ? (event.data.filters as Record<string, unknown>)
              : {};
          const filterCategories = Array.isArray(filtersRaw.categories)
            ? filtersRaw.categories.map((item) => String(item))
            : [];
          const filterSources = Array.isArray(filtersRaw.sources)
            ? filtersRaw.sources.map((item) => String(item))
            : [];
          const totalTools =
            typeof event.data.total_tools === 'number'
              ? event.data.total_tools
              : Number(event.data.total_tools ?? 0);
          const durationMs =
            typeof event.data.duration_ms === 'number'
              ? event.data.duration_ms
              : Number(event.data.duration_ms ?? 0);
          const toolSearchSnapshot: ToolSearchSnapshot = {
            query: String(event.data.query ?? ''),
            selected_tools: selectedTools,
            selected_scores: selectedScoreItems,
            total_tools: Number.isNaN(totalTools) ? 0 : totalTools,
            duration_ms: Number.isNaN(durationMs) ? 0 : durationMs,
            mode: String(event.data.mode ?? 'hybrid'),
            filters: {
              categories: filterCategories,
              sources: filterSources,
            },
            timestamp,
          };

          const scoreByName = new Map<string, number>();
          for (const item of selectedScoreItems) {
            const { name, score } = item;
            scoreByName.set(name, score);
          }

          const selectedLabel =
            selectedTools.length > 0
              ? selectedTools
                  .map((name) =>
                    scoreByName.has(name)
                      ? `${getToolTitle(name)}(${scoreByName.get(name)!.toFixed(2)})`
                      : getToolTitle(name),
                  )
                  .join(', ')
              : 'none';

          return {
            ...prev,
            traceId: eventTraceId ?? prev.traceId,
            sessionId: eventSessionId ?? prev.sessionId,
            lastToolSearch: toolSearchSnapshot,
            metrics: mergeDerivedMetrics(prev.metrics),
            logs: appendLog(prev.logs, {
              timestamp,
              type: event.event,
              text:
                selectedTools.length > 0
                  ? `已选择工具：${selectedLabel}`
                  : '未命中可用工具，准备直接生成回复',
            }),
          };
        }
        case 'plan_created':
        case 'plan_updated': {
          const plan = Array.isArray(event.data.plan) ? (event.data.plan as PlanStep[]) : prev.plan;
          return {
            ...prev,
            traceId: eventTraceId ?? prev.traceId,
            sessionId: eventSessionId ?? prev.sessionId,
            plan,
            metrics: mergeDerivedMetrics(prev.metrics),
            status: 'executing',
            logs: appendLog(prev.logs, {
              timestamp,
              type: event.event,
              text: `${event.event} (${plan.length} steps)`,
            }),
          };
        }
        case 'plan_step_start': {
          const nextPlan: PlanStep[] = prev.plan.map((step): PlanStep =>
            step.step_number === stepNumber ? { ...step, status: 'in_progress' } : step
          );
          return {
            ...prev,
            traceId: eventTraceId ?? prev.traceId,
            sessionId: eventSessionId ?? prev.sessionId,
            plan: nextPlan,
            currentStep: stepNumber ?? prev.currentStep,
            metrics: mergeDerivedMetrics(prev.metrics),
            status: 'executing',
            logs: appendLog(prev.logs, {
              timestamp,
              type: event.event,
              text: `Step ${stepNumber}: ${String(event.data.description ?? '')}`,
              stepNumber,
              agent,
            }),
          };
        }
        case 'plan_step_done': {
          const duration =
            typeof event.data.duration_ms === 'number' ? event.data.duration_ms : undefined;
          const nextPlan: PlanStep[] = prev.plan.map((step): PlanStep =>
            step.step_number === stepNumber
              ? { ...step, status: 'completed', duration_ms: duration ?? step.duration_ms }
              : step
          );
          return {
            ...prev,
            traceId: eventTraceId ?? prev.traceId,
            sessionId: eventSessionId ?? prev.sessionId,
            plan: nextPlan,
            metrics: mergeDerivedMetrics({
              ...prev.metrics,
              steps_completed: prev.metrics.steps_completed + 1,
            }),
            logs: appendLog(prev.logs, {
              timestamp,
              type: event.event,
              text: `Step ${stepNumber} completed`,
              stepNumber,
              agent,
            }),
          };
        }
        case 'step_started': {
          const nextPlan: PlanStep[] = prev.plan.map((step): PlanStep =>
            step.step_number === stepNumber ? { ...step, status: 'in_progress' } : step
          );
          return {
            ...prev,
            traceId: eventTraceId ?? prev.traceId,
            sessionId: eventSessionId ?? prev.sessionId,
            plan: nextPlan,
            currentStep: stepNumber ?? prev.currentStep,
            metrics: mergeDerivedMetrics(prev.metrics),
            status: 'executing',
            logs: appendLog(prev.logs, {
              timestamp,
              type: event.event,
              text: `Step ${stepNumber}: ${String(event.data.description ?? '')}`,
              stepNumber,
              agent,
            }),
          };
        }
        case 'step_completed': {
          const duration =
            typeof event.data.duration_ms === 'number' ? event.data.duration_ms : undefined;
          const nextPlan: PlanStep[] = prev.plan.map((step): PlanStep =>
            step.step_number === stepNumber
              ? { ...step, status: 'completed', duration_ms: duration ?? step.duration_ms }
              : step
          );

          return {
            ...prev,
            traceId: eventTraceId ?? prev.traceId,
            sessionId: eventSessionId ?? prev.sessionId,
            plan: nextPlan,
            metrics: mergeDerivedMetrics({
              ...prev.metrics,
              steps_completed: prev.metrics.steps_completed + 1,
            }),
            logs: appendLog(prev.logs, {
              timestamp,
              type: event.event,
              text: `Step ${stepNumber} completed`,
              stepNumber,
              agent,
            }),
          };
        }
        case 'step_failed': {
          const nextPlan: PlanStep[] = prev.plan.map((step): PlanStep =>
            step.step_number === stepNumber
              ? { ...step, status: 'failed', error: String(event.data.error ?? 'failed') }
              : step
          );

          return {
            ...prev,
            traceId: eventTraceId ?? prev.traceId,
            sessionId: eventSessionId ?? prev.sessionId,
            plan: nextPlan,
            metrics: mergeDerivedMetrics({
              ...prev.metrics,
              steps_failed: prev.metrics.steps_failed + 1,
            }),
            status: 'error',
            errorMessage: String(event.data.error ?? 'failed'),
            logs: appendLog(prev.logs, {
              timestamp,
              type: event.event,
              text: `Step ${stepNumber} failed: ${String(event.data.error ?? '')}`,
              stepNumber,
              agent,
            }),
          };
        }
        case 'hitl_waiting': {
          return {
            ...prev,
            traceId: eventTraceId ?? prev.traceId,
            sessionId: eventSessionId ?? prev.sessionId,
            status: 'waiting_hitl',
            metrics: mergeDerivedMetrics(prev.metrics),
            hitlRequest: event.data as unknown as HITLRequest,
            logs: appendLog(prev.logs, {
              timestamp,
              type: event.event,
              text: 'waiting for human confirmation',
            }),
          };
        }
        case 'hitl_resumed': {
          return {
            ...prev,
            traceId: eventTraceId ?? prev.traceId,
            sessionId: eventSessionId ?? prev.sessionId,
            status: 'executing',
            metrics: mergeDerivedMetrics(prev.metrics),
            errorMessage: null,
            hitlRequest: null,
            logs: appendLog(prev.logs, {
              timestamp,
              type: event.event,
              text: `HITL resumed: ${String(event.data.selected_option ?? '')}`,
            }),
          };
        }
        case 'hitl_request': {
          return {
            ...prev,
            traceId: eventTraceId ?? prev.traceId,
            sessionId: eventSessionId ?? prev.sessionId,
            status: 'waiting_hitl',
            metrics: mergeDerivedMetrics(prev.metrics),
            errorMessage: null,
            hitlRequest: event.data as unknown as HITLRequest,
            logs: appendLog(prev.logs, {
              timestamp,
              type: event.event,
              text: 'waiting for human confirmation',
            }),
          };
        }
        case 'tool_start': {
          const toolName = String(event.data.tool ?? '');
          const toolInput = event.data.input as Record<string, unknown> | undefined;
          const callId = event.data.call_id != null ? String(event.data.call_id) : undefined;
          const newTool: ToolExecutionEvent = {
            tool: toolName,
            call_id: callId,
            input: toolInput,
            status: 'running',
            timestamp,
          };
          return {
            ...prev,
            traceId: eventTraceId ?? prev.traceId,
            sessionId: eventSessionId ?? prev.sessionId,
            status: 'executing',
            metrics: mergeDerivedMetrics(prev.metrics),
            errorMessage: null,
            activeTools: [...prev.activeTools, newTool],
            logs: appendLog(prev.logs, {
              timestamp,
              type: 'tool_start',
              text: `🔧 调用工具: ${getToolTitle(toolName)}`,
            }),
          };
        }
        case 'tool_end': {
          const toolName = String(event.data.tool ?? '');
          const toolOutput = stringifyToolOutput(event.data.output);
          const callId = event.data.call_id != null ? String(event.data.call_id) : undefined;
          const targetIndex = findRunningToolIndex(prev.activeTools, callId, toolName);
          const updatedTools = [...prev.activeTools];
          if (targetIndex >= 0) {
            const nextTool = {
              ...updatedTools[targetIndex],
              call_id: updatedTools[targetIndex].call_id ?? callId,
              output: toolOutput,
              timestamp,
            };
            updatedTools[targetIndex] = {
              ...nextTool,
              status: resolveToolStatus(nextTool, toolOutput, 'completed'),
            };
          }
          return {
            ...prev,
            traceId: eventTraceId ?? prev.traceId,
            sessionId: eventSessionId ?? prev.sessionId,
            metrics: mergeDerivedMetrics(prev.metrics),
            activeTools: updatedTools,
            logs: appendLog(prev.logs, {
              timestamp,
              type: 'tool_end',
              text: `✅ 工具完成: ${getToolTitle(toolName)}`,
            }),
          };
        }
        case 'tool_use_start': {
          const toolName = String(event.data.name ?? event.data.tool ?? '');
          const toolInput = event.data.input as Record<string, unknown> | undefined;
          const callId =
            event.data.tool_id != null
              ? String(event.data.tool_id)
              : event.data.call_id != null
                ? String(event.data.call_id)
                : undefined;

          const duplicated = callId
            ? prev.activeTools.some((tool) => tool.call_id === callId && tool.status === 'running')
            : false;

          const newTool: ToolExecutionEvent = {
            tool: toolName,
            call_id: callId,
            input: toolInput,
            status: 'running',
            timestamp,
          };

          return {
            ...prev,
            traceId: eventTraceId ?? prev.traceId,
            sessionId: eventSessionId ?? prev.sessionId,
            status: 'executing',
            metrics: mergeDerivedMetrics(prev.metrics),
            errorMessage: null,
            activeTools: duplicated ? prev.activeTools : [...prev.activeTools, newTool],
            logs: appendLog(prev.logs, {
              timestamp,
              type: event.event,
              text: `🔧 调用工具: ${getToolTitle(toolName)}`,
            }),
          };
        }
        case 'tool_result': {
          const toolName = String(event.data.name ?? event.data.tool ?? '');
          const toolOutput = stringifyToolOutput(event.data.output);
          const callId =
            event.data.tool_id != null
              ? String(event.data.tool_id)
              : event.data.call_id != null
                ? String(event.data.call_id)
                : undefined;
          const targetIndex = findRunningToolIndex(prev.activeTools, callId, toolName);
          const updatedTools = [...prev.activeTools];
          if (targetIndex >= 0) {
            const nextTool = {
              ...updatedTools[targetIndex],
              call_id: updatedTools[targetIndex].call_id ?? callId,
              output: toolOutput,
              timestamp,
            };
            updatedTools[targetIndex] = {
              ...nextTool,
              status: resolveToolStatus(nextTool, toolOutput),
            };
          }
          return {
            ...prev,
            traceId: eventTraceId ?? prev.traceId,
            sessionId: eventSessionId ?? prev.sessionId,
            metrics: mergeDerivedMetrics(prev.metrics),
            activeTools: updatedTools,
            logs: prev.logs,
          };
        }
        case 'tool_use_done': {
          const toolName = String(event.data.name ?? event.data.tool ?? '');
          const callId =
            event.data.tool_id != null
              ? String(event.data.tool_id)
              : event.data.call_id != null
                ? String(event.data.call_id)
                : undefined;
          const targetIndex = findRunningToolIndex(prev.activeTools, callId, toolName);
          const updatedTools = [...prev.activeTools];
          if (targetIndex >= 0) {
            const nextTool = {
              ...updatedTools[targetIndex],
              call_id: updatedTools[targetIndex].call_id ?? callId,
              timestamp,
            };
            updatedTools[targetIndex] = {
              ...nextTool,
              status: resolveToolStatus(nextTool, nextTool.output, 'completed'),
            };
          }
          return {
            ...prev,
            traceId: eventTraceId ?? prev.traceId,
            sessionId: eventSessionId ?? prev.sessionId,
            metrics: mergeDerivedMetrics(prev.metrics),
            activeTools: updatedTools,
            logs: appendLog(prev.logs, {
              timestamp,
              type: event.event,
              text: `✅ 工具完成: ${getToolTitle(toolName)}`,
            }),
          };
        }
        case 'thinking_delta': {
          const chunk = String(event.data.content ?? '');
          if (!chunk) return prev;
          return {
            ...prev,
            traceId: eventTraceId ?? prev.traceId,
            sessionId: eventSessionId ?? prev.sessionId,
            thinking: prev.thinking + chunk,
            metrics: mergeDerivedMetrics(prev.metrics),
            status: prev.status === 'idle' ? 'planning' : prev.status,
          };
        }
        case 'thinking_done': {
          return {
            ...prev,
            traceId: eventTraceId ?? prev.traceId,
            sessionId: eventSessionId ?? prev.sessionId,
            metrics: mergeDerivedMetrics(prev.metrics),
            logs: appendLog(prev.logs, {
              timestamp,
              type: event.event,
              text: 'thinking completed',
            }),
          };
        }
        case 'content_delta':
        case 'response_chunk': {
          const chunk =
            event.event === 'content_delta'
              ? String(event.data.content ?? '')
              : String(event.data.chunk ?? '');
          chunkBufferRef.current += chunk;
          if (rafIdRef.current === null) {
            rafIdRef.current = requestAnimationFrame(flushBuffer);
          }
          return prev;
        }
        case 'content_done': {
          const buffered = drainBufferedChunks();
          const streamedResponse = prev.finalResponse + buffered;
          const response = String(
            (event.data.response as string) ||
              (event.data.final_response as string) ||
              (event.data.raw as string) ||
              '',
          );
          return {
            ...prev,
            traceId: eventTraceId ?? prev.traceId,
            sessionId: eventSessionId ?? prev.sessionId,
            status: 'completed',
            metrics: mergeDerivedMetrics(prev.metrics),
            errorMessage: null,
            finalResponse: response || streamedResponse,
            logs: prev.logs,
          };
        }
        case 'completed': {
          const buffered = drainBufferedChunks();
          const metrics =
            event.data.metrics && typeof event.data.metrics === 'object'
              ? (event.data.metrics as TraceMetrics)
              : mergeDerivedMetrics(prev.metrics);
          return {
            ...prev,
            traceId: eventTraceId ?? prev.traceId,
            sessionId: eventSessionId ?? prev.sessionId,
            status: 'completed',
            errorMessage: null,
            finalResponse: prev.finalResponse + buffered,
            metrics: mergeDerivedMetrics(metrics),
            logs: appendLog(prev.logs, {
              timestamp,
              type: event.event,
              text: '分析完成',
            }),
          };
        }
        case 'final_response': {
          const buffered = drainBufferedChunks();
          const streamedResponse = prev.finalResponse + buffered;
          const response = String(
            (event.data.response as string) ||
              (event.data.final_response as string) ||
              (event.data.raw as string) ||
              '',
          );
          return {
            ...prev,
            traceId: eventTraceId ?? prev.traceId,
            sessionId: eventSessionId ?? prev.sessionId,
            status: 'completed',
            metrics: mergeDerivedMetrics(prev.metrics),
            errorMessage: null,
            finalResponse: response || streamedResponse,
            logs: appendLog(prev.logs, {
              timestamp,
              type: event.event,
              text: 'final response arrived',
            }),
          };
        }
        case 'done': {
          const buffered = drainBufferedChunks();
          const metrics =
            event.data.metrics && typeof event.data.metrics === 'object'
              ? (event.data.metrics as TraceMetrics)
              : mergeDerivedMetrics(prev.metrics);
          return {
            ...prev,
            traceId: eventTraceId ?? prev.traceId,
            sessionId: eventSessionId ?? prev.sessionId,
            status: 'completed',
            errorMessage: null,
            finalResponse: prev.finalResponse + buffered,
            metrics: mergeDerivedMetrics(metrics),
            logs: appendLog(prev.logs, {
              timestamp,
              type: event.event,
              text: '分析完成',
            }),
          };
        }
        case 'error': {
          const buffered = drainBufferedChunks();
          return {
            ...prev,
            traceId: eventTraceId ?? prev.traceId,
            sessionId: eventSessionId ?? prev.sessionId,
            status: 'error',
            metrics: mergeDerivedMetrics(prev.metrics),
            errorMessage: String(event.data.error ?? event.data.raw ?? ''),
            finalResponse: prev.finalResponse + buffered,
            logs: appendLog(prev.logs, {
              timestamp,
              type: event.event,
              text: `error: ${String(event.data.error ?? event.data.raw ?? '')}`,
            }),
          };
        }
        default:
          return {
            ...prev,
            traceId: eventTraceId ?? prev.traceId,
            sessionId: eventSessionId ?? prev.sessionId,
            metrics: mergeDerivedMetrics(prev.metrics),
            logs: appendLog(prev.logs, {
              timestamp,
              type: event.event,
              text: JSON.stringify(event.data),
              stepNumber,
              agent,
            }),
          };
      }
    });
  }, [drainBufferedChunks, flushBuffer, mergeDerivedMetrics]);

  const onError = useCallback((error: Error) => {
    setState((prev) => ({
      ...prev,
      status: 'error',
      errorMessage: error.message,
      logs: appendLog(prev.logs, {
        timestamp: new Date().toISOString(),
        type: 'error',
        text: error.message,
      }),
    }));
  }, []);

  const sse = useSSE({
    url: `${V2_BASE_URL}/chat/stream`,
    onEvent,
    onError,
  });
  const { connect, connected, disconnect, streaming } = sse;

  const startChat = useCallback(
    (message: string, mode = 'standard') => {
      chunkBufferRef.current = '';
      smoothQueueRef.current = '';
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      const token = useUserStore.getState().token;
      resetDerivedMetricRefs(traceStartedAtRef, toolCallKeysRef, toolCallCountRef, llmCallCountRef);
      setState(initialState(sessionId));
      connect({
        method: 'POST',
        headers: token
          ? {
              satoken: token,
              Authorization: `Bearer ${token}`,
            }
          : undefined,
        body: {
          message,
          session_id: sessionId,
          mode,
        },
      });
    },
    [connect, sessionId]
  );

  const submitHITL = useCallback(
    async (response: HITLResponse) => {
      const token = useUserStore.getState().token;
      let result: Record<string, unknown>;

      try {
        const resp = await fetch(`${V2_BASE_URL}/chat/confirm`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { satoken: token, Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            session_id: state.sessionId,
            selected_option: response.selected_option,
            comment: response.comment,
            modified_data: response.modified_data,
            request_id: response.request_id,
          }),
        });
        if (!resp.ok) {
          throw new Error(`confirm request failed: ${resp.status}`);
        }
        result = (await resp.json()) as Record<string, unknown>;
      } catch {
        result = await agentApi.confirm(state.sessionId, response);
      }

      setState((prev) => {
        const payload =
          result && typeof result === 'object'
            ? (result.result && typeof result.result === 'object'
                ? (result.result as Record<string, unknown>)
                : (result as Record<string, unknown>))
            : {};

        if (payload.error) {
          return {
            ...prev,
            status: 'error',
            logs: appendLog(prev.logs, {
              timestamp: new Date().toISOString(),
              type: 'error',
              text: String(payload.error),
            }),
          };
        }

        const nextHitl =
          payload.hitl_request && typeof payload.hitl_request === 'object'
            ? (payload.hitl_request as HITLRequest)
            : payload.hitl_data && typeof payload.hitl_data === 'object'
              ? (payload.hitl_data as HITLRequest)
              : null;

        if (nextHitl) {
          return {
            ...prev,
            status: 'waiting_hitl',
            hitlRequest: nextHitl,
            logs: appendLog(prev.logs, {
              timestamp: new Date().toISOString(),
              type: 'hitl_waiting',
              text: 'waiting for next human confirmation',
            }),
          };
        }

        const responseText = String(payload.response ?? '');
        return {
          ...prev,
          status: 'completed',
          hitlRequest: null,
          finalResponse: responseText || prev.finalResponse,
          logs: appendLog(prev.logs, {
            timestamp: new Date().toISOString(),
            type: 'hitl_resumed',
            text: 'HITL confirmed and task resumed',
          }),
        };
      });
    },
    [state.sessionId]
  );

  const dismissHITL = useCallback(() => {
    setState((prev) => ({ ...prev, hitlRequest: null }));
  }, []);

  const stop = useCallback(() => {
    const buffered = drainBufferedChunks();
    disconnect();
    setState((prev) => {
      const nextResponse = prev.finalResponse + buffered;
      return {
        ...prev,
        finalResponse: nextResponse,
        status: nextResponse ? 'stopped' : 'idle',
        errorMessage: null,
        logs: appendLog(prev.logs, {
          timestamp: new Date().toISOString(),
          type: 'stopped',
          text: 'generation stopped by user',
        }),
      };
    });
  }, [disconnect, drainBufferedChunks]);

  const reset = useCallback(() => {
    disconnect();
    chunkBufferRef.current = '';
    smoothQueueRef.current = '';
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    resetDerivedMetricRefs(traceStartedAtRef, toolCallKeysRef, toolCallCountRef, llmCallCountRef);
    setState(initialState(sessionId));
  }, [disconnect, sessionId]);

  useEffect(() => {
    disconnect();
    chunkBufferRef.current = '';
    smoothQueueRef.current = '';
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    resetDerivedMetricRefs(traceStartedAtRef, toolCallKeysRef, toolCallCountRef, llmCallCountRef);
    setState(initialState(sessionId));
  }, [disconnect, sessionId]);

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      chunkBufferRef.current = '';
      smoothQueueRef.current = '';
      resetDerivedMetricRefs(traceStartedAtRef, toolCallKeysRef, toolCallCountRef, llmCallCountRef);
    };
  }, []);

  return useMemo(
    () => ({
      ...state,
      connected,
      streaming,
      startChat,
      stop,
      submitHITL,
      dismissHITL,
      reset,
    }),
    [connected, dismissHITL, reset, startChat, state, stop, streaming, submitHITL]
  );
}

export default useAgentTrace;
