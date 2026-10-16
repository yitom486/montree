import { describe, expect, it } from 'vitest'
import { explainToolFailure } from './tool-failure-message'

describe('explainToolFailure', () => {
  it('MCP 启动目录错误不误报为文档未加载', () => {
    const r = explainToolFailure('MCP startup failed: 目录名称无效。 (os error 267)', 'mcp__montree__startup')
    expect(r.headline).toBe('工具启动目录无效')
    expect(r.body).toContain('重新连接')
    expect(r.body).not.toMatch(/换.*说法|加载|稍等/)
  })

  it('MCP 启动超时优先于阅读内容超时', () => {
    expect(explainToolFailure('MCP startup failed: timeout', 'mcp__montree__startup').headline).toBe('工具服务启动失败')
  })
  it('章节参数缺失 → 业务说明', () => {
    const r = explainToolFailure(
      'montree_read(scope=chapter) 需要 flatIndex 或 title 之一',
      'mcp.montree.montree_read',
    )
    expect(r.headline).toContain('章节')
    expect(r.body).not.toMatch(/flatIndex|scope=chapter/)
  })

  it('快照超时 → 可读说明且不含 timeout 原文堆在 body 里当主句', () => {
    const r = explainToolFailure('Montree 快照请求超时：toc.json')
    expect(r.headline).toMatch(/未能取到|内容/)
    expect(r.body).toMatch(/电子书|在线文档|前台/)
  })

  it('空原文仍有兜底', () => {
    const r = explainToolFailure('', 'montree_read')
    expect(r.headline.length).toBeGreaterThan(0)
    expect(r.body.length).toBeGreaterThan(0)
  })

  it('不把未知英文堆栈当正文展示', () => {
    const r = explainToolFailure('Error: ECONNRESET at Socket.emit')
    expect(r.body).not.toMatch(/ECONNRESET|Socket\.emit/)
  })

  it('未入库扫描书搜索拦截 → 建索引引导（不被关键词规则误伤）', () => {
    const r = explainToolFailure(
      '先建立罗盘索引，或手动单页识别',
      'mcp.montree.montree_read',
    )
    expect(r.headline).toContain('罗盘索引')
    expect(r.body).toMatch(/建立罗盘索引|识别本页/)
  })

  it('在线文档外部章节未加载 → 引导使用联网检索', () => {
    const r = explainToolFailure(
      '未能读取「Advanced Routing」（index=2）的正文：该章节为未在阅读器中加载的在线网页（https://nextjs.org/...）。建议直接使用 Web Fetch 或 Web Search 访问该链接。',
      'mcp.montree.montree_read',
    )
    expect(r.headline).toContain('联网读取')
    expect(r.body).toContain('联网检索')
  })
})

