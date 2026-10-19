# MCP stdio 接入与窗口生命周期

生产会话通过 ACP 下发 stdio 配置：Agent 启动构建产物 out/main/mcp-stdio.js，以 Electron 的 Node 模式运行，stdout 仅承载 MCP JSON-RPC。子进程经窗口专属命名管道（Windows）或 Unix socket（macOS/Linux）接入主进程，不使用 HTTP，无需额外安装 Node/Bun。

链路：Agent ↔ stdio 子进程 ↔ 窗口管道 ↔ 主进程工具分发 ↔ 所属窗口的文档快照。

WSL 工作区启动对应发行版的 OpenCode，加载 Ubuntu 用户 SHELL 的登录环境，禁止复用 Windows 的温进程。stdio 命令使用 /mnt 下的 Windows Electron 可执行路径；脚本参数使用 Windows 能识别的正斜杠路径，通过 WSLENV 传递 Node 模式和窗口管道配置。协议仍是标准 ACP/MCP，不复制 Windows 的供应商认证到 Ubuntu。

## 生命周期

- 新建窗口时启动窗口文档服务；断开 ACP、切换智能体和聊天保留端点及令牌。
- 新建、加载、恢复会话均下发所属窗口的 stdio 命令与环境配置。Agent 管理 stdio 子进程，Montree 主进程管理窗口服务。
- 每窗口独立端点、随机令牌及固定快照归属。关闭窗口销毁其所有服务和连接；退出应用清理全部窗口。
- 目录助手按需启动独立 toc 服务，仅暴露目录工具，同样随窗口关闭。
- 管道鉴权超时为 5 秒，通过后无闲置超时；管道关闭时 stdio 子进程结束。
- session/new 失败时保留 MCP 配置重试，禁止悄悄建立无工具会话。
- stdio 不保证修复 Agent 自身的工具目录或缓存问题。
- `mcp/connection-health.ts` 记录成功 tools/list 与对应连接关闭；`mcp-session-recovery.ts` 在下一轮 prompt 前恢复原会话（resume→load），重新下发所属窗口/工具范围的配置，并等待新的 tools/list（每次最多 10 秒）。失败返回错误，不发送本轮 prompt、不创建替代会话。取消或连接切换会使恢复失效；恢复压制历史回放，不重发用户消息。未发现过工具的懒启动会话保持原有行为。
- OpenCode 主会话的原连接恢复最终因工具发现超时失败时，再执行一次串行冷启动：关闭旧进程，以同一 cwd、会话 ID 和工具模式恢复，只允许 resume/load，禁止 session/new 回退；收到新的 tools/list 后才发送原消息一次。其他会话正在生成时不重启。冷启动失败、取消或窗口/连接变化即停止，不重复启动或重发消息。

## 日志

发行版与开发版均在各自 userData/logs/acp-mcp.log 持久化服务启动/关闭、客户端鉴权/连接/关闭、工具发现数量、工具名/耗时/失败、会话恢复、请求失败及 Agent stderr 分类。单文件约 5 MiB 后轮转，保留一份 previous 文件。

日志不保存令牌、管道地址、环境值、工具参数或结果、选区及提示词。Agent 原始 stderr 尾部仍只保留在内存，文件仅记录错误分类。

恢复事件为 mcp.recovery.started / mcp.recovery.failed / mcp.recovery.cold-start / mcp.recovery.discovered，最后一项仅表示重新收到工具发现请求，不能作为模型已调用工具的证明。

Montree 日志只能说明其收到的请求；Agent 不发请求时，仍需结合 Agent 日志判定工具目录是否包含 Montree。

## 实现与兼容

`../../mcp-stdio.ts`：独立子进程构建入口；`mcp/stdio-server.ts`：窗口文档服务；`mcp/session-config.ts`：ACP stdio 配置；`mcp/diagnostics.ts`：诊断日志。

`mcp/montree-mcp-server.ts` 仅保留 HTTP 适配与专用 E2E/诊断兼容钩子，生产 ACP 会话不再挂载它；旧 39281/39291 端口不再用于生产 stdio。

`mcp/stdio-server.test.ts` 以真实 Electron Node 子进程验证工具发现、读取、重连、窗口/令牌隔离及日志隐私。agent-window-isolation E2E 覆盖真实应用的 ACP/stdio/IPC 联动。
