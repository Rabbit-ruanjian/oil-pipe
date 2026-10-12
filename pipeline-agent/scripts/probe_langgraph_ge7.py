"""把任务交给 LangGraph 智能体（走 8100 端口），监视全过程并记录结果。

非流式调 /api/v1/chat：让智能体自己决定怎么"处理这份年度检修报告、
提取故障-原因-处置关系、判断跨故障共享根因/联动处置"。
本脚本只做三件事：提交任务 → 打印 SSE 过程（工具调用序列）→ 存结果报告。
"""
import json
import time
import urllib.request
import urllib.error

MSG = (
    "请处理知识库中《2025年度检修运行分析报告》（doc_id=465e9dd71e50）的故障知识："
    "1) 提取其中的故障-原因-处置因果链；"
    "2) 结合知识图谱判断这些故障之间有哪些共享根因、哪些处置可以联动；"
    "3) 输出结构化故障关系说明（哪个故障关联哪些故障、为什么）。"
)


def main() -> int:
    payload = {"message": MSG, "session_id": "ge7-langgraph-001", "stream": False}
    req = urllib.request.Request(
        "http://localhost:8100/api/v1/chat",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.time()
    out = {}
    try:
        r = urllib.request.urlopen(req, timeout=300)
        out = json.loads(r.read().decode())
        print(f"[result] HTTP {r.status} 耗时 {time.time()-t0:.0f}s")
    except urllib.error.HTTPError as e:
        print(f"[result] HTTP {e.code}: {e.read().decode()[:300]}")
        return 1
    except Exception as e:  # noqa: BLE001
        print(f"[result] 异常 {type(e).__name__}: {e}")
        return 1

    print("\n=== 智能体最终回答 ===")
    print(str(out.get("response", ""))[:2500])
    print("\n=== 意图 ===", out.get("intent"))
    print("\n=== 调用的工具（智能体自主决定的）===")
    for tc in out.get("tool_calls", []):
        print(f"  {tc['tool']}  args={json.dumps(tc.get('args', {}), ensure_ascii=False)[:160]}")
    print("\n=== 检索来源 ===")
    for s in (out.get("sources") or [])[:8]:
        print(f"  {s.get('doc_id')} score={s.get('score')} {str(s.get('doc_title'))[:40]}")

    # 存监视记录
    rec = {
        "ts": time.time(),
        "task": MSG,
        "intent": out.get("intent"),
        "tool_calls": out.get("tool_calls", []),
        "sources": out.get("sources", []),
        "response": out.get("response", ""),
        "elapsed_s": round(time.time() - t0, 1),
    }
    with open("/tmp/langgraph_ge7_trace.json", "w", encoding="utf-8") as f:
        json.dump(rec, f, ensure_ascii=False, indent=2)
    print("\n[out] 监视记录已写 /tmp/langgraph_ge7_trace.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
