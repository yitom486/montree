# src/components/markdown

预览与 Agent 气泡**共用**的 Markdown 渲染块。

| 文件 | 功能 |
|------|------|
| `MarkdownContent` / `.test.ts` | 保留完整 HTML 容器，通过 React portal 原位挂载 Mermaid，折叠区中的图表随正文一起展开/收起 |
| `LivePreviewBlock` | CodeMirror 块级预览适配，复用 MarkdownContent、消毒/本地图片、公式/代码复制/Mermaid；源码编辑及表格单元格精确定位 |
| `MermaidBlock` | 单个 Mermaid 图（独立 hydrate，避免整段 HTML 重灌竞态） |
| `AgentMarkdown.tsx` + `AgentMarkdown.lazy.tsx` | Agent 聊天专用 Streamdown 入口（真实安装，懒加载分块；流式/完成同实例，只翻 `isAnimating`；官方 animated/code/Shiki/mermaid/math/cjk 插件，无旧文字队列/代码工具栏）。编辑器/预览继续 markdown-it |
| `AssistantMarkdownText.tsx` | 基于 `@assistant-ui/react-markdown` 的高帧率流式 Markdown 平滑渐显引擎（内置 useSmooth、dot.css 游标、Gfm 与 memoized DOM 块） |
| `agent-markdown-plugins` / `.test.ts` | Agent 入口微插件：数字开头的配对公式/落单货币 `$` 区分、消毒后消息隔离锚点（含脚注引用/返回及跨块标题链接）、行内 mark/sub/sup、提示块自定义标签 |
