import { afterEach, describe, expect, it } from 'vitest'
import { registerReaderContent } from './reader-content-registry'
import { useReaderNavigationStore } from '@/stores/reader-navigation-store'
import { EMPTY_READER_NAV } from '@montree/reader-core'
import { buildPresentResult, stripHostileHtmlHead } from './present-result-builder'
import { parsePresentResult } from '@montree/contracts'

function setupBook() {
  useReaderNavigationStore.setState({
    ready: true,
    filePath: '/b.epub',
    format: 'epub',
    units: [
      { label: '第一章', href: '1', level: 0 },
      { label: '第二章', href: '2', level: 0 },
    ],
  })
  return registerReaderContent({
    filePath: '/b.epub',
    getCurrentText: () => '',
    getUnitByIndex: async (index: number) => ({
      label: ['第一章', '第二章'][index]!,
      text: ['一章正文含论点甲', '二章正文含论点乙'][index]!,
    }),
  })
}

afterEach(() => {
  useReaderNavigationStore.setState({
    ready: false,
    filePath: null,
    format: null,
    units: [],
    nav: EMPTY_READER_NAV,
    navIntent: null,
  })
})

describe('buildPresentResult chapter-comparison', () => {
  it('验证摘录并组装稳定信封', async () => {
    const dispose = setupBook()
    try {
      const json = await buildPresentResult({
        kind: 'chapter-comparison',
        title: '两章比较',
        chapters: [
          { key: 'c1', label: '第一章', flatIndex: 0 },
          { key: 'c2', label: '第二章', flatIndex: 1 },
        ],
        items: [
          { dimension: '论点', chapterKey: 'c1', excerpt: '论点甲' },
          { dimension: '论点', chapterKey: 'c2', excerpt: '查无此句' },
        ],
      })
      const parsed = parsePresentResult(json)
      expect(parsed?.kind).toBe('chapter-comparison')
      if (parsed?.kind !== 'chapter-comparison') return
      expect(parsed.items[0]?.verified).toBe(true)
      expect(parsed.items[0]?.flatIndex).toBe(0)
      expect(parsed.items[1]?.verified).toBe(false)
      expect(parsed.items[1]?.flatIndex).toBeUndefined()
      // 同一输入重放得同一 id
      const again = await buildPresentResult({
        kind: 'chapter-comparison',
        title: '两章比较',
        chapters: [
          { key: 'c1', label: '第一章', flatIndex: 0 },
          { key: 'c2', label: '第二章', flatIndex: 1 },
        ],
        items: [
          { dimension: '论点', chapterKey: 'c1', excerpt: '论点甲' },
          { dimension: '论点', chapterKey: 'c2', excerpt: '查无此句' },
        ],
      })
      expect(JSON.parse(again).id).toBe(parsed.id)
    } finally {
      dispose()
    }
  })

  it('未知章节与野指针整单拒绝，不伪造', async () => {
    const dispose = setupBook()
    try {
      await expect(
        buildPresentResult({
          kind: 'chapter-comparison',
          title: 't',
          chapters: [
            { key: 'c1', label: '第一章', flatIndex: 0 },
            { key: 'gx', label: '鬼章', flatIndex: 9 },
          ],
          items: [],
        }),
      ).rejects.toThrow()
      await expect(
        buildPresentResult({
          kind: 'chapter-comparison',
          title: 't',
          chapters: [
            { key: 'c1', label: '第一章', flatIndex: 0 },
            { key: 'c2', label: '第二章', flatIndex: 1 },
          ],
          items: [{ dimension: 'd', chapterKey: 'ghost' }],
        }),
      ).rejects.toThrow()
      await expect(
        buildPresentResult({ kind: 'chapter-comparison', title: 't', chapters: [{ key: 'c1', label: '第一章' }], items: [] }),
      ).rejects.toThrow()
    } finally {
      dispose()
    }
  })

  it('无文档时报错而不编造章节', async () => {
    await expect(
      buildPresentResult({
        kind: 'chapter-comparison',
        title: 't',
        chapters: [
          { key: 'c1', label: '第一章', flatIndex: 0 },
          { key: 'c2', label: '第二章', flatIndex: 1 },
        ],
        items: [],
      }),
    ).rejects.toThrow()
  })

  it('构建中切换文档拒绝混合结果（P1：来源调用开始固定）', async () => {
    let release!: () => void
    let started!: () => void
    const pending = new Promise<void>((r) => { release = r })
    const entered = new Promise<void>((r) => { started = r })
    const units = [{ label: 'One' }, { label: 'Two' }]
    const disposeA = registerReaderContent({
      filePath: '/A.epub',
      getUnits: () => units,
      getCurrentText: () => '',
      getUnitByIndex: async (i) => {
        started()
        await pending
        return { label: units[i]!.label, text: 'excerpt from A' }
      },
    })
    const job = buildPresentResult({
      kind: 'chapter-comparison',
      title: 'mixed',
      chapters: [
        { key: 'a', flatIndex: 0 },
        { key: 'b', flatIndex: 1 },
      ],
      items: [
        { dimension: 'D', chapterKey: 'a', excerpt: 'excerpt from A' },
        { dimension: 'D', chapterKey: 'b', excerpt: 'excerpt from B' },
      ],
    })
    await entered
    const disposeB = registerReaderContent({
      filePath: '/B.epub',
      getUnits: () => units,
      getCurrentText: () => '',
      getUnitByIndex: async (i) => ({ label: units[i]!.label, text: 'excerpt from B' }),
    })
    try {
      release()
      await expect(job).rejects.toThrow(/切换|来源|文档/)
    } finally {
      disposeB()
      disposeA()
    }
  })

  it('同路径重注册新 provider 也拒绝旧任务（U0：对象身份非路径）', async () => {
    let release!: () => void
    let started!: () => void
    const pending = new Promise<void>((r) => { release = r })
    const entered = new Promise<void>((r) => { started = r })
    const units = [{ label: 'One' }, { label: 'Two' }]
    const disposeA = registerReaderContent({
      filePath: '/A.epub',
      getUnits: () => units,
      getCurrentText: () => '',
      getUnitByIndex: async (i) => {
        started()
        await pending
        return { label: units[i]!.label, text: 'original' }
      },
    })
    const job = buildPresentResult({
      kind: 'chapter-comparison',
      title: 'review',
      chapters: [
        { key: 'a', flatIndex: 0 },
        { key: 'b', flatIndex: 1 },
      ],
      items: [{ dimension: 'D', chapterKey: 'a', excerpt: 'original' }],
    })
    await entered
    const disposeB = registerReaderContent({
      filePath: '/A.epub',
      getUnits: () => units,
      getCurrentText: () => '',
      getUnitByIndex: async (i) => ({ label: units[i]!.label, text: 'new document content' }),
    })
    try {
      release()
      await expect(job).rejects.toThrow(/切换|来源|文档/)
    } finally {
      disposeB()
      disposeA()
    }
  })

  it('A→B→A 回到原路径仍拒绝旧任务（U0）', async () => {
    let release!: () => void
    let started!: () => void
    const pending = new Promise<void>((r) => { release = r })
    const entered = new Promise<void>((r) => { started = r })
    const units = [{ label: 'One' }, { label: 'Two' }]
    const textOf = (tag: string) => async (i: number) => ({ label: units[i]!.label, text: tag })
    const disposeA1 = registerReaderContent({
      filePath: '/A.epub',
      getUnits: () => units,
      getCurrentText: () => '',
      getUnitByIndex: async (i) => {
        started()
        await pending
        return textOf('a1')(i)
      },
    })
    const job = buildPresentResult({
      kind: 'chapter-comparison',
      title: 'review',
      chapters: [
        { key: 'a', flatIndex: 0 },
        { key: 'b', flatIndex: 1 },
      ],
      items: [{ dimension: 'D', chapterKey: 'a', excerpt: 'a1' }],
    })
    await entered
    const disposeB = registerReaderContent({
      filePath: '/B.epub',
      getUnits: () => units,
      getCurrentText: () => '',
      getUnitByIndex: textOf('b'),
    })
    const disposeA2 = registerReaderContent({
      filePath: '/A.epub',
      getUnits: () => units,
      getCurrentText: () => '',
      getUnitByIndex: textOf('a2'),
    })
    try {
      release()
      await expect(job).rejects.toThrow(/切换|来源|文档/)
    } finally {
      disposeA2()
      disposeB()
      disposeA1()
    }
  })

  it.each([
    ['目录换序', () => {
      useReaderNavigationStore.setState({
        filePath: '/A.epub',
        format: 'epub',
        units: [
          { label: 'Two', href: 'two', level: 0 },
          { label: 'One', href: 'one', level: 0 },
        ],
      })
    }],
    ['ready 失效', () => {
      useReaderNavigationStore.setState({ ready: false })
    }],
  ])('无 getUnits 时%s拒绝旧任务（U0：同一目录规则）', async (_name, mutate) => {
    let release!: () => void
    let started!: () => void
    const pending = new Promise<void>((r) => { release = r })
    const entered = new Promise<void>((r) => { started = r })
    const nav = useReaderNavigationStore.getState()
    nav.beginSession('/A.epub', 'epub')
    nav.setUnits([
      { label: 'One', href: 'one', level: 0 },
      { label: 'Two', href: 'two', level: 0 },
    ])
    nav.setReady(true)
    const disposeA = registerReaderContent({
      filePath: '/A.epub',
      getCurrentText: () => '',
      getUnitByIndex: async (i: number) => {
        started()
        await pending
        return { label: ['One', 'Two'][i]!, text: 'original' }
      },
    })
    const job = buildPresentResult({
      kind: 'chapter-comparison',
      title: 'review',
      chapters: [
        { key: 'a', flatIndex: 0 },
        { key: 'b', flatIndex: 1 },
      ],
      items: [{ dimension: 'D', chapterKey: 'a', excerpt: 'original' }],
    })
    await entered
    mutate()
    try {
      release()
      await expect(job).rejects.toThrow(/切换|来源|目录|文档/)
    } finally {
      disposeA()
      useReaderNavigationStore.setState({ filePath: null, units: [], ready: false })
    }
  })
})

