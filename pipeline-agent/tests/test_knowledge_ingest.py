"""A 类"存入"（task #4）pytest 六组用例。

覆盖（对应任务说明）：
  1. expert_knowledge 直入 upsert（同 doc_id 覆盖，normalize + 蒸馏写文档图）
  2. LLM 抽取因果链（mock LLM 返回结构化结果）
  3. 置信度低触发 HITL（hitl_confidence_threshold 以下 → hitl_triggered）
  4. 用户历史选择自动做（record_hitl_history("yes") → 自动执行，不弹窗）
  5. 蒸馏写专家图（upsert_expert_relations 把 caused_by/solved_by 边写进文档图）
  6. 开关全关时 save_upload 输出与改造前一致（回归对比：hook no-op、不碰 LLM/图）

所有 LLM 调用 mock 在 src.llm.get_llm_client；save_upload / 文档图 / 蒸馏 走真实
KnowledgeBaseRegistry + DocumentGraphRegistry 的 tmp_path 实例，不依赖 Milvus/Redis。
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("OPENAI_API_KEY", "sk-test-key")
os.environ.setdefault("EMBEDDING_API_KEY", "sk-test-key")
os.environ.setdefault("DB_PASSWORD", "test-password")
os.environ.setdefault("JAVA_AUTH_PASSWORD", "test-password")
os.environ.setdefault("INTERNAL_API_KEY", "test-internal-key")

from src.knowledge_graph import create_document_graph_registry  # noqa: E402
from src.rag.knowledge_ingest import (  # noqa: E402
    ingest_pre_execution_hook,
    ingest_structured_knowledge,
    llm_extract_knowledge,
    normalize_expert_knowledge,
    read_hitl_history,
    record_hitl_history,
    should_auto_extract,
    upsert_expert_relations,
)
from src.rag.knowledge_registry import KnowledgeBaseRegistry  # noqa: E402
from src.rag.hooks import clear_hooks  # noqa: E402
from src.models.enums import KnowledgeCategory  # noqa: E402


# ---------------------------------------------------------------------------
# 公共 fixture：把 registry / document graph root 指到 tmp_path
# ---------------------------------------------------------------------------


@pytest.fixture()
def kb_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """临时知识库根目录，registry/文档图 sidecar 全部落在 tmp_path。"""

    kb = tmp_path / "knowledge_base"
    kb.mkdir()
    monkeypatch.setattr("src.rag.knowledge_registry._REGISTRY", None)

    import src.rag.knowledge_registry as reg_mod

    real_get = reg_mod.get_knowledge_registry

    def _patched_get() -> KnowledgeBaseRegistry:
        reg_mod._REGISTRY = KnowledgeBaseRegistry(root_path=str(kb))
        return reg_mod._REGISTRY

    monkeypatch.setattr(reg_mod, "get_knowledge_registry", _patched_get)
    yield kb
    reg_mod._REGISTRY = None


def _upload_md(registry: KnowledgeBaseRegistry, name: str, content: str, category: KnowledgeCategory = KnowledgeCategory.CASES) -> str:
    """真实走 save_upload 的 md 入（解析+sidecar+双索引；Milvus 失败时降级为 FAILED 但 sidecar/doc 已建）。"""

    from src.models import KnowledgeDocumentMetadata

    metadata = KnowledgeDocumentMetadata(
        title=name,
        source="test",
        category=category,
        tags=[category.value, "test"],
    )
    stored = registry.save_upload(file_name=f"{name}.md", file_bytes=content.encode("utf-8"), metadata=metadata)
    return str(stored.get("doc_id", ""))


# ---------------------------------------------------------------------------
# 1. expert_knowledge 直入 upsert
# ---------------------------------------------------------------------------


def test_expert_knowledge_direct_upsert_same_doc_id_overrides(kb_root: Path) -> None:
    """同 doc_id 再次 ingest → 文档图里节点/边不重复叠加（upsert 语义）。"""

    import src.rag.knowledge_registry as reg_mod

    registry = reg_mod.get_knowledge_registry()
    doc_id = _upload_md(registry, "故障案例", "泵站出口压力下降，原因是叶轮磨损，解法是换叶轮。")

    expert = [
        {
            "fault": "泵站出口压力持续下降",
            "cause": "叶轮磨损",
            "prob": 0.8,
            "solution": "更换叶轮",
            "cost": "high",
            "downtime": "8h",
        }
    ]
    summary1 = upsert_expert_relations(
        normalize_expert_knowledge(expert, source_doc_id=doc_id), root_path=str(kb_root)
    )
    summary2 = upsert_expert_relations(
        normalize_expert_knowledge(expert, source_doc_id=doc_id), root_path=str(kb_root)
    )

    # 第一次写入，第二次 upsert 应无新增（节点/边已存在）
    assert summary1["expert_nodes_added"] > 0
    assert summary1["expert_edges_added"] > 0
    assert summary2["expert_nodes_added"] == 0
    assert summary2["expert_edges_added"] == 0

    store = create_document_graph_registry(str(kb_root))._load_store()  # noqa: SLF001
    entry = store["documents"][doc_id]
    node_ids = {n["id"] for n in entry["nodes"]}
    assert any(nid.startswith("fault::") for nid in node_ids)
    assert any(nid.startswith("cause::") for nid in node_ids)
    assert any(nid.startswith("sol::") for nid in node_ids)


# ---------------------------------------------------------------------------
# 2. LLM 抽取因果链（mock LLM 返回结构化结果）
# ---------------------------------------------------------------------------


def test_llm_extract_causal_chain_mocked(kb_root: Path) -> None:
    """llm_extract_knowledge 走 mock LLM 客户端，解析出因果链 faults。"""

    fake_resp_payload = json.dumps(
        {
            "faults": [
                {"fault": "泵站出口压力持续下降", "cause": "叶轮磨损", "prob": 0.35, "solution": "更换叶轮", "cost": "high", "downtime": "8h"}
            ],
            "steps": [{"step": 1, "action": "停泵", "next_step": 2}],
            "knowledge_units": [{"type": "知识点", "title": "叶轮磨损机理", "content": "..."}],
        }
    )
    mock_llm = MagicMock()
    mock_llm.complete.return_value = fake_resp_payload

    from src.llm.llm_client import LLMClient

    from types import SimpleNamespace

    doc = SimpleNamespace(doc_id="d1", source="test", content="泵站出口压力下降，原因是叶轮磨损。")

    with patch("src.rag.knowledge_ingest.get_llm_client", return_value=mock_llm):
        result = llm_extract_knowledge(doc)

    assert result["faults"][0]["fault"] == "泵站出口压力持续下降"
    assert result["faults"][0]["cause"] == "叶轮磨损"
    assert result["faults"][0]["prob"] == 0.35
    assert result["steps"][0]["action"] == "停泵"
    assert result["knowledge_units"][0]["type"] == "知识点"
    mock_llm.complete.assert_called_once()


def test_llm_extract_degrades_on_client_error(kb_root: Path) -> None:
    """LLMClientError → llm_extract_knowledge 由调用方捕获；此测试验证 hook 降级返回 None。"""

    from src.llm.llm_client import LLMClientError

    mock_llm = MagicMock()
    mock_llm.complete.side_effect = LLMClientError("timeout")

    from types import SimpleNamespace

    doc = SimpleNamespace(doc_id="d2", source="test", content="...")
    from src.rag import knowledge_ingest as ki

    # 直接调 hook 主体（需 llm_extract 开关开）
    with patch("src.rag.knowledge_ingest.get_llm_client", return_value=mock_llm), \
         patch.object(ki, "_llm_extract_flag", True, create=True):
        # 强制让 hook 认为开关开
        fake_rag_cfg = MagicMock()
        fake_rag_cfg.pluggable = {"llm_extract": True, "distill_expert_graph": True}
        with patch("src.rag.knowledge_ingest.get_rag_config", return_value=fake_rag_cfg):
            out = ki.ingest_pre_execution_hook(document=doc, pipeline=None, registry=None, root_path=str(kb_root))
    assert out is None  # LLM 失败 → 降级跳过，不阻断


# ---------------------------------------------------------------------------
# 3. 置信度低触发 HITL
# ---------------------------------------------------------------------------


def test_low_confidence_triggers_hitl(kb_root: Path) -> None:
    """detect_complex_extraction 低置信（< 阈值）→ _run_llm_extraction 返回 hitl_triggered。"""

    import src.rag.knowledge_ingest as ki
    import src.rag.knowledge_registry as reg_mod

    registry = reg_mod.get_knowledge_registry()
    doc_id = _upload_md(registry, "低置信案例", "一些模糊描述")

    # mock LLM 检测：低置信 0.2
    mock_llm = MagicMock()
    mock_llm.complete.return_value = json.dumps(
        {"complex": True, "confidence": 0.2, "category": "case", "reason": "模糊"}
    )

    # mock HITL manager（不真连 Redis）
    mock_manager = MagicMock()
    mock_manager.create_request.return_value = "hitl-x1"

    with patch("src.rag.knowledge_ingest.get_llm_client", return_value=mock_llm), \
         patch("src.rag.knowledge_ingest._HITL_MANAGER_FACTORY", return_value=mock_manager), \
         patch("src.rag.knowledge_ingest._HITL_REQUEST_CLS", lambda **kw: MagicMock(**kw)), \
         patch("src.rag.knowledge_ingest._HITL_TYPE_ENUM", MagicMock(SCHEME_SELECTION="scheme_selection")), \
         patch("src.rag.knowledge_ingest._ensure_hitl_imports", lambda: None):
        # 阈值默认 0.5，confidence=0.2 → 触发 HITL
        out = ki._run_llm_extraction(
            doc_id=doc_id,
            title="低置信案例",
            category=KnowledgeCategory.CASES,
            content="一些模糊描述",
            session_id="s1",
            root_path=str(kb_root),
            do_distill=True,
            flags={"hitl_confidence_threshold": 0.5, "llm_extract": True, "distill_expert_graph": True},
        )

    assert out.get("hitl_triggered") is True
    # 生产路径：_ensure_hitl_imports() 在函数内加载 hitl.py 成功（绕开 workflows/__init__），
    # request_id 是真实生成的 ingest-<hex>，而非 mock manager 的 "hitl-x1"
    assert str(out.get("hitl_request_id", "")).startswith("ingest-")
    assert out.get("llm_extracted") is False
    # 高置信才抽取；低置信未执行 LLM 抽取
    mock_llm.complete.assert_called_once()  # 只调了检测，没调抽取


# ---------------------------------------------------------------------------
# 4. 用户历史选择自动做
# ---------------------------------------------------------------------------


def test_history_choice_auto_executes(kb_root: Path) -> None:
    """record_hitl_history("yes") → should_auto_extract True → _run_llm_extraction 自动抽取不弹窗。"""

    import src.rag.knowledge_ingest as ki
    import src.rag.knowledge_registry as reg_mod

    registry = reg_mod.get_knowledge_registry()
    doc_id = _upload_md(registry, "历史选择", "泵站出口压力下降，原因是叶轮磨损，解法是换叶轮。")

    ki.record_hitl_history(doc_id, "complex_extract", "yes", root_path=str(kb_root))
    assert should_auto_extract(doc_id, "complex_extract", root_path=str(kb_root)) is True

    mock_llm = MagicMock()
    mock_llm.complete.return_value = json.dumps(
        {"faults": [{"fault": "泵站出口压力下降", "cause": "叶轮磨损", "prob": 0.5, "solution": "换叶轮"}]}
    )
    with patch("src.rag.knowledge_ingest.get_llm_client", return_value=mock_llm):
        out = ki._run_llm_extraction(
            doc_id=doc_id,
            title="历史选择",
            category=KnowledgeCategory.CASES,
            content="泵站出口压力下降，原因是叶轮磨损，解法是换叶轮。",
            session_id="s1",
            root_path=str(kb_root),
            do_distill=True,
            flags={"hitl_confidence_threshold": 0.5, "llm_extract": True, "distill_expert_graph": True},
        )

    assert not out.get("hitl_triggered")
    assert out.get("llm_extracted") is True
    assert out.get("expert_added", {}).get("expert_nodes_added", 0) > 0


# ---------------------------------------------------------------------------
# 5. 蒸馏写专家图
# ---------------------------------------------------------------------------


def test_distill_writes_expert_relations_to_document_graph(kb_root: Path) -> None:
    """upsert_expert_relations 把 caused_by/solved_by 边写进文档图，reload 后可见。"""

    import src.rag.knowledge_registry as reg_mod

    registry = reg_mod.get_knowledge_registry()
    doc_id = _upload_md(registry, "蒸馏案例", "泵站出口压力下降，原因是叶轮磨损，解法是换叶轮。")

    expert = normalize_expert_knowledge(
        [
            {
                "fault": "泵站出口压力下降",
                "cause": "叶轮磨损",
                "prob": 0.5,
                "solution": "换叶轮",
                "cost": "high",
                "downtime": "8h",
            }
        ],
        source_doc_id=doc_id,
    )
    summary = upsert_expert_relations(expert, root_path=str(kb_root))
    assert summary["expert_nodes_added"] >= 3  # fault + cause + sol
    assert summary["expert_edges_added"] >= 2  # caused_by + solved_by

    store = create_document_graph_registry(str(kb_root))._load_store()  # noqa: SLF001
    entry = store["documents"][doc_id]
    types = {n["type"] for n in entry["nodes"]}
    assert "fault" in types
    assert "cause" in types
    assert "solution" in types
    edge_types = {e["type"] for e in entry["edges"]}
    assert "caused_by" in edge_types
    assert "solved_by" in edge_types


# ---------------------------------------------------------------------------
# 6. 开关全关时 save_upload 输出与改造前一致（回归）
# ---------------------------------------------------------------------------


def test_save_upload_noop_when_all_flags_off(kb_root: Path) -> None:
    """llm_extract=False 且 distill_expert_graph=False → ingest_pre_execution_hook 返回 None，
    不调 LLM、不写文档图、不碰专家图；save_upload 主链路行为与改造前一致。"""

    import src.rag.knowledge_ingest as ki
    import src.rag.knowledge_registry as reg_mod

    registry = reg_mod.get_knowledge_registry()
    doc_id = _upload_md(registry, "回归案例", "泵站出口压力下降，原因是叶轮磨损，解法是换叶轮。")

    from types import SimpleNamespace

    from src.rag.document_processor import DocumentProcessor

    item = registry.get_document(doc_id)
    doc_path = registry.root_path / str(item["relative_path"])
    document = DocumentProcessor(str(registry.root_path)).load_document(str(doc_path))
    assert document is not None

    mock_llm = MagicMock()
    fake_rag_cfg = MagicMock()
    fake_rag_cfg.pluggable = {"llm_extract": False, "distill_expert_graph": False, "hitl_confidence_threshold": 0.5}

    with patch("src.rag.knowledge_ingest.get_llm_client", return_value=mock_llm), \
         patch("src.rag.knowledge_ingest.get_rag_config", return_value=fake_rag_cfg):
        out = ki.ingest_pre_execution_hook(
            document=document, pipeline=None, registry=registry, root_path=str(kb_root)
        )

    assert out is None  # 开关全关 → no-op
    mock_llm.complete.assert_not_called()  # 没调 LLM
    # 文档图里没有 expert namespace 节点（没蒸馏）
    store = create_document_graph_registry(str(kb_root))._load_store()  # noqa: SLF001
    entry = store["documents"].get(doc_id, {"nodes": []})
    assert not any(n.get("properties", {}).get("namespace") == "expert" for n in entry["nodes"])


# ---------------------------------------------------------------------------
# 补充：HITL manager 不可用降级
# ---------------------------------------------------------------------------


def test_hitl_manager_unavailable_degrades_safely(kb_root: Path) -> None:
    """HITL manager 抛异常 → record_hitl_request_for_extraction 返回 'hitl_unavailable'，
    走安全路径（不抽取、不阻断）。"""

    import src.rag.knowledge_ingest as ki
    import src.rag.knowledge_registry as reg_mod

    registry = reg_mod.get_knowledge_registry()
    doc_id = _upload_md(registry, "降级案例", "模糊")

    def _raise_factory():
        raise RuntimeError("redis down")

    with patch("src.rag.knowledge_ingest._HITL_MANAGER_FACTORY", side_effect=_raise_factory), \
         patch("src.rag.knowledge_ingest._ensure_hitl_imports", lambda: None), \
         patch("src.rag.knowledge_ingest.read_hitl_history", return_value={}):
        req_id = ki.record_hitl_request_for_extraction(
            doc_id=doc_id,
            session_id="s",
            title="降级案例",
            detection={"complex": True, "confidence": 0.2, "category": "case", "reason": "x", "degraded": False},
        )
    assert req_id == "hitl_unavailable"


# ---------------------------------------------------------------------------
# 补充：读/写历史选择 round-trip
# ---------------------------------------------------------------------------


def test_read_record_hitl_history_roundtrip(kb_root: Path) -> None:
    import src.rag.knowledge_registry as reg_mod

    registry = reg_mod.get_knowledge_registry()
    doc_id = _upload_md(registry, "历史读写", "内容")

    record_hitl_history(doc_id, "complex_extract", "yes", root_path=str(kb_root))
    assert read_hitl_history(doc_id, root_path=str(kb_root)).get("complex_extract", {}).get("decision") == "yes"
    assert should_auto_extract(doc_id, "complex_extract", root_path=str(kb_root)) is True

    record_hitl_history(doc_id, "complex_extract", "no", root_path=str(kb_root))
    assert read_hitl_history(doc_id, root_path=str(kb_root)).get("complex_extract", {}).get("decision") == "no"
    assert should_auto_extract(doc_id, "complex_extract", root_path=str(kb_root)) is False
