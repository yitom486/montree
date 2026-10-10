# -*- coding: utf-8 -*-
"""
生成全套真实测试样本文件至 D:/book/format-samples
涵盖：
1. 01-企业员工薪资花名册.csv (包含带逗号、换行符、双引号转义的真实复杂字段)
2. 02-产品销售季度统计.tsv (制表符分隔多维销售数据)
3. 03-系统服务配置与规则.json (多层级服务端架构与模型路由配置)
4. 04-应用崩溃与并发堆栈.log (含 ISO 微秒时间戳、模块标签与真实多行堆栈)
5. 05-AI智能体架构演进报告.docx (Word 文档：大纲标题、样式表格、列表、引用)
6. 06-多维财务预算分析表.xlsx (Excel 工作簿：多 Sheet、单元格样式、公式、数值格式)
7. 07-Montree产品与技术方案汇报.pptx (PPT 演示文稿：多页幻灯片、封面与分栏卡片布局)
"""

import os
import sys
import json
from pathlib import Path

# 确保控制台输出 UTF-8
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

# 确保目标目录存在
OUT_DIR = Path(r"D:\book\format-samples")
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ----------------------------------------------------------------------
# 1. CSV: 01-企业员工薪资花名册.csv
# ----------------------------------------------------------------------
csv_content = """工号,姓名,部门,职级,月薪,入职日期,办公地址,工作评价
E1001,张伟,"研发中心, 核心架构组","\"杰出\" 架构师",48000.00,2021-03-15,"上海市浦东新区张江高科技园区
科苑路 88 号 5 楼","主持了底座重构，
表现极其出色"
E1002,李娜,"市场运营部, 华东大区",营销总监,36000.50,2022-07-01,"杭州市西湖区文三路 199 号 2 单元",Q3季度增长率突破 140%
E1003,王强,"产品设计部, 移动端交互","资深 \"UX\" 专家",29500.00,2023-01-10,"北京市海淀区中关村南大街 1 号
数码大厦 B 座 1204","规范了全端设计原子规范，
跨端复用率高"
E1004,赵敏,财务审计部,高级审计主管,31000.00,2020-11-20,"深圳市南山区科技园南区高新南道",年度审计零差错
E1005,陈晨,"基础设施部, 智能运维","DevOps 工程师",27000.80,2024-02-18,"成都市高新区天府软件园 E 区
6 栋 301 室","自动化交付流水线建设中"
E1006,周杰,安全合规部,"安全研究员",35000.00,2022-09-05,"北京市朝阳区望京 SOHO T2",成功拦截 12 次高危越权探测
"""
(OUT_DIR / "01-企业员工薪资花名册.csv").write_text(csv_content, encoding="utf-8-sig")
print("✓ 已生成: 01-企业员工薪资花名册.csv")

# ----------------------------------------------------------------------
# 2. TSV: 02-产品销售季度统计.tsv
# ----------------------------------------------------------------------
tsv_content = """季度\t业务线\t区域\t订单量\tGMV(万元)\t毛利率(%)\t达成率(%)
2026-Q1\t云计算底座\t华东\t1240\t1860.50\t42.5\t112.3
2026-Q1\t云计算底座\t华北\t890\t1250.20\t39.8\t98.5
2026-Q1\t端侧AI智能体\t华东\t3420\t2680.00\t58.2\t145.8
2026-Q1\t端侧AI智能体\t华南\t2150\t1720.80\t56.4\t128.0
2026-Q2\t知识管理套件\t华东\t1680\t980.60\t65.0\t104.2
2026-Q2\t知识管理套件\t西南\t920\t540.30\t61.8\t95.0
2026-Q2\t端侧AI智能体\t华东\t4100\t3350.00\t60.1\t152.0
2026-Q2\t端侧AI智能体\t华北\t2800\t2210.50\t57.3\t131.5
"""
(OUT_DIR / "02-产品销售季度统计.tsv").write_text(tsv_content, encoding="utf-8")
print("✓ 已生成: 02-产品销售季度统计.tsv")

# ----------------------------------------------------------------------
# 3. JSON: 03-系统服务配置与规则.json
# ----------------------------------------------------------------------
json_data = {
    "app": {
        "name": "Montree Desktop Hub",
        "version": "0.4.7",
        "environment": "production",
        "debug": False
    },
    "server": {
        "host": "127.0.0.1",
        "port": 8080,
        "max_connections": 500,
        "timeout_seconds": 30.5,
        "cors": {
            "enabled": True,
            "origins": [
                "http://localhost:5173",
                "app://montree.local"
            ],
            "headers": ["Authorization", "Content-Type", "X-Request-ID"]
        }
    },
    "storage": {
        "engine": "sqlite-pool",
        "database_path": "D:/book/.montree/app_database.db",
        "pool_size": 10,
        "wal_mode": True
    },
    "ai_providers": [
        {
            "id": "gemini-pro",
            "name": "Google Gemini 2.5 Flash",
            "type": "multimodal",
            "enabled": True,
            "max_tokens": 8192,
            "capabilities": ["text", "image", "audio", "document"]
        },
        {
            "id": "codex-acp",
            "name": "Local Agent Runner (ACP)",
            "type": "acp-rpc",
            "enabled": True,
            "command": "codex-acp",
            "capabilities": ["code-editing", "file-tree", "terminal"]
        }
    ],
    "features": {
        "enable_skills_marketplace": True,
        "office_live_editing": True,
        "auto_save_interval_ms": 1500,
        "experimental_flags": {
            "vdom_canvas_table": False,
            "stream_coalescing": True
        }
    }
}
(OUT_DIR / "03-系统服务配置与规则.json").write_text(json.dumps(json_data, ensure_ascii=False, indent=2), encoding="utf-8")
print("✓ 已生成: 03-系统服务配置与规则.json")

