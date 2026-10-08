from __future__ import annotations

import pytest

from src.agents import prompts
from src.skills import get_prompt
from src.tools.agent_tools import ALWAYS_LOADED_TOOL_NAMES, TOOL_REGISTRY


def _contains_chinese(text: str) -> bool:
    return any("\u4e00" <= char <= "\u9fff" for char in text)


def test_prompt_compat_exports_match_skill_prompts() -> None:
    assert prompts.REACT_SYSTEM_PROMPT == get_prompt("chat-orchestrator", "system")
    assert prompts.FINAL_SYNTHESIS_PROMPT == get_prompt("final-synthesis", "system")
    assert prompts.SUPERVISOR_SYSTEM_PROMPT == get_prompt("supervisor", "system")


def test_prompt_module_rejects_unknown_compat_export() -> None:
    with pytest.raises(AttributeError):
        getattr(prompts, "DOES_NOT_EXIST")


def test_tool_registry_keeps_chinese_recall_signal_for_core_tools() -> None:
    for tool_name in ["query_database", "hydraulic_calculation", "search_knowledge_base", "plan_complex_task"]:
        meta = TOOL_REGISTRY[tool_name]
        assert _contains_chinese(meta["description"])
        assert any(_contains_chinese(keyword) for keyword in meta["keywords"])
        assert any(
            any(_contains_chinese(str(value)) for value in example.values())
            for example in meta["input_examples"]
            if isinstance(example, dict)
        )


def test_always_loaded_tool_names_stay_stable() -> None:
    assert ALWAYS_LOADED_TOOL_NAMES == ["query_database", "search_knowledge_base"]
