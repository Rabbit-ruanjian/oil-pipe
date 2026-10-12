#!/usr/bin/env python3
"""RAG 检索堆栈端到端实测脚本（一次性，不进 git）。"""
import os, sys, time, json, re

os.environ.setdefault("OPENAI_API_KEY", "local_nonkey_test")
os.environ.setdefault("EMBEDDING_API_KEY", "local_nonkey_test")
os.environ.setdefault("DB_PASSWORD", "local_test_notweak")
os.environ.setdefault("JAVA_AUTH_PASSWORD", "local_test_notweak")
os.environ.setdefault("AUTH_REQUIRED_IN_PRODUCTION", "false")

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

SEP = "=" * 70

# ---------------------------------------------------------------------------
# 1. 环境状态
# ---------------------------------------------------------------------------
print(SEP, "\n[1] 环境状态")
from src.config import settings, rag_config
print(f"  EMBEDDING_BACKEND : {settings.EMBEDDING_BACKEND}")
print(f"  EMBEDDING_LOCAL   : {settings.EMBEDDING_LOCAL_MODEL}")
print(f"  MILVUS            : {settings.MILVUS_HOST}:{settings.MILVUS_PORT}  collection={settings.MILVUS_COLLECTION}")
print(f"  RERANKER_MODE     : {settings.RERANKER_MODE}  model={settings.RERANKER_MODEL} threshold={settings.RERANKER_THRESHOLD}")
print(f"  RAG_TOP_K/FINAL_K : {settings.RAG_TOP_K}/{settings.RAG_FINAL_K}")
print(f"  pluggable(应全关) : {json.dumps({k:v for k,v in rag_config.pluggable.items() if k!='hitl_confidence_threshold'})}")

# ---------------------------------------------------------------------------
# 2. 新文档入库
# ---------------------------------------------------------------------------
NEW_DOC = "水合物堵塞处置-测试-20261011.md"
NEW_DOC_PATH = os.path.join(os.path.dirname(__file__), "..", "knowledge_base", "cases", NEW_DOC)
NEW_DOC_TITLE = "集输管道水合物堵塞成因判断预防与处置"

new_doc_content = f"""# {NEW_DOC_TITLE}

> 类别: cases | 标签: 水合物, 冰堵, 集输管道, 处置

## 一、水合物形成条件

集输管道中水合物（水冰）是天然气/伴生水在低温低压条件下形成的类冰固态物质，
堵塞管段后造成"冰堵"。形成需同时满足四个条件：

1. 自由水含量足够：含水率超过临界值后管壁析出液态水
2. 温度低于水合物生成温度曲线（随压力升高而升高）
3. 存在游离气：气液两相流界面
4. 流速较低、滞留时间长：静止或缓流段最易成核

冬季保温失效、站外阀后温度骤降是两类典型诱因。

## 二、判断特征与征兆

运行侧可观察到的征兆按出现先后排序：

- 出站压力逐步升高、进站压差（背压-前压）扩大
- 同工况下输量下降 10%~30%
- 管段壁温低于环境温度（冷点）
- 清管器通过时间明显延长
- 严重时出现水击、流态紊乱、流量计失准

诊断口诀：压差大、输量降、管体温、清管慢，四项中命中三项以上应启动水合物处置流程。

## 三、预防措施

预防优于处置。按成本与效果排序：

1. 加注入水抑制剂（甘醇类 MEG/DEG）：注入量 = 临界抑制浓度 × 实际水流量，注入点设在进站前
2. 提高保温等级：站外段保温层导热系数 < 0.04 W/(m·K)，伴热管径 DN15 即可
3. 控制含水率：上游脱水后含水率 < 0.1 mg/m³
4. 提高流速：水合物成核需要静止水膜，流速 > 1.5 m/s 可大幅降低风险
5. 定期巡检冷点：红外测温每 2 周一次，记录最低管体温趋势

## 四、处置步骤

发现水合物征兆后按以下顺序处置：

**第 1 步 确认与上报**
- 核对近 24h 压差/输量/管体温三条曲线
- 通知调度中心，申请进入处置模式

**第 2 步 降负荷**
- 将输量降至正常工况的 70%
- 关闭无关分支阀门，集中气量

**第 3 步 加热解堵**
- 启动伴热（功率 150% 额定）
- 注入热水或蒸汽（注意流速控制，避免水击）
- 每 30 分钟记录压差，压差回落 50% 以上可进入下一步

**第 4 步 循环清管**
- 投入清管器（皮塞）循环 2~3 次
- 监听清管器运行声音，堵塞段有"咔哒"声说明已打通

**第 5 步 恢复**
- 逐步提负荷（每次 +10%，间隔 15 分钟）
- 恢复监测，压差回到基线后解除处置模式

**禁止事项**：严禁在未降压情况下强行提负荷；严禁在未确认堵塞位置前盲投清管器。

## 五、经验要点

- 冬季首周是高风险期，提前一周启动预处置
- 新投产管段水合物风险最高（管壁含水率高）
- 处置后 48h 内保持监测频率加倍
- 压差未回落即提负荷会导致二次堵塞，处置失败率最高

## 六、相关标准与参考

- GB 50350《油气输送管道穿跨越工程设计规范》
- SY/T 6938《水合物防治技术规范》
- 参见本知识库中"泵站出口压力下降"相关案例（关联处置）
"""

