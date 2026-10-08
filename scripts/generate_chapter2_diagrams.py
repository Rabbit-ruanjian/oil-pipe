from __future__ import annotations

from pathlib import Path


OUT_DIR = Path(r"D:\oil\docs\images")
WIDTH = 1600
HEIGHT = 900

BG = "#F5F7FB"
CARD = "#FFFFFF"
TEXT = "#1F2937"
MUTED = "#6B7280"
LINE = "#CBD5E1"
BLUE = "#2563EB"
BLUE_LIGHT = "#DBEAFE"
GREEN = "#059669"
GREEN_LIGHT = "#D1FAE5"
ORANGE = "#D97706"
ORANGE_LIGHT = "#FEF3C7"
PURPLE = "#7C3AED"
PURPLE_LIGHT = "#EDE9FE"
RED = "#DC2626"
RED_LIGHT = "#FEE2E2"
CYAN = "#0891B2"
CYAN_LIGHT = "#CFFAFE"
SLATE = "#475569"


def svg_header(title: str) -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#0F172A" flood-opacity="0.12"/>
    </filter>
    <linearGradient id="topBar" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#1D4ED8"/>
      <stop offset="100%" stop-color="#0F766E"/>
    </linearGradient>
    <marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
      <path d="M0,0 L12,6 L0,12 z" fill="{SLATE}" />
    </marker>
  </defs>
  <rect width="100%" height="100%" fill="{BG}" />
  <rect x="32" y="28" width="{WIDTH - 64}" height="74" rx="22" fill="url(#topBar)" filter="url(#shadow)" />
  <text x="{WIDTH / 2}" y="73" text-anchor="middle" font-size="32" font-weight="700" font-family="Microsoft YaHei, SimHei, sans-serif" fill="#FFFFFF">{title}</text>
