import type { ToolExecutionEvent } from '../../types/agent';

export type ChatMode = 'standard' | 'diagnosis' | 'optimization';

export type UIMessageStatus = 'pending' | 'streaming' | 'completed' | 'error' | 'stopped';

export interface UIErrorState {
  title: string;
  description: string;
  actionLabel?: string;
}

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  status?: UIMessageStatus;
  requestText?: string;
  toolCalls?: ToolExecutionEvent[];
  error?: UIErrorState | null;
}

export interface ChatConversation {
  id: string;
  title: string;
  mode: ChatMode;
  createdAt: string;
  updatedAt: string;
  preview: string;
  messages: UIMessage[];
  pinned?: boolean;
}

export interface PendingStreamTarget {
  conversationId: string;
  assistantMessageId: string;
  requestText: string;
}