with open(NEW_DOC_PATH, "w", encoding="utf-8") as f:
    f.write(new_doc_content)

print(SEP, "\n[2] 新文档入库")
print(f"  文件: {NEW_DOC_PATH}")
print(f"  字符数: {len(new_doc_content)}")

t0 = time.time()
from src.rag.pipeline import get_rag_pipeline
pipeline = get_rag_pipeline()
pipeline.index_documents("knowledge_base", recreate=False)
print(f"  入库+全量重索引耗时: {time.time()-t0:.1f}s")

from src.rag.knowledge_registry import get_knowledge_registry
registry = get_knowledge_registry()
data = registry._load_registry()
docs = data.get("documents", {})
found = [d for d in docs if "水合物" in d]
print(f"  registry 中含'水合物'的 doc_id: {found}")

# 检查 document_graph.json 是否含新实体
dg_path = os.path.join(os.path.dirname(__file__), "..", "knowledge_base", ".registry", "document_graph.json")
with open(dg_path, encoding="utf-8") as f:
    dg = json.load(f)
nodes = dg.get("nodes", {})
hydrate_nodes = [k for k in nodes if "水合物" in k or "冰堵" in k or "甘醇" in k]
print(f"  document_graph 新实体节点: {hydrate_nodes[:10]}")

# ---------------------------------------------------------------------------
# 3. 四组检索
# ---------------------------------------------------------------------------
print(SEP, "\n[3] 四组检索实测")
from src.rag.hybrid_retriever import get_hybrid_retriever

retriever = get_hybrid_retriever()
retriever.ready = True
retriever._build_bm25_index()  # 确保 BM25 已构建（上面 index_documents 已做，这里幂等）

queries = [
    ("Q1", "水合物堵塞怎么预防", "应命中新文档"),
    ("Q2", "泵站出口压力下降的原因", "应命中 cases 中泵站出口压力低文档"),
    ("Q3", "摩阻损失过大怎么处置", "应命中 G-E3 摩阻 case"),
    ("Q4", "雷诺数怎么计算", "应命中 formulas 文档"),
]

for label, q, note in queries:
    print(f"\n  [{label}] {q!r}  ({note})")
    t0 = time.time()
    results = retriever.retrieve(q, top_k=5, use_hybrid=True)
    latency = (time.time() - t0) * 1000
    print(f"  延迟: {latency:.0f}ms")
    for i, r in enumerate(results[:5], 1):
        snippet = (r.content or r.full_text or "")[:60].replace("\n", " ")
        print(f"    #{i}  {r.doc_id[:50]:50s}  score={r.score:.4f}  {snippet}")

# ---------------------------------------------------------------------------
# 4. Graph RAG 实测
# ---------------------------------------------------------------------------
print(SEP, "\n[4] Graph RAG 实测")
from src.knowledge_graph import get_knowledge_graph_builder
kb = get_knowledge_graph_builder()
kb.ensure_ready()
g = kb.graph
print(f"  图节点总数: {g.number_of_nodes()}, 边总数: {g.number_of_edges()}")

# 泵站出口压力下降 → fault_cause 遍历
print("\n  [4a] query='泵站出口压力下降' 因果链遍历")
from src.knowledge_graph.reasoning import summarize_causal_chain
matches = [n for n in g.nodes if "泵站出口压力下降" in str(g.nodes[n].get("name", ""))]
print(f"  匹配节点: {matches}")
if matches:
    for m in matches[:1]:
        chain = summarize_causal_chain(m, g)
        print(f"  因果链: {json.dumps(chain, ensure_ascii=False, default=str)[:400]}")

# 水合物实体入图检查
print("\n  [4b] '水合物' 相关实体入图检查")
hy_nodes = [n for n in g.nodes if any(k in str(g.nodes[n].get("name", "")) for k in ("水合物", "冰堵", "甘醇"))]
print(f"  命中节点: {hy_nodes[:8]}")
if hy_nodes:
    n0 = hy_nodes[0]
    succs = list(g.successors(n0))
    print(f"  {n0} 后继: {[(s, g.get_edge_data(n0, s, {}).get('type')) for s in succs[:5]]}")

# graph_rag 模块直接调用
print("\n  [4c] GraphRAGRetriever 直接调用")
from src.rag.graph_rag import get_graph_rag_retriever
grag = get_graph_rag_retriever()
try:
    ctx = grag.retrieve("泵站出口压力下降", top_k=5)
    print(f"  GraphRAG 返回 context 长度: {len(str(ctx))} chars")
    print(f"  预览: {str(ctx)[:300]}")
except Exception as e:
    print(f"  GraphRAG 调用失败: {type(e).__name__}: {e}")

# ---------------------------------------------------------------------------
# 5. 汇总
# ---------------------------------------------------------------------------
print(SEP, "\n[5] 完成")
print("全部测试执行完毕。")
