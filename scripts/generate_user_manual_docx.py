from __future__ import annotations

import shutil
import sys
import tempfile
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape


TEMPLATE_PATH = Path(r"C:\Users\江玉龙\OneDrive\Desktop\基于大语言模型的统一API网关调度系统-使用说明书.docx")
OUTPUT_PATH = Path(r"D:\oil\docs\智能管道能耗分析系统-使用说明书.docx")

CHAPTER_STYLE = "21bc9c4b-6a32-43e5-beaa-fd2d792c5735"
TOC_TITLE_STYLE = "a5"
TOC_LEVEL_1_STYLE = "TOC1"
TOC_LEVEL_2_STYLE = "TOC2"


def xml_text(text: str) -> str:
    escaped = escape(text)
    if text != text.strip() or "  " in text:
        return f'<w:t xml:space="preserve">{escaped}</w:t>'
    return f"<w:t>{escaped}</w:t>"


def make_run(
    text: str,
    *,
    fonts: str | None = None,
    size: int | None = None,
    bold: bool = False,
    lang_east_asia: str = "zh-CN",
    hint_east_asia: bool = False,
) -> str:
    parts: list[str] = []
    if fonts:
        parts.append(fonts)
    elif hint_east_asia:
        parts.append('<w:rFonts w:hint="eastAsia" />')
    if bold:
        parts.append("<w:b />")
    if size is not None:
        parts.append(f'<w:sz w:val="{size}" />')
        if fonts and 'w:ascii=' not in fonts and 'w:hAnsi=' not in fonts:
            parts.append(f'<w:szCs w:val="{size}" />')
    parts.append(f'<w:lang w:eastAsia="{lang_east_asia}" />')
    return f"<w:r><w:rPr>{''.join(parts)}</w:rPr>{xml_text(text)}</w:r>"


def make_empty_paragraph(*, centered: bool = False) -> str:
    jc = '<w:jc w:val="center" />' if centered else ""
    return (
        "<w:p>"
        "<w:pPr>"
        '<w:widowControl w:val="0" />'
        '<w:spacing w:after="0" w:line="560" w:lineRule="exact" />'
        f"{jc}"
        "</w:pPr>"
        "</w:p>"
    )


def cover_title(text: str) -> str:
    return (
        "<w:p>"
        "<w:pPr>"
        '<w:widowControl w:val="0" />'
        '<w:spacing w:after="0" w:line="560" w:lineRule="exact" />'
        '<w:jc w:val="center" />'
        '<w:rPr><w:sz w:val="48" /><w:szCs w:val="48" /><w:lang w:eastAsia="zh-CN" /></w:rPr>'
        "</w:pPr>"
        f"{make_run(text, size=48, hint_east_asia=True)}"
        "</w:p>"
    )


def cover_subtitle(text: str) -> str:
    fonts = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" />'
    return (
        "<w:p>"
        "<w:pPr>"
        '<w:widowControl w:val="0" />'
        '<w:spacing w:after="0" w:line="560" w:lineRule="exact" />'
        '<w:jc w:val="center" />'
        f"<w:rPr>{fonts}<w:sz w:val=\"32\" /></w:rPr>"
        "</w:pPr>"
        f"{make_run(text, fonts=fonts, size=32)}"
        "</w:p>"
    )


def toc_title(text: str) -> str:
    return f'<w:p><w:pPr><w:pStyle w:val="{TOC_TITLE_STYLE}" /></w:pPr>{make_run(text)}</w:p>'


def toc_item(text: str, *, level: int) -> str:
    style = TOC_LEVEL_1_STYLE if level == 1 else TOC_LEVEL_2_STYLE
    return f'<w:p><w:pPr><w:pStyle w:val="{style}" /></w:pPr>{make_run(text)}</w:p>'


def chapter_heading(text: str, *, page_break_before: bool = False) -> str:
    ppr = [
        f'<w:pStyle w:val="{CHAPTER_STYLE}" />',
        '<w:spacing w:line="550" w:lineRule="exact" />',
        '<w:jc w:val="center" />',
        '<w:rPr><w:rFonts w:hint="eastAsia" /><w:lang w:eastAsia="zh-CN" /></w:rPr>',
    ]
    if page_break_before:
        ppr.insert(0, "<w:pageBreakBefore />")
    return f"<w:p><w:pPr>{''.join(ppr)}</w:pPr>{make_run(text, hint_east_asia=True)}</w:p>"


