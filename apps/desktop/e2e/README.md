# E2E 测试（Playwright + Electron）

Playwright 驱动**已构建**的 Electron 应用（`out/main/main.js`）。运行前需先 `bun run build`。

```bash
bun run build
bun run test:e2e          # 全部 E2E
bun run test:e2e:web-doc  # 仅在线文档 fixture 冒烟
```

## 用例

| 文件 | 说明 |
|------|------|
| `app-smoke.spec.ts` | 启动、欢迎页、菜单 |
| `agent-panel.spec.ts` | Agent 面板壳 |
| `export-pdf.spec.ts` | Markdown 导出 PDF（`E2E_AUTO_EXPORT_PATH`） |
| `quick-open.spec.ts` | 打开文件夹（`E2E_AUTO_OPEN_PATH` 跳过原生对话框）→ Ctrl+P 搜索打开 |
| `document-tools.spec.ts` | JSON/LOG/HTML/DOCX 通用读取、CSV选区/筛选编辑、XLSX公式保存/外部冲突、PPT元素查询/删改/撤销与保存及原稿段落样式回归（`E2E_DOCUMENT_TOOLS`） |
| `text-tools-integration.spec.ts` | mock 模型输出 → 真实 HTTP MCP → IPC → Markdown/TXT CodeMirror 缓冲区；精确选区、重复原文、批量拒绝原子性、全部视图/共享撤销、未保存手动输入、CRLF 保存重开、跨文档及外部冲突校验 |
| `ppt-tools-integration.spec.ts` | mock 模型工具调用输出 → 真实 HTTP MCP → IPC → PPT 模型/预览/磁盘保存与重开；局部样式保留、拒绝原子性、外部冲突、可见页/选区页和按需检查器，附前后截图与工具记录 |
| `ppt-advanced-tools.spec.ts` | mock 工具输出经真实 MCP 编辑嵌套组合、图表及内嵌工作簿、现有母版/版式、基础动画；预览/放映/定时翻页/退出清理/撤销/保存重开与拒绝原子性，附截图及调用记录 |
| `ppt-slideshow.spec.ts` | 真实全屏单页放映、键盘/鼠标翻页、退出按钮/Esc/系统退出、AI 当前页同步、阅读模式与缩放恢复及全屏拒绝回退和宽高适配 |
| `reader-foliate.spec.ts` | foliate 统一阅读器：EPUB/MOBI 章节可读（`E2E_FOLIATE_READER` 门控测试钩子） |
| `reader-foliate-marks.spec.ts` | foliate 标注链路：划重点/批注/检查器/删除（EPUB+MOBI） |
| `reader-footer-nav.spec.ts` | 底栏翻页：收进正文列（不横跨卡片轨）+ 上下单元与正文同步（真实多章节 EPUB） |
| `reader-smoke.spec.ts` | Markdown 预览（Mermaid/公式/高亮）+ PDF 画布文字层（自研最小 fixture） |
| `markdown-live-preview.spec.ts` | 实时预览真实 Electron 回归：表格对齐与精确源单元格、HTML/Markdown 本地图片、KaTeX、Mermaid、代码复制、details、XSS 清理、自动链接/引用定义、脚注编号与跨视口回链/长脚注编辑、暗色对比度、源码切换/撤销及新文档默认/TXT 保留原文；附截图 |
| `reader-pdf-structure.spec.ts` | PDF 结构化 WASM：生产包真加载（非回退）+ Agent 正文走结构化（`E2E_PDF_STRUCTURE` 门控测试钩子） |
| `reader-pdf-ocr.spec.ts` | 扫描版 PDF 单页 OCR：「更多工具 → 识别本页」落缓存 + 文字层可读（当前页无文字层会自动识别；`apps/desktop/e2e/fixtures/ocr/scanned-hello.pdf`） |
| `sync-webdav.spec.ts` | 本地内存 WebDAV stub → 设置页测试连接 + 一次同步落数 |
| `web-doc-smoke.spec.ts` | 在线文档：打开、地址栏换页、目录跳转、论文 SVG 图片与表格对齐/合并/横向滚动 |
| `web-doc-xss.spec.ts` | 在线文档 XSS 回归（真浏览器）：恶意载荷不执行、正文完好 |
| `reader-visual-context.spec.ts` | 网页/Markdown/EPUB/PDF 图片发现、图片地址和图注、主进程阅读区 PNG 截图（`E2E_READER_VISUAL` 门控，不连接 AI） |

## 在线文档 Fixture

不依赖外网。主进程在设置 `E2E_WEB_DOC_FIXTURE_DIR` 时，对 `e2e.montree.test` 域名从本地 HTML 返回页面：

```
apps/desktop/e2e/fixtures/web-doc/
  manifest.json      # URL → 文件名映射
  start.html
  installation.html
  academic.html      # 论文 object SVG 插图、LaTeXML 表格与宽表
  xss.html           # XSS 回归载荷（script / javascript: / 事件处理器）
```

实现：`apps/desktop/electron/services/web-doc/e2e-fixture.ts`（由 `fetchWebDocPage` 优先读取）。

## OCR Fixture

```
apps/desktop/e2e/fixtures/ocr/
  scanned-hello.pdf  # 无文字层单页（Hello Montree OCR），供 OCR 链冒烟只验链路不验精度
```

## 辅助

| 文件 | 说明 |
|------|------|
| `helpers/launch-app.ts` | 启动已构建应用 |
| `helpers/web-doc-fixture.ts` | fixture 目录与测试 URL 常量 |
| `helpers/ebook-fixture.ts` | 自研最小 PDF / EPUB / Markdown 生成器（无新依赖） |
| `../src/lib/data/presentation-test-fixture.ts` | 模型与 Electron 测试共用的真实 PPTX 图表/内嵌工作簿/母版/嵌套组合 fixture |