# ----------------------------------------------------------------------
# 4. LOG: 04-应用崩溃与并发堆栈.log
# ----------------------------------------------------------------------
log_content = """2026-10-10T02:15:01.102Z [system] INFO  Montree runtime initializing on win32-x64...
2026-10-10T02:15:01.150Z [config] INFO  Loaded config file from D:/book/format-samples/03-系统服务配置与规则.json
2026-10-10T02:15:01.210Z [db-pool] DEBUG SQLite connection pool established: 10 connections active in WAL mode
2026-10-10T02:15:02.005Z [acp-host] INFO  Starting codex-acp process with PID 18492
2026-10-10T02:15:02.320Z [acp-host] DEBUG ACP Handshake received: protocol_version=1, capabilities=["session","terminal"]
2026-10-10T02:15:10.840Z [worker-1] WARN  High memory consumption detected in buffer cache: current=1.8GB, limit=2.0GB
2026-10-10T02:15:11.450Z [worker-1] ERROR Uncaught Exception in Background Indexer Worker
java.lang.OutOfMemoryError: Java heap space
    at com.montree.indexer.DocumentParser.parseBuffer(DocumentParser.java:412)
    at com.montree.indexer.DocumentParser.processBatch(DocumentParser.java:185)
    at com.montree.indexer.IndexWorker.run(IndexWorker.java:88)
    at java.base/java.lang.Thread.run(Thread.java:1589)
Caused by: java.lang.RuntimeException: Buffer allocation failed: requested 524288000 bytes
    at com.montree.native.MemoryManager.allocate(MemoryManager.java:54)
    ... 3 more
2026-10-10T02:15:12.010Z [supervisor] WARN  Worker thread worker-1 terminated abnormally. Attempting to recycle resources...
2026-10-10T02:15:12.500Z [supervisor] INFO  Worker thread worker-1 successfully respawned with PID 20411.
2026-10-10T02:15:15.000Z [http-api] INFO  HTTP server listening on 127.0.0.1:8080
"""
(OUT_DIR / "04-应用崩溃与并发堆栈.log").write_text(log_content, encoding="utf-8")
print("✓ 已生成: 04-应用崩溃与并发堆栈.log")

