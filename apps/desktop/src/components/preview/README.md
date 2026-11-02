# src/components/preview

Markdown **预览**面板。

| 文件 | 功能 |
|------|------|
| `PreviewPane` | 消毒后的 HTML 预览；代码复制与 hljs 主题；页内锚点滚动、相对 Markdown/文档链接交给工作区打开并消费跨文件锚点 |
| `MarkdownPreviewTools` | Markdown 预览选段、批注与 AI 制卡接线；复用共享卡片、测验/闪卡、笔记导出、引用变更提示；编辑态仍保留卡片入口 |
| `ImageViewer` | 图片文件阅读器：经工作区宿主读取为 data URL（PNG/JPG/WebP/AVIF/GIF/SVG/BMP/ICO/TIFF），缩放/适应窗口/旋转与尺寸回显 |

与编辑器滚动同步由 `src/hooks/editor/useScrollSync` 驱动。Mermaid 块组件见 `../markdown/`。
