import {
  MessageSquarePlus,
  MoreHorizontal,
  Search,
  Settings2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { ChatConversation } from '../types';
import { formatConversationTime } from '../utils/chatUi';

interface ConversationSidebarProps {
  conversations: ChatConversation[];
  activeConversationId: string | null;
  open: boolean;
  onClose?: () => void;
  onCreate: () => void;
  onSelect: (conversationId: string) => void;
  onDelete: (conversationId: string) => void;
}

export function ConversationSidebar({
  conversations,
  activeConversationId,
  open: _open,
  onClose: _onClose,
  onCreate,
  onSelect,
  onDelete,
}: ConversationSidebarProps) {
  return (
    <aside className="relative flex h-full min-h-0 flex-col border-r border-slate-200/80 bg-[radial-gradient(circle_at_top_left,rgba(191,219,254,0.55),transparent_26%),linear-gradient(180deg,#f8fbff_0%,#f4f7fb_42%,#eef3f8_100%)] px-4 py-4">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(255,255,255,0.72)_0%,rgba(255,255,255,0)_100%)]" />

      <div className="relative flex items-start gap-3 rounded-[28px] border border-white/65 bg-white/70 px-3 py-3 shadow-[0_18px_40px_rgba(148,163,184,0.14)] backdrop-blur-sm">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#dbeafe_0%,#bfdbfe_52%,#e2e8f0_100%)] text-slate-700 shadow-[0_10px_24px_rgba(148,163,184,0.22)] ring-1 ring-white/80">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="truncate text-sm font-semibold text-neutral-900">智能分析助手</div>
            <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700">
              AI
            </span>
          </div>
          <div className="mt-1 text-xs leading-5 text-neutral-500">专业智能工作台</div>
          <div className="mt-3 flex items-center gap-2 text-[11px] text-neutral-400">
            <span className="rounded-full bg-white/90 px-2.5 py-1 ring-1 ring-slate-200/70">
              {conversations.length} 个会话
            </span>
            <span>本地保存</span>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onCreate}
        className="relative mt-4 inline-flex items-center justify-center gap-2 overflow-hidden rounded-2xl border border-sky-200/80 bg-[linear-gradient(135deg,#eff6ff_0%,#dbeafe_56%,#e0f2fe_100%)] px-4 py-3 text-sm font-medium text-slate-800 shadow-[0_14px_28px_rgba(147,197,253,0.18)] transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-[0_18px_34px_rgba(147,197,253,0.22)]"
      >
        <span className="pointer-events-none absolute inset-x-8 top-0 h-px bg-white/80" />
        <MessageSquarePlus className="h-4 w-4" />
        新建会话
      </button>

      <div className="mt-4 flex items-center gap-2 rounded-2xl border border-white/70 bg-white/80 px-3 py-2.5 text-sm text-neutral-500 shadow-[0_8px_20px_rgba(15,23,42,0.04)] backdrop-blur-sm">
        <Search className="h-4 w-4" />
        <span>搜索会话</span>
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="mb-3 flex items-center justify-between px-2">
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-neutral-400">
            最近会话
          </div>
          <div className="text-[11px] text-neutral-400">{conversations.length}</div>
        </div>

        <div className="space-y-1.5">
          {conversations.map((conversation) => {
            const active = conversation.id === activeConversationId;
            return (
              <div
                key={conversation.id}
                className={[
                  'group relative overflow-hidden rounded-[22px] border p-2.5 transition',
                  active
                    ? 'border-sky-200/90 bg-[linear-gradient(135deg,rgba(239,246,255,0.98)_0%,rgba(219,234,254,0.96)_56%,rgba(248,250,252,0.96)_100%)] text-slate-900 shadow-[0_14px_30px_rgba(148,163,184,0.18)]'
                    : 'border-transparent bg-white/35 hover:border-white/70 hover:bg-white/85 hover:shadow-[0_12px_26px_rgba(15,23,42,0.06)]',
                ].join(' ')}
              >
                {active ? (
                  <div className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-[linear-gradient(180deg,#38bdf8_0%,#60a5fa_100%)]" />
                ) : null}

                <button
                  type="button"
                  className="block w-full text-left"
                  onClick={() => onSelect(conversation.id)}
                >
                  <div className="truncate pr-2 text-sm font-medium">{conversation.title}</div>
                  <div className={['mt-1 line-clamp-2 text-xs', active ? 'text-slate-600' : 'text-neutral-500'].join(' ')}>
                    {conversation.preview}
                  </div>
                  <div className={['mt-2 text-[11px]', active ? 'text-slate-500' : 'text-neutral-400'].join(' ')}>
                    {formatConversationTime(conversation.updatedAt)}
                  </div>
                </button>

                <div className={['mt-2 flex items-center justify-end gap-1', active ? 'text-slate-500' : 'text-neutral-400'].join(' ')}>
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-white/70 hover:text-neutral-900"
                    aria-label="更多"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-rose-50 hover:text-rose-600"
                    aria-label="删除会话"
                    onClick={() => onDelete(conversation.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 border-t border-white/70 px-1 pt-3">
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-2xl border border-transparent px-3 py-2.5 text-sm text-neutral-600 transition hover:border-white/70 hover:bg-white/80 hover:text-neutral-900"
        >
          <Settings2 className="h-4 w-4" />
          设置
        </button>
      </div>
    </aside>
  );
}
