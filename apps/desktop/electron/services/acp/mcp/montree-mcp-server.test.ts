import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('montree-mcp-server 9 大阅读与卡片工具全量调用测试', () => {
  const createMockContext = () => ({
    readSnapshot: vi.fn(async (target: string, payload?: unknown) => {
      return JSON.stringify({ target, payload, status: 'ok' })
    }),
  })

  it('1. montree_read：支持 viewport、chapter 与 search 多范围读取', async () => {
    const ctx = createMockContext()
    const resViewport = await callAdaptedMontreeTool('montree_read', ctx, { scope: 'viewport' })
    expect(resViewport.content[0].text).toContain('viewport.txt')

    const resChapter = await callAdaptedMontreeTool('montree_read', ctx, { scope: 'chapter', flatIndex: 2 })
    expect(ctx.readSnapshot).toHaveBeenCalledWith('chapter', { flatIndex: 2 })
    expect(resChapter.content[0].text).toContain('chapter')

    const resSearch = await callAdaptedMontreeTool('montree_read', ctx, { scope: 'search', query: '关键逻辑' })
    expect(ctx.readSnapshot).toHaveBeenCalledWith('search', { query: '关键逻辑' })
    expect(resSearch.content[0].text).toContain('search')
  })

  it('2. montree_inspect_content：支持内容关键词检索', async () => {
    const ctx = createMockContext()
    const res = await callAdaptedMontreeTool('montree_inspect_content', ctx, { query: '逻辑前提', limit: 5 })
    expect(ctx.readSnapshot).toHaveBeenCalledWith('content-audit', { query: '逻辑前提', limit: 5 })
    expect(res.content[0].text).toContain('content-audit')
  })

  it('3. montree_get_selection：支持获取当前划选文本', async () => {
    const ctx = createMockContext()
    const res = await callAdaptedMontreeTool('montree_get_selection', ctx, {})
    expect(ctx.readSnapshot).toHaveBeenCalledWith('selection')
    expect(res.content[0].text).toContain('selection')
  })

  it('4. montree_list_marks：支持按分类列出批注与知识卡片（出题重点输入源）', async () => {
    const ctx = createMockContext()
    const resAll = await callAdaptedMontreeTool('montree_list_marks', ctx, { filter: 'all' })
    expect(ctx.readSnapshot).toHaveBeenCalledWith('marks', { filter: 'all' })
    expect(resAll.content[0].text).toContain('marks')

    const resHighlights = await callAdaptedMontreeTool('montree_list_marks', ctx, { filter: 'highlights' })
    expect(ctx.readSnapshot).toHaveBeenCalledWith('marks', { filter: 'highlights' })
  })

  it('5. montree_suggest_chapters：支持推荐精读与出题章节', async () => {
    const ctx = createMockContext()
    const payload = {
      chapters: [
        { flatIndex: 1, title: '第一章 核心概念', reason: '全书理论基石' },
        { flatIndex: 2, title: '第二章 机制实现', reason: '核心技术落地' },
      ],
    }
    const res = await callAdaptedMontreeTool('montree_suggest_chapters', ctx, payload)
    expect(ctx.readSnapshot).toHaveBeenCalledWith('suggest-chapters', payload)
    expect(res.content[0].text).toContain('suggest-chapters')
  })

  it('6. montree_create_bookmark：支持记录关键阅读书签', async () => {
    const ctx = createMockContext()
    const res = await callAdaptedMontreeTool('montree_create_bookmark', ctx, {})
    expect(ctx.readSnapshot).toHaveBeenCalledWith('create-bookmark')
    expect(res.content[0].text).toContain('create-bookmark')
  })

  it('7. montree_propose_mark：支持单条提议、卡片分类、标题及批量 marks 数组', async () => {
    const ctx = createMockContext()

    // 单条结构化卡片
    const resSingle = await callAdaptedMontreeTool('montree_propose_mark', ctx, {
      excerpt: '在实际工程中，强一致性往往伴随可用性降级。',
      note: '【CAP权衡】分布式系统的核心折中',
      category: 'concept',
      title: 'CAP 定理权衡',
    })
    expect(ctx.readSnapshot).toHaveBeenCalledWith('propose-mark', expect.objectContaining({
      excerpt: '在实际工程中，强一致性往往伴随可用性降级。',
      note: '【CAP权衡】分布式系统的核心折中',
      category: 'concept',
      title: 'CAP 定理权衡',
    }))
    expect(resSingle.content[0].text).toContain('propose-mark')

    // 批量 marks 数组
    const resBatch = await callAdaptedMontreeTool('montree_propose_mark', ctx, {
      marks: [
        { excerpt: '要点一', note: '笔记一', category: 'method' },
        { excerpt: '要点二', note: '笔记二', category: 'quote' },
      ],
    })
    expect(ctx.readSnapshot).toHaveBeenCalledWith('propose-mark', expect.objectContaining({
      marks: expect.arrayContaining([expect.objectContaining({ excerpt: '要点一' })]),
    }))

    // 参数缺失防御：无有效内容报错
    const resInvalid = await callAdaptedMontreeTool('montree_propose_mark', ctx, {})
    expect(resInvalid.isError).toBe(true)
    expect(resInvalid.content[0].text).toContain('montree_propose_mark 需要')
  })

  it('8. montree_generate_diagram：支持生成 Mermaid 图表与可视化步骤流', async () => {
    const ctx = createMockContext()
    const payload = {
      diagramType: 'sequence' as const,
      title: 'ACP 握手与工具调用时序图',
      mermaidCode: 'sequenceDiagram; Client->>Agent: prompt; Agent->>Client: reply;',
      summary: '展示客户端与考官模型的双向通信',
      visualSteps: [
        { from: 'client', to: 'agent', action: 'sendPrompt', desc: '发送出题指令' },
      ],
    }
    const res = await callAdaptedMontreeTool('montree_generate_diagram', ctx, payload)
    expect(res.content[0].text).toContain('ACP 握手与工具调用时序图')
    expect(res.content[0].text).toContain('diagramId')
  })

  it('9. montree_cross_reference：支持跨章节概念交叉引用与对照', async () => {
    const ctx = {
      readSnapshot: vi.fn(async () =>
        JSON.stringify({
          totalMatches: 2,
          hits: [
            { flatIndex: 1, title: '第一章', snippet: 'Raft 协议基础', count: 1 },
            { flatIndex: 2, title: '第二章', snippet: 'Raft 协议选举', count: 1 },
          ],
        }),
      ),
    }
    const payload = { entityName: 'Raft 协议', maxPerChapter: 3 }
    const res = await callAdaptedMontreeTool('montree_cross_reference', ctx, payload)
    expect(ctx.readSnapshot).toHaveBeenCalledWith('search', { query: 'Raft 协议' })
    expect(res.content[0].text).toContain('Raft 协议')
    expect(res.content[0].text).toContain('chapterDistribution')
  })
})

