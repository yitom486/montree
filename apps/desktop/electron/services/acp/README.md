# electron/services/acp

MCP 长会话恢复由 `mcp-session-recovery.ts`（+ `.test.ts`）编排：新建/加载/恢复时记录会话自身的 cwd、完整/目录端点和已接受的元数据；`mcp/connection-health.ts` 跟踪窗口管道的工具发现及断连。检测到曾发现工具的客户端关闭后，下一轮 prompt 前仅尝试原会话 resume→load，保留 MCP 配置，并限时等待新的 tools/list；恢复失败则阻止该轮发送并提示重连，禁止 fallback 到新会话或重放 prompt。恢复期间压制历史回放，取消/切换连接会使旧恢复失效，主副会话恢复互斥。该观测确认 Agent 重新发现工具，不等同于模型目录或实际工具执行验证；从未发现工具的懒启动运行时仍按原路径发送首轮。

ACP Agent 主进程侧 wiring：拉起 `codex-acp`、连接生命周期、权限/回调路由、会话开启、fs/终端、窗口文档服务与 stdio MCP 接入。
ACP 协议与客户端底层纯逻辑已独立至外部包 `@yitom/acp-client`；渲染端零直接引用（`tsconfig.web` include 已剔除 acp）。
`montree_diagram_guide` 返回 `node_modules/@yitom/contracts/dist/agent/diagram-design.js` 的按需图解规范；`montree_present(kind=preset,preset=diagram)` 沿用 present 快照链路生成参数化 SVG，不启动额外 Agent 或执行 skill 脚本。
连接与断连按窗口串行，相同在途连接请求合并；断连立即取消在途 SDK 请求。温进程 initialize 失败时同一次连接仅冷启动回退一次，沿用原会话恢复参数，最终失败才报错。`acp-connection.test.ts` 覆盖自动回退、快速断连重连与重试上限。
OpenCode 主会话的 MCP 在 resume/load 后仍未重新发现时，`mcp-session-recovery.ts` 委托 `acp-connection.ts` 冷启动一次；该路径禁止 session/new，严格核对原会话 ID 与 Code mode，等待新 tools/list 后才在新 SDK 连接发送本轮消息。其他会话忙碌、取消或连接切换时不继续重启；失败关闭新进程并报错。进程生命周期属于宿主，依赖仍使用正式 registry 包。
Agent 工作区文件、Shell 和 Git 使用运行时的原生工具，Montree MCP 负责文档和编辑器状态。Code mode 的局部目录不代表 Agent 顶层工具全集；ACP 的客户端 `fs` / `terminal` 声明保留作兼容，不据此推断原生工具是否可用。

可选实测：`node scripts/probe-opencode-native-tools.mjs <opencode可执行文件路径>`，适用于 OpenCode 2.0.22；启动真实 ACP 进程与本地模拟模型，在临时配置/工作区中验证原生建文件、读取和 Git，客户端文件/终端委托会被拒绝。无需模型密钥，不调用付费模型接口；请求阶段总超时 45 秒，结束后清理临时进程和目录。
通用流桥接、客户端身份、请求超时/取消、会话恢复/新建、原生扩展回退与有界工具输出恢复统一由 `@yitom/acp-client` 实现。`sdk-client.ts` 仅补运行时参数转发与失败诊断，`session-open.ts` 仅补诊断及阅读会话保留 MCP 的重试策略；窗口上下文、进程归属和文档操作留宿主。安装与更新参见根 README 的「聊天与 ACP 包依赖」。

会话级 Code mode（PTC）：仅当 `initialize` 的 `agentCapabilities._meta.toolsMode.values` 显式包含 `ptc` 时，`openSessionAfterAuth` 才在 `sessionMeta` 合并 `{ toolsMode: 'ptc' }`，随 `session/new|load|resume` 下发；能力解析在 `code-mode-support.ts`（纯函数 + 单测），不从运行时 id 推断。渲染端按线程保存请求，只对下一次新建/恢复生效；`AgentHeaderOverflowMenu` 仅在声明支持时显示开关，连接结果回带 `codeModeSupported`。

渲染端入口：`apps/desktop/src/api/acp-api.ts` + `AgentPanel`。设计备忘见本地 `.plan/`（若不在仓库中）。

重连可携带当前线程至多 20 个缺失结果的 `recoverToolCallIds`，经可选会话 `_meta.toolOutputRecovery` 扩展由支持的桥接补偿。`session-open.ts` 限制响应条数/字节数并返回 `recoveredToolOutputs`；仅成功恢复同一会话时交回渲染，渲染只更新匹配的已有成功工具消息并重新校验呈现契约，不重放/新增历史、不重新调用模型。该扩展非 ACP 标准要求，不支持的运行时沿用现有恢复路径。

