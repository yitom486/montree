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
| `reader-foliate.spec.ts` | foliate 统一阅读器：EPUB/MOBI 章节可读（`E2E_FOLIATE_READER` 门控测试钩子） |
| `reader-foliate-marks.spec.ts` | foliate 标注链路：划重点/批注/检查器/删除（EPUB+MOBI） |
| `reader-footer-nav.spec.ts` | 底栏翻页：收进正文列（不横跨卡片轨）+ 上下单元与正文同步（真实多章节 EPUB） |
| `reader-smoke.spec.ts` | Markdown 预览（Mermaid/公式/高亮）+ PDF 画布文字层（自研最小 fixture） |
| `reader-pdf-structure.spec.ts` | PDF 结构化 WASM：生产包真加载（非回退）+ Agent 正文走结构化（`E2E_PDF_STRUCTURE` 门控测试钩子） |
| `reader-pdf-ocr.spec.ts` | 扫描版 PDF 单页 OCR：「更多工具 → 识别本页」落缓存 + 文字层可读（当前页无文字层会自动识别；`apps/desktop/e2e/fixtures/ocr/scanned-hello.pdf`） |
| `sync-webdav.spec.ts` | 本地内存 WebDAV stub → 设置页测试连接 + 一次同步落数 |
| `web-doc-smoke.spec.ts` | 在线文档：打开、地址栏换页、目录跳转 |
| `web-doc-xss.spec.ts` | 在线文档 XSS 回归（真浏览器）：恶意载荷不执行、正文完好 |

## 在线文档 Fixture

不依赖外网。主进程在设置 `E2E_WEB_DOC_FIXTURE_DIR` 时，对 `e2e.montree.test` 域名从本地 HTML 返回页面：

```
apps/desktop/e2e/fixtures/web-doc/
  manifest.json      # URL → 文件名映射
  start.html
  installation.html
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
