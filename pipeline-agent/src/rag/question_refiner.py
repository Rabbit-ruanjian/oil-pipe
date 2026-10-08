"""
Question Refiner (B5 — 在线 HyPE 完善问题)

检索前判断"问题是否完整、是否可检索"：
- 完整（LLM 判断，置信度 >= 阈值）→ 走 QueryRewriter 改写后进检索
- 不完整 / 置信度低于阈值（规则 C：不确定就触发）→ 走 HITL 反问补全
- 反问补全后循环 N 次（可配），直到可检索或次数耗尽
- 任何异常 / HITL 超时 → 降级为跳过，走原检索路径，不阻断主流程

开关：RAG_QUESTION_REFINE（默认 False）
    关闭时本模块的 hook 直接返回原 query，pipeline 行为与现状逐字节一致。

集成方式（P0-③ 可插拔 hook）：
    实现 PreRetrievalHook 协议（__call__ 返回修改后的查询串）；
    通过 register_question_refine_hook() 注册到 hooks.py 的注册表；
    pipeline.retrieve() 调用 run_pre_retrieval_hooks 时自动触发。
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

from src.config import rag_config, settings
from src.utils import logger

from .self_rag import get_query_rewriter

# 循环导入安全：延迟导入 hitl，但保留局部别名供 _request_hitl / _async_wait_hitl 使用
_HITL_MANAGER_FACTORY = "src.workflows.hitl.get_hitl_manager"


def _load_hitl_module():
    """直接加载 src/workflows/hitl.py，绕过 src.workflows.__init__ 的循环导入链。

    循环导入链（触发点）：
        src.rag.question_refiner → src.workflows.hitl
        src.workflows.__init__ → graph → knowledge_agent → src.rag → 本模块（未初始化）

    方案：用 importlib.util.spec_from_file_location 直接加载 hitl.py 文件，
    不执行 workflows/__init__.py。
    """
    import importlib.util
    import pathlib
    import sys

    # 检查是否已有可用的 hitl 模块
    hitl_mod = sys.modules.get("src.workflows.hitl")
    if hitl_mod is not None and hasattr(hitl_mod, "HITLRequest"):
        return hitl_mod

    # 重新从文件加载（覆盖可能残缺的 sys.modules 条目）
    try:
        pkg_dir = pathlib.Path(__file__).resolve().parent.parent.parent  # src/
        hitl_path = pkg_dir / "workflows" / "hitl.py"
        spec = importlib.util.spec_from_file_location(
            "src.workflows.hitl",
            str(hitl_path),
            submodule_search_locations=[],
        )
        hitl_mod = importlib.util.module_from_spec(spec)
        sys.modules["src.workflows.hitl"] = hitl_mod
        spec.loader.exec_module(hitl_mod)
        return hitl_mod
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"HITL hitl 模块加载失败，降级: {exc}")
        return None


def _get_hitl_manager():
    """返回 HITLManager 单例；失败返回 None（由调用方降级处理）。"""
    hitl_mod = _load_hitl_module()
    if hitl_mod is None:
        return None
    return hitl_mod.get_hitl_manager()


# ---------------------------------------------------------------------------
# 配置读取（不依赖 baseline 的 hooks.py，直接从 settings / 环境变量读）
# ---------------------------------------------------------------------------

def _question_refine_enabled() -> bool:
    """读取 question_refine 开关，默认 False。"""
    try:
        return bool(rag_config.pluggable.get("question_refine", False))
    except Exception:
        return False


def _hitl_confidence_threshold() -> float:
    """读取 HITL 置信度阈值（默认 0.5，偏保守 = 多问）。"""
    try:
        return float(settings.RAG_HITL_CONFIDENCE_THRESHOLD)
    except (AttributeError, ValueError, TypeError):
        return 0.5


def _max_refine_rounds() -> int:
    """读取最大反问补全循环次数（默认 2）。"""
    raw = os.environ.get("QUESTION_REFINE_MAX_ROUNDS", "2")
    try:
        return max(1, int(raw))
    except (ValueError, TypeError):
        return 2


def _hitl_timeout_seconds() -> int:
    """HITL 等待超时（默认 300 秒）。"""
    raw = os.environ.get("QUESTION_REFINE_HITL_TIMEOUT", "300")
    try:
        return max(30, int(raw))
    except (ValueError, TypeError):
        return 300


# ---------------------------------------------------------------------------
# LLM 输出结构
# ---------------------------------------------------------------------------

@dataclass
class CompletenessResult:
    """LLM 判断问题完整性的结构化输出。"""

    is_complete: bool
    confidence: float          # 0.0 ~ 1.0，LLM 自报置信度
    missing_info: List[str]   # 缺什么信息（不完整时填写）
    clarifying_question: str  # 给用户的反问（不完整时填写）
    reason: str = ""

    @classmethod
    def from_llm_json(cls, raw: str) -> "CompletenessResult":
        """解析 LLM 返回的 JSON 字符串；解析失败 → 低置信度兜底（触发反问）。"""
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return cls(
                is_complete=False,
                confidence=0.0,
                missing_info=["LLM 判断失败"],
                clarifying_question="能否请详细描述一下你想了解的问题？",
                reason="LLM 输出无法解析，按规则 C 触发反问",
            )
        return cls(
            is_complete=bool(data.get("is_complete", False)),
            confidence=float(data.get("confidence", 0.0)),
            missing_info=[str(x) for x in data.get("missing_info", [])],
            clarifying_question=str(data.get("clarifying_question", "")),
            reason=str(data.get("reason", "")),
        )


@dataclass
class RefineOutcome:
    """一次 refine() 调用的结果。"""

    status: str               # "retrievable" | "exhausted" | "skipped"
    refined_query: Optional[str] = None   # 最终用于检索的问题（改写后）
    rounds_used: int = 0
    hitl_questions: List[str] = field(default_factory=list)
    reason: str = ""

    @property
    def should_proceed_to_retrieval(self) -> bool:
        """True = 有可检索的问题；False = 跳过 hook，走原路径。"""
        return self.status in ("retrievable", "skipped")


# ---------------------------------------------------------------------------
# QuestionRefiner
# ---------------------------------------------------------------------------

class QuestionRefiner:
    """
    检索前完整性判断 + HITL 反问补全循环。

    用法（在 pipeline.retrieve() 检索入口、改写之后、plan_routes 之前调用）：

        outcome = question_refiner.refine(
            query=rewritten_query,
            session_id=session_id,
            trace_id=trace_id,
        )
        if outcome.status == "retrievable" and outcome.refined_query:
            query = outcome.refined_query
        # exhausted / skipped → 直接用原 query，不阻断
    """

    COMPLETENESS_PROMPT = """\
