# src/styles

全局与领域 CSS。Tailwind 入口在 `globals.css`；阅读器/预览有独立样式表。

| 文件 | 功能 |
|------|------|
| `globals.css` | Tailwind 指令、CSS 变量、全局基础（纸张白 / 羊皮纸暖调 / 沉稳石墨三套主题、知识卡片与荧光笔语义色、发光脉冲动效；流式光环在边框内绘制，不触发气泡内部滚动条） |
| `markdown-preview.css` | Markdown 预览排版；Agent 文字显现由 Streamdown 原生动画负责，减少动态效果时清零时长和延迟 |
| `epub-viewer.css` / `pdf-viewer.css` / `mobi-viewer.css` | 各格式阅读器（选区、高亮表面等） |
