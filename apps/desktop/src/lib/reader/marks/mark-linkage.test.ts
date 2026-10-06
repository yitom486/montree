import { describe, expect, it, vi } from 'vitest'
import type { ReadingMark } from '@montree/contracts'
import {
  findMarkByOverlayerKey,
  overlayerKeyForMark,
  planReveal,
  revealExcerptOf,
  runRevealPlan,
  type RevealAdapter,
  type RevealStep,
} from './mark-linkage'

/**
 * 联动决策层集成测试：fixture 形状与三端真实写入一致
 *（Foliate handleSaveAnnotation / PdfViewer V1+V2 / WebDocViewer / 老数据），
 * 锁定"精确→粗粒度→文本兜底"策略顺序、失败穿透与结构化 miss 上报。
 * 本模块是纯决策层：不断言任何 DOM/view 行为，只断言规划与执行语义。
 */

let seq = 0
function baseMark(overrides: Partial<ReadingMark> & Pick<ReadingMark, 'id' | 'anchor'>): ReadingMark {
  seq += 1
  return {
    filePath: '/books/fixture',
    fileFingerprint: 'fp',
    kind: 'highlight',
    createdAt: 1000 + seq,
    updatedAt: 1000 + seq,
    ...overrides,
  }
}

const CFI_A = 'epubcfi(/6/10!/4/2)'
const CFI_B = 'epubcfi(/6/10!/4/6)'

function epubFull(id = 'epub-1'): ReadingMark {
  return baseMark({
    id,
    filePath: '/books/fixture.epub',
    anchor: {
      format: 'epub',
      cfi: CFI_A,
      cfiRange: CFI_A,
      href: 'editor-note.xhtml',
      selectedText: '锚点原文',
    },
    excerpt: '关于我所看到的一切，我谈论了很多。',
  })
}

function recordingAdapter(
  behavior: (step: RevealStep) => boolean | Promise<boolean>,
): RevealAdapter & { calls: RevealStep[] } {
  const calls: RevealStep[] = []
  return {
    calls,
    tryStep: (step) => {
      calls.push(step)
      return behavior(step)
    },
  }
}

