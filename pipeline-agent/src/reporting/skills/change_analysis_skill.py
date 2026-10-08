from __future__ import annotations

from typing import Any

from .sensitivity_insight_skill import build_sensitivity_insight_blocks, flatten_sensitivity_insight_blocks


def change_analysis_skill(ctx: dict[str, Any]) -> list[str]:
    insight_blocks = build_sensitivity_insight_blocks(ctx)
    return flatten_sensitivity_insight_blocks(insight_blocks)
