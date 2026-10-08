import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Bookmark, Bot, ChevronDown, Clock3, Database, Settings2, Zap } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import AnimatedPage from '../../components/common/AnimatedPage';
import { HITLDialog } from '../../components/agent';
import { useAgentTrace } from '../../hooks/useAgentTrace';
import { useScrollToBottom } from '../../hooks/useScrollToBottom';
import {
  ChatTopbar,
  ComposerDock,
  ContextRail,
  ConversationSidebar,
  EmptyStateWelcome,
  ChatMessageItem,
} from '../../features/ai-chat/components';
import { useChatConversations } from '../../features/ai-chat/hooks/useChatConversations';
import type { PendingStreamTarget, UIMessage } from '../../features/ai-chat/types-fixed';
import { getFriendlyError, getStreamLabel, WELCOME_PROMPTS } from '../../features/ai-chat/utils/chatUi';
import styles from './AIChat.module.css';

const BUSY_STATES = new Set(['planning', 'executing', 'waiting_hitl']);
const MODE_PREFIX: Record<'standard' | 'diagnosis' | 'optimization', string> = {
  standard: '',
  diagnosis: '请以故障诊断模式回答，优先做异常定位、原因链分析、风险等级与排查步骤。\n\n',
  optimization: '请以优化建议模式回答，优先给出节能调度、泵站组合优化、约束条件、预期收益与实施建议。\n\n',
};

function buildOutboundMessage(content: string, mode: 'standard' | 'diagnosis' | 'optimization') {
  const prefix = MODE_PREFIX[mode];
  if (!prefix) {
    return content;
  }
  return `${prefix}用户问题：${content}`;
}

const CHAT_NAV_ITEMS = [
  { path: '/dashboard', label: '首页总览', icon: Clock3 },
  { path: '/data/project', label: '项目·管道·泵站', icon: Database },
  { path: '/analysis/hydraulic', label: '水力分析', icon: Zap },
  { path: '/analysis/optimization', label: '泵站优化', icon: Settings2 },
  { path: '/analysis/sensitivity', label: '敏感性分析', icon: BarChart3 },
  { path: '/ai/chat', label: '智能对话', icon: Bot },
  { path: '/ai/report', label: '智能报告', icon: Bookmark },
];

function CompactNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <nav className={styles.compactNav} aria-label="主导航">
      <button type="button" className={styles.compactLogo} onClick={() => navigate('/dashboard')} aria-label="返回首页">N</button>
      {CHAT_NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <button key={item.path} type="button" className={[styles.compactNavItem, location.pathname === item.path ? styles.compactNavActive : ''].join(' ')} onClick={() => navigate(item.path)} aria-label={item.label} data-label={item.label}>
            <Icon size={19} strokeWidth={2} />
          </button>
        );
      })}
    </nav>
  );
}

