import type { ToolExecutionEvent } from '../../../types/agent';

const TOOL_LABELS: Record<string, string> = {
  SQL_Database: '\u6570\u636e\u5e93\u67e5\u8be2',
  Knowledge_Base: '\u77e5\u8bc6\u5e93\u68c0\u7d22',
  Hydraulic_Analysis: '\u6c34\u529b\u8ba1\u7b97',
  query_database: '\u6570\u636e\u5e93\u67e5\u8be2',
  search_knowledge_base: '\u77e5\u8bc6\u5e93\u68c0\u7d22',
  hydraulic_calculation: '\u6c34\u529b\u8ba1\u7b97',
  query_fault_cause: '\u6545\u969c\u539f\u56e0\u5206\u6790',
  query_standards: '\u6807\u51c6\u89c4\u8303\u67e5\u8be2',
  query_equipment_chain: '\u8bbe\u5907\u5173\u7cfb\u67e5\u8be2',
  run_sensitivity_analysis: '\u654f\u611f\u6027\u5206\u6790',
  plan_complex_task: '\u590d\u6742\u4efb\u52a1\u89c4\u5212',
  execute_safe_sql: '\u5b89\u5168 SQL \u67e5\u8be2',
  query_projects: '\u9879\u76ee\u5217\u8868\u67e5\u8be2',
  query_project_by_id: '\u9879\u76ee\u8be6\u60c5\u67e5\u8be2',
  query_pipelines: '\u7ba1\u9053\u5217\u8868\u67e5\u8be2',
  query_pipeline_detail: '\u7ba1\u9053\u8be6\u60c5\u67e5\u8be2',
  query_pump_stations: '\u6cf5\u7ad9\u67e5\u8be2',
  query_oil_properties: '\u6cb9\u54c1\u67e5\u8be2',
  get_calculation_parameters: '\u8ba1\u7b97\u53c2\u6570\u67e5\u8be2',
};

interface ToolPayload {
  success?: boolean;
  message?: unknown;
  error?: unknown;
  raw?: unknown;
  content?: unknown;
  count?: unknown;
  data?: unknown;
}

export interface ToolOutputPresentation {
  displayStatus: ToolExecutionEvent['status'];
  summary: string;
  detail: string | null;
  rawDetail: string | null;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function decodeEscapedText(value: string) {
  return value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

function unwrapToolEnvelope(raw: string) {
  const trimmed = raw.trim();
  const singleQuoted = trimmed.match(/^content='([\s\S]*?)'(?:\s+[a-zA-Z_]+=?|$)/);
  if (singleQuoted) return singleQuoted[1];

  const doubleQuoted = trimmed.match(/^content="([\s\S]*?)"(?:\s+[a-zA-Z_]+=?|$)/);
  if (doubleQuoted) return doubleQuoted[1];

  return trimmed;
}

function parsePayload(raw: string): ToolPayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return {
        success: true,
        data: parsed,
        count: parsed.length,
      };
    }
    if (typeof parsed === 'string') {
      return parsePayload(parsed);
    }
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed as ToolPayload;
  } catch {
    return parsePythonStylePayload(raw) ?? parseLoosePayload(raw);
  }
}

