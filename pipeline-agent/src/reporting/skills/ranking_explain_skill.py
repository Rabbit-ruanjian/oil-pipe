from __future__ import annotations

from typing import Any

from .ranking_insight_skill import ranking_insight_skill


def ranking_explain_skill(ctx: dict[str, Any]) -> str:
    return ranking_insight_skill(ctx)
