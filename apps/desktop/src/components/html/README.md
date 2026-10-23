# src/components/html

本地 HTML / 网页静态文档视图组件。

| 组件 | 功能 |
|------|------|
| `HtmlViewer` | 本地 HTML 渲染器，支持安全沙箱渲染、源码编辑与分屏对照、相对图片解析、主题与缩放控制；相对文档链接交给工作区打开并保留跨文件锚点，避免 srcdoc 把应用自身载入 iframe |
| `HtmlViewer.test.ts` | 预览工具栏、源码模式和真实 HTML 样本渲染回归 |
