"""Reflexion agent for failed-step analysis."""

from __future__ import annotations

import json
from typing import Dict, List, Optional

from langchain_openai import ChatOpenAI
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate

from src.config import settings
from src.models.state import PlanStep, ReflexionMemory
from src.skills import get_skill_runtime
from src.utils import logger


class ReflexionAgent:
    """Self-reflection agent."""
    SKILL_NAME = "reflexion"

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
                temperature=0.2,
                max_tokens=1200,
            )
        return self._llm

    def reflect(
        self,
        failed_step: PlanStep,
        error: str,
        context: dict,
        history: List[ReflexionMemory],
    ) -> dict:
        """Reflect on a failed step and return recovery strategy."""

        prompt = ChatPromptTemplate.from_messages([("human", "{input}")])
        chain = prompt | self.llm | StrOutputParser()

        try:
            prompt_input = self._skill_runtime.render_prompt(
                self.SKILL_NAME,
                "prompt",
                {
                    "step_description": failed_step.get("description", ""),
                    "agent": failed_step.get("agent", ""),
                    "error_message": error,
                    "context": json.dumps(context or {}, ensure_ascii=False),
                    "previous_reflexions": json.dumps(history[-3:], ensure_ascii=False),
                },
            )
            response = chain.invoke({"input": prompt_input})
            return self._parse_response(response)
        except Exception as exc:
            logger.warning(f"Reflexion failed, fallback is used: {exc}")
            return self._fallback(error)

    @staticmethod
    def _parse_response(text: str) -> dict:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise ValueError("No JSON block found")

        data = json.loads(text[start : end + 1])
        return {
            "failure_reason": str(data.get("failure_reason") or "unknown"),
            "lesson_learned": str(data.get("lesson_learned") or ""),
            "revised_approach": str(data.get("revised_approach") or "retry with safer defaults"),
            "should_retry": bool(data.get("should_retry", True)),
            "should_replan": bool(data.get("should_replan", False)),
        }

    @staticmethod
    def _fallback(error: str) -> dict:
        text = (error or "").lower()
        should_replan = any(key in text for key in ["missing", "参数", "权限", "not found"])

        return {
            "failure_reason": f"执行失败: {error}",
            "lesson_learned": "优先检查输入参数、依赖数据和接口可用性",
            "revised_approach": "若参数缺失先补全数据，再重试；连续失败时重规划",
            "should_retry": True,
            "should_replan": should_replan,
        }


_reflexion_agent: Optional[ReflexionAgent] = None


def get_reflexion_agent() -> ReflexionAgent:
    """Return singleton reflexion agent."""

    global _reflexion_agent
    if _reflexion_agent is None:
        _reflexion_agent = ReflexionAgent()
    return _reflexion_agent
