# AGENTS.md — Inkdown

项目开发准则。细则见 `.cursor/rules/`（Git 身份、Zustand、阅读器导航）。

## 目标与产品

Electron 桌面应用：**Markdown 编辑** + **PDF/EPUB/MOBI/AZW3 阅读**（书签/批注）。打包：Win / macOS / Linux。

## 技术栈（不可随意替换）

| 类别 | 选型 |
|------|------|
| 包管理 | **Bun**（禁用 npm / yarn / pnpm） |
| 桌面 | **Electron** + **electron-vite** |
| UI | **React** + **TypeScript** + **shadcn/ui** + **Tailwind** + **lucide-react** |
| 编辑 / 预览 | **CodeMirror 6** + **markdown-it**（DOMPurify） |
| 状态 | **TanStack Query v5**（IPC 数据）+ **Zustand**（本地 UI） |
| 布局 | **react-resizable-panels** |
| 测试 / 打包 | **Vitest** + **Playwright** / **electron-builder** |

```bash
bun install
bun add <pkg>          # 依赖
bun add -d <pkg>       # 开发依赖
bun run dev|build|test|typecheck|pack
bun run lint:docs|lint:deps|check:bundle  # 文档一致性 / 依赖边界 / 体积与白名单
bun run test:e2e       # 需先 build
bunx shadcn@latest add <component>
```

根命令已自带 `--config apps/desktop/...`（`dev`/`build`/`preview` → `apps/desktop/electron.vite.config.ts`；`pack*` → `apps/desktop/electron-builder.yml`；`test:e2e*` → `apps/desktop/playwright.config.ts`）：直接跑根命令即可，勿另传 `--config`。

锁文件：`bun.lock`。

## 目录要点

```
apps/desktop/electron/   # 主进程：main、preload、ipc、window、services（见 apps/desktop/electron/README.md）
apps/desktop/src/api/    # 渲染端 IPC 封装（见该目录 README）
apps/desktop/src/hooks/  # 渲染端 Hook：editor | preview | reader | workspace | agent（见 README）
apps/desktop/src/lib/    # 渲染端纯逻辑：同上五域；根上仅 utils.ts（见 README）
apps/desktop/src/stores/ # Zustand（见 README）
apps/desktop/src/components/  # ui | editor | preview | reader | layout | shared | agent | markdown（见 README）
apps/desktop/src/providers/   # Query / Theme（见 README）
apps/desktop/src/styles/      # 全局与阅读器 CSS（见 README）
apps/desktop/e2e/        # Playwright E2E（见该目录 README）
apps/desktop/resources/  # 图标等构建资源（`icon.png`/`icon.ico`）
apps/desktop/electron.vite.config.ts | electron-builder.yml | playwright.config.ts  # 三配置已搬入 apps/desktop/，根命令经 --config 引用
shared/          # 已清空：仅剩无文件空目录，阶段 10 删除；新代码禁止引用
packages/        # `@inkdown/*` 私有 workspace 包：contracts / reader-core / pdf / ocr-core / annotations / web-doc（不独立发版；ACP 已独立为外部包 `@yitom/acp-client`）
scripts/ | third-party/  # 留守根（含手搓 JSON-RPC 教学归档，三无隔离，禁被正式 import）
out/             # 留守根：构建输出（main / preload / renderer）；release/ 亦落根
.plan/           # 本地计划（已 gitignore，不提交）
.cursor/rules/   # Agent 强制细则
```

渲染进程总览：[`apps/desktop/src/README.md`](./apps/desktop/src/README.md)。主进程：[`apps/desktop/electron/README.md`](./apps/desktop/electron/README.md)。

ACP（阶段 A/B/C）：协议与客户端底层纯逻辑已独立至 `@yitom/acp-client`（传输/认证/会话/多运行时适配/MCP）；主进程 `apps/desktop/electron/services/acp/` 留守接入桥接 + `apps/desktop/src/api/acp-api.ts` + `AgentPanel`；协议 v1，默认 `codex-acp`。  
UI：**壳自研、皮复用**（shadcn + 可选开源消息渲染）；认证：**复用 `~/.codex` / ACP authMethods**（对齐 VS Code / Zed）。细则见本地 `.plan/`（若有）。

路径别名：`@/` → `apps/desktop/src/`，`@inkdown/*` → `packages/*/src/index.ts`，`@foliate` → `third-party/foliate-js`；`@shared/` → `shared/` 已废弃（渲染/测试已剔除，新代码禁用）。

**子目录 README**：`apps/desktop/src/`、`apps/desktop/electron/` 及其子目录等凡有 `README.md` 的目录，增删文件或改文件名后必须同步更新其中的列表与路径引用（叶目录若写「见上级 README」，则改上级清单）。`acp/mcp/` 等更底层实现以代码与上级 README 为准，不必层层铺文档。避免文档与目录脱节。

## Electron / IPC

- **main**：窗口、菜单、dialog、fs  
- **preload**：`contextBridge`  
- **renderer**：禁止 Node / `@electron/remote`

```typescript
webPreferences: {
  preload: path.join(__dirname, '../preload/preload.cjs'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true, // 沙盒开启；preload 须为 CJS（见 apps/desktop/electron.vite.config.ts）
}
```

新增能力顺序：`packages/contracts`（`@inkdown/contracts`；`shared/` 已清空待删）类型/错误 → `apps/desktop/electron/services` → `ipc/register-handlers` → `electron-api.types`（已迁 contracts） → `preload` → `apps/desktop/src/api` → hooks。

有返回值的 IPC 一律 `Result<T, AppError>`；用户取消用 `CANCELLED`（不弹错误）。

## 状态管理

| 类型 | 工具 |
|------|------|
| IPC / 服务端数据 | TanStack Query（`apps/desktop/src/api/query-keys.ts`） |
| 本地 UI 偏好 | Zustand + persist |
| 阅读器导航 | `reader-navigation-store`（详见 rule） |
| 编辑器正文 / dirty | `useState` |

Zustand selector 返回对象时必须 `useShallow`：见 `.cursor/rules/zustand-selectors.mdc`。  
阅读器侧栏 vs 底栏粒度：见 `.cursor/rules/reader-navigation.mdc`。

## UI / 代码风格

- 函数组件；组件 `PascalCase.tsx`，Hook `use*.ts`
- shadcn 组件落在 `apps/desktop/src/components/ui/`；用 `cn()`；勿改 ui 核心逻辑
- 严格 TypeScript；`async/await`；注释只写非显而易见逻辑

## Git 与 Agent

- **作者身份 / Attribution**：`.cursor/rules/git-identity.mdc`（`yitom486@gmail.com`）
- Message：`type: 中文描述`（feat / fix / docs / chore…）
- **发版**：`bun run release`（默认 patch 自动 +1）→ `bun run release:push` 推送 tag；细节见 README「发布版本」
- 最小改动；不擅自引入冲突技术栈；不擅自 commit；不提交密钥
- 任务进度可写本地 `.plan/`（不提交）；状态标记见该目录 README
- 改动带 README 的目录时，同步更新该 README 的文件引用（见上方「子目录 README」）

## 计划

- 准则与架构 → 本文件 + `.cursor/rules/`
- 可执行清单 → 本地 `.plan/*.md`（gitignore，勿提交）
- 不擅自新建计划文件；优先追加现有路线图
- 执行总序 → `.plan/00-roadmap.md`：UI 联动先行，落库紧随，库能力收尾；
  全部完成并合并回 `master` 后，按该文件末尾「完成后删除」清理计划文档