# ----------------------------------------------------------------------
# 5. DOCX: 05-AI智能体架构演进报告.docx
# ----------------------------------------------------------------------
try:
    from docx import Document
    from docx.shared import Inches, Pt, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    doc = Document()

    # 标题
    title = doc.add_heading("AI 智能体桌面端架构演进与多格式文档支持报告", level=0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER

    # 副标题/作者元数据
    p_meta = doc.add_paragraph()
    p_meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_meta_run = p_meta.add_run("Montree 架构团队 · 2026 年 10 月 · 内部技术白皮书")
    p_meta_run.font.color.rgb = RGBColor(120, 120, 120)
    p_meta_run.font.size = Pt(10)

    # 摘要引用块
    p_intro = doc.add_paragraph()
    p_intro_run = p_intro.add_run(
        "【摘要】本文档探讨了在现代桌面生产力工具中，如何将 Markdown 笔记、电子书阅读（PDF/EPUB/MOBI）与传统 "
        "Office 套件（Word、Excel、PPT）以及异构数据格式（CSV/JSON/LOG）深度打通，并引入生态化 Skills 注入架构。"
    )
    p_intro_run.italic = True
    p_intro_run.font.size = Pt(10.5)

    # 一级标题
    doc.add_heading("一、业务背景与核心诉求", level=1)
    p1 = doc.add_paragraph()
    p1.add_run("传统笔记软件普遍局限于 Markdown 文本，用户在面对 ").font.size = Pt(11)
    r_bold = p1.add_run("财务报表（XLSX）、学术论文报告（DOCX）以及演讲文稿（PPTX）")
    r_bold.bold = True
    p1.add_run(" 时往往只能依赖外部桌面应用开启。这种割裂带来两大弊端：").font.size = Pt(11)

    # 列表项
    doc.add_paragraph("1. 知识库与数据处于孤岛状态，AI 伴读与问答无法跨格式提取上下文；", style='List Number')
    doc.add_paragraph("2. 编辑修改无法在应用内就地完成，破坏沉浸式阅读与知识提炼闭环。", style='List Number')

    # 二级标题
    doc.add_heading("二、文档格式矩阵支持路线", level=1)
    doc.add_paragraph("根据解析复杂度与业务优先级，技术路线分为三个推进阶段：")

    # 表格
    table = doc.add_table(rows=1, cols=4)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr_cells = table.rows[0].cells
    hdr_titles = ["阶段", "文档格式", "核心能力", "交互体验"]
    for i, t in enumerate(hdr_titles):
        hdr_cells[i].text = t
        for p in hdr_cells[i].paragraphs:
            for run in p.runs:
                run.bold = True

    data_rows = [
        ("阶段一", "CSV / TSV / JSON / LOG", "轻量表格编辑、JSON树形寻址、日志级别过滤", "就地 CRUD 与无损保存"),
        ("阶段二", "DOCX / XLSX / PPTX", "只读高保真渲染（docx-preview, Luckysheet, pptx2html）", "跨文档批注与一键提炼"),
        ("阶段三", "Office 增强编辑 & Skills", "在线轻编辑、OpenClaw/WorkBuddy 市场工具注入", "一键由书籍提炼生成 PPT")
    ]
    for row in data_rows:
        row_cells = table.add_row().cells
        for i, val in enumerate(row):
            row_cells[i].text = val

    doc.add_heading("三、结语", level=1)
    doc.add_paragraph("统一的文档模型和标准化的工具链注入，是实现端侧大模型从「纯文本问答」向「全知生产力中心」跨越的关键支柱。")

    doc.save(str(OUT_DIR / "05-AI智能体架构演进报告.docx"))
    print("✓ 已生成: 05-AI智能体架构演进报告.docx")
except Exception as e:
    print(f"✗ 生成 docx 失败: {e}")

# ----------------------------------------------------------------------
# 6. XLSX: 06-多维财务预算分析表.xlsx
# ----------------------------------------------------------------------
try:
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    wb = openpyxl.Workbook()

    # 工作表 1：部门预算与执行
    ws1 = wb.active
    ws1.title = "2026年度预算与执行"

    # 表头样式
    header_font = Font(name="微软雅黑", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1F497D", end_color="1F497D", fill_type="solid")
    center_align = Alignment(horizontal="center", vertical="center")
    thin_border = Border(
        left=Side(style='thin', color='D9D9D9'),
        right=Side(style='thin', color='D9D9D9'),
        top=Side(style='thin', color='D9D9D9'),
        bottom=Side(style='thin', color='D9D9D9')
    )

    headers_1 = ["部门名称", "预算总额(元)", "已支出金额(元)", "剩余预算(元)", "预算执行率", "状态"]
    ws1.append(headers_1)

    sheet1_data = [
        ["基础架构研发部", 1200000, 854000, "=B2-C2", "=C2/B2", "正常执行"],
        ["AI核心算法中心", 2500000, 1920000, "=B3-C3", "=C3/B3", "正常执行"],
        ["跨平台客户端组", 800000, 765000, "=B4-C4", "=C4/B4", "即将超支"],
        ["用户体验设计组", 450000, 280000, "=B5-C5", "=C5/B5", "预算充裕"],
        ["市场与品牌推广", 1500000, 1380000, "=B6-C6", "=C6/B6", "正常执行"]
    ]

    for row in sheet1_data:
        ws1.append(row)

    # 汇总行
    summary_row = ["合计 / 平均", "=SUM(B2:B6)", "=SUM(C2:C6)", "=SUM(D2:D6)", "=C7/B7", "-"]
    ws1.append(summary_row)

    # 格式化 Sheet1
    for col_idx in range(1, len(headers_1) + 1):
        cell = ws1.cell(row=1, column=col_idx)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center_align

    for r_idx in range(2, 8):
        for c_idx in range(1, 7):
            cell = ws1.cell(row=r_idx, column=c_idx)
            cell.border = thin_border
            if c_idx in (2, 3, 4):
                cell.number_format = '¥#,##0.00'
                cell.alignment = Alignment(horizontal="right")
            elif c_idx == 5:
                cell.number_format = '0.0%'
                cell.alignment = Alignment(horizontal="right")
            else:
                cell.alignment = Alignment(horizontal="center")

    # 汇总行加粗
    for c_idx in range(1, 7):
        ws1.cell(row=7, column=c_idx).font = Font(name="微软雅黑", size=11, bold=True)

    # 自动列宽
    for col in ws1.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws1.column_dimensions[col_letter].width = max(max_len * 2.2, 14)

    # 工作表 2：季度硬件采购清单
    ws2 = wb.create_sheet(title="季度硬件采购清单")
    headers_2 = ["设备编号", "设备型号", "采购单价(元)", "采购数量", "总金额(元)", "责任人"]
    ws2.append(headers_2)
    sheet2_data = [
        ["DEV-001", "MacBook Pro M4 Max 64G", 26999, 5, "=C2*D2", "张伟"],
        ["DEV-002", "Dell UltraSharp 4K 27寸显示器", 4299, 10, "=C3*D3", "陈晨"],
        ["DEV-003", "RTX 4090 24GB 工作站", 32000, 3, "=C4*D4", "李娜"],
        ["DEV-004", "人体工学电脑椅", 1850, 8, "=C5*D5", "赵敏"]
    ]
    for row in sheet2_data:
        ws2.append(row)

    ws2.append(["合计", "-", "-", "=SUM(D2:D5)", "=SUM(E2:E5)", "-"])

    for col_idx in range(1, len(headers_2) + 1):
        cell = ws2.cell(row=1, column=col_idx)
        cell.font = header_font
        cell.fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
        cell.alignment = center_align

    for r_idx in range(2, 7):
        for c_idx in range(1, 7):
            cell = ws2.cell(row=r_idx, column=c_idx)
            cell.border = thin_border
            if c_idx in (3, 5):
                cell.number_format = '¥#,##0.00'
                cell.alignment = Alignment(horizontal="right")
            elif c_idx == 4:
                cell.alignment = Alignment(horizontal="right")
            else:
                cell.alignment = Alignment(horizontal="center")

    ws2.cell(row=6, column=1).font = Font(name="微软雅黑", size=11, bold=True)
    ws2.cell(row=6, column=5).font = Font(name="微软雅黑", size=11, bold=True)

    for col in ws2.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws2.column_dimensions[col_letter].width = max(max_len * 2.2, 14)

    wb.save(str(OUT_DIR / "06-多维财务预算分析表.xlsx"))
    print("✓ 已生成: 06-多维财务预算分析表.xlsx")
except Exception as e:
    print(f"✗ 生成 xlsx 失败: {e}")

# ----------------------------------------------------------------------
# 7. PPTX: 07-Montree产品与技术方案汇报.pptx
# ----------------------------------------------------------------------
try:
    from pptx import Presentation
    from pptx.util import Inches, Pt
    from pptx.dml.color import RGBColor
    from pptx.enum.text import PP_ALIGN

    prs = Presentation()
    # 16:9 宽屏尺寸
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)

    blank_layout = prs.slide_layouts[6]

    # --- Slide 1: 封面 ---
    s1 = prs.slides.add_slide(blank_layout)

    tb1 = s1.shapes.add_textbox(Inches(1.2), Inches(2.2), Inches(11.0), Inches(1.8))
    tf1 = tb1.text_frame
    p1 = tf1.paragraphs[0]
    p1.text = "Montree 桌面端多格式文档与 Agent 架构"
    p1.font.size = Pt(40)
    p1.font.bold = True
    p1.font.color.rgb = RGBColor(30, 41, 59)

    p1_sub = tf1.add_paragraph()
    p1_sub.text = "从 Markdown 笔记、电子书阅读到 Office 矩阵与 Skills 智能体生态演进"
    p1_sub.font.size = Pt(20)
    p1_sub.font.color.rgb = RGBColor(100, 116, 139)
    p1_sub.space_before = Pt(14)

    tb1_meta = s1.shapes.add_textbox(Inches(1.2), Inches(5.2), Inches(6.0), Inches(1.0))
    tf1_meta = tb1_meta.text_frame
    p_meta = tf1_meta.paragraphs[0]
    p_meta.text = "汇报人: Montree 架构设计团队\n日期: 2026 年 10 月"
    p_meta.font.size = Pt(13)
    p_meta.font.color.rgb = RGBColor(148, 163, 184)

    # --- Slide 2: 核心挑战与方案定位 ---
    s2 = prs.slides.add_slide(blank_layout)
    tb2_title = s2.shapes.add_textbox(Inches(1.0), Inches(0.8), Inches(11.0), Inches(1.0))
    p2_title = tb2_title.text_frame.paragraphs[0]
    p2_title.text = "核心业务挑战与架构愿景"
    p2_title.font.size = Pt(28)
    p2_title.font.bold = True
    p2_title.font.color.rgb = RGBColor(15, 23, 42)

    # 3 张卡片
    card_data = [
        ("痛点 1: 格式壁垒严重", "传统文档软件将 Markdown、电子书与 Office 文件割裂存储，用户无法在统一工作区内进行跨格式交叉索引与知识沉淀。"),
        ("痛点 2: 编辑流程割裂", "外部第三方软件打开 Office 无法就地保存至本地知识库，缺少统一的增删改查模型与版本协同支持。"),
        ("目标: 统一智能工作台", "通过将非 Markdown 文件作为一等公民支持，结合端侧 ACP 协议与 Skills 工具链，打造沉浸式端侧生产力中心。")
    ]

    for idx, (head, body) in enumerate(card_data):
        left = Inches(1.0 + idx * 3.9)
        top = Inches(2.2)
        width = Inches(3.6)
        height = Inches(4.2)

        tb_card = s2.shapes.add_textbox(left, top, width, height)
        tf_card = tb_card.text_frame
        tf_card.word_wrap = True

        p_h = tf_card.paragraphs[0]
        p_h.text = head
        p_h.font.size = Pt(18)
        p_h.font.bold = True
        p_h.font.color.rgb = RGBColor(37, 99, 235)

        p_b = tf_card.add_paragraph()
        p_b.text = body
        p_b.font.size = Pt(13)
        p_b.font.color.rgb = RGBColor(71, 85, 105)
        p_b.space_before = Pt(12)

    # --- Slide 3: 架构规划与推进矩阵 ---
    s3 = prs.slides.add_slide(blank_layout)
    tb3_title = s3.shapes.add_textbox(Inches(1.0), Inches(0.8), Inches(11.0), Inches(1.0))
    p3_title = tb3_title.text_frame.paragraphs[0]
    p3_title.text = "文档支持矩阵演进规划"
    p3_title.font.size = Pt(28)
    p3_title.font.bold = True
    p3_title.font.color.rgb = RGBColor(15, 23, 42)

    phases = [
        ("阶段 1: 文本与数据模型 (已完成)", "• CSV / TSV RFC 4180 状态机解析与行列单元格 CRUD\n• JSON 树形模型与 JSONPath 精准寻址改查\n• LOG 日志级别掩码与多行崩溃堆栈自动吸附"),
        ("阶段 2: Office 高保真与轻编辑", "• DOCX 文档排版解析与正文预览\n• XLSX 电子表格多 Sheet 渲染与公式计算\n• PPTX 演示幻灯片逐页翻阅与大纲提取"),
        ("阶段 3: Skills 市场注入与一键 PPT", "• 对齐 OpenClaw / WorkBuddy 社区 Skills 规范\n• 阅读电子书/笔记一键提炼大纲并自动化生成 PPT\n• 暴露 montree_office_* 工具链赋能 Agent 闭环")
    ]

    for idx, (p_title_str, p_desc) in enumerate(phases):
        left = Inches(1.0 + idx * 3.9)
        top = Inches(2.2)
        width = Inches(3.6)
        height = Inches(4.2)

        tb_card = s3.shapes.add_textbox(left, top, width, height)
        tf_card = tb_card.text_frame
        tf_card.word_wrap = True

        p_h = tf_card.paragraphs[0]
        p_h.text = p_title_str
        p_h.font.size = Pt(17)
        p_h.font.bold = True
        p_h.font.color.rgb = RGBColor(16, 149, 193) if idx == 0 else RGBColor(79, 70, 229)

        p_b = tf_card.add_paragraph()
        p_b.text = p_desc
        p_b.font.size = Pt(13)
        p_b.font.color.rgb = RGBColor(71, 85, 105)
        p_b.space_before = Pt(12)

    prs.save(str(OUT_DIR / "07-Montree产品与技术方案汇报.pptx"))
    print("✓ 已生成: 07-Montree产品与技术方案汇报.pptx")
except Exception as e:
    print(f"✗ 生成 pptx 失败: {e}")

# ----------------------------------------------------------------------
# 8. HTML: 08-数据可视化与3D交互看板.html
# ----------------------------------------------------------------------
html_content = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Montree 3D 全息交互看板</title>
  <style>
    :root {
      --bg-primary: #0a0e17;
      --bg-surface: rgba(18, 24, 38, 0.75);
      --bg-surface-hover: rgba(28, 36, 56, 0.85);
      --border-color: rgba(255, 255, 255, 0.08);
      --border-glow: rgba(59, 130, 246, 0.4);
      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      --accent-blue: #3b82f6;
      --accent-cyan: #06b6d4;
      --accent-emerald: #10b981;
      --accent-amber: #f59e0b;
      --accent-purple: #8b5cf6;
      --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: radial-gradient(circle at 50% 0%, #172554 0%, var(--bg-primary) 70%);
      color: var(--text-main);
      font-family: var(--font-family);
      min-height: 100vh;
      padding: 24px;
      overflow-x: hidden;
      perspective: 1200px;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding: 16px 20px;
      background: var(--bg-surface);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
    }

    .brand { display: flex; align-items: center; gap: 14px; }

    .brand-icon {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: linear-gradient(135deg, var(--accent-cyan), var(--accent-blue), var(--accent-purple));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      box-shadow: 0 0 20px rgba(59, 130, 246, 0.5);
      animation: pulse-glow 3s infinite alternate;
    }

    @keyframes pulse-glow {
      from { box-shadow: 0 0 15px rgba(6, 182, 212, 0.4); }
      to { box-shadow: 0 0 28px rgba(139, 92, 246, 0.7); }
    }

    .brand-text h1 {
      font-size: 1.25rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      background: linear-gradient(90deg, #ffffff, #93c5fd);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .brand-text p {
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    .header-actions { display: flex; align-items: center; gap: 12px; }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #34d399;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 600;
    }

    .status-dot {
      width: 7px;
      height: 7px;
      background: #10b981;
      border-radius: 50%;
      box-shadow: 0 0 8px #10b981;
      animation: blink 2s infinite ease-in-out;
    }

    @keyframes blink {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 20px;
      margin-bottom: 24px;
    }

    .card-3d-wrapper { perspective: 800px; }

    .card-3d {
      position: relative;
      background: var(--bg-surface);
      backdrop-filter: blur(12px);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      padding: 20px;
      transform-style: preserve-3d;
      transition: transform 0.15s ease-out, box-shadow 0.2s ease, border-color 0.2s ease;
      cursor: pointer;
      overflow: hidden;
    }

    .card-3d:hover {
      border-color: var(--border-glow);
      box-shadow: 0 20px 40px rgba(14, 165, 233, 0.18);
    }

    .card-3d::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: linear-gradient(90deg, transparent, var(--accent-cyan), transparent);
      opacity: 0;
      transition: opacity 0.3s;
    }

    .card-3d:hover::before { opacity: 1; }

    .card-title {
      font-size: 0.85rem;
      color: var(--text-muted);
      margin-bottom: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transform: translateZ(20px);
    }

    .card-value {
      font-size: 1.85rem;
      font-weight: 800;
      color: #fff;
      margin-bottom: 6px;
      letter-spacing: -0.03em;
      transform: translateZ(35px);
    }

    .card-delta {
      font-size: 0.8rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 4px;
      transform: translateZ(25px);
    }

    .delta-up { color: #34d399; }

    .dashboard-body {
      display: grid;
      grid-template-columns: 360px 1fr;
      gap: 24px;
    }

    @media (max-width: 1024px) {
      .dashboard-body { grid-template-columns: 1fr; }
    }

    .panel {
      background: var(--bg-surface);
      backdrop-filter: blur(14px);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      padding: 20px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    }

    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .panel-title {
      font-size: 1rem;
      font-weight: 600;
      color: var(--text-main);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .canvas-container {
      position: relative;
      width: 100%;
      height: 330px;
      border-radius: 12px;
      background: rgba(10, 14, 23, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.05);
      overflow: hidden;
    }

    #cubeCanvas {
      width: 100%;
      height: 100%;
      display: block;
      cursor: grab;
    }

    #cubeCanvas:active { cursor: grabbing; }

    .canvas-hint {
      position: absolute;
      bottom: 10px;
      left: 12px;
      right: 12px;
      display: flex;
      justify-content: space-between;
      font-size: 0.72rem;
      color: var(--text-muted);
      pointer-events: none;
    }

    .canvas-controls {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }

    .btn {
      background: rgba(255, 255, 255, 0.06);
      color: var(--text-main);
      border: 1px solid var(--border-color);
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 0.8rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .btn:hover {
      background: rgba(59, 130, 246, 0.2);
      border-color: rgba(59, 130, 246, 0.4);
      color: #93c5fd;
    }

    .btn-primary {
      background: var(--accent-blue);
      border-color: var(--accent-blue);
      color: #fff;
    }

    .btn-primary:hover {
      background: #2563eb;
      color: #fff;
    }

    .table-toolbar {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }

    .search-box {
      flex: 1;
      min-width: 200px;
      position: relative;
    }

    .search-input {
      width: 100%;
      background: rgba(10, 14, 23, 0.6);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 8px 12px 8px 34px;
      color: #fff;
      font-size: 0.82rem;
      outline: none;
      transition: border-color 0.2s;
    }

    .search-input:focus {
      border-color: var(--accent-blue);
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
    }

    .search-icon {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 0.85rem;
      color: var(--text-muted);
    }

    .filter-select {
      background: rgba(10, 14, 23, 0.6);
      border: 1px solid var(--border-color);
      color: var(--text-main);
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 0.82rem;
      outline: none;
      cursor: pointer;
    }

    .table-container {
      overflow-x: auto;
      border-radius: 10px;
      border: 1px solid var(--border-color);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.82rem;
    }

    th {
      background: rgba(15, 23, 42, 0.85);
      color: var(--text-muted);
      font-weight: 600;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-color);
      cursor: pointer;
      user-select: none;
      transition: color 0.15s;
    }

    th:hover { color: #fff; }

    th.sorted-asc::after { content: ' ▲'; font-size: 0.65rem; color: var(--accent-cyan); }
    th.sorted-desc::after { content: ' ▼'; font-size: 0.65rem; color: var(--accent-cyan); }

    td {
      padding: 12px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      color: #cbd5e1;
      transition: background 0.15s;
    }

    tr:hover td {
      background: rgba(59, 130, 246, 0.08);
      color: #fff;
    }

    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 0.72rem;
      font-weight: 600;
    }

    .badge-success { background: rgba(16, 185, 129, 0.15); color: #34d399; }
    .badge-warning { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
    .badge-purple { background: rgba(139, 92, 246, 0.15); color: #c084fc; }

    .progress-bar-bg {
      width: 100%;
      max-width: 110px;
      height: 6px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 3px;
      overflow: hidden;
      display: inline-block;
      vertical-align: middle;
      margin-right: 8px;
    }

    .progress-bar-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.5s ease;
    }

    .table-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 14px;
      font-size: 0.78rem;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="brand-icon">❖</div>
      <div class="brand-text">
        <h1>Montree 3D 全息交互数据看板</h1>
        <p>本地 HTML 实时渲染引擎 / WebGL 3D 几何透视与响应式数据表格</p>
      </div>
    </div>
    <div class="header-actions">
      <div class="status-badge">
        <span class="status-dot"></span>
        渲染引擎：SANDBOX READY
      </div>
      <button class="btn" onclick="randomizeData()">🎲 随机指标</button>
    </div>
  </header>

  <div class="kpi-grid">
    <div class="card-3d-wrapper">
      <div class="card-3d">
        <div class="card-title">
          <span>总算力吞吐量</span>
          <span>⚡</span>
        </div>
        <div class="card-value" id="val1">482.6 TFLOPS</div>
        <div class="card-delta delta-up">↑ +14.8% 较昨日</div>
      </div>
    </div>
    <div class="card-3d-wrapper">
      <div class="card-3d">
        <div class="card-title">
          <span>并发请求响应</span>
          <span>🌐</span>
        </div>
        <div class="card-value" id="val2">1,829 QPS</div>
        <div class="card-delta delta-up">↑ 99.98% 可用率</div>
      </div>
    </div>
    <div class="card-3d-wrapper">
      <div class="card-3d">
        <div class="card-title">
          <span>模型交互延迟</span>
          <span>⏱</span>
        </div>
        <div class="card-value" id="val3">18.4 ms</div>
        <div class="card-delta delta-up">↓ -2.4 ms 延迟优化</div>
      </div>
    </div>
    <div class="card-3d-wrapper">
      <div class="card-3d">
        <div class="card-title">
          <span>内存缓存命中</span>
          <span>💾</span>
        </div>
        <div class="card-value" id="val4">96.8 %</div>
        <div class="card-delta delta-up">↑ 零磁盘争用</div>
      </div>
    </div>
  </div>

  <div class="dashboard-body">
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">
          <span>🔮</span>
          <span>3D 透视粒子核心</span>
        </div>
        <span style="font-size: 0.75rem; color: var(--accent-cyan);">60 FPS</span>
      </div>
      <div class="canvas-container">
        <canvas id="cubeCanvas"></canvas>
        <div class="canvas-hint">
          <span>拖拽鼠标可 3D 自由旋转</span>
          <span id="rotationStat">X: 0° | Y: 0°</span>
        </div>
      </div>
      <div class="canvas-controls">
        <button class="btn" style="flex:1" onclick="toggleAutoRotate()">⏯ 启停自转</button>
        <button class="btn" style="flex:1" onclick="switch3DMode()">🔄 切换几何体</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">
          <span>📊</span>
          <span>分布式工作负载监控</span>
        </div>
        <button class="btn btn-primary" onclick="addNewRow()">＋ 注入负载节点</button>
      </div>

      <div class="table-toolbar">
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input
            type="text"
            id="searchInput"
            class="search-input"
            placeholder="搜索节点名称、集群区域或状态..."
            oninput="handleSearch()"
          />
        </div>
        <select id="statusFilter" class="filter-select" onchange="handleFilter()">
          <option value="ALL">全部状态</option>
          <option value="ACTIVE">运行中 (Active)</option>
          <option value="OPTIMIZED">超频加速 (Optimized)</option>
          <option value="PENDING">准备中 (Pending)</option>
        </select>
      </div>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th onclick="sortTable(0)">节点标识</th>
              <th onclick="sortTable(1)">计算集群</th>
              <th onclick="sortTable(2)">状态</th>
              <th onclick="sortTable(3)">核心负载</th>
              <th onclick="sortTable(4)">带宽峰值</th>
              <th style="text-align:right">操作</th>
            </tr>
          </thead>
          <tbody id="tableBody"></tbody>
        </table>
      </div>

      <div class="table-footer">
        <span id="rowCount">展示 5 条记录</span>
        <span>HTML 渲染模式：高保真沙箱已挂载</span>
      </div>
    </div>
  </div>

  <script>
    // 卡片 3D 视差
    document.querySelectorAll('.card-3d').forEach((card) => {
      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const rotateX = ((y - rect.height / 2) / (rect.height / 2)) * -12;
        const rotateY = ((x - rect.width / 2) / (rect.width / 2)) * 12;
        card.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
      });
      card.addEventListener('mouseleave', () => {
        card.style.transform = 'perspective(800px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
      });
    });

    // 3D Canvas
    const canvas = document.getElementById('cubeCanvas');
    const ctx = canvas.getContext('2d');
    let width, height;

    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      width = canvas.width = rect.width;
      height = canvas.height = rect.height;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    let angleX = 0.4, angleY = 0.6;
    let isDragging = false, autoRotate = true;
    let lastMouseX = 0, lastMouseY = 0, shapeMode = 0;

    function getCubeVertices() {
      const s = 65;
      return [
        [-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s],
        [-s, -s, s],  [s, -s, s],  [s, s, s],  [-s, s, s]
      ];
    }
    const cubeEdges = [
      [0,1],[1,2],[2,3],[3,0],
      [4,5],[5,6],[6,7],[7,4],
      [0,4],[1,5],[2,6],[3,7]
    ];

    function getOctahedronVertices() {
      const s = 90;
      return [
        [0, -s, 0], [0, s, 0],
        [-s, 0, 0], [s, 0, 0],
        [0, 0, -s], [0, 0, s]
      ];
    }
    const octaEdges = [
      [0,2],[0,3],[0,4],[0,5],
      [1,2],[1,3],[1,4],[1,5],
      [2,4],[4,3],[3,5],[5,2]
    ];

    function project(p, ax, ay) {
      let cosY = Math.cos(ay), sinY = Math.sin(ay);
      let x1 = p[0] * cosY - p[2] * sinY;
      let z1 = p[0] * sinY + p[2] * cosY;

      let cosX = Math.cos(ax), sinX = Math.sin(ax);
      let y2 = p[1] * cosX - z1 * sinX;
      let z2 = p[1] * sinX + z1 * cosX;

      let fov = 320, distance = 270;
      let scale = fov / (distance + z2);

      return { x: x1 * scale + width / 2, y: y2 * scale + height / 2, scale: scale };
    }

    function render3D() {
      ctx.clearRect(0, 0, width, height);
      if (autoRotate && !isDragging) {
        angleY += 0.015;
        angleX += 0.007;
      }
      document.getElementById('rotationStat').textContent =
        `X: ${Math.round((angleX * 180) / Math.PI) % 360}° | Y: ${Math.round((angleY * 180) / Math.PI) % 360}°`;

      const vertices = shapeMode === 0 ? getCubeVertices() : getOctahedronVertices();
      const edges = shapeMode === 0 ? cubeEdges : octaEdges;
      const projected = vertices.map(v => project(v, angleX, angleY));

      const time = Date.now() * 0.001;
      ctx.fillStyle = 'rgba(6, 182, 212, 0.4)';
      for (let i = 0; i < 20; i++) {
        let theta = i * 0.31 + time;
        let r = 105 + Math.sin(time * 2 + i) * 15;
        let p = project([Math.cos(theta) * r, Math.sin(theta * 0.5) * 35, Math.sin(theta) * r], angleX, angleY);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1, p.scale * 3), 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.lineWidth = 2;
      for (const [i, j] of edges) {
        const p1 = projected[i], p2 = projected[j];
        const grad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
        grad.addColorStop(0, '#06b6d4');
        grad.addColorStop(1, '#8b5cf6');
        ctx.strokeStyle = grad;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }

      for (const p of projected) {
        ctx.fillStyle = '#60a5fa';
        ctx.shadowColor = '#3b82f6';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(2, p.scale * 4.5), 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      requestAnimationFrame(render3D);
    }
    render3D();

    canvas.addEventListener('mousedown', (e) => {
      isDragging = true;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      angleY += (e.clientX - lastMouseX) * 0.01;
      angleX += (e.clientY - lastMouseY) * 0.01;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    });

    window.addEventListener('mouseup', () => { isDragging = false; });

    function toggleAutoRotate() { autoRotate = !autoRotate; }
    function switch3DMode() { shapeMode = (shapeMode + 1) % 2; }

    // 表格数据
    let tableData = [
      { id: 'node-ap-01', cluster: '华东·上海加速区', status: 'ACTIVE', load: 88, bandwidth: '24.2 Gbps' },
      { id: 'node-bj-04', cluster: '华北·北京异地容灾', status: 'OPTIMIZED', load: 42, bandwidth: '12.8 Gbps' },
      { id: 'node-sz-02', cluster: '华南·深圳边缘节点', status: 'ACTIVE', load: 76, bandwidth: '18.4 Gbps' },
      { id: 'node-us-west', cluster: '美西·硅谷接入站', status: 'PENDING', load: 15, bandwidth: '4.1 Gbps' },
      { id: 'node-eu-fra', cluster: '欧洲·法兰克福', status: 'OPTIMIZED', load: 63, bandwidth: '15.6 Gbps' }
    ];

    let currentSortCol = null, sortAsc = true;

    function renderTable(dataToRender) {
      const tbody = document.getElementById('tableBody');
      tbody.innerHTML = '';

      dataToRender.forEach((row, idx) => {
        const tr = document.createElement('tr');
        let badgeClass = 'badge-success', statusLabel = '运行中';
        if (row.status === 'OPTIMIZED') { badgeClass = 'badge-purple'; statusLabel = '超频加速'; }
        if (row.status === 'PENDING') { badgeClass = 'badge-warning'; statusLabel = '准备中'; }
        let barColor = row.load > 80 ? '#f43f5e' : row.load > 60 ? '#f59e0b' : '#10b981';

        tr.innerHTML = `
          <td style="font-family: monospace; font-weight: 600; color: #93c5fd;">${row.id}</td>
          <td>${row.cluster}</td>
          <td><span class="badge ${badgeClass}">${statusLabel}</span></td>
          <td>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" style="width: ${row.load}%; background: ${barColor}"></div>
            </div>
            <span>${row.load}%</span>
          </td>
          <td style="font-family: monospace">${row.bandwidth}</td>
          <td style="text-align:right">
            <button class="btn" style="padding: 4px 8px; font-size: 0.72rem" onclick="deleteRow(${idx})">移除</button>
          </td>
        `;
        tbody.appendChild(tr);
      });

      document.getElementById('rowCount').textContent = `展示 ${dataToRender.length} 条记录`;
    }

    function getFilteredData() {
      const query = document.getElementById('searchInput').value.trim().toLowerCase();
      const status = document.getElementById('statusFilter').value;
      return tableData.filter((item) => {
        const matchQuery = !query || item.id.toLowerCase().includes(query) || item.cluster.toLowerCase().includes(query);
        const matchStatus = status === 'ALL' || item.status === status;
        return matchQuery && matchStatus;
      });
    }

    function handleSearch() { renderTable(getFilteredData()); }
    function handleFilter() { renderTable(getFilteredData()); }

    function sortTable(colIndex) {
      if (currentSortCol === colIndex) { sortAsc = !sortAsc; }
      else { currentSortCol = colIndex; sortAsc = true; }

      document.querySelectorAll('th').forEach((th, i) => {
        th.className = '';
        if (i === colIndex) { th.className = sortAsc ? 'sorted-asc' : 'sorted-desc'; }
      });

      tableData.sort((a, b) => {
        let v1, v2;
        if (colIndex === 0) { v1 = a.id; v2 = b.id; }
        else if (colIndex === 1) { v1 = a.cluster; v2 = b.cluster; }
        else if (colIndex === 2) { v1 = a.status; v2 = b.status; }
        else if (colIndex === 3) { v1 = a.load; v2 = b.load; }
        else if (colIndex === 4) { v1 = parseFloat(a.bandwidth); v2 = parseFloat(b.bandwidth); }
        if (v1 < v2) return sortAsc ? -1 : 1;
        if (v1 > v2) return sortAsc ? 1 : -1;
        return 0;
      });

      renderTable(getFilteredData());
    }

    function deleteRow(index) {
      tableData.splice(index, 1);
      renderTable(getFilteredData());
    }

    function addNewRow() {
      const idNum = Math.floor(10 + Math.random() * 90);
      const regions = ['西南·成都算力中心', '华中·武汉算力枢纽', '亚太·新加坡节点', '东京·跨域加速站'];
      const statuses = ['ACTIVE', 'OPTIMIZED', 'PENDING'];
      tableData.unshift({
        id: `node-core-${idNum}`,
        cluster: regions[Math.floor(Math.random() * regions.length)],
        status: statuses[Math.floor(Math.random() * statuses.length)],
        load: Math.floor(20 + Math.random() * 75),
        bandwidth: (5 + Math.random() * 25).toFixed(1) + ' Gbps'
      });
      renderTable(getFilteredData());
    }

    function randomizeData() {
      document.getElementById('val1').textContent = (400 + Math.random() * 200).toFixed(1) + ' TFLOPS';
      document.getElementById('val2').textContent = Math.floor(1200 + Math.random() * 1000) + ' QPS';
      document.getElementById('val3').textContent = (14 + Math.random() * 8).toFixed(1) + ' ms';
      document.getElementById('val4').textContent = (94 + Math.random() * 5).toFixed(1) + ' %';
      tableData.forEach(row => { row.load = Math.floor(20 + Math.random() * 75); });
      renderTable(getFilteredData());
    }

    renderTable(tableData);
  </script>
</body>
</html>
"""
(OUT_DIR / "08-数据可视化与3D交互看板.html").write_text(html_content, encoding="utf-8")
print("✓ 已生成: 08-数据可视化与3D交互看板.html")

print("==================================================")
print(f"全部 8 个测试样本已成功写入: {OUT_DIR}")

