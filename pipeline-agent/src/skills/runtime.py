"""Minimal runtime helpers for skill-backed prompts."""

from __future__ import annotations

import re
from typing import Any, Mapping

from .registry import get_skill_loader
from .types import MISSING, SkillDefinition


_PROMPT_VARIABLE_PATTERN = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")


class SkillRuntime:
    """Resolve skill definitions and render prompt templates."""

    def get_skill(self, name: str) -> SkillDefinition:
        return get_skill_loader().load(name)

    def get_prompt(self, skill_name: str, prompt_name: str, default: Any = MISSING) -> str:
        return get_skill_loader().get_prompt(skill_name, prompt_name, default=default)

    def render_prompt(
        self,
        skill_name: str,
        prompt_name: str,
        variables: Mapping[str, Any] | None = None,
        default: Any = MISSING,
    ) -> str:
        template = self.get_prompt(skill_name, prompt_name, default=default)
        if not variables:
            return template
        missing = sorted(
            {
                match.group(1)
                for match in _PROMPT_VARIABLE_PATTERN.finditer(template)
                if match.group(1) not in variables
            }
        )
        if missing:
            raise KeyError(
                f"Missing prompt variables for {skill_name}.{prompt_name}: {', '.join(missing)}"
            )

        return _PROMPT_VARIABLE_PATTERN.sub(
            lambda match: str(variables[match.group(1)]),
            template,
        )


_skill_runtime = SkillRuntime()


def get_skill_runtime() -> SkillRuntime:
    """Return singleton skill runtime."""

    return _skill_runtime
