from langchain.chat_models import ChatOpenAI
from langchain.schema import HumanMessage, SystemMessage

from app.config import settings

SYSTEM_PROMPT = (
    "你是管道能耗分析系统的智能助手。"
    "请使用中文，回答保持专业、直接、简洁。"
    "如果用户要求结构化输出，就严格按要求返回。"
)

llm = ChatOpenAI(
    openai_api_key=settings.OPENAI_API_KEY,
    openai_api_base=settings.OPENAI_API_BASE,
    model_name=settings.MODEL_NAME,
    temperature=0,
)


class SimpleChatGraph:
    def invoke(self, state: dict) -> dict:
        messages = state.get("messages") or []
        prompt_messages = [SystemMessage(content=SYSTEM_PROMPT)]

        for message in messages:
            if isinstance(message, HumanMessage):
                prompt_messages.append(message)
            elif hasattr(message, "content"):
                prompt_messages.append(HumanMessage(content=str(message.content)))
            else:
                prompt_messages.append(HumanMessage(content=str(message)))

        response = llm.predict_messages(prompt_messages)
        return {"messages": [response.content]}


app_graph = SimpleChatGraph()
