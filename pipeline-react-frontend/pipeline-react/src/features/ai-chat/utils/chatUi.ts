import type { TraceStatus, ToolExecutionEvent } from '../../../types/agent';
import type { ChatMode, UIErrorState } from '../types';

const DEFAULT_TITLES = new Set(['新会话', '未命名会话']);

export const MODE_OPTIONS: Array<{ value: ChatMode; label: string; description: string }> = [
  { value: 'standard', label: '标准分析', description: '适合常规问答和业务分析' },
  { value: 'diagnosis', label: '深度诊断', description: '更强调故障定位和原因追踪' },
  { value: 'optimization', label: '优化建议', description: '优先给出节能调度和优化方案' },
];

export const WELCOME_PROMPTS = [
  '分析当前输油工况的能耗瓶颈，并给出优化建议',
  '比较两套泵站运行方案的成本、安全性和节能效果',
  '结合当前数据生成一份可执行的节能调度建议',
  '诊断末站压力异常下降的可能原因，并给出处置建议',
];

export function makeId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function buildConversationTitle(input: string) {
  const normalized = input.replace(/\s+/g, ' ').trim();
  if (!normalized) return '新会话';
  return normalized.length > 24 ? `${normalized.slice(0, 24)}...` : normalized;
}

export function shouldAutoRenameConversation(title: string) {
  return DEFAULT_TITLES.has(title);
}

export function buildConversationPreview(input: string) {
  const normalized = input.replace(/\s+/g, ' ').trim();
  return normalized.length > 40 ? `${normalized.slice(0, 40)}...` : normalized;
}

export function getFriendlyError(error?: string | null): UIErrorState {
  const message = (error || '').trim();
  const normalized = message.toLowerCase();

  if (!message) {
    return {
      title: '本次回复未完成',
      description: '你可以重试，或缩小问题范围后再试一次。',
      actionLabel: '重试',
    };
  }

  if (normalized.includes('failed to fetch') || normalized.includes('network') || normalized.includes('sse connection error')) {
    return {
      title: '网络连接中断',
      description: '请确认智能助手服务可用后重试，或稍后再次发起分析。',
      actionLabel: '重试',
    };
  }

  if (normalized.includes('401') || normalized.includes('403') || normalized.includes('token')) {
    return {
      title: '登录状态已失效',
      description: '请重新登录后继续当前分析。',
      actionLabel: '重新登录',
    };
  }

  if (normalized.includes('408') || normalized.includes('504') || normalized.includes('timeout')) {
    return {
      title: '响应超时',
      description: '助手暂时没有完成分析，你可以重试或简化问题后再试。',
      actionLabel: '重试',
    };
  }

  if (normalized.includes('500') || normalized.includes('502') || normalized.includes('503')) {
    return {
      title: '服务暂时不可用',
      description: '后端分析服务当前不可用，请稍后再试。',
      actionLabel: '重试',
    };
  }

  return {
    title: '本次分析未完成',
    description: '你可以重试，或重新描述问题后继续。',
    actionLabel: '重试',
  };
}

export function getStreamLabel(status: TraceStatus, activeTools: ToolExecutionEvent[]) {
  if (status === 'waiting_hitl') return '等待人工确认';
  if (activeTools.some((tool) => tool.status === 'running')) return '正在调用分析工具';
  if (status === 'planning') return '正在理解问题';
  if (status === 'executing') return '正在生成分析结果';
  if (status === 'stopped') return '已停止生成';
  return null;
}

export function formatConversationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}
