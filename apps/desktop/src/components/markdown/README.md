# src/components/markdown

预览与 Agent 气泡**共用**的 Markdown 渲染块。

Agent 代码高亮沿用 Streamdown 默认 `github-light` / `github-dark` 双主题。生产构建经 `apps/desktop/electron/vite-plugins/shiki-themes.ts` 仅打包这两套主题，保留既有 Shiki web 语言支持；开发态仍使用上游注册表。若以后增加代码高亮主题，须同步构建白名单。

| 文件 | 功能 |
|------|------|
| `MarkdownContent` / `.test.ts` | 保留完整 HTML 容器，通过 React portal 原位挂载 Mermaid，折叠区中的图表随正文一起展开/收起 |
| `LivePreviewBlock` | CodeMirror 块级预览适配，复用 MarkdownContent、消毒/本地图片、公式/代码复制/Mermaid；源码编辑及表格单元格精确定位 |
| `MermaidBlock` | 单个 Mermaid 图（独立 hydrate，避免整段 HTML 重灌竞态） |
| `AgentMarkdown.tsx` + `AgentMarkdown.lazy.tsx` | Agent 聊天专用 Streamdown 入口（真实安装，懒加载分块；流式/完成同实例，只翻 `isAnimating`；官方 animated/code/Shiki/mermaid/math/cjk 插件，无旧文字队列/代码工具栏）。动效三层：字符经 `useRevealText` 小步高频揭示（`clamp(ceil(remaining/20),6,40)` + 32ms 提交）、新块挂载播一次滑入（`agent-block-in`，旧块不重播）、tip 呼吸光标跟打字头（纯 CSS `::after` + `data-status` 开关）；官方 `animated` 词级 cascade 与外部切片同活，双开闪烁故保持关闭。代码块：Shiki 高亮类靠全局样式 @source 扫描 streamdown dist 生成（缺之整块单色）；agent 域去套娃（pre/code 底色归零、外卡内盒收紧 12px）、动作浮层 32px + header 预留 88px 防重叠。Mermaid：主题跟随 App（dark/neutral/default 映射，纯函数单测）+ 主题翻转整实例 remount（焊色 SVG 社区不跟 config，不换 key 旧图永为旧色）；普通滚轮在 markdown 根捕获期截停（只 stopPropagation，页面滚动照常，±按钮/拖拽保留），视口上滑意图标记取捕获期以免被门吞掉。编辑器/预览继续 markdown-it |
| `agent-markdown-plugins` / `.test.ts` | Agent 入口微插件：数字开头的配对公式/落单货币 `$` 区分、消毒后消息隔离锚点（含脚注引用/返回及跨块标题链接）、行内 mark/sub/sup、提示块自定义标签 |
