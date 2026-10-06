import { describe, expect, it, vi } from 'vitest'
import { loadPdfOutlineUnits, loadPdfOutlineInfo } from '@montree/reader-core'
import type { PDFDocumentProxy } from 'pdfjs-dist'

function createPdfMock(options: {
  numPages: number
  outline?: Array<{ title: string; dest: unknown[] | string | null; items?: unknown[] }> | null
  pageIndex?: number
}): PDFDocumentProxy {
  const { numPages, outline = null, pageIndex = 0 } = options

  return {
    numPages,
    getOutline: vi.fn(async () => outline),
    getDestination: vi.fn(async (name: string) => (name === 'chapter1' ? ['ref'] : null)),
    getPageIndex: vi.fn(async () => pageIndex),
  } as unknown as PDFDocumentProxy
}

describe('loadPdfOutlineUnits', () => {
  it('无 outline 时按页生成占位单元', async () => {
    const pdf = createPdfMock({ numPages: 3, outline: null })
    const units = await loadPdfOutlineUnits(pdf)

    expect(units).toEqual([
      { label: '第 1 页', href: '1', level: 0 },
      { label: '第 2 页', href: '2', level: 0 },
      { label: '第 3 页', href: '3', level: 0 },
    ])
  })

  it('解析 outline 为 ReaderUnit 列表', async () => {
    const pdf = createPdfMock({
      numPages: 10,
      outline: [
        { title: ' 前言 ', dest: ['ref'] },
        {
          title: '第一章',
          dest: ['ref'],
          items: [{ title: '1.1 节', dest: ['ref'] }],
        },
      ],
      pageIndex: 4,
    })

    const units = await loadPdfOutlineUnits(pdf)

    expect(units).toEqual([
      { label: '前言', href: '5', level: 0 },
      { label: '第一章', href: '5', level: 0 },
      { label: '1.1 节', href: '5', level: 1 },
    ])
  })

  it('outline 解析结果为空时回退到按页单元', async () => {
    const pdf = createPdfMock({
      numPages: 2,
      outline: [{ title: '无效', dest: null }],
    })

    const result = await loadPdfOutlineInfo(pdf)

    expect(result.source).toBe('page-fallback')
    expect(result.outlineItemCount).toBe(1)
    expect(result.unresolvedItemCount).toBe(1)
    expect(result.units).toEqual([
      { label: '第 1 页', href: '1', level: 0 },
      { label: '第 2 页', href: '2', level: 0 },
    ])
  })

  it('命名目标可解析为页码', async () => {
    const pdf = createPdfMock({
      numPages: 10,
      outline: [{ title: '章一', dest: 'chapter1' }],
      pageIndex: 2,
    })

    const result = await loadPdfOutlineInfo(pdf)

    expect(result.source).toBe('embedded')
    expect(result.units).toEqual([{ label: '章一', href: '3', level: 0 }])
  })

  it('dest 为页引用对象时可解析', async () => {
    const pageRef = { num: 7, gen: 0 }
    const pdf = {
      numPages: 20,
      getOutline: vi.fn(async () => [{ title: '附录', dest: pageRef }]),
      getDestination: vi.fn(),
      getPageIndex: vi.fn(async () => 9),
    } as unknown as PDFDocumentProxy

    const result = await loadPdfOutlineInfo(pdf)

    expect(result.units).toEqual([{ label: '附录', href: '10', level: 0 }])
  })

  it('部分书签解析失败时保留统计', async () => {
    const pdf = createPdfMock({
      numPages: 5,
      outline: [
        { title: '有效', dest: ['ref'] },
        { title: '无效', dest: null },
      ],
      pageIndex: 0,
    })

    const result = await loadPdfOutlineInfo(pdf)

    expect(result.source).toBe('embedded')
    expect(result.outlineItemCount).toBe(2)
    expect(result.resolvedItemCount).toBe(1)
    expect(result.unresolvedItemCount).toBe(1)
    expect(result.units).toHaveLength(1)
  })
})

describe('formatPdfOutlineNotice', () => {
  it('嵌入目录部分失败时提示', async () => {
    const { formatPdfOutlineNotice } = await import('@montree/reader-core')
    const notice = formatPdfOutlineNotice(
      {
        units: [],
        source: 'embedded',
        embeddedItemCount: 1,
        outlineItemCount: 2,
        resolvedItemCount: 1,
        unresolvedItemCount: 1,
      },
      false,
    )
    expect(notice).toContain('1 条嵌入书签未能解析')
  })
})
