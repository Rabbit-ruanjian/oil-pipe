import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChatConversation, ChatMode, UIMessage } from '../types';
import {
  buildConversationPreview,
  buildConversationTitle,
  makeId,
  shouldAutoRenameConversation,
} from '../utils/chatUi';

const STORAGE_KEY = 'ai-chat-conversations-v2';

function createConversation(mode: ChatMode = 'standard'): ChatConversation {
  const now = new Date().toISOString();
  return {
    id: makeId('chat'),
    title: '新会话',
    mode,
    createdAt: now,
    updatedAt: now,
    preview: '开始一段新的分析对话',
    messages: [],
  };
}

function getPreviewFromMessages(messages: UIMessage[]) {
  const lastMeaningful = [...messages].reverse().find((message) => message.content.trim());
  return lastMeaningful ? buildConversationPreview(lastMeaningful.content) : '开始一段新的分析对话';
}

function loadInitialState() {
  if (typeof window === 'undefined') {
    const initial = createConversation();
    return { conversations: [initial], activeConversationId: initial.id };
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const initial = createConversation();
    return { conversations: [initial], activeConversationId: initial.id };
  }

  try {
    const parsed = JSON.parse(raw) as { conversations?: ChatConversation[]; activeConversationId?: string | null };
    if (parsed.conversations && parsed.conversations.length > 0) {
      return {
        conversations: parsed.conversations,
        activeConversationId: parsed.activeConversationId ?? parsed.conversations[0].id,
      };
    }
  } catch {
    // ignore invalid cache and rebuild below
  }

  const initial = createConversation();
  return { conversations: [initial], activeConversationId: initial.id };
}

export function useChatConversations() {
  const [initialState] = useState(loadInitialState);
  const [conversations, setConversations] = useState<ChatConversation[]>(initialState.conversations);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(initialState.activeConversationId);

  useEffect(() => {
    if (!conversations.length || !activeConversationId) return;
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ conversations, activeConversationId }),
      );
    }, 250);

    return () => window.clearTimeout(timer);
  }, [activeConversationId, conversations]);

  const createNewConversation = useCallback((mode: ChatMode = 'standard') => {
    const next = createConversation(mode);
    setConversations((prev) => [next, ...prev]);
    setActiveConversationId(next.id);
    return next.id;
  }, []);

  const removeConversation = useCallback((conversationId: string) => {
    setConversations((prev) => {
      const filtered = prev.filter((conversation) => conversation.id !== conversationId);
      if (filtered.length === 0) {
        const next = createConversation();
        setActiveConversationId(next.id);
        return [next];
      }
      setActiveConversationId((current) => (current === conversationId ? filtered[0].id : current));
      return filtered;
    });
  }, []);

  const setConversationMode = useCallback((conversationId: string, mode: ChatMode) => {
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, mode, updatedAt: new Date().toISOString() }
          : conversation,
      ),
    );
  }, []);

  const appendExchange = useCallback((conversationId: string, prompt: string) => {
    const now = new Date().toISOString();
    const userMessage: UIMessage = {
      id: makeId('message'),
      role: 'user',
      content: prompt,
      createdAt: now,
      status: 'completed',
    };
    const assistantMessage: UIMessage = {
      id: makeId('message'),
      role: 'assistant',
      content: '',
      createdAt: now,
      status: 'streaming',
      requestText: prompt,
      toolCalls: [],
      error: null,
    };

    setConversations((prev) =>
      prev.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        const nextMessages = [...conversation.messages, userMessage, assistantMessage];
        return {
          ...conversation,
          title: shouldAutoRenameConversation(conversation.title)
            ? buildConversationTitle(prompt)
            : conversation.title,
          updatedAt: now,
          preview: buildConversationPreview(prompt),
          messages: nextMessages,
        };
      }),
    );

    return assistantMessage.id;
  }, []);

  const updateAssistantMessage = useCallback((conversationId: string, messageId: string, patch: Partial<UIMessage>) => {
    setConversations((prev) =>
      prev.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        const nextMessages = conversation.messages.map((message) =>
          message.id === messageId ? { ...message, ...patch } : message,
        );
        return {
          ...conversation,
          updatedAt: new Date().toISOString(),
          preview: getPreviewFromMessages(nextMessages),
          messages: nextMessages,
        };
      }),
    );
  }, []);

  const getConversationById = useCallback(
    (conversationId: string | null) =>
      (conversationId ? conversations.find((conversation) => conversation.id === conversationId) : undefined) ?? null,
    [conversations],
  );

  const activeConversation = useMemo(
    () => getConversationById(activeConversationId),
    [activeConversationId, getConversationById],
  );

  return {
    conversations,
    activeConversation,
    activeConversationId,
    setActiveConversationId,
    createNewConversation,
    removeConversation,
    setConversationMode,
    appendExchange,
    updateAssistantMessage,
  };
}
