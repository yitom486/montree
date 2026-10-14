# electron/services/acp

ACP Agent 主进程侧 wiring：拉起 `codex-acp`、连接生命周期、权限/回调路由、会话开启、fs/终端、窗口文档服务与 stdio MCP 接入。
ACP 协议与客户端底层纯逻辑已独立至外部包 `@yitom/acp-client`；渲染端零直接引用（`tsconfig.web` include 已剔除 acp）。
渲染端入口：`apps/desktop/src/api/acp-api.ts` + `AgentPanel`。设计备忘见本地 `.plan/`（若不在仓库中）。

| 组 | 文件 | 功能 |
|----|------|------|
| 入口 | `acp-client.ts` 门面（仅 re-export，学 `apps/desktop/src/stores/acp-ui-store.ts` 先例）+ `acp-state.ts` / `acp-bridges.ts` / `acp-connection.ts` / `acp-session-ops.ts` + `process-manager.ts` / `sdk-client.ts` 留守；手搓传输已删，协议走官方 `@agentclientprotocol/sdk`（ACP v1 稳定入口） | 连接生命周期、子进程、SDK 长驻 `ClientConnection`（`client({name:"montree"}).connect()`，stdio 经 toWeb→`ndJsonStream` 桥接，垫层保温进程 fd；`connectSdkClient` 增可选 `runtimeId` 参，仅日志/隔离）；spawn 模板一律经 `findBuiltinAcpRuntime`（`resolveRuntimeTemplate` 防御性回落），禁写死 codex bunx；adapter 调用全防御（`probeAuth`/`getSpawnEnv`/`orderAuthMethods`/`canSkipInteractiveAuth`/`beforeSpawn`/`onColdStart`/`resolveSpawnCommand`/`resolveSpawnBlocker` 抛错回落中性；`resolveSpawnCommand` 回 `null` 时 spawn 前判停并返回带安装指引的 `ACP_SPAWN_ERROR`；`resolveSpawnBlocker` 回非空文案时同样 spawn 前判停，如 deepseek 缺 key；连接失败时拼 stderr 尾部（去窗口化，慢退同样带尾），替代裸 `connection closed`）；温进程按窗口与 `runtime.id` 分键，并核对 native/WSL 发行版环境后复用，禁止跨 Windows/WSL 串用；WSL 加载用户 SHELL 的登录环境（`listLiveAcpRuntimeIds` 可查），冷启动经通用 `onColdStart` 钩子；`acp-state.ts` 最底层（窗口上下文代理 `acpState` + `setStatus`/订阅/getter，禁 import 其他 `acp-*` 拆分模块），`acp-bridges.ts` 依赖 state，`acp-connection.ts` / `acp-session-ops.ts` 依赖 state+bridges（session-ops 另依赖 connection 的 `disconnectAcp`），无循环依赖 |
| 隔离 | `acp-context.ts` / `acp-context.test.ts` | AsyncLocalStorage 绑定可信窗口身份；独立状态、SDK 回调、温进程及 MCP 端点；无窗口调用仅用于兼容与单测 |
| cwd | `agent-sandbox-cwd.ts` | 无用户工作区时 ACP 沙箱 cwd（`userData/agent-sandbox/<窗口>`） |
| 注册 | `@yitom/acp-client`（注册表） | 可用运行时（默认 `codex-acp`） |
| 运行时 | `runtimes/`（`codex/` `claude/` `gemini/` `copilot/` `opencode/` `cursor/` `deepseek/` `agy/`；核心适配器矩阵已沉淀至 `@yitom/acp-client`，此处保留门面与兼容桥接） | 接线层仅消费 `GenericRuntimeAdapter`（`probeAuth`/`getSpawnEnv`/`orderAuthMethods`/`canSkipInteractiveAuth`/`resolveSpawnCommand`/`resolveSpawnBlocker` 可选），未知运行时回落中性空 adapter；Codex 自定义供应商/隔离、各家登录探测与 Cursor 安装路径解析、agy 经 bunx 直调（版本跟随 bunx，新鲜度不再逐次 `npm view`）及认证守门员（Antigravity 已淘汰，目录与桥接代码已删） |
| 认证 | `codex-auth-preflight.ts` 留守（实现已归拢至 `runtimes/codex/`；类型单一源 `@montree/contracts`）；认证守门员已迁 `@yitom/acp-client`；接线层保留非认证会话失败的真实错误，禁止统一误报为需要登录 | 连接前探活、authMethods 顺序、`~/.codex` |
| 代理与配置 | `acp-proxy-service.ts` / `provider-config-service.ts` | Agent 子进程代理设置（userData 下 `agent/proxy` JSON 持久化）：spawn 注入 HTTP(S)_PROXY / ALL_PROXY，关闭时清理代理键；供应商配置门面 |
| 会话 | `session-open.ts` 留守；会话能力与选项解析已迁 `@yitom/acp-client` | `session/new`、能力、Mode/Model（resume→load→new + 瞬时错误重试 1 次，`session/new` 失败保留同一 MCP 配置重试 1 次（仍失败抛原错，禁止静默去掉工具），超时 120s 由 `sdk-client.ts` 显式透传；`session/new`（及 load/resume）返回顶层 `models` 方言（数组 string / `{id\|value/name}` 对象 / `{availableModels, currentModelId}` 对象）且无 model 类 configOption 时合成一项 `model` 选项；initialize 的 `clientCapabilities` 另带 `session: { configOptions: { boolean: {} } }` 以解锁按 boolean 门控下发选项的 Agent） |
| 回调 | `client-handlers.ts` 留守（含 `registerAcpClientHandlers`，SDK `onRequest`/`onNotification` 原生签名） | Agent → 客户端：权限（无桥接直接 cancelled，禁静默 allow）、fs、终端等；错误抛 `RequestError` |
| IO | `acp-fs.ts` / `acp-terminal.ts` 留守；终端输出缓冲已迁 `@yitom/acp-client` | 虚拟/真实读文件、终端（虚拟文件定义见 `@montree/contracts`：`packages/contracts/src/agent/montree-virtual-fs.ts`，快照类型同目录 `packages/contracts/src/agent/montree-snapshot.ts`） |
| MCP | `mcp/stdio-server.ts` + `mcp/session-config.ts` + `mcp/diagnostics.ts`（HTTP 留守诊断兼容）；工具表与 RPC 已迁 `@yitom/acp-client` | 主进程每窗口常驻命名管道/Unix socket；Agent 启动 stdio 子进程入口（源文件 `../../mcp-stdio.ts`），经 stdio 注册工具；断开 ACP 保留服务，关闭窗口/应用销毁；独立令牌与固定快照归属 |
| 专篇 | `parameterized-model-picker.md` | cursor 参数化模型选择：两态、握手标记、Invalid params 根因与渲染三层设计 |
| 专篇 | `mcp-endpoint-architecture.md` | MCP stdio 接入、窗口生命周期、命名管道归属与发行版诊断日志 |

