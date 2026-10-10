# src/components/office

Office 文档高保真渲染与编辑组件（DOCX / XLSX）。

| 文件 | 用途 |
|------|------|
| [`DocxViewer.tsx`](./DocxViewer.tsx) | 基于社区成熟工业级 `docx-preview` 实现纯前端 DOCX 高保真分页与样式渲染 |
| [`SpreadsheetViewer.tsx`](./SpreadsheetViewer.tsx) | CSV/TSV/XLSX 原地址模型、多选、区域 MCP 编辑、撤销和保存；筛选保留原始地址，画布使用同一工作簿只读预览 |
| [`UniverSheetViewer.tsx`](./UniverSheetViewer.tsx) | 基于社区顶流 **Univer 1.0**（`@univerjs/presets`）实现的工业级 Canvas Excel 画布，带公式栏、选区、样式与原生暗黑模式 |
| [`PptxViewer.tsx`](./PptxViewer.tsx) | 实际尺寸静态预览、连续/单页浏览、原始元素 ID 多选和 MCP 查询/文字/位置/字体修改及删除、撤销和保存；母版/主题/动画/组合内部/图表编辑尚未支持 |
| [`PresentationSlide.tsx`](./PresentationSlide.tsx) | 按原稿配色和尺寸比例显示 PPT 段落/文字块样式、换行、间距、内边距、形状填充和边框；不随应用深色主题改写原稿 |

