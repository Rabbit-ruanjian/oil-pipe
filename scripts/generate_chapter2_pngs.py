from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


OUT_DIR = Path(r"D:\oil\docs\images\png")
WIDTH = 1800
HEIGHT = 1080

BG = "#F3F6FB"
PANEL = "#EEF3F8"
TEXT = "#172033"
MUTED = "#5F6B7A"
LINE = "#C8D4E3"
SHADOW = "#D9E1EC"
BLUE = "#2563EB"
BLUE_LIGHT = "#DCEAFE"
GREEN = "#059669"
GREEN_LIGHT = "#D9F7E8"
ORANGE = "#D97706"
ORANGE_LIGHT = "#FEF0CF"
PURPLE = "#7C3AED"
PURPLE_LIGHT = "#EEE6FF"
RED = "#DC2626"
RED_LIGHT = "#FDE3E2"
CYAN = "#0891B2"
CYAN_LIGHT = "#D7F5FB"
GRAY_LIGHT = "#F8FAFC"
WHITE = "#FFFFFF"
ARROW = "#4A5A70"


FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
]


def get_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    preferred = FONT_CANDIDATES if bold else FONT_CANDIDATES[1:] + FONT_CANDIDATES[:1]
    for path in preferred:
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


TITLE_FONT = get_font(34, bold=True)
GROUP_FONT = get_font(24, bold=True)
CARD_TITLE_FONT = get_font(26, bold=True)
LABEL_FONT = get_font(18, bold=True)


def make_canvas(title: str) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((28, 24, WIDTH - 28, 92), radius=22, fill="#2C54CC")
    draw.text((WIDTH / 2, 58), title, anchor="mm", font=TITLE_FONT, fill=WHITE)
    return image, draw


def draw_group(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, title: str) -> None:
    draw.rounded_rectangle((x, y, x + w, y + h), radius=28, fill=PANEL, outline=LINE, width=3)
    draw.text((x + 24, y + 28), title, anchor="la", font=GROUP_FONT, fill="#48566A")


def draw_shadow(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], radius: int = 24) -> None:
    x1, y1, x2, y2 = box
    draw.rounded_rectangle((x1 + 8, y1 + 8, x2 + 8, y2 + 8), radius=radius, fill=SHADOW)


def wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> list[str]:
    if not text:
        return [""]
    lines: list[str] = []
    current = ""
    for ch in text:
        candidate = current + ch
        if current and draw.textlength(candidate, font=font) > max_width:
            lines.append(current)
            current = ch
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def fit_body_lines(
    draw: ImageDraw.ImageDraw,
    lines: list[str],
    max_width: int,
    max_height: int,
    start_size: int = 20,
    min_size: int = 15,
) -> tuple[list[str], ImageFont.ImageFont, int]:
    for size in range(start_size, min_size - 1, -1):
        font = get_font(size)
        wrapped: list[str] = []
        for line in lines:
            wrapped.extend(wrap_text(draw, line, font, max_width))
        line_gap = size + 12
        total_height = len(wrapped) * line_gap
        if total_height <= max_height:
            return wrapped, font, line_gap
    fallback = get_font(min_size)
    wrapped = []
    for line in lines:
        wrapped.extend(wrap_text(draw, line, fallback, max_width))
    return wrapped, fallback, min_size + 10


def draw_card(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    w: int,
    h: int,
    title: str,
    lines: list[str],
    fill: str,
    stroke: str,
) -> None:
    draw_shadow(draw, (x, y, x + w, y + h))
    draw.rounded_rectangle((x, y, x + w, y + h), radius=24, fill=fill, outline=stroke, width=3)
    draw.text((x + 24, y + 22), title, anchor="la", font=CARD_TITLE_FONT, fill=TEXT)

    body_top = y + 78
    wrapped, font, line_gap = fit_body_lines(draw, lines, w - 48, h - 100)
    for idx, line in enumerate(wrapped):
        draw.text((x + 24, body_top + idx * line_gap), line, anchor="la", font=font, fill=MUTED)


def draw_tag(draw: ImageDraw.ImageDraw, cx: int, cy: int, text: str) -> None:
    font = LABEL_FONT
    pad_x = 20
    width = int(draw.textlength(text, font=font) + pad_x * 2)
    height = 36
    x1 = int(cx - width / 2)
    y1 = int(cy - height / 2)
    draw.rounded_rectangle((x1, y1, x1 + width, y1 + height), radius=18, fill=WHITE, outline=LINE, width=2)
    draw.text((cx, cy - 1), text, anchor="mm", font=font, fill="#667789")


