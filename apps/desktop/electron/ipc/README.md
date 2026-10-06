# electron/ipc

把 `ipcMain` 通道接到 `services/`。目前只有一份注册表，不要在组件或 preload 里散落 `ipcMain.handle`。

| 文件 | 功能 |
|------|------|
| `register-handlers.ts` | 注册全部 IPC（文件内按域分段注释）：文件/工作区、导出、阅读标记、错误日志、ACP、OCR |

通道名与 payload 类型在 `packages/contracts/src/ipc/`（`@montree/contracts`，原 `shared/ipc/`）。有返回值的一律 `Result<T, AppError>`；用户取消 `CANCELLED`。
