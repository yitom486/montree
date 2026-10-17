# electron/ipc

把 `ipcMain` 通道接到 `services/`。目前只有一份注册表，不要在组件或 preload 里散落 `ipcMain.handle`。

| 文件 | 功能 |
|------|------|
| `register-handlers.ts` | 注册全部 IPC（文件内按域分段注释）：文件/工作区、导出、阅读标记、错误日志、ACP、OCR |
| `acp-window-handlers.ts` / `acp-window-handlers.test.ts` | 以可信 IPC sender 隔离 Agent 连接、事件、权限和文档快照；校验会话归属、恢复占用与窗口关闭清理 |

通道名与 payload 类型在 `packages/contracts/src/ipc/`（`@montree/contracts`，原 `shared/ipc/`）。有返回值的一律 `Result<T, AppError>`；用户取消 `CANCELLED`。

- `typst-handlers.ts`：Typst IPC 主窗口/本机宿主校验、会话归属、导出对话框与原子 PDF 写入。

- `typst-handlers.test.ts`：主 frame 与可信窗口、远端拒绝、跨窗请求归属、导出取消与过期修订零写入回归。