| 组 | 文件 | 功能 |
|----|------|------|
| 入口 | `acp-client.ts` 门面（仅 re-export，学 `apps/desktop/src/stores/acp-ui-store.ts` 先例）+ `acp-state.ts` / `acp-bridges.ts` / `acp-connection.ts` / `acp-session-ops.ts` + `process-manager.ts` / `sdk-client.ts` 留守；手搓传输已删，协议走官方 `@agentclientprotocol/sdk`（ACP v1 稳定入口） | 连接生命周期、子进程、SDK 长驻 `ClientConnection`（客户端身份由 SDK 设置，stdio 经 toWeb→`ndJsonStream` 桥接，垫层保温进程 fd；`connectSdkClient` 增可选 `runtimeId` 参，仅日志/隔离）；spawn 模板一律经 `findBuiltinAcpRuntime`（`resolveRuntimeTemplate` 防御性回落），禁写死 codex bunx；adapter 调用全防御（`probeAuth`/`getSpawnEnv`/`orderAuthMethods`/`canSkipInteractiveAuth`/`beforeSpawn`/`onColdStart`/`resolveSpawnCommand`/`resolveSpawnBlocker` 抛错回落中性；`resolveSpawnCommand` 回 `null` 时 spawn 前判停并返回带安装指引的 `ACP_SPAWN_ERROR`；`resolveSpawnBlocker` 回非空文案时同样 spawn 前判停，如 deepseek 缺 key；连接失败时拼 stderr 尾部（去窗口化，慢退同样带尾），替代裸 `connection closed`）；温进程按窗口与 `runtime.id` 分键，并核对 native/WSL 发行版环境后复用，禁止跨 Windows/WSL 串用；WSL 加载用户 SHELL 的登录环境（`listLiveAcpRuntimeIds` 可查），冷启动经通用 `onColdStart` 钩子；`acp-state.ts` 最底层（窗口上下文代理 `acpState` + `setStatus`/订阅/getter，禁 import 其他 `acp-*` 拆分模块），`acp-bridges.ts` 依赖 state，`acp-connection.ts` / `acp-session-ops.ts` 依赖 state+bridges（session-ops 另依赖 connection 的 `disconnectAcp`），无循环依赖 |
| 隔离 | `acp-context.ts` / `acp-context.test.ts` | AsyncLocalStorage 绑定可信窗口身份；独立状态、SDK 回调、温进程及 MCP 端点；无窗口调用仅用于兼容与单测 |
| cwd | `agent-sandbox-cwd.ts` | 仅接受现存绝对目录；无工作区、旧缓存相对路径或不可用目录回落 ACP 沙箱 cwd（`userData/agent-sandbox/<窗口>`），记录回落原因 |
| 注册 | `@yitom/acp-client`（注册表） | 可用运行时（默认 `codex-acp`） |
| 运行时 | `runtimes/`（`codex/` `claude/` `gemini/` `copilot/` `opencode/` `cursor/` `deepseek/` `agy/`；核心适配器矩阵已沉淀至 `@yitom/acp-client`，此处保留门面与兼容桥接） | 接线层仅消费 `GenericRuntimeAdapter`（`probeAuth`/`getSpawnEnv`/`orderAuthMethods`/`canSkipInteractiveAuth`/`resolveSpawnCommand`/`resolveSpawnBlocker` 可选），未知运行时回落中性空 adapter；Codex 自定义供应商/隔离、各家登录探测与 Cursor 安装路径解析、agy 经 bunx 直调（版本跟随 bunx，新鲜度不再逐次 `npm view`）及认证守门员（Antigravity 已淘汰，目录与桥接代码已删） |
| 认证 | `codex-auth-preflight.ts` 留守（实现已归拢至 `runtimes/codex/`；类型单一源 `@montree/contracts`）；认证守门员已迁 `@yitom/acp-client`；接线层保留非认证会话失败的真实错误，禁止统一误报为需要登录 | 连接前探活、authMethods 顺序、`~/.codex` |
| 代理与配置 | `acp-proxy-service.ts` / `provider-config-service.ts` | Agent 子进程代理设置（userData 下 `agent/proxy` JSON 持久化）：spawn 注入 HTTP(S)_PROXY / ALL_PROXY，关闭时清理代理键；供应商配置门面 |
| 会话 | `session-open.ts` 留守；会话能力与选项解析已迁 `@yitom/acp-client` | `session/new`、能力、Mode/Model（resume→load→new + 瞬时错误重试 1 次，`session/new` 失败保留同一 MCP 配置重试 1 次（仍失败抛原错，禁止静默去掉工具），超时 120s 由 `sdk-client.ts` 显式透传；`session/new`（及 load/resume）返回顶层 `models` 方言（数组 string / `{id\|value/name}` 对象 / `{availableModels, currentModelId}` 对象）且无 model 类 configOption 时合成一项 `model` 选项；initialize 的 `clientCapabilities` 另带 `session: { configOptions: { boolean: {} } }` 以解锁按 boolean 门控下发选项的 Agent） |
| Code mode | `code-mode-support.ts`（+ `.test.ts`） | 解析 `initialize.agentCapabilities._meta.toolsMode.values`，仅显式 `ptc` 才算支持；`openSessionAfterAuth` 按请求把 `toolsMode` 合并进 `sessionMeta`，`acp-state` 记录能力并由连接结果回带渲染；`acp-connection.test.ts` 覆盖声明/仅 native 两条路径 |
| 原生规则 | `native-binding.ts`（+ `native-binding.test.ts`） | 用户 `~/.montree/AGENTS.md` 为运行入口；`agent-resources.ts`（+ `.test.ts`）在应用启动与连接时从随包模板补齐缺失规则/Skills，不覆盖用户文件；配置准备、原生 Skills 绑定与精确版本门全部委托 SDK。支持会话扩展的运行时优先按会话下发，新建/恢复/加载与批注副会话均回显自身送达结果；拒绝扩展只移除扩展并保留 MCP，未知版本继续兼容。目录副会话不携带完整宿主规则。温进程按资源与有效配置摘要匹配；自定义供应商 TOML 合并辅助保留，复杂结构不覆盖 |
| 回调 | `client-handlers.ts` 留守（含 `registerAcpClientHandlers`，SDK `onRequest`/`onNotification` 原生签名） | Agent → 客户端：权限（无桥接直接 cancelled，禁静默 allow）、fs、终端等；错误抛 `RequestError` |
| 终端审批 | `terminal-approval.ts` / `terminal-approval.test.ts` | `terminal/create` 先弹审批卡（允许一次/信任此工作区/拒绝）；信任文件每次重读；决定写 JSONL 审计日志 |
| IO | `acp-fs.ts` / `acp-terminal.ts` 留守；终端输出缓冲已迁 `@yitom/acp-client` | 虚拟/真实读文件、终端（虚拟文件定义见 `@yitom/contracts`：`node_modules/@yitom/contracts/dist/agent/montree-virtual-fs.js`，快照类型同目录 `node_modules/@yitom/contracts/dist/agent/montree-snapshot.js`） |
| MCP | `mcp/stdio-server.ts` + `mcp/session-config.ts` + `mcp/diagnostics.ts`（HTTP 留守诊断兼容）；工具表与 RPC 已迁 `@yitom/acp-client` | 主进程每窗口常驻命名管道/Unix socket；Agent 启动 stdio 子进程入口（源文件 `../../mcp-stdio.ts`），经 stdio 注册工具；断开 ACP 保留服务，关闭窗口/应用销毁；独立令牌与固定快照归属 |
| 专篇 | `parameterized-model-picker.md` | cursor 参数化模型选择：两态、握手标记、Invalid params 根因与渲染三层设计 |
| 专篇 | `mcp-endpoint-architecture.md` | MCP stdio 接入、窗口生命周期、命名管道归属与发行版诊断日志 |

