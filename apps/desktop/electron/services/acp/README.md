# electron/services/acp

ACP Agent 主进程侧 wiring：拉起 `codex-acp`、连接生命周期、权限/回调路由、会话开启、fs/终端、进程内 MCP 挂载。
ACP 协议与客户端底层纯逻辑已独立至外部包 `@yitom/acp-client`；渲染端零直接引用（`tsconfig.web` include 已剔除 acp）。
渲染端入口：`apps/desktop/src/api/acp-api.ts` + `AgentPanel`。设计备忘见本地 `.plan/`（若不在仓库中）。

| 组 | 文件 | 功能 |
|----|------|------|
| 入口 | `acp-client.ts` 门面（仅 re-export，学 `apps/desktop/src/stores/acp-ui-store.ts` 先例）+ `acp-state.ts` / `acp-bridges.ts` / `acp-connection.ts` / `acp-session-ops.ts` + `process-manager.ts` / `sdk-client.ts` 留守；手搓传输已删，协议走官方 `@agentclientprotocol/sdk`（ACP v1 稳定入口） | 连接生命周期、子进程、SDK 长驻 `ClientConnection`（`client({name:"montree"}).connect()`，stdio 经 toWeb→`ndJsonStream` 桥接，垫层保温进程 fd；`connectSdkClient` 增可选 `runtimeId` 参，仅日志/隔离）；spawn 模板一律经 `findBuiltinAcpRuntime`（`resolveRuntimeTemplate` 防御性回落），禁写死 codex bunx；adapter 调用全防御（`probeAuth`/`getSpawnEnv`/`orderAuthMethods`/`canSkipInteractiveAuth`/`beforeSpawn`/`onColdStart`/`resolveSpawnCommand`/`resolveSpawnBlocker` 抛错回落中性；`resolveSpawnCommand` 回 `null` 时 spawn 前判停并返回带安装指引的 `ACP_SPAWN_ERROR`；`resolveSpawnBlocker` 回非空文案时同样 spawn 前判停，如 deepseek 缺 key；连接失败时拼 stderr 尾部（去窗口化，慢退同样带尾），替代裸 `connection closed`）；同 runtime 温进程按 `runtime.id` 分键常驻复用、绝不串用（`listLiveAcpRuntimeIds` 可查），冷启动经通用 `onColdStart` 钩子；`acp-state.ts` 最底层（单例 `acpState` + `setStatus`/订阅/getter，禁 import 其他 `acp-*` 拆分模块），`acp-bridges.ts` 依赖 state，`acp-connection.ts` / `acp-session-ops.ts` 依赖 state+bridges（session-ops 另依赖 connection 的 `disconnectAcp`），无循环依赖 |
| cwd | `agent-sandbox-cwd.ts` | 无用户工作区时 ACP 沙箱 cwd（`userData/agent-sandbox`） |
| 注册 | `@yitom/acp-client`（注册表） | 可用运行时（默认 `codex-acp`） |
| 运行时 | `runtimes/`（`codex/` `claude/` `gemini/` `copilot/` `opencode/` `cursor/` `deepseek/` `agy/`；核心适配器矩阵已沉淀至 `@yitom/acp-client`，此处保留门面与兼容桥接） | 接线层仅消费 `GenericRuntimeAdapter`（`probeAuth`/`getSpawnEnv`/`orderAuthMethods`/`canSkipInteractiveAuth`/`resolveSpawnCommand`/`resolveSpawnBlocker` 可选），未知运行时回落中性空 adapter；Codex 自定义供应商/隔离、各家登录探测与 Cursor 安装路径解析、agy 经 bunx 直调（版本跟随 bunx，新鲜度不再逐次 `npm view`）及认证守门员（Antigravity 已淘汰，目录与桥接代码已删） |
| 认证 | `codex-auth-preflight.ts` 留守（实现已归拢至 `runtimes/codex/`；类型单一源 `@montree/contracts`）；认证守门员已迁 `@yitom/acp-client` | 连接前探活、authMethods 顺序、`~/.codex` |
| 代理 | `acp-proxy-service.ts` | Agent 子进程代理设置（userData 下 `agent/proxy` JSON 持久化）：spawn 注入 HTTP(S)_PROXY / ALL_PROXY，关闭时清理代理键 |
| 会话 | `session-open.ts` 留守；会话能力与选项解析已迁 `@yitom/acp-client` | `session/new`、能力、Mode/Model（resume→load→new + 瞬时错误重试 1 次，`session/new` 失败另有无 MCP（`mcpServers: []`）裸调重试 1 次（仍失败抛原错），超时 120s 由 `sdk-client.ts` 显式透传；`session/new`（及 load/resume）返回顶层 `models` 方言（数组 string / `{id\|value/name}` 对象 / `{availableModels, currentModelId}` 对象）且无 model 类 configOption 时合成一项 `model` 选项；initialize 的 `clientCapabilities` 另带 `session: { configOptions: { boolean: {} } }` 以解锁按 boolean 门控下发选项的 Agent） |
| 回调 | `client-handlers.ts` 留守（含 `registerAcpClientHandlers`，SDK `onRequest`/`onNotification` 原生签名） | Agent → 客户端：权限（无桥接直接 cancelled，禁静默 allow）、fs、终端等；错误抛 `RequestError` |
| IO | `acp-fs.ts` / `acp-terminal.ts` 留守；终端输出缓冲已迁 `@yitom/acp-client` | 虚拟/真实读文件、终端（虚拟文件定义见 `@montree/contracts`：`packages/contracts/src/agent/montree-virtual-fs.ts`，快照类型同目录 `packages/contracts/src/agent/montree-snapshot.ts`） |
| MCP | `mcp/montree-mcp-server.ts` 留守（HTTP 挂载）；工具表与 RPC 已迁 `@yitom/acp-client` | 进程内 HTTP MCP（`montree_*` 工具）；随连接起停；默认固定冷门端口 39281/39291，支持自愈降级与跨重启鉴权稳定 |
| 专篇 | `parameterized-model-picker.md` | cursor 参数化模型选择：两态、握手标记、Invalid params 根因与渲染三层设计 |
| 专篇 | `mcp-endpoint-architecture.md` | MCP 本地端点架构：冷门固定端口（39281/39291）、端口冲突弹性顺延与跨重启鉴权稳定性设计 |

`mcp/` 仅留传输挂载，不必再单独维护一份长 README；工具列表以 `@yitom/acp-client` 与 Skill 为准；目录副会话专用表见 `@yitom/acp-client`（`toc_*`，独立端点，仅 `toolScope: 'toc'` 的会话挂载）。

标记提议模型 `mark-proposal`（单条·批量）与章级建议 `chapter-mark-plan` 已归 `@montree/annotations`（与渲染 `ChapterMarkPlanCard` / `ProposeMarkCard` 对接），不在本包。
