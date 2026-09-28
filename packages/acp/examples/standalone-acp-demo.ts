/**
 * 示例：在任何其他项目中（无需 Electron，纯命令行/Node.js 环境）
 * 直接引入并使用 @inkdown/acp SDK 连接各类 ACP Agent！
 * 
 * 运行方式：
 *   bun run packages/acp/examples/standalone-acp-demo.ts
 */
import { AcpClient, getAcpRuntimeAdapter, BUILTIN_ACP_RUNTIMES } from '../src'

async function main() {
  console.log('=== 支持的 ACP 运行时列表 ===')
  for (const runtime of BUILTIN_ACP_RUNTIMES) {
    const adapter = getAcpRuntimeAdapter(runtime.id)
    const auth = adapter.probeAuth()
    console.log(`- [${runtime.id}] ${runtime.name} (已登录状态: ${auth.looksLoggedIn})`)
  }

  console.log('\n=== 初始化 Headless ACP Client ===')
  const client = new AcpClient({
    // 支持指定任意已适配的 Agent：'codex-acp' | 'claude' | 'cursor-cli' | 'deepseek' | 'gemini' | 'copilot' | 'opencode' | 'agy'
    runtime: 'deepseek',
    workspaceRoot: process.cwd(),
    clientInfo: {
      name: 'my-custom-cli-tool',
      version: '1.0.0',
    },
    callbacks: {
      onStatusChange: (status, detail) => {
        console.log(`[Status Change] -> ${status} ${detail ? `(${detail})` : ''}`)
      },
      onPermissionRequest: async ({ toolCall }) => {
        console.log(`[Permission Request] Agent 请求调用工具:`, toolCall)
        // 允许自动授权或通过 readline 让用户按 y/n
        return { outcome: 'approved' }
      },
      onSessionUpdate: (update) => {
        console.log(`[Stream Event]:`, update)
      },
      onLog: (level, msg) => {
        console.log(`[${level.toUpperCase()}] ${msg}`)
      },
    },
  })

  console.log('客户端创建成功，当前就绪状态:', client.currentStatus)
  // 若需启动连接：
  // const connectResult = await client.connect()
  // if (connectResult.ok) {
  //   const sessionResult = await client.createSession()
  //   if (sessionResult.ok) {
  //     const session = sessionResult.data
  //     await session.prompt('请帮我分析当前目录结构')
  //   }
  // }
}

main().catch(console.error)