"""


def svg_footer() -> str:
    return "</svg>\n"


def card(x: int, y: int, w: int, h: int, title: str, body: list[str], fill: str, stroke: str, title_fill: str = TEXT) -> str:
    lines = [
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="24" fill="{fill}" stroke="{stroke}" stroke-width="2" filter="url(#shadow)"/>',
        f'<text x="{x + 28}" y="{y + 42}" font-size="26" font-weight="700" font-family="Microsoft YaHei, SimHei, sans-serif" fill="{title_fill}">{title}</text>',
    ]
    for idx, line in enumerate(body):
        lines.append(
            f'<text x="{x + 30}" y="{y + 86 + idx * 38}" font-size="21" font-family="Microsoft YaHei, SimHei, sans-serif" fill="{MUTED}">{line}</text>'
        )
    return "\n".join(lines)


def pill(x: int, y: int, w: int, h: int, label: str, fill: str, stroke: str, fg: str = TEXT) -> str:
    return (
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{h // 2}" fill="{fill}" stroke="{stroke}" stroke-width="2"/>'
        f'<text x="{x + w / 2}" y="{y + h / 2 + 8}" text-anchor="middle" font-size="20" font-weight="700" '
        f'font-family="Microsoft YaHei, SimHei, sans-serif" fill="{fg}">{label}</text>'
    )


def arrow(x1: int, y1: int, x2: int, y2: int, label: str | None = None) -> str:
    mid_x = (x1 + x2) / 2
    mid_y = (y1 + y2) / 2
    parts = [
        f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{SLATE}" stroke-width="4" marker-end="url(#arrow)"/>'
    ]
    if label:
        parts.append(
            f'<rect x="{mid_x - 74}" y="{mid_y - 18}" width="148" height="34" rx="17" fill="#FFFFFF" stroke="{LINE}" stroke-width="1.5"/>'
        )
        parts.append(
            f'<text x="{mid_x}" y="{mid_y + 6}" text-anchor="middle" font-size="18" font-family="Microsoft YaHei, SimHei, sans-serif" fill="{SLATE}">{label}</text>'
        )
    return "\n".join(parts)


def dashed_group(x: int, y: int, w: int, h: int, label: str) -> str:
    return (
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="28" fill="none" stroke="{LINE}" stroke-width="2.5" stroke-dasharray="12 10"/>'
        f'<text x="{x + 24}" y="{y + 36}" font-size="22" font-weight="700" font-family="Microsoft YaHei, SimHei, sans-serif" fill="{SLATE}">{label}</text>'
    )


def generate_frontend_design() -> str:
    parts = [svg_header("图1 前端功能设计图")]
    parts.append(dashed_group(58, 132, 1484, 710, "前端展示层（React + TypeScript + Vite）"))
    parts.append(card(622, 174, 356, 120, "统一前端门户", ["登录认证", "首页总览", "侧边菜单导航"], BLUE_LIGHT, BLUE))
    parts.append(card(106, 360, 286, 186, "数据管理", ["项目管理", "管道参数", "泵站参数", "油品参数"], CARD, BLUE))
    parts.append(card(448, 360, 286, 186, "计算分析", ["水力分析", "泵站优化", "敏感性分析"], CARD, GREEN))
    parts.append(card(790, 360, 286, 186, "系统设置", ["用户管理", "角色权限", "系统配置", "个人中心"], CARD, ORANGE))
    parts.append(card(1132, 360, 286, 186, "智能助手", ["智能对话", "知识库录入", "知识检索"], CARD, PURPLE))
    parts.append(card(450, 618, 700, 154, "分析与可视化输出", ["图表趋势、告警卡片、分析结论、计算结果面板"], CYAN_LIGHT, CYAN))
    parts.append(arrow(800, 294, 250, 360, "菜单进入"))
    parts.append(arrow(800, 294, 592, 360, "菜单进入"))
    parts.append(arrow(800, 294, 934, 360, "菜单进入"))
    parts.append(arrow(800, 294, 1274, 360, "菜单进入"))
    parts.append(arrow(250, 546, 620, 618, "数据驱动"))
    parts.append(arrow(592, 546, 724, 618, "分析结果"))
    parts.append(arrow(934, 546, 874, 618, "专题结果"))
    parts.append(arrow(1274, 546, 980, 618, "AI增强"))
    parts.append(pill(118, 790, 330, 54, "面向业务人员的统一操作入口", BLUE_LIGHT, BLUE, BLUE))
    parts.append(pill(494, 790, 286, 54, "参数录入与分析联动", GREEN_LIGHT, GREEN, GREEN))
    parts.append(pill(818, 790, 288, 54, "智能分析与知识辅助", PURPLE_LIGHT, PURPLE, PURPLE))
    parts.append(pill(1140, 790, 286, 54, "结果归档与报告输出", ORANGE_LIGHT, ORANGE, ORANGE))
    parts.append(svg_footer())
    return "\n".join(parts)


def generate_backend_design() -> str:
    parts = [svg_header("图2 后端功能设计图")]
    parts.append(dashed_group(56, 126, 1488, 716, "后端服务层（Spring Cloud + FastAPI Agent）"))
    parts.append(card(560, 158, 480, 108, "统一接入层", ["pipeline-gateway：统一入口、路由转发、跨域与鉴权接入"], BLUE_LIGHT, BLUE))
    parts.append(card(118, 328, 250, 170, "认证服务", ["pipeline-auth", "登录认证", "Sa-Token 会话管理"], CARD, BLUE))
    parts.append(card(410, 328, 250, 170, "系统服务", ["pipeline-system", "用户/角色/系统配置"], CARD, GREEN))
    parts.append(card(702, 328, 250, 170, "数据服务", ["pipeline-data", "项目/管道/泵站/油品 CRUD"], CARD, ORANGE))
    parts.append(card(994, 328, 250, 170, "计算服务", ["pipeline-calculation", "水力分析、泵站优化、报告归档"], CARD, RED))
    parts.append(card(1286, 328, 180, 170, "智能体服务", ["pipeline-agent", "知识检索、对话、报告生成"], CARD, PURPLE))
    parts.append(card(120, 586, 320, 164, "数据存储", ["MySQL：业务数据与历史结果", "Redis：缓存/会话"], CYAN_LIGHT, CYAN))
    parts.append(card(520, 586, 320, 164, "服务治理", ["Nacos：注册发现与配置管理", "Gateway：服务聚合"], GREEN_LIGHT, GREEN))
    parts.append(card(920, 586, 520, 164, "知识与对象存储", ["MinIO：文档对象存储", "Milvus：向量检索", "Knowledge Base：标准、案例、公式"], PURPLE_LIGHT, PURPLE))
    for x in [243, 535, 827, 1119, 1376]:
        parts.append(arrow(800, 266, x, 328, "分发"))
    parts.append(arrow(243, 498, 280, 586, "持久化"))
    parts.append(arrow(827, 498, 280, 586, "数据读写"))
    parts.append(arrow(535, 498, 680, 586, "注册配置"))
    parts.append(arrow(1119, 498, 1180, 586, "结果落库"))
    parts.append(arrow(1376, 498, 1180, 586, "知识检索"))
    parts.append(pill(164, 784, 360, 50, "网关统一入口，微服务按职责拆分", BLUE_LIGHT, BLUE, BLUE))
    parts.append(pill(592, 784, 300, 50, "专业计算与数据服务解耦", RED_LIGHT, RED, RED))
    parts.append(pill(952, 784, 452, 50, "Agent 服务补充知识库、报告与交互式分析能力", PURPLE_LIGHT, PURPLE, PURPLE))
    parts.append(svg_footer())
    return "\n".join(parts)


def generate_architecture() -> str:
    parts = [svg_header("图3 系统架构图")]
    parts.append(dashed_group(54, 124, 1492, 718, "分层架构与外部依赖"))
    parts.append(card(104, 180, 300, 132, "用户与浏览器", ["业务人员 / 管理员", "PC 浏览器访问"], CARD, BLUE))
    parts.append(card(522, 180, 556, 132, "前端应用层", ["pipeline-react：登录、数据管理、计算分析、智能助手、系统设置"], BLUE_LIGHT, BLUE))
    parts.append(card(1194, 180, 252, 132, "智能接口层", ["SSE 流式响应", "REST API"], CARD, PURPLE))
    parts.append(card(112, 402, 320, 204, "Java 微服务集群", ["Gateway", "Auth", "System", "Data", "Calculation"], GREEN_LIGHT, GREEN))
    parts.append(card(500, 402, 360, 204, "Python 智能体服务", ["Chat / Trace / Knowledge / Tools", "Graph Workflow / MCP / RAG"], PURPLE_LIGHT, PURPLE))
    parts.append(card(928, 402, 520, 204, "基础设施与平台能力", ["MySQL、Redis、Nacos", "MinIO、Milvus", "日志、配置、服务发现"], ORANGE_LIGHT, ORANGE))
    parts.append(card(214, 674, 364, 108, "专业分析结果", ["水力指标、泵站优化结果、敏感性分析、趋势图表"], CYAN_LIGHT, CYAN))
    parts.append(card(648, 674, 364, 108, "知识增强结果", ["知识库问答、知识检索、建议说明、过程追踪"], CARD, PURPLE))
    parts.append(card(1082, 674, 256, 108, "输出形态", ["页面图表 + 结果面板"], CARD, RED))
    parts.append(arrow(404, 246, 522, 246, "访问"))
    parts.append(arrow(1078, 246, 1194, 246, "流式/接口"))
    parts.append(arrow(800, 312, 272, 402, "业务请求"))
    parts.append(arrow(800, 312, 680, 402, "AI请求"))
    parts.append(arrow(1320, 312, 1188, 402, "接口支撑"))
    parts.append(arrow(432, 504, 928, 504, "共享基础设施"))
    parts.append(arrow(860, 504, 928, 504, "检索/存储"))
    parts.append(arrow(272, 606, 396, 674, "计算输出"))
    parts.append(arrow(680, 606, 830, 674, "智能输出"))
    parts.append(arrow(1188, 606, 1210, 674, "聚合输出"))
    parts.append(arrow(1012, 728, 1082, 728, "汇总"))
    parts.append(svg_footer())
    return "\n".join(parts)


def generate_overall_design() -> str:
    parts = [svg_header("图4 系统整体设计图")]
    parts.append(dashed_group(54, 124, 1492, 718, "端到端业务闭环"))
    parts.append(card(86, 352, 210, 170, "1. 数据准备", ["创建项目", "录入管道", "录入泵站", "录入油品"], BLUE_LIGHT, BLUE))
    parts.append(card(358, 352, 230, 170, "2. 参数建模", ["自动带入参数", "校验输入完整性", "形成分析工况"], GREEN_LIGHT, GREEN))
    parts.append(card(652, 352, 236, 170, "3. 专业计算", ["水力分析", "泵站优化", "敏感性分析"], ORANGE_LIGHT, ORANGE))
    parts.append(card(952, 312, 248, 252, "4. 智能增强", ["智能对话", "知识检索", "故障诊断", "方案对比", "智能报告"], PURPLE_LIGHT, PURPLE))
    parts.append(card(1264, 352, 208, 170, "5. 成果输出", ["图表展示", "报告归档", "DOCX/PDF 下载"], RED_LIGHT, RED))
    parts.append(card(418, 640, 328, 120, "运行支撑", ["网关、认证、数据服务、计算服务、智能体服务"], CARD, CYAN))
    parts.append(card(852, 640, 422, 120, "基础设施支撑", ["MySQL、Redis、Nacos、MinIO、Milvus"], CARD, CYAN))
    parts.append(arrow(296, 437, 358, 437, "进入分析"))
    parts.append(arrow(588, 437, 652, 437, "形成输入"))
    parts.append(arrow(888, 437, 952, 437, "结果解释"))
    parts.append(arrow(1200, 437, 1264, 437, "形成成果"))
    parts.append(arrow(740, 522, 740, 640, "服务调用"))
    parts.append(arrow(1080, 564, 1080, 640, "依赖支撑"))
    parts.append(pill(92, 196, 286, 54, "业务主线：数据 -> 计算 -> 智能 -> 报告", BLUE_LIGHT, BLUE, BLUE))
    parts.append(pill(462, 196, 328, 54, "支持教学演示、项目分析与方案汇报", GREEN_LIGHT, GREEN, GREEN))
    parts.append(pill(852, 196, 420, 54, "既能独立完成计算，也能通过 Agent 提升解释与归纳效率", PURPLE_LIGHT, PURPLE, PURPLE))
    parts.append(svg_footer())
    return "\n".join(parts)


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    files = {
        "图1-前端功能设计图.svg": generate_frontend_design(),
        "图2-后端功能设计图.svg": generate_backend_design(),
        "图3-系统架构图.svg": generate_architecture(),
        "图4-系统整体设计图.svg": generate_overall_design(),
    }
    for name, content in files.items():
        (OUT_DIR / name).write_text(content, encoding="utf-8")
    print(str(OUT_DIR))
    for name in files:
        print(str(OUT_DIR / name))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