describe('buildPresentResult html-artifact', () => {
  it('组装并剥离 base 与模型 CSP', async () => {
    const json = await buildPresentResult({
      kind: 'html-artifact',
      title: '计数器',
      html: '<base href="https://evil.test/"><meta http-equiv="Content-Security-Policy" content="script-src *"><button>按</button>',
    })
    const parsed = parsePresentResult(json)
    expect(parsed?.kind).toBe('html-artifact')
    if (parsed?.kind !== 'html-artifact') return
    expect(parsed.html).not.toContain('<base')
    expect(parsed.html).not.toContain('Content-Security-Policy')
    expect(parsed.html).toContain('<button>按</button>')
  })

  it('超限与空源码拒绝', async () => {
    await expect(buildPresentResult({ kind: 'html-artifact', title: 't', html: '   ' })).rejects.toThrow()
    await expect(
      buildPresentResult({ kind: 'html-artifact', title: 't', html: 'x'.repeat(97 * 1024) }),
    ).rejects.toThrow('96KiB')
  })

  it('未知 kind 拒绝', async () => {
    await expect(buildPresentResult({ kind: 'json-render', title: 't' })).rejects.toThrow()
  })
})

describe('stripHostileHtmlHead', () => {
  it('大小写与引号变体均剥离，正文保留', () => {
    expect(stripHostileHtmlHead('<BASE HREF="/">ok')).toBe('ok')
    expect(stripHostileHtmlHead("<meta http-equiv='content-security-policy' content='x'>ok")).toBe('ok')
    expect(stripHostileHtmlHead('<meta http-equiv="refresh" content="0;url=data:text/html,hi">ok')).toBe('ok')
    expect(stripHostileHtmlHead('<meta name="viewport" content="width=1">ok')).toBe('ok')
  })
})