export default function AIChat() {
  const [draft, setDraft] = useState('');
  const [pendingTarget, setPendingTarget] = useState<PendingStreamTarget | null>(null);
  const {
    conversations,
    activeConversation,
    activeConversationId,
    setActiveConversationId,
    createNewConversation,
    removeConversation,
    setConversationMode,
    appendExchange,
    updateAssistantMessage,
  } = useChatConversations();

  const {
    activeTools,
    connected,
    currentStep,
    dismissHITL,
    errorMessage,
    finalResponse,
    hitlRequest,
    logs,
    metrics,
    plan,
    reset,
    startChat,
    status,
    stop,
    streaming,
    submitHITL,
  } = useAgentTrace(activeConversationId ?? 'chat-default');

  const busy = BUSY_STATES.has(status);
  const messages = activeConversation?.messages ?? [];
  const streamLabel = useMemo(() => getStreamLabel(status, activeTools), [activeTools, status]);

  const { ref: messagesRef, isAtBottom, scrollToBottom } = useScrollToBottom<HTMLDivElement>(
    [activeConversationId, messages.length, finalResponse, status],
    { enabled: true, behavior: 'smooth', threshold: 120 },
  );

  useEffect(() => {
    reset();
  }, [activeConversationId, reset]);

  useEffect(() => {
    if (!pendingTarget) return;
    if (!activeConversationId || pendingTarget.conversationId !== activeConversationId) return;

    const nextStatus = status === 'error'
      ? 'error'
      : status === 'stopped'
        ? 'stopped'
        : streaming || busy
          ? 'streaming'
          : 'completed';

    updateAssistantMessage(pendingTarget.conversationId, pendingTarget.assistantMessageId, {
      content: finalResponse,
      status: nextStatus,
      toolCalls: activeTools,
      requestText: pendingTarget.requestText,
      error: status === 'error' ? getFriendlyError(errorMessage ?? logs[logs.length - 1]?.text) : null,
    });
  }, [
    activeConversationId,
    activeTools,
    busy,
    errorMessage,
    finalResponse,
    logs,
    pendingTarget,
    status,
    streaming,
    updateAssistantMessage,
  ]);

  const activeMode = activeConversation?.mode ?? 'standard';

  const sendMessage = (text: string) => {
    const content = text.trim();
    if (!content || busy) return;

    const targetConversationId = activeConversationId ?? createNewConversation(activeMode);
    const assistantMessageId = appendExchange(targetConversationId, content);
    setPendingTarget({
      conversationId: targetConversationId,
      assistantMessageId,
      requestText: content,
    });
    setDraft('');
    startChat(buildOutboundMessage(content, activeMode), activeMode);
  };

  const handleRetry = (message: UIMessage) => {
    if (!message.requestText || busy) return;
    sendMessage(message.requestText);
  };

  const handleSelectConversation = (conversationId: string) => {
    if (conversationId === activeConversationId) {
      return;
    }
    if (busy || streaming) {
      stop();
    }
    setActiveConversationId(conversationId);
  };

  const handleCreateConversation = () => {
    if (busy || streaming) {
      stop();
    }
    createNewConversation(activeMode);
    setDraft('');
  };

  const handleDeleteConversation = (conversationId: string) => {
    if (conversationId === activeConversationId && (busy || streaming)) {
      stop();
    }
    removeConversation(conversationId);
  };

  return (
    <AnimatedPage className={styles.workspace}>
      <CompactNavigation />

      <ConversationSidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        onCreate={handleCreateConversation}
        onSelect={handleSelectConversation}
        onDelete={handleDeleteConversation}
      />

      <div className={styles.chatColumn}>
        <ChatTopbar
          title={activeConversation?.title ?? '新会话'}
          connected={connected}
          streaming={streaming}
          status={status}
        />

        <div className={styles.chatBody}>
          <section className={styles.messageColumn}>
            <div
              ref={messagesRef}
              className={[
                styles.messageScroller,
                messages.length === 0 ? 'overflow-hidden' : 'overflow-y-auto',
              ].join(' ')}
            >
              <div className={[
                'mx-auto flex min-h-full w-full max-w-[820px] flex-col px-5 md:px-7',
                messages.length === 0 ? 'justify-center py-8' : 'pb-12 pt-6',
              ].join(' ')}>
                {messages.length === 0 ? (
                  <EmptyStateWelcome prompts={WELCOME_PROMPTS} onPromptSelect={sendMessage} />
                ) : (
                  <div className="w-full space-y-5 pb-10">
                    {messages.map((message) => (
                      <ChatMessageItem
                        key={message.id}
                        message={message}
                        streamingLabel={message.status === 'streaming' ? streamLabel : null}
                        onRetry={handleRetry}
                        onReusePrompt={(prompt) => setDraft(prompt)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <ComposerDock
              draft={draft}
              mode={activeMode}
              busy={busy || streaming}
              compact={messages.length === 0}
              prompts={WELCOME_PROMPTS}
              onDraftChange={setDraft}
              onModeChange={(mode) => {
                if (activeConversationId) {
                  setConversationMode(activeConversationId, mode);
                }
              }}
              onSubmit={() => sendMessage(draft)}
              onStop={stop}
            />
          </section>

        </div>
      </div>

      <aside className={styles.commandColumn}>
        <ContextRail
          plan={plan}
          logs={logs}
          metrics={metrics}
          activeTools={activeTools}
          currentStep={currentStep}
          status={status}
        />
      </aside>

      {!isAtBottom && messages.length > 0 ? (
        <button
          type="button"
          className="absolute bottom-36 right-6 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-neutral-700 shadow-[0_10px_30px_rgba(15,23,42,0.12)] ring-1 ring-black/5 transition hover:text-neutral-950"
          onClick={() => scrollToBottom()}
          aria-label="滚动到底部"
        >
          <ChevronDown className="h-5 w-5" />
        </button>
      ) : null}

      <HITLDialog request={hitlRequest} onSubmit={submitHITL} onCancel={dismissHITL} />
    </AnimatedPage>
  );
}
