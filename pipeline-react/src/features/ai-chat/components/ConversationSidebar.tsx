import { MessageSquarePlus, Search, Settings2, Sparkles, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ChatConversation } from '../types';
import { formatConversationTime } from '../utils/chatUi';

interface ConversationSidebarProps {
  conversations: ChatConversation[];
  activeConversationId: string | null;
  onCreate: () => void;
  onSelect: (conversationId: string) => void;
  onDelete: (conversationId: string) => void;
}

export function ConversationSidebar({ conversations, activeConversationId, onCreate, onSelect, onDelete }: ConversationSidebarProps) {
  const [query, setQuery] = useState('');
  const filteredConversations = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return conversations;
    return conversations.filter((conversation) => `${conversation.title} ${conversation.preview}`.toLowerCase().includes(keyword));
  }, [conversations, query]);

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden border-r border-[#e2e9f2] bg-white px-3 py-3.5">
      <div className="flex items-center gap-2.5 px-1.5 pb-3.5 pt-1">
        <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] bg-[linear-gradient(135deg,#0e6e8c,#0fa3c0)] text-white">
          <Sparkles className="h-[19px] w-[19px]" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold text-[#132542]">智能分析助手</div>
          <div className="mt-0.5 text-[10px] text-[#7188a8]">专业智能工作台</div>
        </div>
        <span className="ml-auto rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[9px] font-bold text-[#059669]">AI</span>
      </div>

      <button type="button" onClick={onCreate} className="mb-2.5 inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-[linear-gradient(135deg,#0e6e8c,#0fa3c0)] px-3 text-[12.5px] font-bold text-white shadow-[0_5px_14px_rgba(14,110,140,.2)] transition hover:brightness-105">
        <MessageSquarePlus className="h-[15px] w-[15px]" />
        新建会话
      </button>

      <label className="mb-3 flex items-center gap-2 rounded-[9px] border border-[#e2e9f2] px-2.5 py-2 text-[#94a3b8] focus-within:border-[#67e8f9]">
        <Search className="h-3.5 w-3.5 shrink-0" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索会话" className="min-w-0 flex-1 bg-transparent text-[11.5px] text-[#132542] outline-none placeholder:text-[#94a3b8]" />
      </label>

      <div className="mb-1.5 flex items-center justify-between px-1 text-[10px] tracking-[0.1em] text-[#7188a8]">
        <span>最近会话</span><span>{filteredConversations.length} 个会话</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filteredConversations.map((conversation) => {
          const active = conversation.id === activeConversationId;
          return (
            <div key={conversation.id} className={['group relative mb-1 rounded-[9px] border-l-[3px] px-2.5 py-2.5 transition', active ? 'border-l-[#0e6e8c] bg-[rgba(14,110,140,.08)]' : 'border-l-transparent hover:bg-[#f4f8fe]'].join(' ')}>
              <button type="button" className="block w-full pr-7 text-left" onClick={() => onSelect(conversation.id)}>
                <div className="truncate text-[11.5px] font-semibold text-[#132542]">{conversation.title}</div>
                <div className="mt-1 text-[9.5px] text-[#94a3b8]">{formatConversationTime(conversation.updatedAt)}</div>
              </button>
              <button type="button" className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-[#94a3b8] opacity-0 transition hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100" onClick={() => onDelete(conversation.id)} aria-label="删除会话">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
        {filteredConversations.length === 0 ? <div className="px-2 py-6 text-center text-[11px] text-[#94a3b8]">没有匹配的会话</div> : null}
      </div>

      <button type="button" className="mt-2 inline-flex items-center gap-2 rounded-[9px] border border-[#e2e9f2] px-2.5 py-2 text-[11.5px] text-[#3d557a] transition hover:bg-[#f4f8fe]">
        <Settings2 className="h-[15px] w-[15px] text-[#7188a8]" />
        设置
      </button>
    </aside>
  );
}