`mcp/` 包含 `mcp/stdio-server.ts`（窗口服务）、`mcp/session-config.ts`（ACP stdio 配置）、`mcp/diagnostics.ts`（metadata 日志）及 `mcp/stdio-server.test.ts`（真实 Electron Node 子进程、重连/隔离/日志隐私）；`mcp/montree-mcp-server.ts` / `.test.ts` 保留 HTTP 诊断与 E2E 兼容工具适配；另有 `mcp/reader-visual-tools.ts`（宿主扩展 `montree_list_images` / `montree_capture_viewport`，后者返回 MCP image 内容块）；原有工具列表以 `@yitom/acp-client` 与 Skill 为准；目录副会话专用表见 `@yitom/acp-client`（`toc_*`，独立端点，仅 `toolScope: 'toc'` 的会话挂载）。

标记提议模型 `mark-proposal`（单条·批量）与章级建议 `chapter-mark-plan` 已归 `@montree/annotations`（与渲染 `ChapterMarkPlanCard` / `ProposeMarkCard` 对接），不在本包。

`mcp/document-tools.ts` 为宿主文档编辑扩展：`montree_table_read/edit`、`montree_ppt_read/edit/edit_text/delete/chart_edit/design_edit/animation_edit`、`montree_document_undo/save`，通过快照桥接操作当前内存模型；工具使用文档路径、revision、选区 ID 和匹配数量校验，不自行解析用户文件。`edit_text` 支持段落、片段与 UTF-16 字符范围及组合内部，替换前核对原文，保留范围外样式。高级查询先返回能力/影响范围/样式/效果 ID；图表与内嵌 XLSX 同步，设计工具核对共享影响页，动画工具核对旧列表，复杂内容保留并拒绝覆盖。`montree_present` 另含展示声明（`chapter-comparison` / `html-artifact` / `component-ui` 生成式 UI 树，后者经 `present-result-builder.buildComponentUi` 验章节归属与白名单后由渲染 `generative/ComponentUiCard` 经官方 `GenerativeUIRender` 呈现）。
