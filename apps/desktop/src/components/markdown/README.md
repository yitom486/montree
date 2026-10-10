# src/components/markdown

预览与 Agent 气泡**共用**的 Markdown 渲染块。

| 文件 | 功能 |
|------|------|
| `MarkdownContent` / `.test.ts` | 保留完整 HTML 容器，通过 React portal 原位挂载 Mermaid，折叠区中的图表随正文一起展开/收起 |
| `LivePreviewBlock` | CodeMirror 块级预览适配，复用 MarkdownContent、消毒/本地图片、公式/代码复制/Mermaid；源码编辑及表格单元格精确定位 |
| `MermaidBlock` | 单个 Mermaid 图（独立 hydrate，避免整段 HTML 重灌竞态） |
