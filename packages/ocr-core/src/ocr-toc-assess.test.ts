import { describe, expect, it } from 'vitest'
import type { PdfOcrTocCache } from '@montree/contracts'
import { assessPdfOcrTocCache } from './ocr-toc-assess'

const PAGE_COUNT = 340

function entry(title: string, printedPage: number, level = 1, source?: 'pipe' | 'geo' | 'ai' | 'manual' | 'read' | 'paired' | 'backfilled') {
  return { title, printedPage, level, ...(source ? { source } : {}) }
}

function unitsFor(list: { title: string; printedPage: number; level: number }[], offset = 12) {
  return list.map((entry) => ({
    label: entry.title,
    href: String(entry.printedPage + offset),
    level: entry.level,
  }))
}

function makeCache(overrides: Partial<PdfOcrTocCache> = {}): PdfOcrTocCache {
  const entries = [
    entry('2.2运算方法和运算电路', 32, 1, 'pipe'),
    entry('2.2.1基本运算部件', 32, 2, 'pipe'),
  ]
  return {
    fileFingerprint: 'fp-1',
    tocPageRange: [8, 12],
    pageOffset: 12,
    entries,
    units: unitsFor(entries),
    createdAt: new Date().toISOString(),
    extractorVersion: 7,
    origin: 'auto',
    stats: { requestedPages: 5, processedPages: 5, acceptedEntries: 2 },
    ...overrides,
  }
}