def section_heading(number: str, title: str) -> str:
    fonts = '<w:rFonts w:ascii="Times New Roman" w:eastAsia="黑体" w:hAnsi="Times New Roman" />'
    ppr = (
        "<w:pPr>"
        '<w:widowControl w:val="0" />'
        '<w:spacing w:after="0" w:line="550" w:lineRule="exact" />'
        '<w:outlineLvl w:val="1" />'
        f"<w:rPr>{fonts}<w:sz w:val=\"28\" /><w:lang w:eastAsia=\"zh-CN\" /></w:rPr>"
        "</w:pPr>"
    )
    runs = make_run(f"{number} ", fonts=fonts, size=28) + make_run(title, fonts=fonts, size=28)
    return f"<w:p>{ppr}{runs}</w:p>"


def body_paragraph(text: str) -> str:
    fonts = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" />'
    ppr = (
        "<w:pPr>"
        '<w:widowControl w:val="0" />'
        '<w:spacing w:after="0" w:line="550" w:lineRule="exact" />'
        '<w:ind w:firstLineChars="200" w:firstLine="480" />'
        '<w:jc w:val="both" />'
        f"<w:rPr>{fonts}<w:lang w:eastAsia=\"zh-CN\" /></w:rPr>"
        "</w:pPr>"
    )
    return f"<w:p>{ppr}{make_run(text, fonts=fonts)}</w:p>"


def figure_caption(text: str) -> str:
    fonts = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" />'
    ppr = (
        "<w:pPr>"
        '<w:widowControl w:val="0" />'
        '<w:spacing w:after="0" w:line="400" w:lineRule="exact" />'
        '<w:jc w:val="center" />'
        f"<w:rPr>{fonts}<w:b /><w:sz w:val=\"21\" /><w:lang w:eastAsia=\"zh-CN\" /></w:rPr>"
        "</w:pPr>"
    )
    return f"<w:p>{ppr}{make_run(text, fonts=fonts, size=21, bold=True)}</w:p>"


