# Typst 工作区

| 文件 | 职责 |
|------|------|
| `TypstWorkspace.tsx` | `.typ` 的编辑/预览分栏、状态与错误、字体/固定入口配置、显式 PDF/HTML 导出；远程工作区仅编辑，不回落本机编译 |
| `TypstEditor.tsx` | CodeMirror 6 的 WASM-free Lezer 语法、共享 TextDocument 历史、Tinymist LSP 补全/参数/悬浮/定义跳转/格式化/诊断；异步响应校验原文并丢弃过期结果 |
| `TypstEditor.test.ts` | 实际 CodeMirror 组件回归：补全范围与 snippet、导入补全单步撤销、诊断、异步格式化、会话重启隔离、跨视图历史与外部正文同步 |

运行时生命周期由 [useTypstSession](../../hooks/editor/useTypstSession.ts) 与 [typst-session](../../lib/editor/typst-session.ts) 管理，经 [typst-api](../../api/typst-api.ts) 访问主进程。正文只同步到内存，不为预览自动写回磁盘。预览 iframe 只接受主进程返回的 loopback HTTP 地址，无 preload 或 Node 能力；只允许脚本和自身 origin，不允许顶层导航或弹窗。服务端文档提示按纯文本展示。

编辑器使用 `codemirror-lang-typst/lezer`，语法层只提供高亮、折叠、缩进和列表键位；完整补全和诊断由 Tinymist 提供，避免叠加静态补全和重复报错。`Ctrl/Cmd+Space` 补全，`F12` 定义，`Ctrl/Cmd+Shift+F` 格式化。

预览沿用 Tinymist 0.15.8 自带的缩放行为：初始适应宽度，聚焦预览后 `Ctrl/Cmd+=` 放大、`Ctrl/Cmd+-` 缩小，`Ctrl+滚轮` 缩放。分栏/单栏切换通过 resizable group 的布局 API 折叠面板，保留先前分栏比例与编辑/预览实例。
