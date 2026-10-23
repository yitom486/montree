# lib/html

本地 HTML 文档的**阅读 MCP 正文抽取**（纯逻辑，不依赖 React）。

| 文件 | 功能 |
|------|------|
| `reader-content.ts` | 从已渲染 iframe DOM / 源码后备 DOM 提取可见纯文本；排除脚本、样式、导航、页脚和隐藏节点；按 `h1`–`h6` 生成阅读单元与层级 |
| `reader-content.test.ts` | 可见文本、隐藏节点过滤、标题目录与空文档回归 |

HTML 预览组件通过 `useDocumentReader` 注册给 `montree_read`；不要再用 `TextDataReaderContext` 把 HTML 源码当作正文。
