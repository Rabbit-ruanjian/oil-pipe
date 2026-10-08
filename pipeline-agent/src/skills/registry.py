"""Singleton registry for local skill definitions."""

from __future__ import annotations

from typing import Optional

from .loader import SkillLoader


_skill_loader: Optional[SkillLoader] = None


def get_skill_loader() -> SkillLoader:
    """Return singleton skill loader."""

    global _skill_loader
    if _skill_loader is None:
        _skill_loader = SkillLoader()
    return _skill_loader
