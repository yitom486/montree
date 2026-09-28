# 快速入门指南 (Getting Started)

本指南介绍如何在不同的技术栈与应用宿主中快速集成 `@inkdown/acp`。

---

## 1. 安装

在目标项目中安装本包：

```bash
bun add @inkdown/acp
# 或
npm install @inkdown/acp
```

> **环境要求**：Node.js 18+ 或 Bun 1.0+。

---

## 2. 场景一：纯 Node.js / Bun 命令行工具 (CLI)

在命令行中连接 Agent，并使用标准输入输出与用户交互：

```typescript
import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { AcpClient } from '@inkdown/acp'

async function runCli() {
  const rl = readline.createInterface({ input: stdin, output: stdout })

  const client = new AcpClient({
    runtime: 'cursor-cli', // 可选: 'claude' | 'codex-acp' | 'deepseek' 等
    workspaceRoot: process.cwd(),
    clientInfo: {
      name: 'my-terminal-agent',
      version: '1.0.0',
    },
    callbacks: {
      onStatusChange: (status, detail) => {
        console.log(`[连接状态] ${status} ${detail ? `(${detail})` : ''}`)
      },
      // 敏感权限交互式审批
      onPermissionRequest: async ({ toolCall }) => {
        const answer = await rl.question(
          `\n[权限确认] Agent 请求执行工具 "${toolCall?.title || '未知'}"，是否允许？(y/N): `
        )
        const approved = answer.trim().toLowerCase() === 'y'
        return { outcome: approved ? 'approved' : 'cancelled' }
      },
      // 实时流式响应
      onSessionUpdate: (update) => {
        if (update.type === 'message' && typeof update.content === 'string') {
          process.stdout.write(update.content)
        }
      },
    },
  })

  // 1. 连接 Agent
  const connectRes = await client.connect()
  if (!connectRes.ok) {
    console.error('连接失败:', connectRes.error.message)
    rl.close()
    return
  }

  // 2. 开启新会话
  const sessionRes = await client.createSession()
  if (!sessionRes.ok) {
    console.error('创建会话失败:', sessionRes.error.message)
    rl.close()
    return
  }
  const session = sessionRes.data

  // 3. 循环问答
  while (true) {
    const input = await rl.question('\n你: ')
    if (input.trim() === 'exit') break
    await session.prompt(input)
  }

  // 4. 清理释放
  await client.disconnect()
  rl.close()
}

runCli().catch(console.error)
```

---

## 3. 场景二：Web / 后端服务 (WebSocket / SSE)

在后端服务中，可以将 `callbacks` 桥接到 WebSocket 或 Server-Sent Events (SSE)，向前端浏览器实时推流：

```typescript
import { WebSocketServer } from 'ws'
import { AcpClient } from '@inkdown/acp'

const wss = new WebSocketServer({ port: 8080 })

wss.on('connection', async (ws) => {
  const client = new AcpClient({
    runtime: 'deepseek',
    workspaceRoot: '/path/to/project',
    callbacks: {
      onSessionUpdate: (data) => {
        // 向网页前端广播流式输出
        ws.send(JSON.stringify({ event: 'agent_chunk', data }))
      },
      onPermissionRequest: async (req) => {
        // 向前端发送审批弹窗请求，等待网页用户点击确认
        return waitForWebUserApproval(ws, req)
      },
    },
  })

  await client.connect()
  const session = (await client.createSession()).data

  ws.on('message', async (message) => {
    const { prompt } = JSON.parse(message.toString())
    await session.prompt(prompt)
  })

  ws.on('close', () => {
    void client.disconnect()
  })
})
```

---

## 4. 场景三：Electron 桌面主进程

在 Electron 主进程中，将 `callbacks` 桥接给主窗口的 `webContents.send`：

```typescript
import { BrowserWindow } from 'electron'
import { AcpClient } from '@inkdown/acp'

export function setupAcpClient(mainWindow: BrowserWindow, workspaceRoot: string) {
  const client = new AcpClient({
    runtime: 'codex-acp',
    workspaceRoot,
    callbacks: {
      onStatusChange: (status, detail) => {
        mainWindow.webContents.send('acp:status-changed', { status, detail })
      },
      onSessionUpdate: (update) => {
        mainWindow.webContents.send('acp:session-update', update)
      },
      onPermissionRequest: async (payload) => {
        // 弹出 Electron 原生对话框或向渲染进程发起 IPC 请求
        return handleDialogApproval(payload)
      },
    },
  })
  return client
}
```
