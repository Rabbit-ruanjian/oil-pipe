from __future__ import annotations

from typing import Any

from src.models.schemas import SensitivityInsightBlock, SensitivityReportAiInsights

from .impact_insight_skill import impact_insight_skill
from .interval_conclusion_skill import interval_conclusion_skill
from .ranking_insight_skill import ranking_insight_skill
from .trend_insight_skill import trend_insight_skill


def build_sensitivity_insight_blocks(ctx: dict[str, Any]) -> SensitivityReportAiInsights:
    ranking_content = ranking_insight_skill(ctx)
    trend_content = trend_insight_skill(ctx)
    impact_content = impact_insight_skill(ctx)
    table_content = interval_conclusion_skill(ctx)

    return SensitivityReportAiInsights(
        rankingInsight=SensitivityInsightBlock(title="排名解读", content=ranking_content) if ranking_content else None,
        trendInsight=SensitivityInsightBlock(title="趋势解读", content=trend_content) if trend_content else None,
        impactInsight=SensitivityInsightBlock(title="影响区间分析", content=impact_content) if impact_content else None,
        tableConclusion=SensitivityInsightBlock(title="区间变化结论", content=table_content) if table_content else None,
    )


def flatten_sensitivity_insight_blocks(insights: SensitivityReportAiInsights) -> list[str]:
    items: list[str] = []
    for block in (
        insights.rankingInsight,
        insights.trendInsight,
        insights.impactInsight,
        insights.tableConclusion,
    ):
        if block and block.content.strip():
            items.append(block.content.strip())
    return items
