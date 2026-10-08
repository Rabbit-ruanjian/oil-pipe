"""Loader for file-backed skill definitions."""

from __future__ import annotations

import logging
from pathlib import Path
import tomllib
from typing import Any, Dict, Optional

from .types import MISSING, SkillDefinition, SkillPromptMap


logger = logging.getLogger(__name__)


class SkillLoader:
    """Load skills from the local `skills/definitions` directory."""

    def __init__(self, definitions_root: Optional[Path] = None) -> None:
        self._definitions_root = definitions_root or Path(__file__).resolve().parent / "definitions"
        self._cache: Dict[str, SkillDefinition] = {}

    @property
    def definitions_root(self) -> Path:
        return self._definitions_root

    def load(self, name: str) -> SkillDefinition:
        """Load a skill definition by folder name."""

        normalized = str(name or "").strip()
        if not normalized:
            raise ValueError("skill name is required")

        cached = self._cache.get(normalized)
        if cached is not None:
            return cached

        skill_dir = self._definitions_root / normalized
        if not skill_dir.exists():
            raise FileNotFoundError(f"skill definition not found: {normalized}")

        manifest = self._load_manifest(skill_dir / "manifest.toml")
        prompts = self._load_prompts(skill_dir)
        definition = SkillDefinition(
            name=str(manifest.get("name") or normalized),
            version=str(manifest.get("version") or "1.0.0"),
            description=str(manifest.get("description") or ""),
            prompts=prompts,
            allowed_tools=tuple(str(item) for item in manifest.get("allowed_tools", []) or []),
            allowed_resources=tuple(str(item) for item in manifest.get("allowed_resources", []) or []),
            metadata=dict(manifest.get("metadata", {}) or {}),
        )
        self._cache[normalized] = definition
        return definition

    def get_prompt(self, skill_name: str, prompt_name: str, default: Any = MISSING) -> str:
        """Convenience helper for loading one prompt template."""

        try:
            return self.load(skill_name).get_prompt(prompt_name, default=default)
        except Exception as exc:  # noqa: BLE001
            if default is MISSING:
                raise RuntimeError(
                    f"Failed to load required skill prompt {skill_name}.{prompt_name}"
                ) from exc
            logger.warning("Failed to load skill prompt %s.%s: %s", skill_name, prompt_name, exc)
            return str(default)

    @staticmethod
    def _load_manifest(path: Path) -> dict:
        if not path.exists():
            return {}
        with path.open("rb") as fh:
            return tomllib.load(fh)

    @staticmethod
    def _load_prompts(skill_dir: Path) -> SkillPromptMap:
        prompts: SkillPromptMap = {}
        for path in sorted(skill_dir.glob("*.md")):
            prompts[path.stem] = path.read_text(encoding="utf-8").strip()
        return prompts
