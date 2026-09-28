# 完整 API 参考文档 (API Reference)

本文档详细列出 `@inkdown/acp` 导出的所有核心类、方法与类型定义。

---

## 1. `AcpClient` 类

管理单个 Agent 连接及其生命周期的核心门面类。

### 构造函数

```typescript
const client = new AcpClient(options: AcpClientOptions)
```

#### `AcpClientOptions` 参数说明

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :---: | :--- |
| `workspaceRoot` | `string` | **是** | Agent 工作区根目录（绝对路径） |
| `runtime` | `string \| AcpRuntimeInfo` | 否 | 运行时标识（如 `'codex-acp'`、`'cursor-cli'`、`'claude'`、`'deepseek'` 等），默认 `'codex-acp'` |
| `clientInfo` | `{ name: string; version?: string }` | 否 | 客户端身份声明，默认 `{ name: 'inkdown', version: '0.1.0' }` |
| `dataDir` | `string` | 否 | 本地凭据与配置持久化目录，缺省自动使用操作系统标准应用数据目录 |
| `proxy` | `Partial<AcpProxySettings>` | 否 | 代理配置 `{ enabled?: boolean; host?: string; port?: number }` |
| `env` | `NodeJS.ProcessEnv` | 否 | 注入给子进程的额外环境变量 |
| `callbacks` | `AcpClientCallbacks` | 否 | 事件与审批回调钩子（详见下文） |

### 实例属性

- `currentStatus`: `AcpConnectionStatus`
  - 当前状态值：`'disconnected' | 'connecting' | 'connected' | 'awaiting_auth' | 'error'`
- `isConnected`: `boolean`
  - 是否已成功建连且持有就绪的 RPC 客户端
- `agent`: `ClientContext | null`
  - 底层 `@agentclientprotocol/sdk` 的原生 RPC 上下文，可用于直接发送低级 RPC 请求

### 核心方法

#### `connect(): Promise<Result<{ status: AcpConnectionStatus; init: InitializeResponse }, AppError>>`
启动 Agent 后台进程、初始化 Stdio 通道并完成 Initialize 握手。

#### `createSession(options?): Promise<Result<AcpSessionHandle, AppError>>`
开启一个新会话或恢复已有会话。
- `options.resumeSessionId?: string | null`：尝试恢复的会话 ID
- `options.mcpServers?: unknown[]`：挂载的 MCP 服务器列表

#### `disconnect(reason?: string): Promise<void>`
断开当前连接，释放 Stdio 管道并安全杀死后台进程（清理进程树，避免孤儿进程）。

---

## 2. `AcpSessionHandle` 类

代表一个已建立的对话会话。

### 方法

#### `prompt(text: string, options?: { timeoutMs?: number }): Promise<Result<unknown, AppError>>`
向当前会话发送提示词或用户输入。

#### `setConfigOption(configId: string, value: string | boolean): Promise<Result<unknown, AppError>>`
动态修改会话配置项（如切换底层模型 `model`、模式 `mode` 等）。

---

## 3. 回调接口 `AcpClientCallbacks`

用于完全解耦宿主与界面的事件驱动接口：

```typescript
export interface AcpClientCallbacks {
  /** 权限审批回调：当 Agent 尝试调用工具或执行敏感操作时触发 */
  onPermissionRequest?: (payload: {
    sessionId?: string
    toolCall?: { id?: string; title?: string; kind?: string }
    params: Record<string, unknown>
  }) => Promise<{ outcome: 'approved' | 'cancelled' }>

  /** 会话状态与内容流式更新 */
  onSessionUpdate?: (params: Record<string, unknown>) => void

  /** 连接状态机变化通知 */
  onStatusChange?: (status: AcpConnectionStatus, detail?: string) => void

  /** Agent 进程 stderr 输出（用于实时调试排错） */
  onStderrLine?: (line: string) => void

  /** 虚拟文件读取（供 Agent 读取内存快照） */
  readSnapshot?: (resource: InkdownVirtualResource) => Promise<string>

  /** 日志打印 */
  onLog?: (level: 'info' | 'warn' | 'error', message: string, meta?: unknown) => void
}
```

---

## 4. 运行时适配器工具

- `getAcpRuntimeAdapter(runtimeId: string): AcpRuntimeAdapter`
  获取指定运行时的适配器对象。
- `BUILTIN_ACP_RUNTIMES: readonly AcpRuntimeInfo[]`
  获取当前内置支持的所有 8 大 Agent 运行时配置元数据列表。
