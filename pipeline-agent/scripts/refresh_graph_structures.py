"""图结构层一键刷新：PageRank + 边描述向量 + 社区向量。

在删/增文档后调用，保证 graph_rank / graph_edges / communities 三层
与当前图同步。纯本地算法 + 本地 embedding，失败不阻断。

跑法：cd pipeline-agent && .venv/bin/python scripts/refresh_graph_structures.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("SKIP_STARTUP_WARMUP", "true")

from src.knowledge_graph import get_knowledge_graph_builder
from src.knowledge_graph.community import build_communities, upsert_community_vectors
from src.knowledge_graph.graph_rank import build_graph_rank
from src.rag.edge_vector_store import build_edge_descriptions, upsert_edge_vectors
from src.utils import logger


def main() -> int:
    builder = get_knowledge_graph_builder()
    n_nodes = builder.graph.number_of_nodes()
    n_edges = builder.graph.number_of_edges()
    logger.info("refresh_graph_structures: graph now {} nodes / {} edges", n_nodes, n_edges)

    rank = build_graph_rank(builder.graph)
    logger.info("PageRank: {} nodes", len(rank["pagerank"]))

    records = build_edge_descriptions(builder.graph)
    upsert_edge_vectors(records)
    logger.info("Edge vectors: {} edges", len(records))

    communities = build_communities(builder)
    if communities:
        upsert_community_vectors(communities)
        logger.info("Communities: {}", len(communities))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