describe('assessPdfOcrTocCache', () => {
  it('自动识别正常缓存 → suspect（可恢复阅读，须提示确认）', () => {
    const result = assessPdfOcrTocCache(makeCache(), { pageCount: PAGE_COUNT })
    expect(result.status).toBe('suspect')
    expect(result.repairedUnits).toBeUndefined()
    expect(result.reasons[0]).toContain('未经人工确认')
  })

  it('用户确认的短目录 → usable（不受条数规则影响）', () => {
    const short = [entry('第1章 概述', 1, 0, 'manual')]
    const result = assessPdfOcrTocCache(
      makeCache({ entries: short, units: unitsFor(short), origin: 'reviewed', stats: undefined }),
      { pageCount: PAGE_COUNT },
    )
    expect(result.status).toBe('usable')
    expect(result.reasons).toEqual([])
  })

  it('旧版缓存（无来源记录）→ legacy（可查看，不删除）', () => {
    const { origin: _o, stats: _s, extractorVersion: _v, ...legacy } = makeCache()
    void _o
    void _s
    void _v
    const result = assessPdfOcrTocCache(legacy as PdfOcrTocCache, { pageCount: PAGE_COUNT })
    expect(result.status).toBe('legacy')
    expect(result.reasons[0]).toContain('旧版')
  })

  it('条数/缺章/跳号永不判 invalid', () => {
    // 无章节点、页码跳跃的自动缓存也只是 suspect
    const jumped = [
      entry('1.5常见问题', 18, 1, 'paired'),
      entry('2.1数制与编码', 22, 1, 'paired'),
      entry('3.1存储器概述', 78, 1, 'paired'),
    ]
    const result = assessPdfOcrTocCache(
      makeCache({ entries: jumped, units: unitsFor(jumped) }),
      { pageCount: PAGE_COUNT },
    )
    expect(result.status).toBe('suspect')
  })

  it.each([
    ['空缓存', { entries: [], units: [] }],
    ['空标题条目', { entries: [entry('', 5)], units: [{ label: '', href: '17', level: 1 }] }],
    ['零页码条目', { entries: [entry('正文混入', 0)], units: [{ label: '正文混入', href: '12', level: 1 }] }],
    [
      '页码越界',
      {
        entries: [entry('超大', 500)],
        units: [{ label: '超大', href: '512', level: 1 }],
      },
    ],
    ['目录页范围越界', { tocPageRange: [8, 400] as [number, number] }],
    ['目录页范围倒置', { tocPageRange: [12, 8] as [number, number] }],
  ])('结构损坏 → invalid：%s', (_name, overrides) => {
    const base = makeCache(overrides as Partial<PdfOcrTocCache>)
    const result = assessPdfOcrTocCache(base, { pageCount: PAGE_COUNT })
    expect(result.status).toBe('invalid')
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('null/非对象 → invalid', () => {
    expect(assessPdfOcrTocCache(null, { pageCount: PAGE_COUNT }).status).toBe('invalid')
    expect(
      assessPdfOcrTocCache(undefined, { pageCount: PAGE_COUNT }).status,
    ).toBe('invalid')
  })

  it('entries 有效但 units 缺失 → 安全修复，不判 invalid', () => {
    const entries = [entry('2.2运算方法和运算电路', 32, 1, 'pipe')]
    const result = assessPdfOcrTocCache(
      makeCache({ entries, units: [], origin: 'reviewed', stats: undefined }),
      { pageCount: PAGE_COUNT },
    )
    expect(result.status).toBe('usable')
    expect(result.repairedUnits).toEqual([{ label: '2.2运算方法和运算电路', href: '44', level: 1 }])
  })

  it('entries 有效但 units 失配（长度/页码）→ 重建', () => {
    const entries = [
      entry('2.2运算方法和运算电路', 32, 1, 'pipe'),
      entry('2.2.1基本运算部件', 32, 2, 'pipe'),
    ]
    const result = assessPdfOcrTocCache(
      makeCache({
        entries,
        units: [{ label: '2.2运算方法和运算电路', href: '44', level: 1 }],
        origin: 'reviewed',
        stats: undefined,
      }),
      { pageCount: PAGE_COUNT },
    )
    expect(result.status).toBe('usable')
    expect(result.repairedUnits).toHaveLength(2)
  })

  it('units 一致时不返回 repairedUnits', () => {
    const result = assessPdfOcrTocCache(
      makeCache({ origin: 'reviewed', stats: undefined }),
      { pageCount: PAGE_COUNT },
    )
    expect(result.status).toBe('usable')
    expect(result.repairedUnits).toBeUndefined()
  })

  it.each([
    ['范围非数组', { tocPageRange: '8-12' }],
    ['范围数字', { tocPageRange: 8 }],
    ['范围 null', { tocPageRange: null }],
    ['范围长度 1', { tocPageRange: [8] }],
    ['范围长度 3', { tocPageRange: [8, 12, 15] }],
    ['范围含小数', { tocPageRange: [8, 12.5] }],
    ['负偏移', { pageOffset: -1 }],
    ['小数偏移', { pageOffset: 1.5 }],
    ['NaN 偏移', { pageOffset: NaN }],
    ['字符串偏移', { pageOffset: '12' }],
    ['null 条目', { entries: [null] }],
    ['数字条目', { entries: [42] }],
    ['字符串条目', { entries: ['x'] }],
    ['条目缺标题', { entries: [{ printedPage: 5, level: 1 }] }],
    ['条目缺页码', { entries: [{ title: 'x', level: 1 }] }],
    ['units 非数组', { units: 'x' }],
    ['units 含 null', { units: [null] }],
    ['unit 字段缺失', { units: [{ label: 'a' }] }],
  ])('损坏数据不抛异常 → invalid 或安全修复：%s', (_name, overrides) => {
    const base = makeCache(overrides as Partial<PdfOcrTocCache>)
    let result: { status: string } | undefined
    expect(() => {
      result = assessPdfOcrTocCache(base, { pageCount: PAGE_COUNT })
    }).not.toThrow()
    expect(['invalid', 'legacy', 'suspect', 'usable']).toContain(result?.status)
  })

  it('损坏 units + 有效 entries → 修复而非 invalid', () => {
    const entries = [entry('2.2运算方法和运算电路', 32, 1, 'pipe')]
    for (const units of [[null], 'x', [{ label: 'a' }]]) {
      const result = assessPdfOcrTocCache(
        makeCache({ entries, units: units as never, origin: 'reviewed', stats: undefined }),
        { pageCount: PAGE_COUNT },
      )
      expect(result.status).toBe('usable')
      expect(result.repairedUnits).toEqual([
        { label: '2.2运算方法和运算电路', href: '44', level: 1 },
      ])
    }
  })

  it('origin 缺失或非法 → 精确 legacy（不看 stats 与版本）', () => {
    for (const origin of [undefined, null, 42, 'x', {}, 'AUTO']) {
      const result = assessPdfOcrTocCache(
        makeCache({ origin: origin as never, stats: { requestedPages: 5, processedPages: 5, acceptedEntries: 2 } }),
        { pageCount: PAGE_COUNT },
      )
      expect(result.status).toBe('legacy')
      expect(result.reasons[0]).toBe('旧版缓存缺少来源记录，建议打开校正目录核对后保存确认')
    }
  })

  it('origin=auto 且 stats 缺失/损坏 → 精确 suspect，不编造数字', () => {
    const missing = assessPdfOcrTocCache(makeCache({ stats: undefined }), {
      pageCount: PAGE_COUNT,
    })
    expect(missing.status).toBe('suspect')
    expect(missing.reasons).toEqual(['自动识别结果未经人工确认（共 2 条）'])

    for (const stats of ['x', 42, null, { acceptedEntries: '多', droppedPool: 'x' }, {}]) {
      const result = assessPdfOcrTocCache(
        makeCache({ stats: stats as never }),
        { pageCount: PAGE_COUNT },
      )
      expect(result.status).toBe('suspect')
      expect(result.reasons).toEqual(['自动识别结果未经人工确认（共 2 条）'])
    }
  })

  it('origin=auto 且 stats 完好 → suspect 文案带过滤数', () => {
    const result = assessPdfOcrTocCache(
      makeCache({ stats: { requestedPages: 5, processedPages: 5, acceptedEntries: 2, droppedPool: 3, droppedLines: 4 } }),
      { pageCount: PAGE_COUNT },
    )
    expect(result.status).toBe('suspect')
    expect(result.reasons).toEqual(['自动识别结果未经人工确认（共 2 条，过滤 7 处）'])
  })

  it('origin=reviewed 且 stats 缺失/损坏 → 精确 usable', () => {
    for (const stats of [undefined, 'x', null, { acceptedEntries: '多' }]) {
      const result = assessPdfOcrTocCache(
        makeCache({ origin: 'reviewed', stats: stats as never }),
        { pageCount: PAGE_COUNT },
      )
      expect(result.status).toBe('usable')
      expect(result.reasons).toEqual([])
    }
  })

  it('顶层非对象 → invalid 不抛异常', () => {
    for (const bad of [42, 'x', [], true]) {
      expect(() => assessPdfOcrTocCache(bad as never, { pageCount: PAGE_COUNT })).not.toThrow()
      expect(assessPdfOcrTocCache(bad as never, { pageCount: PAGE_COUNT }).status).toBe('invalid')
    }
  })
})
