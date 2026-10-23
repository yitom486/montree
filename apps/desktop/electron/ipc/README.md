# electron/ipc

把 `ipcMain` 通道接到 `services/`。目前只有一份注册表，不要在组件或 preload 里散落 `ipcMain.handle`。

| 文件 | 功能 |
|------|------|
| `register-handlers.ts` | 注册全部 IPC（文件内按域分段注释）：文件/工作区、导出、阅读标记、错误日志、ACP、OCR |
| `agent-inspection-handlers.ts` / `.test.ts` | MCP/Skills 详情与已发现技能的文件位置；可信主 frame、窗口/会话归属和异步切换校验；仅接收技能 ID，不接受任意文件路径 |
| `terminal-handlers.ts` | 主 frame 校验、可信窗口/工作区选择、终端会话归属；刷新、崩溃与窗口销毁时清理 |
| `acp-window-handlers.ts` / `acp-window-handlers.test.ts` | 以可信 IPC sender 隔离 Agent 连接、事件、权限和文档快照；校验会话归属、恢复占用；窗口销毁时同步摘除 SDK 流桥后再终止所属子进程，覆盖迟到写入与跨窗隔离回归 |

通道名与 payload 类型在 `packages/contracts/src/ipc/`（`@montree/contracts`，原 `shared/ipc/`）。有返回值的一律 `Result<T, AppError>`；用户取消 `CANCELLED`。

- `inline-completion-handlers.ts`：行内补全 IPC（请求/取消/状态/专用 provider/ChatGPT 登录/动态模型列表），按窗口取消在途请求；`E2E_INLINE_COMPLETION_MOCK=1` 时使用模拟模型。
- `typst-handlers.ts`：Typst IPC 主窗口/本机宿主校验、会话归属、导出对话框与原子 PDF 写入。

- `typst-handlers.test.ts`：主 frame 与可信窗口、远端拒绝、跨窗请求归属、导出取消与过期修订零写入回归。
