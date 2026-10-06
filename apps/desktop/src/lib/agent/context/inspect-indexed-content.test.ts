import { describe, expect, it, vi } from 'vitest'
import { err, ok } from '@montree/contracts'
import { useActiveDocumentStore } from '@/stores/active-document-store'
import { inspectIndexedContentForAgent } from './inspect-indexed-content'
import { registerReaderContent } from './reader-content-registry'

const RESULT = {
  query: '王道计',
  total: 1,
  truncated: false,
  limit: 10,
  hits: [
    {
      source: 'book-index' as const,
      locator: { pageNumber: 36, chapterTitle: '第2章', blockId: 7 },
      text: '王道计是出版社',
      textTruncated: false,
      matchPosition: 'start' as const,
    },
  ],
}

function deps(over: Record<string, unknown> = {}) {
  return {
    getActivePath: vi.fn((): string => '/book/demo.pdf'),
    getFingerprint: vi.fn((): string => '/book/demo.pdf|123'),
    callInspect: vi.fn(async () => ok(RESULT)),
    ...over,
  }
}

describe('inspectIndexedContentForAgent', () => {
  it('绑定当前文档指纹并返回审计 JSON', async () => {
    const d = deps()
    const text = await inspectIndexedContentForAgent('王道计', 10, d)
    expect(d.callInspect).toHaveBeenCalledWith('/book/demo.pdf|123', '王道计', 10)
    expect(JSON.parse(text)).toMatchObject({ total: 1, truncated: false })
  })

  it('无活动文档 / 未绑定指纹抛错', async () => {
    await expect(inspectIndexedContentForAgent('王道计', 10, deps({ getActivePath: () => '' }))).rejects.toThrow(
      '没有打开的文档',
    )
    await expect(inspectIndexedContentForAgent('王道计', 10, deps({ getFingerprint: () => '' }))).rejects.toThrow(
      '不支持内容审计',
    )
  })

  it('空 query 与非法 limit 抛错，不调 IPC', async () => {
    const d = deps()
    await expect(inspectIndexedContentForAgent('   ', 10, d)).rejects.toThrow('非空')
    await expect(inspectIndexedContentForAgent('王道计', Number.NaN, d)).rejects.toThrow('整数')
    expect(d.callInspect).not.toHaveBeenCalled()
  })

  it('IPC 错误向上传递为异常（快照层转工具错误）', async () => {
    const d = deps({
      callInspect: vi.fn(async () => err({ code: 'INVALID_STATE' as const, message: '本书尚未导入罗盘索引' })),
    })
    await expect(inspectIndexedContentForAgent('王道计', 10, d)).rejects.toThrow('尚未导入罗盘索引')
  })

  it('短词与非法 limit 在读正文前拒绝', async () => {
    const getBufferText = vi.fn(async (): Promise<string | null> => '正文王道计正文')
    const d = deps({ getFingerprint: () => '', getBufferText })
    await expect(inspectIndexedContentForAgent('ab', 10, d)).rejects.toThrow('至少需要 3 个字符')
    await expect(inspectIndexedContentForAgent('王道计', 0, d)).rejects.toThrow('1–10 的整数')
    expect(getBufferText).not.toHaveBeenCalled()
  })

  it('markdown 无指纹：命中编辑器内存（含未保存字串），source=editor-buffer', async () => {
    const getBufferText = vi.fn(
      async (): Promise<string | null> => '第一章\n未保存的王道计草稿\n尾声',
    )
    const callInspect = vi.fn()
    const d = deps({ getFingerprint: () => '', getBufferText, callInspect })
    const text = await inspectIndexedContentForAgent('王道计', 10, d)
    expect(callInspect).not.toHaveBeenCalled()
    const parsed = JSON.parse(text) as {
      total: number
      truncated: boolean
      hits: Array<{
        source: string
        locator: Record<string, unknown>
        text: string
        matchPosition: string
      }>
    }
    expect(parsed.total).toBe(1)
    expect(parsed.truncated).toBe(false)
    expect(parsed.hits).toHaveLength(1)
    expect(parsed.hits[0]?.source).toBe('editor-buffer')
    expect(parsed.hits[0]?.locator).toEqual({ lineStart: 2 })
    expect(parsed.hits[0]?.text).toContain('未保存的王道计草稿')
    expect(parsed.hits[0]).not.toHaveProperty('pageNumber')
  })

  it('内存 limit 截断不影响精确 total', async () => {
    const getBufferText = vi.fn(
      async (): Promise<string | null> =>
        Array.from({ length: 5 }, (_, i) => `第${i + 1}行王道计`).join('\n'),
    )
    const d = deps({ getFingerprint: () => '', getBufferText })
    const parsed = JSON.parse(await inspectIndexedContentForAgent('王道计', 2, d)) as {
      total: number
      truncated: boolean
      limit: number
      hits: unknown[]
    }
    expect(parsed.total).toBe(5)
    expect(parsed.truncated).toBe(true)
    expect(parsed.limit).toBe(2)
    expect(parsed.hits).toHaveLength(2)
  })

  it('空 buffer 与零命中返回 total=0 合法 JSON', async () => {
    const d = deps({ getFingerprint: () => '', getBufferText: vi.fn(async () => '') })
    expect(JSON.parse(await inspectIndexedContentForAgent('王道计', 10, d))).toMatchObject({
      total: 0,
      hits: [],
      truncated: false,
    })
    const d2 = deps({
      getFingerprint: () => '',
      getBufferText: vi.fn(async () => '纯正文无命中'),
    })
    expect(JSON.parse(await inspectIndexedContentForAgent('王道计', 10, d2))).toMatchObject({
      total: 0,
      hits: [],
    })
  })

  it('PDF 无指纹仍拒绝，不读 getCurrentText', async () => {
    // getBufferText 返回 null = 非 markdown/未绑定（EPUB 同理）
    const getBufferText = vi.fn(async (): Promise<string | null> => null)
    const d = deps({ getFingerprint: () => '', getBufferText })
    await expect(inspectIndexedContentForAgent('王道计', 10, d)).rejects.toThrow('不支持内容审计')
  })

  it('P3.1 epub：章节取证，source 与定位正确，无页码无路径', async () => {
    async function* units() {
      yield { label: '第一章 概述', text: '王道计是出版社\n普通行' }
      yield { label: '第二章 运算', text: '无关正文' }
    }
    const getEbookUnits = vi.fn(() => units())
    const searchWorkspace = vi.fn()
    const d = deps({ getFingerprint: () => '', getEbookUnits, searchWorkspace })
    const parsed = JSON.parse(await inspectIndexedContentForAgent('王道计', 10, d)) as {
      total: number
      truncated: boolean
      hits: Array<{ source: string; locator: Record<string, unknown>; text: string }>
    }
    expect(parsed.total).toBe(1)
    expect(parsed.truncated).toBe(false)
    expect(parsed.hits[0]?.source).toBe('ebook-section')
    expect(parsed.hits[0]?.locator).toEqual({ chapterTitle: '第一章 概述', lineStart: 1 })
    expect(parsed.hits[0]).not.toHaveProperty('pageNumber')
    expect(parsed.hits[0]).not.toHaveProperty('filePath')
    expect(searchWorkspace).not.toHaveBeenCalled()
  })

  it('P3.1 limit 截断但 total 含未展示行；零命中合法', async () => {
    async function* units() {
      yield { label: '第一章', text: '王道计甲\n王道计乙' }
      yield { label: '第二章', text: '王道计丙' }
    }
    const d = deps({ getFingerprint: () => '', getEbookUnits: () => units() })
    const parsed = JSON.parse(await inspectIndexedContentForAgent('王道计', 2, d)) as {
      total: number
      truncated: boolean
      limit: number
      hits: unknown[]
    }
    expect(parsed.total).toBe(3)
    expect(parsed.truncated).toBe(true)
    expect(parsed.limit).toBe(2)
    expect(parsed.hits).toHaveLength(2)
    async function* empty() {
      yield { label: '空章', text: '纯正文' }
    }
    const zero = JSON.parse(
      await inspectIndexedContentForAgent('王道计', 10, deps({ getFingerprint: () => '', getEbookUnits: () => empty() })),
    ) as { total: number; hits: unknown[]; truncated: boolean }
    expect(zero).toMatchObject({ total: 0, hits: [], truncated: false })
  })

  it('P3.1 指纹路径零 iterateUnits、零工作区搜索', async () => {
    const getEbookUnits = vi.fn(() => null)
    const searchWorkspace = vi.fn()
    const d = deps({ getEbookUnits, searchWorkspace })
    await inspectIndexedContentForAgent('王道计', 10, d)
    expect(getEbookUnits).not.toHaveBeenCalled()
    expect(searchWorkspace).not.toHaveBeenCalled()
  })

  it('P3.1 PDF 无指纹拒绝且不拉 iterateUnits；markdown 不拉 iterateUnits', async () => {
    let pulls = 0
    async function* counting() {
      pulls += 1
      yield { label: '第一章', text: '王道计正文' }
    }
    // PDF 无指纹：kind 门直接拒绝，生成器函数体一次都不执行
    useActiveDocumentStore.setState({ filePath: '/book/scan.pdf' })
    const unregisterPdf = registerReaderContent({
      filePath: '/book/scan.pdf',
      getCurrentText: () => '',
      iterateUnits: counting,
    })
    try {
      await expect(
        inspectIndexedContentForAgent('王道计', 10, { getFingerprint: () => '' }),
      ).rejects.toThrow('不支持内容审计')
      expect(pulls).toBe(0)
    } finally {
      unregisterPdf()
    }
    // markdown：走 buffer，同样不拉 iterateUnits
    useActiveDocumentStore.setState({ filePath: '/doc/note.md' })
    const unregisterMd = registerReaderContent({
      filePath: '/doc/note.md',
      getCurrentText: () => '内存王道计文本',
      iterateUnits: counting,
    })
    try {
      const parsed = JSON.parse(
        await inspectIndexedContentForAgent('王道计', 10, { getFingerprint: () => '' }),
      ) as { total: number; hits: Array<{ source: string }> }
      expect(parsed.total).toBe(1)
      expect(parsed.hits[0]?.source).toBe('editor-buffer')
      expect(pulls).toBe(0)
    } finally {
      unregisterMd()
      useActiveDocumentStore.setState({ filePath: null })
    }
  })

  it('P3.1 无 iterateUnits 的 epub 形态拒绝', async () => {
    useActiveDocumentStore.setState({ filePath: '/book/demo.epub' })
    const unregister = registerReaderContent({
      filePath: '/book/demo.epub',
      getCurrentText: () => '内存王道计文本',
    })
    try {
      await expect(
        inspectIndexedContentForAgent('王道计', 10, { getFingerprint: () => '' }),
      ).rejects.toThrow('不支持内容审计')
    } finally {
      unregister()
      useActiveDocumentStore.setState({ filePath: null })
    }
  })

  it('P2.2 合并：buffer 在前、workspace 在后，total 精确相加', async () => {
    const d = deps({
      getFingerprint: () => '',
      getBufferText: vi.fn(async () => '内存王道计一行'),
      getWorkspaceRoot: () => '/ws',
      searchWorkspace: vi.fn(async () => ({
        ok: true as const,
        value: {
          total: 2,
          hits: [
            { filePath: 'a.md', lineStart: 3, line: '工作区王道计甲' },
            { filePath: 'b.md', lineStart: 1, line: '工作区王道计乙' },
          ],
        },
      })),
    })
    const parsed = JSON.parse(await inspectIndexedContentForAgent('王道计', 10, d)) as {
      total: number
      truncated: boolean
      hits: Array<{ source: string; locator: Record<string, unknown>; text: string }>
    }
    expect(parsed.total).toBe(3)
    expect(parsed.truncated).toBe(false)
    expect(parsed.hits.map((hit) => hit.source)).toEqual([
      'editor-buffer',
      'workspace-file',
      'workspace-file',
    ])
    expect(parsed.hits[1]?.locator).toEqual({ filePath: 'a.md', lineStart: 3 })
    expect(parsed.hits[1]).not.toHaveProperty('pageNumber')
  })

  it('P2.2 limit 截断展示但 total 含工作区精确数', async () => {
    const d = deps({
      getFingerprint: () => '',
      getBufferText: vi.fn(async () => '内存王道计一行'),
      getWorkspaceRoot: () => '/ws',
      searchWorkspace: vi.fn(async () => ({
        ok: true as const,
        value: {
          total: 5,
          hits: Array.from({ length: 5 }, (_, i) => ({
            filePath: `f${i}.md`,
            lineStart: 1,
            line: '工作区王道计',
          })),
        },
      })),
    })
    const parsed = JSON.parse(await inspectIndexedContentForAgent('王道计', 2, d)) as {
      total: number
      truncated: boolean
      limit: number
      hits: unknown[]
    }
    expect(parsed.total).toBe(6)
    expect(parsed.truncated).toBe(true)
    expect(parsed.limit).toBe(2)
    expect(parsed.hits).toHaveLength(2)
  })

  it('P2.2 无工作区根则行为等于 P2.1；工作区失败降级纯内存', async () => {
    const buffer = vi.fn(async () => '内存王道计一行')
    const searchWorkspace = vi.fn()
    const noRoot = deps({ getFingerprint: () => '', getBufferText: buffer, getWorkspaceRoot: () => '' })
    expect(JSON.parse(await inspectIndexedContentForAgent('王道计', 10, noRoot))).toMatchObject({
      total: 1,
    })
    expect(searchWorkspace).not.toHaveBeenCalled()
    const failing = deps({
      getFingerprint: () => '',
      getBufferText: buffer,
      getWorkspaceRoot: () => '/ws',
      searchWorkspace: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'UNKNOWN' as const, message: '炸了' },
      })),
    })
    expect(JSON.parse(await inspectIndexedContentForAgent('王道计', 10, failing))).toMatchObject({
      total: 1,
      truncated: false,
    })
  })

  it('P2.2 指纹路径零次工作区搜索', async () => {
    const searchWorkspace = vi.fn()
    const d = deps({ getWorkspaceRoot: () => '/ws', searchWorkspace })
    await inspectIndexedContentForAgent('王道计', 10, d)
    expect(searchWorkspace).not.toHaveBeenCalled()
  })

  it('默认接线：markdown 读内存、epub 拒绝、错文件拒绝', async () => {
    const callInspect = vi.fn()
    const base = { getFingerprint: () => '', callInspect }
    // markdown：编辑器内存命中
    useActiveDocumentStore.setState({ filePath: '/doc/note.md' })
    const unregisterMd = registerReaderContent({
      filePath: '/doc/note.md',
      getCurrentText: () => '# 标题\n内存王道计文本',
    })
    try {
      const parsed = JSON.parse(await inspectIndexedContentForAgent('王道计', 10, base)) as {
        total: number
        hits: Array<{ source: string; locator: Record<string, unknown> }>
      }
      expect(callInspect).not.toHaveBeenCalled()
      expect(parsed.total).toBe(1)
      expect(parsed.hits[0]?.source).toBe('editor-buffer')
      expect(parsed.hits[0]?.locator).toEqual({ lineStart: 2 })
    } finally {
      unregisterMd()
    }
    // epub：同样无指纹，但 kind 判定拒绝，不读内存
    useActiveDocumentStore.setState({ filePath: '/book/demo.epub' })
    const unregisterEpub = registerReaderContent({
      filePath: '/book/demo.epub',
      getCurrentText: () => '内存王道计文本',
    })
    try {
      await expect(inspectIndexedContentForAgent('王道计', 10, base)).rejects.toThrow('不支持内容审计')
    } finally {
      unregisterEpub()
    }
    // provider 与活动文档不是同一文件：拒绝
    useActiveDocumentStore.setState({ filePath: '/doc/other.md' })
    const unregisterStale = registerReaderContent({
      filePath: '/doc/note.md',
      getCurrentText: () => '内存王道计文本',
    })
    try {
      await expect(inspectIndexedContentForAgent('王道计', 10, base)).rejects.toThrow('不支持内容审计')
    } finally {
      unregisterStale()
      useActiveDocumentStore.setState({ filePath: null })
    }
  })
})
