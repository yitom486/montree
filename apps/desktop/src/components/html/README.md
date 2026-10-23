# src/components/html

本地 HTML / 网页静态文档视图组件。

| 组件 | 功能 |
|------|------|
| `HtmlViewer` | 本地 HTML 渲染器：预览页经 `montree-html://` 独立源加载（与应用窗口跨源，拿不到 preload 接口；页面自身存储与相对 CSS/JS/图片照常可用），推送当前文本（含未保存修改）后以版本号重载；源码编辑与分屏对照、主题与缩放控制。缩放、锚点、链接拦截、阅读正文与选区都经桥接 postMessage：相对文档链接交给工作区打开并保留跨文件锚点，外链仅在用户刚点击过时交给系统浏览器；`useDocumentReader` 读取桥接推来的渲染后正文快照与视口文本注册给 `montree_read` |
| `HtmlViewer.test.ts` | 预览工具栏、源码模式、预览会话登记与文本推送、真实 HTML 样本渲染回归 |