`mcp/` 包含 `mcp/stdio-server.ts`（窗口服务）、`mcp/session-config.ts`（ACP stdio 配置）、`mcp/diagnostics.ts`（metadata 日志）及 `mcp/stdio-server.test.ts`（真实 Electron Node 子进程、重连/隔离/日志隐私）；`mcp/montree-mcp-server.ts` / `.test.ts` 保留 HTTP 诊断与 E2E 兼容工具适配；另有 `mcp/reader-visual-tools.ts`（宿主扩展 `montree_list_images` / `montree_capture_viewport`，后者返回 MCP image 内容块）；原有工具列表以 `@yitom/acp-client` 与 Skill 为准；目录副会话专用表见 `@yitom/acp-client`（`toc_*`，独立端点，仅 `toolScope: 'toc'` 的会话挂载）。

标记提议模型 `mark-proposal`（单条·批量）与章级建议 `chapter-mark-plan` 已归 `@montree/annotations`（与渲染 `ChapterMarkPlanCard` / `ProposeMarkCard` 对接），不在本包。

`mcp/document-tools.ts` 为宿主文档编辑扩展：`montree_table_read/edit`、`montree_ppt_read/edit/edit_text/delete/chart_edit/design_edit/animation_edit`、`montree_document_undo/save`，通过快照桥接操作当前内存模型；工具使用文档路径、revision、选区 ID 和匹配数量校验，不自行解析用户文件。`edit_text` 支持段落、片段与 UTF-16 字符范围及组合内部，替换前核对原文，保留范围外样式。高级查询先返回能力/影响范围/样式/效果 ID；图表与内嵌 XLSX 同步，设计工具核对共享影响页，动画工具核对旧列表，复杂内容保留并拒绝覆盖。`montree_present` 另含展示声明（`chapter-comparison` / `html-artifact` / `component-ui` 生成式 UI 树，后者经 `present-result-builder.buildComponentUi` 验章节归属与白名单后由渲染 `generative/ComponentUiCard` 经官方 `GenerativeUIRender` 呈现）。

montree_markdown_guide 按需返回 Markdown 文档图解/本地交互组件格式及静态降级规则；模型须走当前正文 revision 与 text-edit 插入，不以聊天 present 代替写入。
