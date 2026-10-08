"""Supervisor agent for intent analysis and final synthesis."""

from __future__ import annotations

import json
from typing import Callable, Dict, List, Optional

from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

from src.config import settings
from src.models.enums import IntentType
from src.models.state import AgentState, SubTask
from src.skills import get_skill_runtime
from src.utils import generate_task_id, logger


class SupervisorAgent:
    """Top-level coordinator for routing and multi-agent synthesis."""

    SKILL_NAME = "supervisor"

    def __init__(self) -> None:
        self._llm: Optional[ChatOpenAI] = None
        self._skill_runtime = get_skill_runtime()

    @property
    def llm(self) -> ChatOpenAI:
        if self._llm is None:
            self._llm = ChatOpenAI(
                api_key=settings.OPENAI_API_KEY,
                base_url=settings.OPENAI_API_BASE,
                model=settings.LLM_MODEL,
                temperature=0.1,
                max_tokens=2000,
            )
        return self._llm

    def analyze_intent(self, user_input: str) -> Dict[str, object]:
        """Analyze intent and produce a supervisor decision payload."""

        try:
            prompt = ChatPromptTemplate.from_messages(
                [
                    ("system", self._skill_runtime.get_prompt(self.SKILL_NAME, "system")),
                    ("human", "{input}"),
                ]
            )
            chain = prompt | self.llm | StrOutputParser()
            task_input = self._skill_runtime.render_prompt(
                self.SKILL_NAME,
                "task",
                {"user_input": user_input},
            )
            response = chain.invoke({"input": task_input})
            result = self._parse_decision(response)

            logger.info(
                "Supervisor decision: intent={}, tasks={}",
                result.get("intent"),
                len(result.get("sub_tasks", [])),
            )
            return result
        except Exception as exc:  # noqa: BLE001
            logger.error("Supervisor analyze_intent failed: {}", exc)
            return self._fallback_decision(user_input)

    def classify_intent(self, user_input: str) -> IntentType:
        """Fast intent classification for lightweight routing."""

        try:
            prompt = ChatPromptTemplate.from_messages([("human", "{input}")])
            chain = prompt | self.llm | StrOutputParser()
            prompt_input = self._skill_runtime.render_prompt(
                self.SKILL_NAME,
                "intent_classification",
                {"user_input": user_input},
            )
            response = chain.invoke({"input": prompt_input}).strip().lower()

            intent_mapping = {
                "query": IntentType.QUERY,
                "calculate": IntentType.CALCULATE,
                "knowledge": IntentType.KNOWLEDGE,
                "complex": IntentType.COMPLEX,
                "chat": IntentType.CHAT,
            }
            for key, intent in intent_mapping.items():
                if key in response:
                    return intent
            return IntentType.KNOWLEDGE
        except Exception as exc:  # noqa: BLE001
            logger.warning("Intent classification failed: {}", exc)
            return IntentType.KNOWLEDGE

    def create_sub_tasks(self, decision: Dict[str, object]) -> List[SubTask]:
        """Create normalized sub-task objects from a supervisor decision."""

        sub_tasks: List[SubTask] = []
        raw_tasks = decision.get("sub_tasks", [])
        if not isinstance(raw_tasks, list):
            return sub_tasks

        for task_info in raw_tasks:
            if not isinstance(task_info, dict):
                continue
            sub_tasks.append(
                SubTask(
                    id=generate_task_id(),
                    agent=str(task_info.get("agent", "knowledge_agent")),
                    task=str(task_info.get("task", "")),
                    depends_on=list(task_info.get("depends_on", [])),
                    status="pending",
                    result=None,
                )
            )
        return sub_tasks

    def determine_next_agent(self, state: AgentState) -> Optional[str]:
        """Determine the next runnable agent based on dependency completion."""

        sub_tasks = state.get("sub_tasks", [])
        completed = state.get("completed_tasks", [])
        current_index = state.get("current_task_index", 0)

        if current_index >= len(sub_tasks):
            return None

        current_task = sub_tasks[current_index]
        depends_on = current_task.get("depends_on", [])
        completed_ids = {task.get("id") for task in completed}

        for dep_id in depends_on:
            if dep_id not in completed_ids:
                logger.warning(
                    "Task {} is waiting on unfinished dependency {}",
                    current_task.get("id", ""),
                    dep_id,
                )
                return None

        return current_task.get("agent")

    def synthesize_response(
        self,
        user_input: str,
        completed_tasks: List[Dict],
        intent: str,
    ) -> str:
        """Synthesize the final answer from completed task results."""

        if not completed_tasks:
            return "抱歉，无法处理您的请求。"

        try:
            agent_results = self._build_agent_results_text(completed_tasks)
            prompt = ChatPromptTemplate.from_messages([("human", "{input}")])
            chain = prompt | self.llm | StrOutputParser()
            prompt_input = self._skill_runtime.render_prompt(
                self.SKILL_NAME,
                "synthesis",
                {
                    "user_input": user_input,
                    "agent_results": agent_results,
                },
            )
            return chain.invoke({"input": prompt_input}).strip()
        except Exception as exc:  # noqa: BLE001
            logger.error("Supervisor synthesize_response failed: {}", exc)
            return "\n\n".join(
                [str(task.get("result", "")) for task in completed_tasks if task.get("result")]
            )

    def synthesize_response_stream(
        self,
        user_input: str,
        completed_tasks: List[Dict],
        intent: str,
        on_chunk: Optional[Callable[[str], None]] = None,
    ) -> str:
        """Stream the final answer from completed task results."""

        if not completed_tasks:
            text = "抱歉，无法处理您的请求。"
            if on_chunk:
                on_chunk(text)
            return text

        try:
            agent_results = self._build_agent_results_text(completed_tasks)
            prompt = ChatPromptTemplate.from_messages([("human", "{input}")])
            chain = prompt | self.llm
            prompt_input = self._skill_runtime.render_prompt(
                self.SKILL_NAME,
                "synthesis",
                {
                    "user_input": user_input,
                    "agent_results": agent_results,
                },
            )

            full_text = ""
            for chunk in chain.stream({"input": prompt_input}):
                token = chunk.content if hasattr(chunk, "content") else str(chunk)
                if not token:
                    continue
                full_text += token
                if on_chunk:
                    on_chunk(token)

            return full_text.strip()
        except Exception as exc:  # noqa: BLE001
            logger.error("Supervisor synthesize_response_stream failed: {}", exc)
            fallback = "\n\n".join(
                [str(task.get("result", "")) for task in completed_tasks if task.get("result")]
            )
            if on_chunk and fallback:
                on_chunk(fallback)
            return fallback

    def handle_chat(self, user_input: str) -> str:
        """Handle casual chat outside the domain workflow."""

        try:
            prompt = ChatPromptTemplate.from_messages(
                [
                    (
                        "system",
                        "你是管道能耗分析系统的 AI 助手。对于与系统功能无关的问题，"
                        "请礼貌说明你主要帮助处理管道工程相关问题。",
                    ),
                    ("human", "{input}"),
                ]
            )
            chain = prompt | self.llm | StrOutputParser()
            return chain.invoke({"input": user_input})
        except Exception as exc:  # noqa: BLE001
            logger.error("Supervisor handle_chat failed: {}", exc)
            return "我是管道能耗分析系统的 AI 助手，主要帮助您处理管道工程相关问题。"

    @staticmethod
    def _build_agent_results_text(completed_tasks: List[Dict]) -> str:
        parts: List[str] = []
        for task in completed_tasks:
            agent = str(task.get("agent", "unknown"))
            task_desc = str(task.get("task", ""))
            result = str(task.get("result", "无结果"))
            parts.append(f"[{agent}] {task_desc}\n结果: {result}")
        return "\n\n".join(parts)

    def _parse_decision(self, response: str) -> Dict[str, object]:
        try:
            start = response.find("{")
            end = response.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(response[start:end])
            raise ValueError("No JSON block found in supervisor response")
        except json.JSONDecodeError as exc:
            logger.warning("Supervisor JSON parse failed: {}", exc)
            return self._extract_decision_from_text(response)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Supervisor response parse failed: {}", exc)
            return self._extract_decision_from_text(response)

    @staticmethod
    def _extract_decision_from_text(response: str) -> Dict[str, object]:
        response_lower = response.lower()

        if "查询" in response or "数据" in response:
            intent = "query"
            agent = "data_agent"
        elif "计算" in response or "雷诺" in response or "摩阻" in response:
            intent = "calculate"
            agent = "calc_agent"
        elif "知识" in response or "概念" in response or "什么是" in response:
            intent = "knowledge"
            agent = "knowledge_agent"
        else:
            intent = "chat"
            agent = None

        result: Dict[str, object] = {
            "intent": intent,
            "sub_tasks": [],
            "reasoning": "extracted from non-JSON supervisor response",
        }
        if agent:
            result["sub_tasks"] = [
                {
                    "agent": agent,
                    "task": "处理用户请求",
                    "depends_on": [],
                }
            ]
        return result

    @staticmethod
    def _fallback_decision(user_input: str) -> Dict[str, object]:
        user_lower = user_input.lower()

        if any(kw in user_lower for kw in ["项目", "管道", "泵站", "查询", "多少"]):
            return {
                "intent": "query",
                "sub_tasks": [{"agent": "data_agent", "task": user_input, "depends_on": []}],
                "reasoning": "keyword fallback: data query",
            }
        if any(kw in user_lower for kw in ["计算", "雷诺", "摩阻", "流量", "扬程"]):
            return {
                "intent": "calculate",
                "sub_tasks": [{"agent": "calc_agent", "task": user_input, "depends_on": []}],
                "reasoning": "keyword fallback: calculation",
            }
        return {
            "intent": "knowledge",
            "sub_tasks": [{"agent": "knowledge_agent", "task": user_input, "depends_on": []}],
            "reasoning": "default fallback: knowledge",
        }


_supervisor: Optional[SupervisorAgent] = None


def get_supervisor() -> SupervisorAgent:
    global _supervisor
    if _supervisor is None:
        _supervisor = SupervisorAgent()
    return _supervisor