describe('planReveal', () => {
  it('EPUB 完整锚点：cfi（cfiRange 优先）→ excerpt', () => {
    expect(planReveal(epubFull())).toEqual([
      { type: 'cfi', cfi: CFI_A },
      { type: 'excerpt', text: '关于我所看到的一切，我谈论了很多。' },
    ])
  })

  it('EPUB 老锚点（仅 cfi、无摘录）：只有 cfi 一步', () => {
    const mark = baseMark({
      id: 'epub-old',
      filePath: '/books/old.epub',
      anchor: { format: 'epub', cfi: CFI_B },
    })
    expect(planReveal(mark)).toEqual([{ type: 'cfi', cfi: CFI_B }])
  })

  it('EPUB 无 cfi 又无摘录：空计划（真·不可定位，报 empty-plan）', () => {
    const mark = baseMark({
      id: 'epub-broken',
      anchor: { format: 'epub', cfi: '' } as unknown as ReadingMark['anchor'],
    })
    expect(planReveal(mark)).toEqual([])
  })

  it('MOBI 完整锚点：cfi → chapter → excerpt', () => {
    const mark = baseMark({
      id: 'mobi-1',
      filePath: '/books/fixture.mobi',
      anchor: { format: 'mobi', chapterId: 'mobi-ch2', cfi: CFI_A, cfiRange: CFI_A },
      excerpt: '正文摘录',
    })
    expect(planReveal(mark)).toEqual([
      { type: 'cfi', cfi: CFI_A },
      { type: 'mobi-chapter', chapterId: 'mobi-ch2' },
      { type: 'excerpt', text: '正文摘录' },
    ])
  })

  it('MOBI 老锚点（仅 chapterId）：chapter → excerpt', () => {
    const mark = baseMark({
      id: 'mobi-old',
      filePath: '/books/old.mobi',
      anchor: { format: 'mobi', chapterId: 'mobi-ch1' },
      excerpt: '旧摘录',
    })
    expect(planReveal(mark)).toEqual([
      { type: 'mobi-chapter', chapterId: 'mobi-ch1' },
      { type: 'excerpt', text: '旧摘录' },
    ])
  })

  it('PDF V2（quads）：page → excerpt（页内描框是适配器的事）', () => {
    const mark = baseMark({
      id: 'pdf-1',
      filePath: '/books/fixture.pdf',
      anchor: {
        format: 'pdf',
        page: 19,
        version: 2,
        quads: [],
        selectedText: '虚拟化（virtualization）',
      },
      excerpt: '虚拟化（virtualization）、并发与持久性。',
    })
    expect(planReveal(mark)).toEqual([
      { type: 'pdf-page', page: 19 },
      { type: 'excerpt', text: '虚拟化（virtualization）、并发与持久性。' },
    ])
  })

  it('PDF 裸页签（无任何文字）：只有 page 一步', () => {
    const mark = baseMark({
      id: 'pdf-bare',
      filePath: '/books/fixture.pdf',
      anchor: { format: 'pdf', page: 3 },
    })
    expect(planReveal(mark)).toEqual([{ type: 'pdf-page', page: 3 }])
  })

  it('WEB：url（+headingId）→ excerpt；无 heading 时只有 url', () => {
    const full = baseMark({
      id: 'web-1',
      filePath: 'https://example.com/doc',
      anchor: { format: 'web', url: 'https://example.com/doc', headingId: 'sec-2' },
      excerpt: '页面摘录',
    })
    expect(planReveal(full)).toEqual([
      { type: 'web-url', url: 'https://example.com/doc', headingId: 'sec-2' },
      { type: 'excerpt', text: '页面摘录' },
    ])
    const bare = baseMark({
      id: 'web-bare',
      filePath: 'https://example.com/other',
      anchor: { format: 'web', url: 'https://example.com/other' },
    })
    expect(planReveal(bare)).toEqual([
      { type: 'web-url', url: 'https://example.com/other', headingId: undefined },
    ])
  })

  it('书签同样可规划（锚点有效即有策略）', () => {
    const mark = baseMark({
      id: 'bm-1',
      filePath: '/books/fixture.epub',
      kind: 'bookmark',
      anchor: { format: 'epub', cfi: CFI_A, href: 'editor-note.xhtml' },
    })
    expect(planReveal(mark)).toEqual([{ type: 'cfi', cfi: CFI_A }])
  })
})

describe('revealExcerptOf', () => {
  it('空白摘录视为无摘录', () => {
    const mark = baseMark({
      id: 'blank',
      anchor: { format: 'pdf', page: 1 },
      excerpt: '   \n  ',
    })
    expect(revealExcerptOf(mark)).toBeNull()
    expect(planReveal(mark)).toEqual([{ type: 'pdf-page', page: 1 }])
  })

  it('无卡片正文时回落锚点原文', () => {
    const mark = baseMark({
      id: 'anchor-text',
      anchor: { format: 'pdf', page: 2, selectedText: '  锚点原文  ' },
    })
    expect(revealExcerptOf(mark)).toBe('锚点原文')
  })
})

