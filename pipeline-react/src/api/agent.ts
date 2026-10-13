import { useUserStore } from '../stores/userStore';
import type {
  AutoRouteResponse,
  DynamicReportRequestPayload,
  DynamicReportResponsePayload,
  HITLResponse,
  IngestExpertItem,
  IngestKnowledgeResponse,
  KnowledgeDeleteResponse,
  KnowledgeDocumentListPayload,
  KnowledgeGraphQueryPayload,
  KnowledgeReindexResponse,
  KnowledgeSearchDebugPayload,
  KnowledgeSearchDebugRequest,
  KnowledgeSearchResponse,
  KnowledgeStageBaseline,
  KnowledgeStatsPayload,
  KnowledgeUploadPayload,
  KnowledgeUploadResponse,
} from '../types/agent';

const AGENT_API_BASE =
  import.meta.env.VITE_AGENT_API_BASE_URL ||
  (import.meta.env.DEV ? '/api/v1' : 'http://127.0.0.1:8100/api/v1');

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

function buildHeaders(headers?: HeadersInit) {
  const token = useUserStore.getState().token;
  const normalized =
    headers instanceof Headers
      ? (() => {
          const entries: Record<string, string> = {};
          headers.forEach((value, key) => {
            entries[key] = value;
          });
          return entries;
        })()
      : Array.isArray(headers)
        ? Object.fromEntries(headers)
        : { ...(headers ?? {}) };

  if (!token) {
    return normalized;
  }

  return {
    ...normalized,
    satoken: token,
    Authorization: `Bearer ${token}`,
  };
}

async function requestAgent<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${AGENT_API_BASE}${path}`, {
      ...init,
      headers: buildHeaders(init?.headers),
    });
  } catch (error) {
    if (error instanceof Error && error.message) {
      throw new Error(`智能报告服务连接失败：${error.message}`);
    }
    throw new Error('智能报告服务连接失败，请稍后重试。');
  }

  if (!response.ok) {
    let errorMessage = `request failed: ${response.status}`;
    try {
      const errorPayload = await parseJson<Record<string, unknown>>(response);
      if (typeof errorPayload.detail === 'string') {
        errorMessage = errorPayload.detail;
      } else if (typeof errorPayload.message === 'string') {
        errorMessage = errorPayload.message;
      }
    } catch {
      // Ignore JSON parse failures and fall back to the status code.
    }
    throw new Error(errorMessage);
  }

  return parseJson<T>(response);
}

export const agentApi = {
  baseUrl: AGENT_API_BASE,

  async chat(message: string, sessionId: string, options?: { mode?: string; context?: Record<string, unknown> }) {
    return requestAgent<Record<string, unknown>>('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        session_id: sessionId,
        ...(options?.mode ? { mode: options.mode } : {}),
        ...(options?.context ? { context: options.context } : {}),
      }),
    });
  },

  async confirm(sessionId: string, responsePayload: HITLResponse) {
    return requestAgent<Record<string, unknown>>('/chat/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, response: responsePayload }),
    });
  },

  async getTrace(traceId: string) {
    return requestAgent<Record<string, unknown>>(`/trace/${traceId}`);
  },

  async queryGraph(query: string, queryType?: string) {
    const params = new URLSearchParams({ query });
    if (queryType) {
      params.set('query_type', queryType);
    }
    return requestAgent<KnowledgeGraphQueryPayload>(`/graph/query?${params.toString()}`);
  },

  /** A 类：/knowledge/ingest 专家知识结构化直入（B4/A 类） */
  async ingestExpertKnowledge(payload: {
    title: string;
    category?: string;
    content?: string;
    expertKnowledge: IngestExpertItem[];
  }) {
    return requestAgent<IngestKnowledgeResponse>('/knowledge/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: payload.title,
        category: payload.category || 'cases',
        content: payload.content,
        expert_knowledge: payload.expertKnowledge,
      }),
    });
  },

  /** B1/B2/B3：/knowledge/search 多路检索主链路 */
  async searchKnowledge(payload: { query: string; topK?: number }) {
    return requestAgent<KnowledgeSearchResponse>('/knowledge/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: payload.query, top_k: payload.topK ?? 3 }),
    });
  },

  /** 对话入口 LLM 自动路由（RAG_AUTO_ROUTE 门控）：B4 图 / B1B2B3 检索 */
  async autoRouteKnowledge(payload: { question: string; topK?: number }) {
    return requestAgent<AutoRouteResponse>('/knowledge/auto-route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: payload.question, top_k: payload.topK ?? 5 }),
    });
  },

  async getKnowledgeBaseline() {
    return requestAgent<KnowledgeStageBaseline>('/knowledge/baseline');
  },

  async listKnowledgeDocuments(params?: { category?: string; status?: string }) {
    const query = new URLSearchParams();
    if (params?.category) {
      query.set('category', params.category);
    }
    if (params?.status) {
      query.set('status', params.status);
    }
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return requestAgent<KnowledgeDocumentListPayload>(`/knowledge/documents${suffix}`);
  },

  async getKnowledgeStats() {
    return requestAgent<KnowledgeStatsPayload>('/knowledge/stats');
  },

  async uploadKnowledgeDocument(payload: KnowledgeUploadPayload) {
    const formData = new FormData();
    formData.append('file', payload.file);
    formData.append('title', payload.title);
    formData.append('source', payload.source);
    formData.append('category', payload.category);
    formData.append('tags', payload.tags.join(','));

    if (payload.author) {
      formData.append('author', payload.author);
    }
    if (payload.summary) {
      formData.append('summary', payload.summary);
    }
    if (payload.language) {
      formData.append('language', payload.language);
    }
    if (payload.version) {
      formData.append('version', payload.version);
    }
    if (payload.external_id) {
      formData.append('external_id', payload.external_id);
    }
    if (payload.effective_at) {
      formData.append('effective_at', payload.effective_at);
    }

    return requestAgent<KnowledgeUploadResponse>('/knowledge/documents/upload', {
      method: 'POST',
      body: formData,
    });
  },

  async deleteKnowledgeDocument(docId: string) {
    return requestAgent<KnowledgeDeleteResponse>(`/knowledge/documents/${encodeURIComponent(docId)}`, {
      method: 'DELETE',
    });
  },

  async reindexKnowledge(recreate = true) {
    return requestAgent<KnowledgeReindexResponse>('/knowledge/reindex', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recreate }),
    });
  },

  async debugKnowledgeSearch(payload: KnowledgeSearchDebugRequest) {
    return requestAgent<KnowledgeSearchDebugPayload>('/knowledge/search/debug', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async generateDynamicReport(payload: DynamicReportRequestPayload) {
    return requestAgent<DynamicReportResponsePayload>('/reports/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
};