def build_document_xml() -> str:
    paragraphs: list[str] = []

    paragraphs.extend(
        [
            make_empty_paragraph(centered=True),
            cover_title("智能管道能耗分析系统"),
            make_empty_paragraph(centered=True),
            cover_subtitle("使用说明书"),
            make_empty_paragraph(centered=True),
            make_empty_paragraph(centered=True),
            toc_title("目录"),
            toc_item("第1章 系统概述", level=1),
            toc_item("1.1 建设目标", level=2),
            toc_item("1.2 背景", level=2),
            toc_item("第2章 系统设计", level=1),
            toc_item("2.1 前端功能设计", level=2),
            toc_item("2.2 后端功能设计", level=2),
            toc_item("2.3 系统架构设计", level=2),
            toc_item("2.4 系统整体设计", level=2),
            toc_item("第3章 功能使用说明", level=1),
            toc_item("3.1 登录与首页总览", level=2),
            toc_item("3.2 基础数据管理", level=2),
            toc_item("3.3 计算分析", level=2),
            toc_item("3.4 智能助手与知识库", level=2),
            toc_item("第4章 部署与运行", level=1),
            toc_item("4.1 运行环境", level=2),
            toc_item("4.2 启动方式", level=2),
            toc_item("4.3 运维建议", level=2),
        ]
    )

    paragraphs.extend(
        [
            chapter_heading("第1章 系统概述", page_break_before=True),
            body_paragraph("本系统面向输油管道运行分析、能耗核算、泵站调度优化、故障诊断与智能问答场景，提供从基础数据管理、专业计算分析到智能报告生成的一体化能力。"),
            body_paragraph("系统采用“前端可视化平台 + Spring Cloud 微服务后端 + Python 智能体服务”的分层架构，支持项目参数建模、水力工况分析、泵站组合优化、知识库问答与智能辅助分析，适用于教学演示、方案论证、业务试运行与后续工程化扩展。"),
            section_heading("1.1", "建设目标"),
            body_paragraph("（1）建立统一的项目、管道、泵站、油品等基础数据管理平台，为后续分析提供标准化输入。"),
            body_paragraph("（2）提供水力分析、泵站优化、敏感性分析等核心业务能力。"),
            body_paragraph("（3）通过智能助手接入知识库检索、分析推理与过程追踪能力，提升分析效率。"),
            body_paragraph("（4）形成“数据录入 - 计算分析 - 结果展示 - 知识辅助”的完整闭环，便于部署、演示与持续迭代。"),
            section_heading("1.2", "背景"),
            body_paragraph("软件分类：应用软件。"),
            body_paragraph("运行硬件环境：个人计算机或服务器，建议 CPU 4 核及以上、内存 16GB 及以上、可用磁盘空间 20GB 及以上。"),
            body_paragraph("开发硬件环境：个人计算机，建议 CPU 4 核及以上、内存 16GB 及以上、可用磁盘空间 40GB 及以上。"),
            body_paragraph("开发软件环境：IntelliJ IDEA、Visual Studio Code、Node.js、Maven、Python 3.11、Docker Desktop。"),
            body_paragraph("软件运行支撑环境/支持软件：JDK 21、MySQL 8.0、Redis 7、Nacos 2.2.x、MinIO、Milvus、Node.js 18+。"),
            body_paragraph("运行软件环境：Windows 10、Windows 11 或 Linux。"),
            body_paragraph("开发该软件的操作系统：Windows 10 或 Windows 11。"),
            body_paragraph("编程语言：Java、TypeScript、Python、SQL。"),
            body_paragraph("主要功能：系统支持用户登录认证、首页总览、项目数据建模、水力分析、泵站优化、敏感性分析、智能问答与知识库录入。"),
            body_paragraph("技术特点：后端采用 Spring Cloud Alibaba 微服务架构，前端采用 React + TypeScript + Vite，智能体服务采用 FastAPI，并结合知识库、向量检索与流程编排能力构建智能分析闭环。"),
        ]
    )

    paragraphs.extend(
        [
            chapter_heading("第2章 系统设计", page_break_before=True),
            section_heading("2.1", "前端功能设计"),
            figure_caption("图1 前端功能设计图（图片预留）"),
            body_paragraph("前端系统提供统一的可视化入口，主要包含登录页、首页总览、数据管理、计算分析、智能助手和系统设置等区域。用户可通过侧边菜单快速切换项目管理、参数配置、分析计算、知识录入与系统配置等页面。"),
            section_heading("2.2", "后端功能设计"),
            figure_caption("图2 后端功能设计图（图片预留）"),
            body_paragraph("后端由 API 网关、认证服务、系统服务、数据服务、计算服务和智能体服务组成。网关负责统一入口与路由转发，认证服务负责登录鉴权，数据服务承担项目和参数数据管理，计算服务负责水力分析与优化计算，智能体服务负责知识库问答、分析追踪与工具编排。"),
            section_heading("2.3", "系统架构设计"),
            figure_caption("图3 系统架构图（图片预留）"),
            body_paragraph("系统整体采用分层架构。用户通过浏览器访问 React 前端，前端经由网关访问各 Java 微服务；Python 智能体服务独立提供智能问答与知识工具接口；底层使用 MySQL 存储业务数据，Redis 维护缓存和会话，Nacos 用于服务注册发现，MinIO 和 Milvus 为知识文档与向量检索提供支撑。"),
            section_heading("2.4", "系统整体设计"),
            figure_caption("图4 系统整体设计图（图片预留）"),
            body_paragraph("系统业务流程为：先建立项目与设备参数，再执行水力分析和优化计算；随后结合敏感性分析与首页总览查看结果；最后通过智能助手和知识库能力完成结论归纳、知识检索与过程追踪，形成完整应用闭环。"),
        ]
    )

    paragraphs.extend(
        [
            chapter_heading("第3章 功能使用说明", page_break_before=True),
            section_heading("3.1", "登录与首页总览"),
            figure_caption("图5 系统首页图（图片预留）"),
            figure_caption("图6 系统登录界面图（图片预留）"),
            body_paragraph("用户打开前端地址 http://localhost:5173 后进入登录页，输入用户名和密码即可访问系统。当前项目默认管理员账号为 admin / admin123。登录成功后进入首页总览页面，可查看实时流量、管道压力、平均温度、系统效率、告警信息和设备运行状态等概览信息。"),
            section_heading("3.2", "基础数据管理"),
            figure_caption("图7 项目与参数管理界面图（图片预留）"),
            body_paragraph("在“数据管理”菜单下，系统提供项目管理、管道参数、泵站参数和油品参数四类基础数据维护页面。建议的录入顺序为：先创建项目，再维护项目下的管道参数，然后维护泵站参数和油品参数。后续在分析计算页面中，系统可自动带入已保存的参数，减少重复输入。"),
            section_heading("3.3", "计算分析"),
            figure_caption("图8 水力分析界面图（图片预留）"),
            figure_caption("图9 泵站优化与敏感性分析界面图（图片预留）"),
            body_paragraph("在“计算分析”菜单下，系统提供水力分析、泵站优化和敏感性分析功能。水力分析用于计算流速、雷诺数、沿程损失、水力坡降和站间压力等指标；泵站优化用于遍历可行泵组合并输出推荐运行方案、末站压力与能耗成本；敏感性分析用于观察关键变量变化对结果的影响。"),
            section_heading("3.4", "智能助手与知识库"),
            figure_caption("图10 智能助手与知识库界面图（图片预留）"),
            body_paragraph("在“智能助手”菜单下，用户可进入智能对话和知识库录入页面。智能对话支持标准问答、故障排查建议和优化建议模式，并展示分析计划、工具调用和执行过程；知识库录入用于上传和维护管道相关知识文档。"),
            body_paragraph("知识库页面支持文档上传、重建索引和基础统计查看，便于持续补充系统知识来源。"),
        ]
    )

    paragraphs.extend(
        [
            chapter_heading("第4章 部署与运行", page_break_before=True),
            section_heading("4.1", "运行环境"),
            body_paragraph("推荐环境如下："),
            body_paragraph("JDK 21，Maven 3.8 及以上。"),
            body_paragraph("Python 3.11。"),
            body_paragraph("Node.js 18 及以上。"),
            body_paragraph("MySQL 8.0，Redis 7。"),
            body_paragraph("Docker 与 Docker Compose。"),
            body_paragraph("Windows 10、Windows 11 或 Linux。"),
            section_heading("4.2", "启动方式"),
            body_paragraph("基础设施启动：进入 pipeline-energy-cloud 目录后执行 docker-compose up -d，启动 MySQL、Redis、Nacos、MinIO 和 Milvus 等依赖服务。"),
            body_paragraph("数据库初始化：执行 pipeline-energy-cloud/sql/schema.sql 脚本，导入系统基础表、计算历史表、分析报告表和默认管理员账号数据。"),
            body_paragraph("Java 后端启动：在 pipeline-energy-cloud 目录执行 mvn clean package -DskipTests 完成编译后，按需启动网关、认证、数据、计算等服务，或使用项目根目录的 start-all-services.bat 脚本进行联动启动。"),
            body_paragraph("智能体服务启动：进入 pipeline-agent 目录，安装依赖后执行 py -3 -m src.main 或 py -3 main.py，默认服务地址为 http://localhost:8100。"),
            body_paragraph("前端启动：进入 pipeline-react 目录执行 npm install 与 npm run dev，默认访问地址为 http://localhost:5173。"),
            body_paragraph("系统常用地址：前端 http://localhost:5173，网关 http://localhost:8080，智能体服务 http://localhost:8100，Nacos 控制台 http://localhost:8848，MinIO 控制台 http://localhost:9001。"),
            section_heading("4.3", "运维建议"),
            body_paragraph("建议定期备份 MySQL 数据、MinIO 文件和知识库索引，避免报告与知识文档丢失。"),
            body_paragraph("建议在部署前核对各服务配置文件和 pipeline-agent/.env 中的数据库、模型与接口地址配置，确保前后端以及智能体服务地址保持一致。"),
            body_paragraph("建议通过日志、告警和健康检查接口持续观察网关、计算服务和智能体服务运行状态，必要时按“基础设施 - Java 微服务 - 智能体服务 - 前端”的顺序进行重启。"),
            body_paragraph("建议生产环境修改默认管理员密码，并对内部接口令牌、知识库上传接口和报告下载接口进行访问控制。"),
        ]
    )

    sect_pr = (
        "<w:sectPr>"
        '<w:pgSz w:w="11906" w:h="16838" />'
        '<w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800" w:header="851" w:footer="992" w:gutter="0" />'
        '<w:cols w:space="425" />'
        '<w:docGrid w:linePitch="312" />'
        "</w:sectPr>"
    )
    body = "".join(paragraphs) + sect_pr
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}</w:body>"
        "</w:document>"
    )


def generate_docx(template_path: Path, output_path: Path) -> None:
    if not template_path.exists():
        raise FileNotFoundError(f"Template not found: {template_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    document_xml = build_document_xml().encode("utf-8")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".docx") as tmp_file:
        temp_path = Path(tmp_file.name)

    try:
        with zipfile.ZipFile(template_path, "r") as source, zipfile.ZipFile(temp_path, "w") as target:
            for item in source.infolist():
                if item.filename == "word/document.xml":
                    target.writestr(item, document_xml)
                else:
                    target.writestr(item, source.read(item.filename))
        shutil.move(str(temp_path), str(output_path))
    finally:
        if temp_path.exists():
            temp_path.unlink()


def main() -> int:
    template = Path(sys.argv[1]) if len(sys.argv) > 1 else TEMPLATE_PATH
    output = Path(sys.argv[2]) if len(sys.argv) > 2 else OUTPUT_PATH
    generate_docx(template, output)
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