def draw_arrow(draw: ImageDraw.ImageDraw, x1: int, y1: int, x2: int, y2: int) -> None:
    draw.line((x1, y1, x2, y2), fill=ARROW, width=4)
    dx = x2 - x1
    dy = y2 - y1
    length = max((dx * dx + dy * dy) ** 0.5, 1)
    ux = dx / length
    uy = dy / length
    px = -uy
    py = ux
    head_len = 18
    head_w = 11
    tip = (x2, y2)
    left = (x2 - head_len * ux + head_w * px, y2 - head_len * uy + head_w * py)
    right = (x2 - head_len * ux - head_w * px, y2 - head_len * uy - head_w * py)
    draw.polygon([tip, left, right], fill=ARROW)


def fig1() -> Image.Image:
    image, draw = make_canvas("图1 前端功能设计图")
    draw_group(draw, 48, 118, 1704, 900, "前端展示层（React + TypeScript + Vite）")

    draw_card(draw, 610, 164, 580, 168, "统一前端门户", ["登录认证", "首页总览", "侧边菜单导航"], BLUE_LIGHT, BLUE)

    draw_card(draw, 102, 420, 300, 228, "数据管理", ["项目管理", "管道参数", "泵站参数", "油品参数"], GRAY_LIGHT, BLUE)
    draw_card(draw, 500, 420, 300, 228, "计算分析", ["水力分析", "泵站优化", "敏感性分析"], GRAY_LIGHT, GREEN)
    draw_card(draw, 898, 420, 300, 228, "系统设置", ["用户管理", "角色权限", "系统配置", "个人中心"], GRAY_LIGHT, ORANGE)
    draw_card(draw, 1296, 420, 300, 228, "智能助手", ["智能对话", "知识库录入", "知识检索"], GRAY_LIGHT, PURPLE)

    draw_card(draw, 420, 756, 960, 164, "分析与可视化输出", ["图表趋势、告警卡片、分析结论", "计算结果面板"], CYAN_LIGHT, CYAN)

    draw_arrow(draw, 900, 346, 252, 420)
    draw_arrow(draw, 900, 346, 650, 420)
    draw_arrow(draw, 900, 346, 1048, 420)
    draw_arrow(draw, 900, 346, 1446, 420)

    draw_arrow(draw, 252, 648, 620, 756)
    draw_arrow(draw, 650, 648, 780, 756)
    draw_arrow(draw, 1048, 648, 1020, 756)
    draw_arrow(draw, 1446, 648, 1180, 756)

    return image


def fig2() -> Image.Image:
    image, draw = make_canvas("图2 后端功能设计图")
    draw_group(draw, 48, 118, 1704, 900, "后端服务层（Spring Cloud + FastAPI Agent）")

    draw_card(draw, 574, 150, 652, 162, "统一接入层", ["pipeline-gateway", "统一入口、路由转发、鉴权接入"], BLUE_LIGHT, BLUE)

    draw_card(draw, 88, 394, 260, 220, "认证服务", ["pipeline-auth", "登录认证", "Sa-Token 会话管理"], GRAY_LIGHT, BLUE)
    draw_card(draw, 418, 394, 260, 220, "系统服务", ["pipeline-system", "用户/角色/系统配置"], GRAY_LIGHT, GREEN)
    draw_card(draw, 748, 394, 260, 220, "数据服务", ["pipeline-data", "项目/管道/泵站/油品", "CRUD 管理"], GRAY_LIGHT, ORANGE)
    draw_card(draw, 1078, 394, 260, 220, "计算服务", ["pipeline-calculation", "水力分析", "泵站优化 / 报告归档"], GRAY_LIGHT, RED)
    draw_card(draw, 1408, 394, 260, 220, "智能体服务", ["pipeline-agent", "知识检索", "对话 / 报告生成"], GRAY_LIGHT, PURPLE)

    draw_card(draw, 120, 744, 360, 176, "数据存储", ["MySQL：业务数据与历史结果", "Redis：缓存 / 会话"], CYAN_LIGHT, CYAN)
    draw_card(draw, 548, 744, 360, 176, "服务治理", ["Nacos：注册发现与配置管理", "Gateway：服务聚合"], GREEN_LIGHT, GREEN)
    draw_card(draw, 976, 730, 604, 190, "知识与对象存储", ["MinIO：文档对象存储", "Milvus：向量检索", "Knowledge Base：标准、案例、公式"], PURPLE_LIGHT, PURPLE)

    for target_x in (218, 548, 878, 1208, 1538):
        draw_arrow(draw, 900, 312, target_x, 394)

    draw_arrow(draw, 218, 614, 300, 744)
    draw_arrow(draw, 878, 614, 300, 744)
    draw_arrow(draw, 548, 614, 728, 744)
    draw_arrow(draw, 1208, 614, 1230, 730)
    draw_arrow(draw, 1538, 614, 1330, 730)

    return image