function parsePythonStylePayload(raw: string): ToolPayload | null {
  const text = raw.trim();
  if (!text.startsWith('{') || !text.endsWith('}')) {
    return null;
  }

  const successMatch = text.match(/['"]success['"]\s*:\s*(True|False|true|false)/);
  const messageMatch = text.match(/['"](message|error|raw|content)['"]\s*:\s*(['"])([\s\S]*?)\2\s*(?:,|})/);
  const countMatch = text.match(/['"]count['"]\s*:\s*(\d+)/);

  if (!successMatch && !messageMatch && !countMatch) {
    return null;
  }

  const payload: ToolPayload = {};
  if (successMatch) {
    payload.success = successMatch[1].toLowerCase() === 'true';
  }
  if (messageMatch) {
    const field = messageMatch[1];
    if (field === 'message') payload.message = messageMatch[3];
    if (field === 'error') payload.error = messageMatch[3];
    if (field === 'raw') payload.raw = messageMatch[3];
    if (field === 'content') payload.content = messageMatch[3];
  }
  if (countMatch) {
    payload.count = Number(countMatch[1]);
  }
  return payload;
}

function extractLooseString(text: string, keys: string[]) {
  for (const key of keys) {
    const strictQuoted = text.match(
      new RegExp(
        String.raw`['"]${key}['"]\s*:\s*(['"])([\s\S]*?)\1(?=\s*,\s*['"][a-zA-Z_]+['"]\s*:|\s*}|$)`,
      ),
    );
    if (strictQuoted?.[2]?.trim()) {
      return strictQuoted[2].trim();
    }

    const truncatedQuoted = text.match(new RegExp(String.raw`['"]${key}['"]\s*:\s*(['"])([\s\S]*)$`));
    if (truncatedQuoted?.[2]?.trim()) {
      return truncatedQuoted[2].trim();
    }

    const unquoted = text.match(
      new RegExp(String.raw`['"]${key}['"]\s*:\s*([^,}]+)(?=\s*,\s*['"][a-zA-Z_]+['"]\s*:|\s*}|$)`),
    );
    if (unquoted?.[1]?.trim()) {
      return unquoted[1].trim();
    }
  }
  return '';
}

function parseLoosePayload(raw: string): ToolPayload | null {
  const text = raw.trim();
  if (!text) return null;

  const successMatch = text.match(/['"]success['"]\s*:\s*(True|False|true|false)/);
  const countMatch = text.match(/['"]count['"]\s*:\s*(\d+)/);
  const message = extractLooseString(text, ['message', 'error', 'raw', 'content']);

  if (!successMatch && !countMatch && !message) {
    return null;
  }

  const payload: ToolPayload = {};
  if (successMatch) {
    payload.success = successMatch[1].toLowerCase() === 'true';
  }
  if (countMatch) {
    payload.count = Number(countMatch[1]);
  }
  if (message) {
    payload.message = message;
  }
  return payload;
}

function getFirstString(...candidates: unknown[]) {
  for (const item of candidates) {
    if (typeof item === 'string' && item.trim()) {
      return item.trim();
    }
  }
  return '';
}

function stripVerboseGuide(message: string) {
  const retryToken = '\u8bf7\u6539\u7528\u4e0b\u9762\u8fd9\u4e9b\u771f\u5b9e\u4e1a\u52a1\u8868\u540d\u540e\u91cd\u8bd5\uff1a';
  const schemaToken = '\u6570\u636e\u5e93\u67e5\u8be2\u53ea\u80fd\u4f7f\u7528\u4e0b\u9762\u8fd9\u4e9b\u771f\u5b9e\u4e1a\u52a1\u8868\u540d\u548c\u5b57\u6bb5\u540d';
  const condensed = message.split(retryToken)[0]?.trim();
  if (condensed) return condensed;
  const schemaGuideIndex = message.indexOf(schemaToken);
  if (schemaGuideIndex > 0) {
    return message.slice(0, schemaGuideIndex).trim();
  }
  return message.trim();
}

function stripPayloadNoise(message: string) {
  return decodeEscapedText(
    message
    .replace(/^['"]|['"]$/g, '')
    .replace(/^content=(['"])([\s\S]*)\1$/u, '$2')
    .replace(/^content=(['"])([\s\S]*?)(?:\1\s+[a-zA-Z_]+=|$)/u, '$2')
    .replace(/\.\.\.\(.*?\)\s*$/u, '')
    .replace(/\s+tool_call_id=.*$/u, '')
    .replace(/\s+name=.*$/u, '')
    .trim(),
  );
}

function buildRawDetail(raw: string, summary: string, detail: string | null) {
  const normalizedRaw = stripPayloadNoise(unwrapToolEnvelope(raw));
  if (!normalizedRaw) return null;

  const comparableRaw = normalizeText(normalizedRaw);
  const comparableSummary = normalizeText(stripPayloadNoise(summary));
  const comparableDetail = detail ? normalizeText(stripPayloadNoise(detail)) : null;

  if (normalizedRaw.length < 160) return null;
  if (comparableRaw === comparableSummary) return null;
  if (comparableDetail && comparableRaw === comparableDetail) return null;

  return normalizedRaw;
}

function getSuccessfulTextSummary(toolName: string, text: string) {
  const compact = normalizeText(stripPayloadNoise(text));
  if (!compact) return null;
  if (compact.length <= 120) {
    return {
      summary: compact,
      detail: null as string | null,
      rawDetail: null as string | null,
    };
  }

  const summaryByTool: Record<string, string> = {
    Knowledge_Base: '\u5df2\u83b7\u53d6\u77e5\u8bc6\u5e93\u53c2\u8003\u5185\u5bb9',
    SQL_Database: '\u5df2\u5b8c\u6210\u6570\u636e\u5e93\u67e5\u8be2',
    Hydraulic_Analysis: '\u5df2\u5b8c\u6210\u6c34\u529b\u8ba1\u7b97',
    query_database: '\u5df2\u5b8c\u6210\u6570\u636e\u5e93\u67e5\u8be2',
    search_knowledge_base: '\u5df2\u83b7\u53d6\u77e5\u8bc6\u5e93\u53c2\u8003\u5185\u5bb9',
    hydraulic_calculation: '\u5df2\u5b8c\u6210\u6c34\u529b\u8ba1\u7b97',
    query_fault_cause: '\u5df2\u83b7\u53d6\u6545\u969c\u539f\u56e0\u5206\u6790\u7ed3\u679c',
    query_standards: '\u5df2\u83b7\u53d6\u6807\u51c6\u89c4\u8303\u53c2\u8003\u5185\u5bb9',
    query_equipment_chain: '\u5df2\u83b7\u53d6\u8bbe\u5907\u5173\u7cfb\u4fe1\u606f',
    run_sensitivity_analysis: '\u5df2\u5b8c\u6210\u654f\u611f\u6027\u5206\u6790',
    plan_complex_task: '\u5df2\u751f\u6210\u590d\u6742\u4efb\u52a1\u5904\u7406\u7ed3\u679c',
    execute_safe_sql: '\u5df2\u5b8c\u6210\u5b89\u5168 SQL \u67e5\u8be2',
    query_projects: '\u5df2\u83b7\u53d6\u9879\u76ee\u5217\u8868\u4fe1\u606f',
    query_project_by_id: '\u5df2\u83b7\u53d6\u9879\u76ee\u8be6\u60c5',
    query_pipelines: '\u5df2\u83b7\u53d6\u7ba1\u9053\u5217\u8868\u4fe1\u606f',
    query_pipeline_detail: '\u5df2\u83b7\u53d6\u7ba1\u9053\u8be6\u60c5',
    query_pump_stations: '\u5df2\u83b7\u53d6\u6cf5\u7ad9\u4fe1\u606f',
    query_oil_properties: '\u5df2\u83b7\u53d6\u6cb9\u54c1\u53c2\u6570',
    get_calculation_parameters: '\u5df2\u83b7\u53d6\u8ba1\u7b97\u53c2\u6570',
  };

  const summary = summaryByTool[toolName] ?? '\u5de5\u5177\u5df2\u8fd4\u56de\u6587\u672c\u7ed3\u679c';

  return {
    summary,
    detail: null,
    rawDetail: null,
  };
}

function looksLikeFailure(text: string) {
  const normalized = stripPayloadNoise(text).toLowerCase();
  if (!normalized) return false;
  if (normalized === '[object object]') return true;
  if (
    normalized.includes('\u672a\u627e\u5230\u6570\u636e') ||
    normalized.includes('\u672a\u67e5\u5230\u6570\u636e')
  ) {
    return false;
  }
  return (
    normalized.includes('\u67e5\u8be2\u5931\u8d25') ||
    normalized.includes('\u6570\u636e\u5e93\u4e0d\u53ef\u7528') ||
    normalized.includes('\u6570\u636e\u5e93\u8fde\u63a5\u5f02\u5e38') ||
    normalized.includes('\u65e0\u6cd5\u8fde\u63a5\u6570\u636e\u5e93') ||
    normalized.includes('\u76ee\u6807\u8ba1\u7b97\u673a\u79ef\u6781\u62d2\u7edd') ||
    normalized.includes('error') ||
    normalized.includes('exception') ||
    normalized.includes('unknown column') ||
    normalized.includes("doesn't exist") ||
    normalized.includes('unknown table') ||
    normalized.includes("can't connect to mysql") ||
    normalized.includes('connection refused') ||
    normalized.includes('10061')
  );
}

function summarizeMessage(message: string) {
  const normalized = normalizeText(stripPayloadNoise(stripVerboseGuide(message)));
  const lower = normalized.toLowerCase();

  if (!normalized) {
    return { summary: '\u5de5\u5177\u6267\u884c\u5b8c\u6210', detail: null as string | null };
  }

  if (
    normalized.includes('\u68c0\u6d4b\u5230\u4e0d\u5b58\u5728\u6216\u4e0d\u5141\u8bb8\u8bbf\u95ee\u7684\u8868\u540d') ||
    lower.includes("doesn't exist") ||
    lower.includes('unknown table')
  ) {
    return {
      summary: '\u67e5\u8be2\u4f7f\u7528\u4e86\u4e0d\u5b58\u5728\u7684\u8868\u540d',
      detail: normalized,
    };
  }

  if (lower.includes('unknown column')) {
    return {
      summary: '\u67e5\u8be2\u5b57\u6bb5\u4e0d\u5b58\u5728',
      detail: normalized,
    };
  }

  if (
    lower.includes("can't connect to mysql") ||
    lower.includes('connection refused') ||
    normalized.includes('\u6570\u636e\u5e93\u4e0d\u53ef\u7528') ||
    normalized.includes('\u6570\u636e\u5e93\u8fde\u63a5\u5f02\u5e38') ||
    normalized.includes('\u65e0\u6cd5\u8fde\u63a5\u6570\u636e\u5e93') ||
    normalized.includes('\u76ee\u6807\u8ba1\u7b97\u673a\u79ef\u6781\u62d2\u7edd') ||
    normalized.includes('10061')
  ) {
    return {
      summary: '\u6570\u636e\u5e93\u6682\u65f6\u4e0d\u53ef\u7528',
      detail: '\u8bf7\u68c0\u67e5 MySQL \u670d\u52a1\u662f\u5426\u542f\u52a8\uff0c\u4ee5\u53ca AI \u670d\u52a1\u7684\u6570\u636e\u5e93\u8fde\u63a5\u914d\u7f6e\u662f\u5426\u6b63\u786e\u3002',
    };
  }

  if (normalized.includes('\u53ea\u5141\u8bb8\u6267\u884c SELECT \u67e5\u8be2')) {
    return {
      summary: '\u53ea\u5141\u8bb8\u6267\u884c SELECT \u67e5\u8be2',
      detail: '\u5f53\u524d\u5de5\u5177\u7981\u6b62\u6267\u884c\u5199\u5165\u3001\u5220\u9664\u6216\u7ed3\u6784\u4fee\u6539\u7c7b SQL\u3002',
    };
  }

  if (
    normalized.includes('\u65e0\u6cd5\u83b7\u53d6\u6570\u636e') ||
    normalized.includes('\u65e0\u6cd5\u8bfb\u53d6\u6570\u636e') ||
    normalized.includes('\u6682\u65f6\u65e0\u6cd5\u83b7\u53d6\u6570\u636e')
  ) {
    return {
      summary: '\u6682\u65f6\u65e0\u6cd5\u83b7\u53d6\u6570\u636e',
      detail: normalized,
    };
  }

  if (normalized.includes('\u7981\u6b62\u67e5\u8be2\u7cfb\u7edf\u7528\u6237\u5bc6\u7801\u5b57\u6bb5')) {
    return {
      summary: '\u654f\u611f\u5b57\u6bb5\u5df2\u88ab\u62e6\u622a',
      detail: normalized,
    };
  }

  if (normalized === '[object Object]') {
    return {
      summary: '\u5de5\u5177\u8fd4\u56de\u683c\u5f0f\u5f02\u5e38',
      detail: '\u524d\u7aef\u6536\u5230\u4e86\u975e\u6807\u51c6\u5de5\u5177\u8f93\u51fa\uff0c\u8bf7\u67e5\u770b\u539f\u59cb\u8fd4\u56de\u6216\u91cd\u8bd5\u3002',
    };
  }

  if (
    normalized.includes('\u672a\u627e\u5230\u6570\u636e') ||
    normalized.includes('\u672a\u67e5\u5230\u6570\u636e')
  ) {
    return {
      summary: '\u672a\u67e5\u5230\u6570\u636e',
      detail: normalized,
    };
  }

  return {
    summary: normalized.length > 88 ? `${normalized.slice(0, 88)}...` : normalized,
    detail: normalized.length > 88 ? normalized : null,
  };
}

function toCount(payload: ToolPayload) {
  if (typeof payload.count === 'number' && Number.isFinite(payload.count)) {
    return payload.count;
  }
  if (Array.isArray(payload.data)) {
    return payload.data.length;
  }
  if (payload.data && typeof payload.data === 'object') {
    return 1;
  }
  return null;
}

export function getToolTitle(toolName: string) {
  return TOOL_LABELS[toolName] ?? toolName;
}

export function getToolDisplayStatus(tool: ToolExecutionEvent) {
  return describeToolOutput(tool).displayStatus;
}

export function describeToolOutput(tool: ToolExecutionEvent): ToolOutputPresentation {
  if (!tool.output?.trim()) {
    if (tool.status === 'running') {
      return {
        displayStatus: 'running',
        summary: '\u7b49\u5f85\u5de5\u5177\u8fd4\u56de\u7ed3\u679c',
        detail: null,
        rawDetail: null,
      };
    }
    return {
      displayStatus: tool.status,
      summary: tool.status === 'failed' ? '\u5de5\u5177\u6267\u884c\u5931\u8d25' : '\u5de5\u5177\u6267\u884c\u5b8c\u6210',
      detail: null,
      rawDetail: null,
    };
  }

  const rawDetail = tool.output.trim();
  const unwrapped = unwrapToolEnvelope(rawDetail);
  const payload = parsePayload(unwrapped);

  if (payload) {
    const message = getFirstString(payload.message, payload.error, payload.raw, payload.content);
    const count = toCount(payload);

    if (payload.success === false) {
      const summarized = summarizeMessage(message || unwrapped);
      return {
        displayStatus: 'failed',
        summary: summarized.summary,
        detail: summarized.detail,
        rawDetail: buildRawDetail(rawDetail, summarized.summary, summarized.detail),
      };
    }

    if (payload.success === true) {
      if (count === 0) {
        return {
          displayStatus: 'completed',
          summary: '\u672a\u67e5\u5230\u6570\u636e',
          detail:
            message && message !== '\u67e5\u8be2\u6210\u529f\uff0c\u4f46\u672a\u627e\u5230\u6570\u636e'
              ? normalizeText(message)
              : null,
          rawDetail: buildRawDetail(rawDetail, '\u672a\u67e5\u5230\u6570\u636e', message ? normalizeText(message) : null),
        };
      }

      if (typeof count === 'number' && count > 0) {
        return {
          displayStatus: 'completed',
          summary: `\u5df2\u8fd4\u56de ${count} \u6761\u7ed3\u679c`,
          detail: message ? normalizeText(message) : null,
          rawDetail: buildRawDetail(
            rawDetail,
            `\u5df2\u8fd4\u56de ${count} \u6761\u7ed3\u679c`,
            message ? normalizeText(message) : null,
          ),
        };
      }

      if (message) {
        const summarized = summarizeMessage(message);
        const successfulText = !looksLikeFailure(message)
          ? getSuccessfulTextSummary(tool.tool, message)
          : null;
        if (successfulText) {
          return {
            displayStatus: 'completed',
            summary: successfulText.summary,
            detail: successfulText.detail,
            rawDetail: successfulText.rawDetail,
          };
        }
        return {
          displayStatus: looksLikeFailure(message) ? 'failed' : 'completed',
          summary: summarized.summary,
          detail: summarized.detail,
          rawDetail: buildRawDetail(rawDetail, summarized.summary, summarized.detail),
        };
      }
    }

    if (message) {
      const summarized = summarizeMessage(message);
      const successfulText =
        !looksLikeFailure(message) && tool.status !== 'failed'
          ? getSuccessfulTextSummary(tool.tool, message)
          : null;
      if (successfulText) {
        return {
          displayStatus: 'completed',
          summary: successfulText.summary,
          detail: successfulText.detail,
          rawDetail: successfulText.rawDetail,
        };
      }
      return {
        displayStatus: looksLikeFailure(message) ? 'failed' : tool.status,
        summary: summarized.summary,
        detail: summarized.detail,
        rawDetail: buildRawDetail(rawDetail, summarized.summary, summarized.detail),
      };
    }
  }

  const summarized = summarizeMessage(unwrapped);
  const successfulText =
    !looksLikeFailure(unwrapped) && tool.status !== 'failed'
      ? getSuccessfulTextSummary(tool.tool, unwrapped)
      : null;
  if (successfulText) {
    return {
      displayStatus: 'completed',
      summary: successfulText.summary,
      detail: successfulText.detail,
      rawDetail: successfulText.rawDetail,
    };
  }
  return {
    displayStatus: looksLikeFailure(unwrapped) ? 'failed' : tool.status,
    summary: summarized.summary,
    detail: summarized.detail,
    rawDetail: buildRawDetail(rawDetail, summarized.summary, summarized.detail),
  };
}
