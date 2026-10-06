import { describe, expect, it } from 'vitest'
import { explainToolFailure } from './tool-failure-message'

describe('explainToolFailure', () => {
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
})