def fig3() -> Image.Image:
    image, draw = make_canvas("图3 系统架构图")
    draw_group(draw, 48, 118, 1704, 900, "分层架构与外部依赖")

    draw_card(draw, 92, 162, 372, 162, "用户与浏览器", ["业务人员 / 管理员", "PC 浏览器访问"], GRAY_LIGHT, BLUE)
    draw_card(draw, 566, 162, 720, 184, "前端应用层", ["pipeline-react：登录、数据管理、计算分析", "智能助手、系统设置"], BLUE_LIGHT, BLUE)
    draw_card(draw, 1400, 162, 256, 162, "智能接口层", ["SSE 流式响应", "REST API"], GRAY_LIGHT, PURPLE)

    draw_card(draw, 102, 446, 382, 238, "Java 微服务集群", ["Gateway", "Auth", "System", "Data", "Calculation"], GREEN_LIGHT, GREEN)
    draw_card(draw, 590, 446, 430, 238, "Python 智能体服务", ["Chat / Trace", "Knowledge / Tools", "Graph Workflow / MCP / RAG"], PURPLE_LIGHT, PURPLE)
    draw_card(draw, 1126, 446, 530, 238, "基础设施与平台能力", ["MySQL、Redis、Nacos", "MinIO、Milvus", "日志、配置、服务发现"], ORANGE_LIGHT, ORANGE)

    draw_card(draw, 148, 806, 430, 156, "专业分析结果", ["水力指标、泵站优化结果", "敏感性分析、趋势图表"], CYAN_LIGHT, CYAN)
    draw_card(draw, 680, 806, 430, 156, "知识增强结果", ["知识问答、知识检索", "建议说明、过程追踪"], GRAY_LIGHT, PURPLE)
    draw_card(draw, 1212, 806, 316, 156, "输出形态", ["页面图表", "结果面板"], GRAY_LIGHT, RED)

    draw_arrow(draw, 464, 240, 566, 240)
    draw_tag(draw, 516, 220, "访问")

    draw_arrow(draw, 1286, 240, 1400, 240)
    draw_tag(draw, 1342, 220, "流式 / 接口")

    draw_arrow(draw, 866, 346, 292, 446)
    draw_arrow(draw, 866, 346, 804, 446)
    draw_arrow(draw, 1528, 324, 1390, 446)
    draw_tag(draw, 1470, 384, "接口支撑")

    draw_arrow(draw, 804, 684, 894, 806)
    draw_arrow(draw, 292, 684, 362, 806)
    draw_arrow(draw, 1250, 684, 1370, 806)
    draw_arrow(draw, 1110, 884, 1212, 884)

    return image


def fig4() -> Image.Image:
    image, draw = make_canvas("图4 系统整体设计图")
    draw_group(draw, 48, 118, 1704, 900, "端到端业务闭环")

    draw_tag(draw, 278, 222, "业务主线：数据 -> 计算 -> 智能 -> 报告")
    draw_tag(draw, 762, 222, "支持教学演示、项目分析与汇报")
    draw_tag(draw, 1268, 222, "Agent 提升解释、归纳与分析效率")

    draw_card(draw, 70, 336, 250, 236, "1. 数据准备", ["创建项目", "录入管道", "录入泵站", "录入油品"], BLUE_LIGHT, BLUE)
    draw_card(draw, 370, 336, 270, 236, "2. 参数建模", ["自动带入参数", "校验输入完整性", "形成分析工况"], GREEN_LIGHT, GREEN)
    draw_card(draw, 690, 336, 270, 236, "3. 专业计算", ["水力分析", "泵站优化", "敏感性分析"], ORANGE_LIGHT, ORANGE)
    draw_card(draw, 1030, 296, 300, 310, "4. 智能增强", ["智能对话", "知识检索", "故障诊断", "方案对比", "智能报告"], PURPLE_LIGHT, PURPLE)
    draw_card(draw, 1410, 336, 270, 236, "5. 成果输出", ["图表展示", "报告归档", "DOCX / PDF 下载"], RED_LIGHT, RED)

    draw_card(draw, 464, 744, 390, 166, "运行支撑", ["网关、认证、数据服务", "计算服务、智能体服务"], GRAY_LIGHT, CYAN)
    draw_card(draw, 954, 744, 500, 166, "基础设施支撑", ["MySQL、Redis、Nacos", "MinIO、Milvus"], GRAY_LIGHT, CYAN)

    draw_arrow(draw, 320, 454, 370, 454)
    draw_arrow(draw, 640, 454, 690, 454)
    draw_arrow(draw, 960, 454, 1030, 454)
    draw_arrow(draw, 1330, 454, 1410, 454)

    draw_arrow(draw, 825, 572, 825, 744)
    draw_arrow(draw, 1180, 606, 1180, 744)

    return image


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    figures = {
        "图1-前端功能设计图.png": fig1(),
        "图2-后端功能设计图.png": fig2(),
        "图3-系统架构图.png": fig3(),
        "图4-系统整体设计图.png": fig4(),
    }
    for name, image in figures.items():
        image.save(OUT_DIR / name, format="PNG")
    print(str(OUT_DIR))
    for name in figures:
        print(str(OUT_DIR / name))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
