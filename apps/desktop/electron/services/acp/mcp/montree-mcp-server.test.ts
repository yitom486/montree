import { describe, expect, it, vi } from 'vitest'
import {
  adaptMontreeTools,
  callAdaptedMontreeTool,
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
