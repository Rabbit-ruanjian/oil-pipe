"""Types for file-backed skill definitions."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Mapping


MISSING = object()


@dataclass(frozen=True)
class SkillDefinition:
    """Loaded skill definition with prompt templates and metadata."""

    name: str
    version: str
    description: str
    prompts: Mapping[str, str] = field(default_factory=dict)
    allowed_tools: tuple[str, ...] = ()
    allowed_resources: tuple[str, ...] = ()
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def get_prompt(self, prompt_name: str, default: Any = MISSING) -> str:
        """Return a named prompt template from this skill."""

        if prompt_name in self.prompts:
            return str(self.prompts[prompt_name])
        if default is MISSING:
            raise KeyError(f"prompt not found: {self.name}.{prompt_name}")
        return str(default)


SkillPromptMap = Dict[str, str]
