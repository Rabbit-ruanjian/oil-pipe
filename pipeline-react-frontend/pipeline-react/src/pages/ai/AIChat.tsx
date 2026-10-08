import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
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

export default function AIChat() {
  const [draft, setDraft] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(true);
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
      setSidebarOpen(false);
      return;
    }
    if (busy || streaming) {
      stop();
    }
    setActiveConversationId(conversationId);
    setSidebarOpen(false);
  };

  const handleCreateConversation = () => {
    if (busy || streaming) {
      stop();
    }
    createNewConversation(activeMode);
    setDraft('');
    setSidebarOpen(false);
  };

  const handleDeleteConversation = (conversationId: string) => {
    if (conversationId === activeConversationId && (busy || streaming)) {
      stop();
    }
    removeConversation(conversationId);
  };

  return (
    <AnimatedPage className="relative grid h-full min-h-0 grid-cols-[296px_minmax(0,1fr)] overflow-hidden rounded-[24px] border border-neutral-200/80 bg-white text-neutral-900 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
      <ConversationSidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onCreate={handleCreateConversation}
        onSelect={handleSelectConversation}
        onDelete={handleDeleteConversation}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(241,245,249,0.88),transparent_30%),linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)]">
        <ChatTopbar
          title={activeConversation?.title ?? '新会话'}
          mode={activeMode}
          connected={connected}
          streaming={streaming}
          status={status}
          compact={messages.length === 0}
          contextOpen={contextOpen}
          onToggleSidebar={() => setSidebarOpen(true)}
          onToggleContext={() => setContextOpen((prev) => !prev)}
          onModeChange={(mode) => {
            if (activeConversationId) {
              setConversationMode(activeConversationId, mode);
            }
          }}
        />

        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col">
            <div
              ref={messagesRef}
              className={[
                'min-h-0 flex-1',
                messages.length === 0 ? 'overflow-hidden' : 'overflow-y-auto',
              ].join(' ')}
            >
              <div
                className={[
                  'flex min-h-full w-full max-w-[1060px] flex-col px-4 md:px-6 xl:pl-8 xl:pr-10',
                  messages.length === 0 ? 'justify-start py-3' : 'pb-12 pt-6',
                ].join(' ')}
              >
                {messages.length === 0 ? (
                  <EmptyStateWelcome prompts={WELCOME_PROMPTS} onPromptSelect={sendMessage} />
                ) : (
                  <div className="w-full max-w-[980px] space-y-6 pb-10 xl:max-w-[1020px]">
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

          <aside
            className={[
              'hidden border-l border-neutral-200/70 bg-white/50 transition-all duration-200 xl:block',
              contextOpen ? 'w-[320px]' : 'w-0 overflow-hidden border-l-0',
            ].join(' ')}
          >
            {contextOpen ? (
              <ContextRail
                plan={plan}
                logs={logs}
                metrics={metrics}
                activeTools={activeTools}
                currentStep={currentStep}
              />
            ) : null}
          </aside>
        </div>
      </div>

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
