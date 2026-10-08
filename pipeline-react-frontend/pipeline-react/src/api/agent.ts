import { useUserStore } from '../stores/userStore';
import type {
  DynamicReportRequestPayload,
  DynamicReportResponsePayload,
  HITLResponse,
  KnowledgeDeleteResponse,
  KnowledgeDocumentListPayload,
  KnowledgeGraphQueryPayload,
  KnowledgeReindexResponse,
  KnowledgeSearchDebugPayload,
  KnowledgeSearchDebugRequest,
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

  async chat(message: string, sessionId: string) {
    return requestAgent<Record<string, unknown>>('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, session_id: sessionId }),
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

  async queryGraph(query: string) {
    const params = new URLSearchParams({ query });
    return requestAgent<KnowledgeGraphQueryPayload>(`/graph/query?${params.toString()}`);
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