describe('montree-mcp-server HTTP JSON-RPC 端点与协议交互测试', () => {
  let serverHandle: Awaited<ReturnType<typeof import('./montree-mcp-server').startMontreeMcpServer>> | null = null
  const mockContext = {
    readSnapshot: vi.fn(async (target: string) => `snapshot-content-for-${target}`),
  }

  afterEach(async () => {
    if (serverHandle) {
      await serverHandle.close()
      serverHandle = null
    }
    const { stopMontreeMcpServer } = await import('./montree-mcp-server')
    await stopMontreeMcpServer()
  })

  it('真实 HTTP POST /mcp 收到 JSON-RPC 请求并正确分发 tools/list 与 tools/call', async () => {
    const { startMontreeMcpServer } = await import('./montree-mcp-server')
    // 强制使用随机空闲端口
    process.env.MONTREE_MCP_PORT = '0'
    serverHandle = await startMontreeMcpServer(mockContext)

    expect(serverHandle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    expect(serverHandle.authToken).toBeTruthy()

    // 1. 验证未带 Token 返回 401
    const unauthedRes = await fetch(serverHandle.url, { method: 'POST', body: '{}' })
    expect(unauthedRes.status).toBe(401)

    // 2. 验证 GET 请求返回 405
    const getRes = await fetch(serverHandle.url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${serverHandle.authToken}` },
    })
    expect(getRes.status).toBe(405)

    // 3. 验证 tools/list 能列出全部 9 个 montree_* 工具
    const listRes = await fetch(serverHandle.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serverHandle.authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
    })
    expect(listRes.status).toBe(200)
    const listJson = (await listRes.json()) as { result?: { tools?: Array<{ name: string }> } }
    const toolNames = (listJson.result?.tools || []).map((t) => t.name)
    expect(toolNames).toContain('montree_read')
    expect(toolNames).toContain('montree_inspect_content')
    expect(toolNames).toContain('montree_get_selection')
    expect(toolNames).toContain('montree_list_marks')
    expect(toolNames).toContain('montree_suggest_chapters')
    expect(toolNames).toContain('montree_create_bookmark')
    expect(toolNames).toContain('montree_propose_mark')
    expect(toolNames).toContain('montree_generate_diagram')
    expect(toolNames).toContain('montree_cross_reference')

    // 4. 验证 tools/call 正常调用 montree_read
    const callRes = await fetch(serverHandle.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serverHandle.authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'montree_read',
          arguments: { scope: 'viewport' },
        },
      }),
    })
    expect(callRes.status).toBe(200)
    const callJson = (await callRes.json()) as {
      result?: { content?: Array<{ type: string; text: string }> }
    }
    expect(callJson.result?.content?.[0]?.text).toContain('viewport.txt')

    delete process.env.MONTREE_MCP_PORT
  })
})


