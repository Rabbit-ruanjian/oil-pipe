"""
历史摘要
用于长对话的历史压缩
"""

from typing import Optional, List

from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

from src.config import settings
from src.utils import logger


class ConversationSummarizer:
    """
    对话摘要器

    将长对话历史压缩为摘要
    """

    SUMMARY_PROMPT = """请将以下对话历史压缩为一个简洁的摘要。

对话历史:
{history}

要求：
1. 保留关键信息（查询的数据、计算的参数、得出的结论）
2. 去除冗余的问候和确认
3. 摘要长度不超过200字

摘要："""

    def __init__(self):
        self._llm = None

    @property
    def llm(self):
        if self._llm is None:
            self._llm = ChatOpenAI(
                api_key=settings.OPENAI_API_KEY,
                base_url=settings.OPENAI_API_BASE,
                model=settings.LLM_MODEL,
                temperature=0,
                max_tokens=1024,
            )
        return self._llm

    def summarize(self, messages: List[dict], threshold: int = 10) -> Optional[str]:
        """
        生成对话摘要

        Args:
            messages: 消息列表 [{"role": "user/assistant", "content": "..."}]
            threshold: 触发摘要的消息数阈值

        Returns:
            摘要文本，如果消息数不足则返回None
        """
        if len(messages) < threshold:
            return None

        try:
            # 构建历史文本
            history_parts = []
            for msg in messages:
                role = "用户" if msg.get("role") == "user" else "助手"
                content = msg.get("content", "")[:200]  # 截断
                history_parts.append(f"{role}: {content}")

            history = "\n".join(history_parts)

            prompt = ChatPromptTemplate.from_template(self.SUMMARY_PROMPT)
            chain = prompt | self.llm | StrOutputParser()

            summary = chain.invoke({"history": history})
            return summary.strip()

        except Exception as e:
            logger.error(f"生成摘要失败: {e}")
            return None


# 全局实例
_summarizer: Optional[ConversationSummarizer] = None


def get_summarizer() -> ConversationSummarizer:
    """获取摘要器实例"""
    global _summarizer
    if _summarizer is None:
        _summarizer = ConversationSummarizer()
    return _summarizer
