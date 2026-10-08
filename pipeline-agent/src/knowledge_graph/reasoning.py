"""Causal reasoning helpers for knowledge graph."""

from __future__ import annotations

from typing import Dict, List


def rank_causes_by_probability(causes: List[dict]) -> List[dict]:
    """Sort causes by probability descending."""

    return sorted(causes, key=lambda item: float(item.get("probability", 0)), reverse=True)


def estimate_risk_level(probability: float) -> str:
    """Map probability to discrete risk label."""

    if probability >= 0.4:
        return "high"
    if probability >= 0.2:
        return "medium"
    return "low"


def summarize_causal_chain(fault: str, causes: List[dict]) -> Dict[str, object]:
    """Generate concise causal summary."""

    ranked = rank_causes_by_probability(causes)
    return {
        "fault": fault,
        "top_causes": [
            {
                "cause": cause.get("cause"),
                "probability": cause.get("probability", 0),
                "risk_level": estimate_risk_level(float(cause.get("probability", 0))),
            }
            for cause in ranked[:3]
        ],
    }