你是知识库检索前置判断器。判断以下用户问题是否**完整、可检索**——\
即仅凭问题本身，知识库中能否找到足以回答的信息。

用户问题: {query}

{context}

请输出 JSON（只输出 JSON，不要额外说明）：
{{
  "is_complete": true/false,
  "confidence": 0.0~1.0,   // 你对这个判断的把握（0.0 = 完全拿不准）
  "missing_info": ["..."],  // 缺什么信息（is_complete=true 时为空数组）
  "clarifying_question": "..."  // 给用户的反问（is_complete=true 时为空字符串）
}}

判断标准：
- 问题指向明确的知识点 / 实体 / 操作步骤 → is_complete=true
- 问题模糊、缺少关键限定词、指代不明、需要补充背景 → is_complete=false
- confidence 反映你的把握程度；拿不准（0.5 左右）时应偏向 is_complete=false（宁可多问）
"""

    def __init__(self) -> None:
        self._llm: Optional[ChatOpenAI] = None
        # 由外部调用方设置（hook 协议不传递 session_id）
        self.session_id: str = ""
        self.trace_id: str = ""

    @property
    def enabled(self) -> bool:
        return _question_refine_enabled()

    @property
    def llm(self) -> ChatOpenAI:
        if self._llm is None:
            self._llm = ChatOpenAI(
                api_key=settings.OPENAI_API_KEY,
                base_url=settings.OPENAI_API_BASE,
                model=settings.router_model_name,
                temperature=0,
                max_tokens=512,
            )
        return self._llm

    # ------------------------------------------------------------------
    # PreRetrievalHook 协议实现
    # hook 签名：(query, decision, top_k, category_filter) -> str
    # 返回修改后的查询串；降级时返回原 query。
    # ------------------------------------------------------------------

    def __call__(
        self,
        *,
        query: str,
        decision: Any,
        top_k: int,
        category_filter: Optional[str] = None,
    ) -> str:
        """PreRetrievalHook 协议入口。

        返回修改后的查询串（完整 → 改写；不完整 → HITL 补全后合并；
        降级 / 开关关闭 → 原 query 不变）。
        """
        if not self.enabled:
            return query

        try:
            outcome = self._refine_loop(
                query=query,
                session_id=self.session_id,
                trace_id=self.trace_id,
                hitl_timeout=None,
            )
            if outcome.status == "retrievable" and outcome.refined_query:
                logger.info(f"QuestionRefiner hook: 使用 '{outcome.refined_query}'")
                return outcome.refined_query
            # exhausted：用合并后的问题走原路径
            if outcome.status == "exhausted" and outcome.refined_query:
                logger.info(f"QuestionRefiner hook: N 轮耗尽，用合并问题 '{outcome.refined_query}'")
                return outcome.refined_query
            # skipped → 返回原 query
            return query
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"QuestionRefiner hook 异常，降级返回原 query: {exc}")
            return query

    # ------------------------------------------------------------------
    # 主入口
    # ------------------------------------------------------------------

    def refine(
        self,
        query: str,
        session_id: str = "",
        trace_id: str = "",
        *,
        hitl_timeout: Optional[int] = None,
    ) -> RefineOutcome:
        """
        判断问题完整性，不完整则走 HITL 反问补全循环。

        降级保证：任何异常 / HITL 超时 → 返回 status="skipped"，
        refined_query=None，调用方继续使用原 query。
        """
        if not self.enabled:
            return RefineOutcome(status="skipped", reason="question_refine 未启用")

        try:
            return self._refine_loop(
                query=query,
                session_id=session_id,
                trace_id=trace_id,
                hitl_timeout=hitl_timeout,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"QuestionRefiner 异常，降级跳过: {exc}")
            return RefineOutcome(status="skipped", reason=f"异常降级: {exc}")

    # ------------------------------------------------------------------
    # 内部循环
    # ------------------------------------------------------------------

    def _refine_loop(
        self,
        query: str,
        session_id: str,
        trace_id: str,
        hitl_timeout: Optional[int],
    ) -> RefineOutcome:
        current_query = query
        rounds = 0
        max_rounds = _max_refine_rounds()
        threshold = _hitl_confidence_threshold()
        hitl_questions: List[str] = []
        timeout = hitl_timeout if hitl_timeout is not None else _hitl_timeout_seconds()

        while rounds < max_rounds:
            rounds += 1
            logger.debug(f"QuestionRefiner 第 {rounds}/{max_rounds} 轮判断: '{current_query}'")

            # Step 1: LLM 判断完整性
            result = self._judge_completeness(current_query, trace_id=trace_id)

            if result.is_complete and result.confidence >= threshold:
                # 完整且置信度达标 → 改写后进检索
                rewritten = self._rewrite(current_query)
                logger.info(
                    f"QuestionRefiner: 问题完整（confidence={result.confidence:.2f}），"
                    f"改写后 → '{rewritten}'"
                )
                return RefineOutcome(
                    status="retrievable",
                    refined_query=rewritten,
                    rounds_used=rounds,
                    hitl_questions=hitl_questions,
                    reason=f"问题完整（第 {rounds} 轮，confidence={result.confidence:.2f}）",
                )

            # Step 2: 不完整 或 置信度低（规则 C）→ HITL 反问补全
            trigger_reason = "问题不完整" if not result.is_complete else f"置信度 {result.confidence:.2f} < 阈值 {threshold}"
            logger.info(f"QuestionRefiner: {trigger_reason}，触发 HITL 反问")

            clarifying = result.clarifying_question or "请补充说明你想了解的具体问题。"
            hitl_questions.append(clarifying)

            # 走 HITL 机制拿用户补全
            user_answer = self._request_hitl(
                session_id=session_id,
                trace_id=trace_id,
                original_query=query,
                current_query=current_query,
                missing_info=result.missing_info,
                clarifying_question=clarifying,
                timeout=timeout,
            )

            if user_answer is None:
                # HITL 超时 / 失败 → 降级，不阻断
                logger.warning(f"QuestionRefiner HITL 超时（第 {rounds} 轮），降级跳过")
                return RefineOutcome(
                    status="skipped",
                    rounds_used=rounds,
                    hitl_questions=hitl_questions,
                    reason=f"HITL 超时（第 {rounds} 轮），降级走原路径",
                )

            # 用户补全了 → 合并进问题，进入下一轮
            current_query = f"{query}。补充：{user_answer}"
            logger.info(f"QuestionRefiner 收到用户补全（第 {rounds} 轮）: '{user_answer}'")

        # 次数耗尽仍无法判定完整 → 用最后一次合并的问题走原检索路径
        logger.info(f"QuestionRefiner: {max_rounds} 轮耗尽，降级用合并问题走原路径")
        return RefineOutcome(
            status="exhausted",
            refined_query=current_query if current_query != query else None,
            rounds_used=rounds,
            hitl_questions=hitl_questions,
            reason=f"{max_rounds} 轮耗尽，使用合并后的问题",
        )

    # ------------------------------------------------------------------
    # LLM 判断
    # ------------------------------------------------------------------

    def _judge_completeness(
        self,
        query: str,
        trace_id: str = "",
        context: str = "",
    ) -> CompletenessResult:
        """调用 LLM 判断问题是否完整；LLM 失败 → 低置信度兜底（触发反问）。

        统一走 src/llm/llm_client.get_llm_client().complete()（与 B1/B2/A 类同一封装）；
        LLMClientError（超时/网络/配置缺失）被捕获后按规则 C 降级为低置信度，
        触发 HITL 反问补全，不阻断主流程。
        """
        from src.llm import LLMClientError, get_llm_client

        try:
            ctx_block = f"\n背景信息:\n{context}" if context else ""
            user_text = self.COMPLETENESS_PROMPT.format(query=query, context=ctx_block)
            raw = get_llm_client().complete(user_text, system=None, timeout=30.0).strip()
            result = CompletenessResult.from_llm_json(raw)
            logger.debug(f"完整性判断: is_complete={result.is_complete}, confidence={result.confidence:.2f}")
            return result
        except LLMClientError as exc:
            logger.warning(f"完整性判断 LLM 失败，按规则 C 触发反问: {exc}")
            return CompletenessResult(
                is_complete=False,
                confidence=0.0,
                missing_info=["LLM 判断失败"],
                clarifying_question="能否请详细描述一下你想了解的问题？",
                reason=f"LLM 异常: {exc}",
            )

    # ------------------------------------------------------------------
    # 改写（复用 QueryRewriter）
    # ------------------------------------------------------------------

    def _rewrite(self, query: str) -> str:
        """问题完整 → 用 QueryRewriter 改写（与现有 pipeline 改写逻辑一致）。"""
        if rag_config.features.get("query_rewrite", False):
            try:
                return get_query_rewriter().rewrite(query)
            except Exception as exc:  # noqa: BLE001
                logger.warning(f"QueryRewriter 改写失败，使用原问题: {exc}")
        return query

    # ------------------------------------------------------------------
    # HITL 反问（复用 src/workflows/hitl.py）
    # ------------------------------------------------------------------

    def _request_hitl(
        self,
        session_id: str,
        trace_id: str,
        original_query: str,
        current_query: str,
        missing_info: List[str],
        clarifying_question: str,
        timeout: int,
    ) -> Optional[str]:
        """
        通过 HITLManager 创建反问请求，等待用户补全。

        返回用户补全内容（字符串）；超时 / 失败 → None。

        注意：用 _load_hitl_module() 直接加载 hitl.py 文件（绕过 workflows/__init__），
        避免循环导入链。
        """
        hitl_mod = _load_hitl_module()
        if hitl_mod is None:
            return None

        HITLRequest = hitl_mod.HITLRequest
        HITLType = hitl_mod.HITLType

        request_id = uuid.uuid4().hex
        hitl_request = HITLRequest(
            request_id=request_id,
            type=HITLType.PARAMETER_CONFIRM,
            title="请补充问题信息",
            description=clarifying_question,
            options=[
                {"id": "provide", "label": "我来补充"},
            ],
            data={
                "original_query": original_query,
                "current_query": current_query,
                "missing_info": missing_info,
                "clarifying_question": clarifying_question,
            },
            timeout_seconds=timeout,
            default_option="provide",
        )

        try:
            manager = _get_hitl_manager()
            if manager is None:
                return None
            manager.create_request(session_id=session_id, request=hitl_request, trace_id=trace_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"HITL create_request 失败，降级: {exc}")
            return None

        # 等待用户响应（async → 在同步上下文中用 asyncio.run）
        try:
            response = self._async_wait_hitl(session_id, request_id, timeout)
            if response is None:
                return None
            # 用户通过 comment 字段填写补全内容
            comment = str(response.get("comment", "")).strip()
            return comment if comment else None
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"HITL 等待异常，降级: {exc}")
            return None

    @staticmethod
    def _async_wait_hitl(session_id: str, request_id: str, timeout: int) -> Optional[Dict[str, Any]]:
        """在同步上下文中运行异步 HITL 等待；若已在 async 上下文中则降级返回 None。"""

        async def _wait() -> Optional[Dict[str, Any]]:
            manager = _get_hitl_manager()
            return await manager.wait_for_response(session_id, request_id, timeout=timeout)

        try:
            try:
                asyncio.get_running_loop()
            except RuntimeError:
                # 无运行中的事件循环 → 同步上下文，用 asyncio.run
                return asyncio.run(_wait())
            # 已在事件循环中（LangGraph async node 不应同步调用此路径）→ 降级
            logger.warning("QuestionRefiner: 已在 async 上下文中，HITL 等待降级")
            return None
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"QuestionRefiner async wait 异常: {exc}")
            return None


# ---------------------------------------------------------------------------
# 单例
# ---------------------------------------------------------------------------

_question_refiner: Optional[QuestionRefiner] = None


def get_question_refiner() -> QuestionRefiner:
    global _question_refiner
    if _question_refiner is None:
        _question_refiner = QuestionRefiner()
    return _question_refiner


def register_question_refine_hook() -> None:
    """将 QuestionRefiner 注册为 PreRetrievalHook。

    调用此函数后，pipeline.retrieve() 中 run_pre_retrieval_hooks
    会自动触发完整性判断 + HITL 反问补全循环。
    """
    from .hooks import register_pre_retrieval_hook

    refiner = get_question_refiner()
    register_pre_retrieval_hook(refiner, name="question_refiner")
    logger.debug("QuestionRefiner pre-retrieval hook registered")
