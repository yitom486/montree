# src/components/office

Office 文档渲染与编辑组件（DOCX / XLSX / PPTX）。

| 文件 | 用途 |
|------|------|
| [`DocxViewer.tsx`](./DocxViewer.tsx) | 基于社区成熟工业级 `docx-preview` 实现纯前端 DOCX 高保真分页与样式渲染 |
| [`SpreadsheetViewer.tsx`](./SpreadsheetViewer.tsx) | CSV/TSV/XLSX 原地址模型、多选、区域 MCP 编辑、撤销和保存；筛选保留原始地址，画布使用同一工作簿只读预览 |
| [`UniverSheetViewer.tsx`](./UniverSheetViewer.tsx) | 基于社区顶流 **Univer 1.0**（`@univerjs/presets`）实现的工业级 Canvas Excel 画布，带公式栏、选区、样式与原生暗黑模式 |
| [`PptxViewer.tsx`](./PptxViewer.tsx) | 原稿预览、连续/单页浏览、全屏放映与退出恢复、组合内部 ID 多选及 MCP 查询/精细编辑、图表/现有母版版式/基础动画工具、撤销和保存 |
| [`PresentationSlideshow.tsx`](./PresentationSlideshow.tsx) | 按屏幕宽高适配、键盘/鼠标翻页、明确退出；出现/淡入入场动画、三种触发关系、淡入/推入转场与定时翻页；退出清理时间线，复杂效果保留并提示 |
| [`PresentationSlide.tsx`](./PresentationSlide.tsx) | 原稿配色/尺寸、段落样式、形状外观、母版/版式继承和递归组合坐标渲染 |
| [`PresentationChart.tsx`](./PresentationChart.tsx) | 二维柱状/条形、折线、单系列饼图 SVG 预览，编辑数据与预览同步；复杂图表显示限制说明 |
| [`PptxElementInspector.tsx`](./PptxElementInspector.tsx) | 按需展开的元素检查器，段落文字/字号/颜色/粗体以明确应用操作提交，复用精细编辑模型 |

