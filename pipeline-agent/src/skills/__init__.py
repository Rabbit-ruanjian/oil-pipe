"""Skill helpers for file-backed prompts."""

from .types import MISSING
from .registry import get_skill_loader
from .runtime import get_skill_runtime


def get_skill(name: str):
    """Load one skill definition."""

    return get_skill_loader().load(name)


def get_prompt(skill_name: str, prompt_name: str, default=MISSING) -> str:
    """Load one prompt template from a skill definition."""

    return get_skill_loader().get_prompt(skill_name, prompt_name, default=default)


__all__ = [
    "get_skill",
    "get_prompt",
    "get_skill_loader",
    "get_skill_runtime",
]
