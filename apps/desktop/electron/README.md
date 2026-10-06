# electron

**主进程**源码。入口：`main.ts`；渲染进程通过 `preload.ts` 的 `contextBridge` 调 IPC。  
渲染进程在 [`src/`](../src/README.md)；跨进程契约在 `packages/contracts/`（`@inkdown/contracts`，原 `shared/` 核心/IPC/类型；`shared/` 已清空，阶段 10 删除）。

门禁：`bun run lint:docs`（`scripts/lint-docs.ts`）+ `bun run lint:deps`（`scripts/check-deps.ts`，R1–R6 依赖边界）。

| 目录 / 文件 | 职责 |
|-------------|------|
| `main.ts` | 应用生命周期、注册 IPC、创建窗口、退出时释放 ACP / 工作区监听 |
| `preload.ts` | `contextIsolation` 下暴露 `window.electronAPI` |
| [`ipc/`](./ipc/) | `ipcMain` 处理器注册 |
| [`window/`](./window/) | BrowserWindow 创建、关闭确认、标题；`window/app-menu.ts` 安装 Edit 菜单角色（Ctrl+C/V） |
| [`services/`](./services/) | 业务服务（文件、工作区、阅读标记、ACP、**在线文档 web-doc**、**OCR 目录**；含 `web-doc/`（`url-policy`/`site-registry` 留守网络边界，目录抽取/站点谓词已迁 `@inkdown/web-doc`）、`ocr/`；ACP 纯逻辑已独立至 `@yitom/acp-client`，本树 `services/acp/` 仅留守 client/manager/terminal/fs/preflight/router/session-open；标注纯核/合并见 `@inkdown/annotations`） |
| [`vite-plugins/`](./vite-plugins/) | 主进程构建用 Vite 插件 |

`webPreferences`：preload + `contextIsolation: true` + `nodeIntegration: false`。渲染端禁止 Node / `@electron/remote`。

新增能力顺序见 [AGENTS.md](../../AGENTS.md)：`packages/contracts`（`@inkdown/contracts`，原 `shared/`）→ **本目录 services** → ipc → `electron-api.types`（已迁 contracts）→ preload → `apps/desktop/src/api` → hooks。
