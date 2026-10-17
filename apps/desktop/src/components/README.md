# src/components

React UI。按产品域分子目录；shadcn 落在 `ui/`。

| 目录 | 管什么 |
|------|--------|
| [`ui/`](./ui/) | shadcn 基础组件（勿轻易改核心逻辑） |
| [`layout/`](./layout/) | 窗口壳、侧栏、编辑/阅读主工作区 |
| [`editor/`](./editor/) | CodeMirror Markdown 编辑器 |
| [`typst/`](./typst/) | Typst 源码编辑、Tinymist 智能提示、实时预览、字体/入口配置与 PDF 导出 |
| [`preview/`](./preview/) | Markdown 预览面板 |
| [`markdown/`](./markdown/) | 可复用的 Markdown/Mermaid 渲染块 |
| [`reader/`](./reader/) | EPUB / PDF / MOBI 阅读器与批注 UI |
| [`quiz/`](./quiz/) | AI 伴读考官出题、作答批卷与成绩回放 UI |
| [`agent/`](./agent/) | ACP Agent 面板与消息卡片 |
| [`ai-elements/`](./ai-elements/) | 社区 AI 组件手动接入（Conversation / Message / Reasoning / PromptInput / Tool；见该目录 README 来源与版本） |
| [`data/`](./data/) | CSV/TSV 表格工作区、JSON 树形折叠、LOG 日志流高亮与多维过滤视图 |
| [`office/`](./office/) | DOCX 高保真排版预览与多主题护眼适配（`docx-preview`）、多工作表 Excel 表格（`xlsx` / Univer 1.0）、PPTX 演示文稿幻灯片（`fflate`） |
| [`html/`](./html/) | 本地 HTML 网页与静态文档渲染器（沙箱预览、分屏实时编辑、源码高亮） |
| [`shared/`](./shared/) | 跨工作区对话框、错误边界 |

命名：组件 `PascalCase.tsx`。样式优先 Tailwind + `cn()`；阅读器特殊样式见 `src/styles/`。