describe('runRevealPlan', () => {
  it('首步成功即停，不执行后续兜底', async () => {
    const tryStep = vi.fn(() => true)
    const result = await runRevealPlan(epubFull(), { tryStep })
    expect(result.ok).toBe(true)
    expect(tryStep).toHaveBeenCalledTimes(1)
    if (result.ok) expect(result.step).toEqual({ type: 'cfi', cfi: CFI_A })
  })

  it('精确步失败则穿透到兜底，并记录完整 attempts', async () => {
    const adapter = recordingAdapter((step) => step.type === 'excerpt')
    const result = await runRevealPlan(epubFull(), adapter)
    expect(adapter.calls.map((s) => s.type)).toEqual(['cfi', 'excerpt'])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.step.type).toBe('excerpt')
      expect(result.attempts).toHaveLength(2)
      expect(result.attempts[0]).toMatchObject({ ok: false })
    }
  })

  it('MOBI 陈旧 cfi 失败后可落到 chapter（现状 Foliate 到 cfi 即停，本规划允许穿透）', async () => {
    const mark = baseMark({
      id: 'mobi-stale',
      filePath: '/books/fixture.mobi',
      anchor: { format: 'mobi', chapterId: 'mobi-ch2', cfi: 'epubcfi(/6/99!/4/4)' },
      excerpt: '摘录',
    })
    const adapter = recordingAdapter((step) => step.type === 'mobi-chapter')
    const result = await runRevealPlan(mark, adapter)
    expect(adapter.calls.map((s) => s.type)).toEqual(['cfi', 'mobi-chapter'])
    expect(result.ok).toBe(true)
  })

  it('全败返回结构化 miss（markId + tried，不静默）', async () => {
    const adapter = recordingAdapter(() => false)
    const result = await runRevealPlan(epubFull(), adapter)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.miss).toEqual({ reason: 'all-steps-failed', markId: 'epub-1' })
      expect(result.attempts).toHaveLength(2)
    }
  })

  it('空计划返回 empty-plan miss', async () => {
    const mark = baseMark({
      id: 'broken',
      anchor: { format: 'epub', cfi: '' } as unknown as ReadingMark['anchor'],
    })
    const tryStep = vi.fn(() => true)
    const result = await runRevealPlan(mark, { tryStep })
    expect(result).toEqual({
      ok: false,
      attempts: [],
      miss: { reason: 'empty-plan', markId: 'broken' },
    })
    expect(tryStep).not.toHaveBeenCalled()
  })

  it('适配器抛错记入本步并继续兜底（reveal 永不炸调用方）', async () => {
    const adapter = recordingAdapter((step) => {
      if (step.type === 'cfi') throw new Error('view 已销毁')
      return true
    })
    const result = await runRevealPlan(epubFull(), adapter)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.step.type).toBe('excerpt')
      expect(result.attempts[0]).toMatchObject({ ok: false, error: 'view 已销毁' })
    }
  })

  it('支持异步适配器', async () => {
    const result = await runRevealPlan(epubFull(), {
      tryStep: (step) => Promise.resolve(step.type === 'cfi'),
    })
    expect(result.ok).toBe(true)
  })
})

describe('overlayer key', () => {
  it('epub/mobi 取 cfiRange 优先；bookmark 无键；pdf/web 无键', () => {
    expect(overlayerKeyForMark(epubFull())).toBe(CFI_A)
    const mobi = baseMark({
      id: 'mobi-1',
      filePath: '/books/f.mobi',
      anchor: { format: 'mobi', chapterId: 'c1', cfi: 'old-cfi', cfiRange: 'new-range' },
    })
    expect(overlayerKeyForMark(mobi)).toBe('new-range')
    const bookmark = baseMark({
      id: 'bm',
      filePath: '/books/f.epub',
      kind: 'bookmark',
      anchor: { format: 'epub', cfi: CFI_A },
    })
    expect(overlayerKeyForMark(bookmark)).toBeNull()
    const pdf = baseMark({ id: 'pdf', filePath: '/b.pdf', anchor: { format: 'pdf', page: 1 } })
    expect(overlayerKeyForMark(pdf)).toBeNull()
  })

  it('findMarkByOverlayerKey 往返 + 未知 key 返回 undefined', () => {
    const a = epubFull('a')
    const b = epubFull('b')
    expect(findMarkByOverlayerKey([a, b], CFI_A)?.id).toBe('a')
    expect(findMarkByOverlayerKey([a, b], 'epubcfi(/6/404)')).toBeUndefined()
    expect(findMarkByOverlayerKey([], CFI_A)).toBeUndefined()
  })
})
