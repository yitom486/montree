# src/components/office

Office 文档高保真渲染与编辑组件（DOCX / XLSX）。

| 文件 | 用途 |
|------|------|
| [`DocxViewer.tsx`](./DocxViewer.tsx) | 基于社区成熟工业级 `docx-preview` 实现纯前端 DOCX 高保真分页与样式渲染 |
| [`SpreadsheetViewer.tsx`](./SpreadsheetViewer.tsx) | 基于 `xlsx` (SheetJS) 实现多工作表 Excel (XLSX) 与 CSV/TSV 统一网格渲染与编辑 |
| [`UniverSheetViewer.tsx`](./UniverSheetViewer.tsx) | 基于社区顶流 **Univer 1.0**（`@univerjs/presets`）实现的工业级 Canvas Excel 画布，带公式栏、选区、样式与原生暗黑模式 |
| [`PptxViewer.tsx`](./PptxViewer.tsx) | 基于 `fflate` 纯前端解压并精准解析 OpenXML 的 16:9 幻灯片查看器，支持瀑布流、单页精读、结构化大纲提炼与全屏演示放映 |

