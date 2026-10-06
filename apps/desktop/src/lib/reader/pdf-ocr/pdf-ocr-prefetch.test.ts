import { describe, expect, it } from 'vitest'
import type { ReaderUnit } from '@montree/reader-core'
import {
  orderPagesForPrefetch,
  resolvePdfOcrChapterRange,
  resolvePdfOcrPrefetchPages,
} from './pdf-ocr-prefetch'

function pageUnit(page: number, level = 0): ReaderUnit {
  return { href: String(page), label: `第 ${page} 页`, level }
}

describe('pdf-ocr-prefetch', () => {
  it('无章节目录时退回视口邻近页', () => {
    expect(resolvePdfOcrChapterRange(10, 100, [], false)).toEqual({ start: 7, end: 13 })
  })

  it('按章范围预取并跳过已缓存页', () => {
    const units: ReaderUnit[] = [
      pageUnit(1, 0),
      pageUnit(10, 0),
      pageUnit(20, 0),
      pageUnit(30, 0),
    ]
    expect(resolvePdfOcrChapterRange(15, 100, units, true)).toEqual({ start: 10, end: 19 })
    expect(
      resolvePdfOcrPrefetchPages(15, 100, units, true, {
        cachedPages: new Set([15, 16]),
      }),
    ).toEqual([14, 17, 13, 18, 12, 19, 11, 10])
  })

  it('当前页优先排序', () => {
    expect(orderPagesForPrefetch(5, [3, 4, 5, 6, 7])).toEqual([5, 6, 4, 7, 3])
  })
})
