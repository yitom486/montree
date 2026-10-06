import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  adaptMontreeTools,
  callAdaptedMontreeTool,
  DEFAULT_MONTREE_MCP_PORT,
  DEFAULT_MONTREE_TOC_MCP_PORT,
  getOrCreateAuthToken,
  listenWithFallback,
} from './montree-mcp-server'
import type { MontreeMcpToolDefinition, MontreeMcpToolContext } from './montree-mcp-server'

describe('montree-mcp-server tool adaptation', () => {
  it('正确将 inkdown_* 工具转译为 montree_* 并替换 description', () => {
    const rawTools: MontreeMcpToolDefinition[] = [
      {
        name: 'inkdown_read',
        description: '使用 inkdown_read 读取正文，另见 inkdown_get_selection。',
        inputSchema: { type: 'object' },
      },
      {
        name: 'custom_tool',
        description: '不受影响的工具',
        inputSchema: { type: 'object' },
      },
    ]

    const adapted = adaptMontreeTools(rawTools)
    expect(adapted[0].name).toBe('montree_read')
    expect(adapted[0].description).toBe('使用 montree_read 读取正文，另见 montree_get_selection。')
    expect(adapted[1].name).toBe('custom_tool')
  })

  it('转发调用时能把 montree_xxx 映射为底层 inkdown_xxx', async () => {
    const mockContext: MontreeMcpToolContext = {
      readSnapshot: vi.fn(async () => 'test content'),
    }

    // 验证调用 montree_read 时正常转发底层逻辑且不报错
    const result = await callAdaptedMontreeTool('montree_read', mockContext, { scope: 'viewport' })
    expect(result.content[0].text).toBe('test content')
    expect(mockContext.readSnapshot).toHaveBeenCalledWith('viewport.txt')
  })
})

describe('montree-mcp-server port and token resilience', () => {
  it('导出预期的冷门端口常量', () => {
    expect(DEFAULT_MONTREE_MCP_PORT).toBe(39281)
    expect(DEFAULT_MONTREE_TOC_MCP_PORT).toBe(39291)
  })

  it('getOrCreateAuthToken 返回有效且跨调用一致的 48 字符 hex 令牌', () => {
    const token1 = getOrCreateAuthToken('test-unit')
    const token2 = getOrCreateAuthToken('test-unit')
    expect(token1).toHaveLength(48)
    expect(/^[0-9a-f]+$/i.test(token1)).toBe(true)
    expect(token1).toBe(token2)
  })

  it('listenWithFallback 在端口被占用时自动递增尝试下一个端口', async () => {
    // 占用测试起始端口
    const blockerPort = 39870
    const blockerServer = createServer()
    await new Promise<void>((resolve) => blockerServer.listen(blockerPort, '127.0.0.1', () => resolve()))

    const testServer = createServer()
    const allocatedPort = await listenWithFallback(testServer, blockerPort)

    try {
      expect(allocatedPort).toBe(blockerPort + 1)
    } finally {
      await new Promise<void>((resolve) => testServer.close(() => resolve()))
      await new Promise<void>((resolve) => blockerServer.close(() => resolve()))
    }
  })
})

