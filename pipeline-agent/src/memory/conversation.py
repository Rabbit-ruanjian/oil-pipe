"""
对话历史管理
"""

from typing import List, Dict, Optional
from dataclasses import dataclass, field
from datetime import datetime

from langchain_core.messages import BaseMessage, HumanMessage, AIMessage

from src.utils import logger


@dataclass
class ConversationTurn:
    """对话轮次"""
    role: str  # "user" or "assistant"
    content: str
    timestamp: datetime = field(default_factory=datetime.now)
    metadata: Dict = field(default_factory=dict)


class ConversationMemory:
    """
    对话记忆

    管理会话的对话历史
    """

    def __init__(self, max_turns: int = 20):
        """
        初始化对话记忆

        Args:
            max_turns: 最大保留轮次
        """
        self.max_turns = max_turns
        self._sessions: Dict[str, List[ConversationTurn]] = {}

    def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        metadata: Optional[Dict] = None
    ):
        """
        添加消息

        Args:
            session_id: 会话ID
            role: 角色 (user/assistant)
            content: 消息内容
            metadata: 元数据
        """
        if session_id not in self._sessions:
            self._sessions[session_id] = []

        turn = ConversationTurn(
            role=role,
            content=content,
            metadata=metadata or {}
        )

        self._sessions[session_id].append(turn)

        # 限制历史长度
        if len(self._sessions[session_id]) > self.max_turns:
            self._sessions[session_id] = self._sessions[session_id][-self.max_turns:]

    def get_history(
        self,
        session_id: str,
        max_turns: int = None
    ) -> List[ConversationTurn]:
        """
        获取对话历史

        Args:
            session_id: 会话ID
            max_turns: 最大返回轮次

        Returns:
            对话历史列表
        """
        history = self._sessions.get(session_id, [])

        if max_turns:
            return history[-max_turns:]

        return history

    def get_messages(self, session_id: str) -> List[BaseMessage]:
        """
        获取LangChain消息格式的历史

        Args:
            session_id: 会话ID

        Returns:
            LangChain消息列表
        """
        history = self.get_history(session_id)
        messages = []

        for turn in history:
            if turn.role == "user":
                messages.append(HumanMessage(content=turn.content))
            else:
                messages.append(AIMessage(content=turn.content))

        return messages

    def clear_session(self, session_id: str):
        """
        清除会话历史

        Args:
            session_id: 会话ID
        """
        if session_id in self._sessions:
            del self._sessions[session_id]

    def get_session_count(self) -> int:
        """获取活跃会话数"""
        return len(self._sessions)


# 全局实例
_memory: Optional[ConversationMemory] = None


def get_conversation_memory() -> ConversationMemory:
    """获取对话记忆实例"""
    global _memory
    if _memory is None:
        _memory = ConversationMemory()
    return _memory
