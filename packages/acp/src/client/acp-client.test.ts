import { describe, expect, it } from 'vitest'
import { AcpClient } from './acp-client'

describe('AcpClient Headless SDK', () => {
  it('正确实例化默认客户端', () => {
    const client = new AcpClient({
      workspaceRoot: process.cwd(),
      clientInfo: {
        name: 'test-app',
        version: '1.0.0',
      },
    })

    expect(client).toBeDefined()
    expect(client.currentStatus).toBe('disconnected')
    expect(client.isConnected).toBe(false)
  })

  it('支持传入不同的运行时名称', () => {
    const runtimes = ['codex-acp', 'claude', 'cursor-cli', 'deepseek', 'gemini', 'copilot', 'opencode', 'agy']

    for (const runtime of runtimes) {
      const client = new AcpClient({
        runtime,
        workspaceRoot: process.cwd(),
      })
      expect(client).toBeDefined()
    }
  })

  it('传入未知运行时抛出明确错误', () => {
    expect(() => {
      new AcpClient({
        runtime: 'unknown-agent-xyz',
        workspaceRoot: process.cwd(),
      })
    }).toThrow('未知或未注册的 ACP 运行时模板: unknown-agent-xyz')
  })
})
