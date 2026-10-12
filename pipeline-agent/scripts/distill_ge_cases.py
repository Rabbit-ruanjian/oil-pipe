"""把 G-E1~G-E4 新资料的因果链蒸馏进知识图（走系统现成的 expert 蒸馏管道）。

不是手写新蒸馏器：复用 src.rag.knowledge_ingest 的
  normalize_expert_knowledge + upsert_expert_relations
（与 POST /knowledge/ingest 带 expert_knowledge 的同一条路）：
  1) 节点/边落盘进文档图
  2) 渲染"专家关系"检索文本写回 .md → 刷新向量/BM25
  3) 图谱加载器 reload

跑法：cd pipeline-agent && .venv/bin/python scripts/distill_ge_cases.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

try:
    from dotenv import load_dotenv

    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
except Exception:  # noqa: BLE001
    pass

# G-E doc_id（入库时确认）
GE_DOC_IDS = {
    "G-E1": "2b37f768c840",  # 机封泄漏
    "G-E2": "04430bda72fa",  # 过滤器堵塞
    "G-E3": "f10556fa8a41",  # 摩阻损失
    "G-E4": "1c5ae7d0a475",  # 泵站出口压力下降
}

# 每份资料的因果链（fault / causes / solutions），与 .md 内容一一对应
EXPERT_ITEMS = [
    # G-E1 机封泄漏（图上已有 fault 机封泄漏，cause 端面烧蚀/弹簧断裂；
    # 补 冲洗液不足 这个新 cause）
    {
        "doc_id": GE_DOC_IDS["G-E1"],
        "items": [
            {
                "fault": "机封泄漏",
                "causes": [
                    {
                        "cause": "冲洗液不足",
                        "prob": 0.7,
                        "solutions": [
                            {"solution": "恢复冲洗液通路", "cost": "低", "downtime": "1h"},
                            {"solution": "研磨端面", "cost": "中", "downtime": "4h"},
                        ],
                    },
                    {"cause": "低流量区运行", "prob": 0.3, "solutions": [
                        {"solution": "加装最小回流线", "cost": "中", "downtime": "8h"},
                    ]},
                ],
            }
        ],
    },
    # G-E2 过滤器堵塞（全新因果链，图上没有）
    {
        "doc_id": GE_DOC_IDS["G-E2"],
        "items": [
            {
                "fault": "过滤器堵塞",
                "causes": [
                    {
                        "cause": "滤网截留蜡晶",
                        "prob": 0.6,
                        "solutions": [
                            {"solution": "切换备用过滤器", "cost": "低", "downtime": "0.5h"},
                            {"solution": "热油冲洗清洗滤网", "cost": "中", "downtime": "6h"},
                        ],
                    },
                    {"cause": "冬季黏度升高", "prob": 0.4, "solutions": [
                        {"solution": "过滤器伴热保温", "cost": "中", "downtime": "0h"},
                    ]},
                ],
            }
        ],
    },
    # G-E3 摩阻损失（全新因果链）
    {
        "doc_id": GE_DOC_IDS["G-E3"],
        "items": [
            {
                "fault": "摩阻损失增大",
                "causes": [
                    {
                        "cause": "管道结蜡",
                        "prob": 0.6,
                        "solutions": [
                            {"solution": "热油清蜡", "cost": "高", "downtime": "24h"},
                            {"solution": "恢复正常输量", "cost": "低", "downtime": "0h"},
                        ],
                    },
                    {"cause": "油品黏度升高", "prob": 0.4, "solutions": [
                        {"solution": "提高输送温度", "cost": "中", "downtime": "2h"},
                    ]},
                ],
            }
        ],
    },
    # G-E4 泵站出口压力下降（fault 已有，补 转速波动 cause）
    {
        "doc_id": GE_DOC_IDS["G-E4"],
        "items": [
            {
                "fault": "泵站出口压力持续下降",
                "causes": [
                    {
                        "cause": "转速波动",
                        "prob": 0.5,
                        "solutions": [
                            {"solution": "检查变频器输出", "cost": "低", "downtime": "1h"},
                            {"solution": "核查泵入口液位", "cost": "低", "downtime": "1h"},
                        ],
                    },
                    {"cause": "油品密度下降", "prob": 0.3, "solutions": [
                        {"solution": "提温增黏过渡", "cost": "中", "downtime": "4h"},
                    ]},
                ],
            }
        ],
    },
]


def main() -> int:
    os.environ.setdefault("SKIP_STARTUP_WARMUP", "true")
    from src.rag.knowledge_ingest import (
        normalize_expert_knowledge,
        upsert_expert_relations,
    )

    total_nodes, total_edges = 0, 0
    for entry in EXPERT_ITEMS:
        expert = normalize_expert_knowledge(
            entry["items"], source_doc_id=entry["doc_id"]
        )
        print(f"[{entry['doc_id'][:8]}] 归一化: faults={[f['fault'] for f in expert.get('faults', [])]}")
        summary = upsert_expert_relations(expert)
        total_nodes += summary.get("expert_nodes_added", 0)
        total_edges += summary.get("expert_edges_added", 0)
        print(f"    upsert: {summary}")

    print(f"\n[done] 共新增 {total_nodes} 节点 / {total_edges} 边")

    # 重建社区索引（新因果链进图 → 社区结构变化）
    from src.knowledge_graph import get_knowledge_graph_builder
    from src.knowledge_graph.community import build_communities, upsert_community_vectors

    b = get_knowledge_graph_builder()
    b.reload_all()
    comms = build_communities(b)
    n = upsert_community_vectors(comms)
    print(f"[community] 重建 {n} 个社区摘要向量")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
