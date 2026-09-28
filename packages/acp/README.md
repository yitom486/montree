# @yitom/acp-client — Headless ACP (Agent Client Protocol) SDK

通用的 **ACP (Agent Client Protocol)** 纯 TypeScript / Node.js 客户端 SDK。零 UI / 零 Electron 强依赖，可独立打包发布到 NPM，在任何命令行 CLI、Node.js 后端服务、Electron 或 Tauri 桌面端中跨项目直接调用。

---

## 📚 详细文档导航

为了方便在不同场景下深入接入与定制，我们在 [`docs/`](./docs/) 目录下提供了专项详细指南：

| 文档 | 链接 | 内容说明 |
| :--- | :--- | :--- |
| **快速入门** | [Getting Started](./docs/getting-started.md) | 在 CLI 工具、Web/后端服务、Electron 主进程中接入的标准范式 |
| **API 参考** | [API Reference](./docs/api-reference.md) | `AcpClient` 构造参数、方法、事件回调接口与会话控制详述 |
| **新增 Agent 适配** | [Adding an Agent](./docs/adding-an-agent.md) | 插件式适配器开发指南（如何为新 Agent 编写凭证探测与 CLI 接线） |
| **Tauri 集成实战** | [Tauri Integration](./docs/tauri-integration.md) | 通过 Bun 编译独立单文件二进制，作为 Tauri Sidecar 伴生进程运行 |

---

## ⚡ 核心特性

- **多 Agent 统一适配（8 大主流运行时）**：
  开箱即用支持 `codex-acp` (ChatGPT)、`claude`、`cursor-cli`、`deepseek`、`gemini`、`copilot`、`opencode`、`agy`。新增 Agent 只需在该包实现一个适配器，全局所有项目自动生效。
- **纯 Node.js / Headless 架构**：
  不依赖任何 Electron API、React 或特定前端框架。配置目录跨平台自动检测回落（支持自定义 `dataDir`）。
- **生命周期全托管**：
  负责跨平台后台进程拉起（Windows PID 级联杀进程）、Stdio ndJson 传输桥接、协议初始化（Initialize 握手）、温进程池长驻复用、错误诊断（stderr 尾部日志聚合）。
- **会话状态机与容错**：
  自动处理 `resume` → `load` → `new` 会话恢复流程，处理模型方言（models 数组/对象）、无 MCP 自动降级与网络抖动重试。
- **解耦的事件钩子与审批**：
  工具调用审批、权限请求、会话流式更新采用标准的回调与事件驱动，宿主自由决定如何确认（命令行交互 / 桌面弹窗 / Web 消息）。

---

## 🤖 运行时与认证支持矩阵

| 运行时 ID | 显示名称 | 本机凭据探测路径 / 环境变量 | 预检 / 启动特性 |
| :--- | :--- | :--- | :--- |
| `codex-acp` | ChatGPT | `~/.codex/auth.json` / 自定义供应商 API Key | 支持隔离 `CODEX_HOME` 生成 `config.toml` |
| `claude` | Claude | `~/.claude.json` / `ANTHROPIC_API_KEY` | 自动复用本机 Claude Code CLI 登录态 |
| `cursor-cli` | Cursor | `CURSOR_API_KEY` / 系统 Keychain 登录态 | 自动探测 `%LOCALAPPDATA%\cursor-agent\agent.cmd` |
| `deepseek` | DeepSeek | `DEEPSEEK_API_KEY` | 缺 key 提前拦截判停，避免子进程秒退 |
| `gemini` | Gemini | `~/.gemini/oauth_creds.json` / `GEMINI_API_KEY` | 自动探测 OAuth 凭证与系统 Key |
| `copilot` | Copilot | `~/.copilot/config.json` / `GH_TOKEN` | 自动提取 `loggedInUsers` 凭证列表 |
| `opencode` | OpenCode | `$XDG_DATA_HOME/opencode/auth.json` | 遵循 XDG / `%LOCALAPPDATA%` 规范 |
| `agy` | agy | 官方桥接器免密直连 | `tryDirectSessionFirst` 免鉴权直通 |

---

## 🚀 快速上手 (1 分钟代码)

```typescript
import { AcpClient } from '@yitom/acp-client'

// 1. 初始化客户端
const client = new AcpClient({
  runtime: 'cursor-cli', // 或 'claude' | 'codex-acp' | 'deepseek' 等
  workspaceRoot: process.cwd(),
  clientInfo: {
    name: 'my-custom-cli',
    version: '1.0.0',
  },
  callbacks: {
    onStatusChange: (status, detail) => {
      console.log(`[Status] -> ${status}`, detail ?? '')
    },
    onPermissionRequest: async ({ toolCall }) => {
      console.log(`Agent 请求调用工具:`, toolCall)
      return { outcome: 'approved' } // 交互式批准或自动放行
    },
    onSessionUpdate: (event) => {
      console.log(`[Stream Event]:`, event)
    },
  },
})

// 2. 启动并连接 Agent
const connectResult = await client.connect()
if (!connectResult.ok) {
  console.error('连接失败:', connectResult.error)
  return
}

// 3. 创建/恢复会话
const sessionResult = await client.createSession()
if (sessionResult.ok) {
  const session = sessionResult.data
  // 4. 发送提示词 / 消息交互
  await session.prompt('请帮我分析当前项目目录结构')
}

// 5. 随时安全断开连接（清理孤儿进程）
await client.disconnect()
```

---

## 📦 打包构建

在本包根目录一键构建生成 `dist`（ESM / CJS / `.d.ts`）：

```bash
bun run build:acp
```

产物说明：
- `dist/index.js`：ESM 格式，适合现代构建工具（Vite、Webpack）与 ESM Node.js 环境；
- `dist/index.cjs`：CommonJS 格式，适合传统 Node.js 环境（`require`）；
- `dist/index.d.ts`：完整 TypeScript 类型声明，支持 IDE 智能感知。

---

## 🧪 运行独立验证示例

我们在 [`examples/standalone-acp-demo.ts`](./examples/standalone-acp-demo.ts) 提供了可在终端直接运行的验证脚本：

```bash
bun run packages/acp/examples/standalone-acp-demo.ts
```
