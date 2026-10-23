# src/components/preview

Markdown **预览**面板。

| 文件 | 功能 |
|------|------|
| `PreviewPane` | 消毒后的 HTML 预览；代码复制与 hljs 主题；页内锚点滚动、相对 Markdown/文档链接交给工作区打开并消费跨文件锚点 |

与编辑器滚动同步由 `src/hooks/editor/useScrollSync` 驱动。Mermaid 块组件见 `../markdown/`。
