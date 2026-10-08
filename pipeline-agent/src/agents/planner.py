"""Planner agent for plan-and-execute workflow."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from langchain_openai import ChatOpenAI
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate

from src.config import settings
from src.skills import get_skill_runtime
from src.utils import logger


class PlannerAgent:
    """Plan-and-Execute planner."""
    SKILL_NAME = "planner"

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
                max_tokens=3000,
            )
        return self._llm

    def create_plan(self, user_input: str, context: Optional[dict] = None) -> dict:
        """Create plan from user input."""

        # ★ 前置闲聊检测：在调用 LLM 之前拦截，节省 API 调用
        if self._is_chat_intent(user_input):
            return {
                "reasoning": "chat-direct",
                "plan": [],
                "direct_response": True,
            }

        prompt = ChatPromptTemplate.from_messages(
            [
                ("system", self._skill_runtime.get_prompt(self.SKILL_NAME, "system")),
                ("human", "{input}"),
            ]
        )
        chain = prompt | self.llm | StrOutputParser()

        try:
            task_input = self._skill_runtime.render_prompt(
                self.SKILL_NAME,
                "task",
                {
                    "user_input": user_input,
                    "available_context": json.dumps(context or {}, ensure_ascii=False),
                },
            )
            response = chain.invoke({"input": task_input})
            return self._parse_plan(response)
        except Exception as exc:
            logger.warning(f"Planner create_plan failed, fallback is used: {exc}")
            return self._fallback_plan(user_input)

    def replan(
        self,
        user_input: str,
        completed_steps: List[dict],
        failed_step: dict,
        reflexion: str,
    ) -> dict:
        """Replan using completed context and failure reflexion."""

        prompt = ChatPromptTemplate.from_messages(
            [
                ("system", self._skill_runtime.get_prompt(self.SKILL_NAME, "system")),
                ("human", "{input}"),
            ]
        )
        chain = prompt | self.llm | StrOutputParser()

        try:
            task_input = self._skill_runtime.render_prompt(
                self.SKILL_NAME,
                "replan",
                {
                    "user_input": user_input,
                    "completed_steps": json.dumps(completed_steps, ensure_ascii=False),
                    "failed_step": json.dumps(failed_step, ensure_ascii=False),
                    "reflexion": reflexion,
                },
            )
            response = chain.invoke({"input": task_input})
            parsed = self._parse_plan(response)
            parsed["reasoning"] = f"replan: {parsed.get('reasoning', '')}"
            return parsed
        except Exception as exc:
            logger.warning(f"Planner replan failed, fallback is used: {exc}")
            return self._fallback_plan(user_input, replan=True)

    def _parse_plan(self, response: str) -> dict:
        """Parse LLM plan JSON and normalize fields."""

        data = self._extract_json(response)

        # ★ 识别 LLM 返回的 direct_response 标记
        if data.get("direct_response") is True:
            return {
                "reasoning": data.get("reasoning", "chat-direct"),
                "plan": [],
                "direct_response": True,
            }

        reasoning = data.get("reasoning") or "auto-generated plan"
        raw_plan = data.get("plan") or []

        normalized = []
        for idx, step in enumerate(raw_plan, start=1):
            normalized.append(
                {
                    "step_number": int(step.get("step_number") or idx),
                    "description": str(step.get("description") or f"执行步骤{idx}"),
                    "agent": self._normalize_agent(step.get("agent")),
                    "expected_output": str(step.get("expected_output") or ""),
                    "depends_on": self._normalize_depends(step.get("depends_on")),
                }
            )

        if not normalized:
            return self._fallback_plan("", reason="empty-plan")

        return {"reasoning": reasoning, "plan": normalized}

    @staticmethod
    def _extract_json(text: str) -> dict:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise ValueError("No JSON block found")
        return json.loads(text[start : end + 1])

    @staticmethod
    def _normalize_depends(depends_on: Any) -> List[int]:
        if not isinstance(depends_on, list):
            return []

        result: List[int] = []
        for item in depends_on:
            try:
                value = int(item)
                if value > 0:
                    result.append(value)
            except Exception:
                continue
        return result

    @staticmethod
    def _normalize_agent(agent: Any) -> str:
        value = str(agent or "knowledge_agent").strip().lower()
        valid = {
            "data_agent",
            "calc_agent",
            "knowledge_agent",
            "graph_agent",
        }
        if value in valid:
            return value
        if "data" in value:
            return "data_agent"
        if "calc" in value or "compute" in value:
            return "calc_agent"
        if "graph" in value:
            return "graph_agent"
        return "knowledge_agent"

    @staticmethod
    def _is_chat_intent(text: str) -> bool:
        """Detect greetings, farewells, and other non-domain conversational inputs."""
        t = text.strip().lower()
        # Short greetings / farewells
        chat_phrases = [
            "你好", "hello", "hi", "嗨", "在吗", "在不在",
            "谢谢", "感谢", "thanks", "thank you",
            "再见", "拜拜", "bye",
            "你是谁", "你叫什么", "你能做什么", "帮我什么",
            "好的", "ok", "嗯", "哦",
        ]
        if any(t == phrase or t == phrase + "吗" or t == phrase + "啊" for phrase in chat_phrases):
            return True
        # Very short input with no domain keywords → likely chat
        domain_keywords = [
            "管道", "泵站", "油品", "项目", "压力", "流量", "计算", "优化",
            "水力", "摩阻", "粘度", "密度", "能耗", "分析", "诊断", "故障",
            "报告", "碳排放", "敏感性", "方案", "对比", "监控", "知识图谱",
            "因果", "雷诺", "扬程", "排量", "粗糙度", "壁厚", "管径",
        ]
        if len(t) <= 10 and not any(k in t for k in domain_keywords):
            return True
        return False

    def _fallback_plan(
        self,
        user_input: str,
        replan: bool = False,
        reason: str = "keyword",
    ) -> dict:
        """Rule-based fallback planner."""

        text = (user_input or "").lower()

        # Check for chat/greeting intent first — skip all agents
        if not replan and self._is_chat_intent(text):
            return {
                "reasoning": "chat-direct",
                "plan": [],
                "direct_response": True,
            }

        plan: List[Dict[str, Any]] = []

        need_data = any(k in text for k in ["项目", "管道", "泵站", "参数", "数据"])
        need_calc = any(k in text for k in ["计算", "优化", "压力", "流量", "雷诺", "摩阻"])
        need_graph = any(k in text for k in ["因果", "知识图谱", "关系"])

        step_num = 1
        if need_data or need_calc:
            plan.append(
                {
                    "step_number": step_num,
                    "description": "查询所需项目和管道基础参数",
                    "agent": "data_agent",
                    "expected_output": "项目、管道、泵站和油品关键参数",
                    "depends_on": [],
                }
            )
            step_num += 1

        if need_calc:
            plan.append(
                {
                    "step_number": step_num,
                    "description": "执行水力分析或优化计算",
                    "agent": "calc_agent",
                    "expected_output": "计算指标与可行方案",
                    "depends_on": [step_num - 1] if step_num > 1 else [],
                }
            )
            step_num += 1

        if need_graph:
            plan.append(
                {
                    "step_number": step_num,
                    "description": "执行知识图谱关系或因果推理",
                    "agent": "graph_agent",
                    "expected_output": "结构化关系与推理结论",
                    "depends_on": [step_num - 1] if step_num > 1 else [],
                }
            )
            step_num += 1

        if not plan:
            plan.append(
                {
                    "step_number": step_num,
                    "description": "检索领域知识并回答问题",
                    "agent": "knowledge_agent",
                    "expected_output": "专业解释和依据",
                    "depends_on": [],
                }
            )
            step_num += 1

        action = "replan" if replan else "plan"
        return {
            "reasoning": f"{action}-fallback({reason})",
            "plan": plan,
        }


_planner: Optional[PlannerAgent] = None


def get_planner() -> PlannerAgent:
    """Return singleton planner."""

    global _planner
    if _planner is None:
        _planner = PlannerAgent()
    return _planner
