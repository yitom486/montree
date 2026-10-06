import { describe, expect, it } from 'vitest'
import {
  assertPageOcrAllowed,
  mergeOcrPageCaches,
  shouldAutoOcrViewportPage,
} from './pdf-page-auto-ocr'
import type { PdfOcrPageCache } from '@montree/contracts'

const cacheFor = (page: number): PdfOcrPageCache => ({
  fileFingerprint: 'fp|1',
  page,
  pageWidth: 541,
  pageHeight: 754,
  ocrScale: 2,
  words: [{ text: '甲', bbox: { x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 } }],
  createdAt: '2026-01-01',
})

describe('shouldAutoOcrViewportPage', () => {
  const base = { reportedMissing: true, isCurrentPage: true, hasCache: false, importRunning: false }
  it('无缓存、未导入、当前页、已报缺层 → 应认（不依赖文档级扫描标志）', () => {
    expect(shouldAutoOcrViewportPage(base)).toBe(true)
  })
  it('邻页缺层 → 不应认（翻到再认，禁窗口并行 OCR）', () => {
    expect(shouldAutoOcrViewportPage({ ...base, isCurrentPage: false })).toBe(false)
  })
  it('未上报缺层 → 不应认', () => {
    expect(shouldAutoOcrViewportPage({ ...base, reportedMissing: false })).toBe(false)
  })
  it('已有缓存 → 不应认', () => {
    expect(shouldAutoOcrViewportPage({ ...base, hasCache: true })).toBe(false)
  })
  it('导入中 → 不应认（禁第二趟）', () => {
    expect(shouldAutoOcrViewportPage({ ...base, importRunning: true })).toBe(false)
  })
})

describe('assertPageOcrAllowed', () => {
  it('空闲放行、导入中抛全书识别中文案', () => {
    expect(() => assertPageOcrAllowed({ importRunning: false, page: 3 })).not.toThrow()
    expect(() => assertPageOcrAllowed({ importRunning: true, page: 3 })).toThrowError(
      /全书识别进行中/,
    )
  })
})

describe('mergeOcrPageCaches', () => {
  it('按页合并：旧页保留、新页并入、同页后写赢', () => {
    const prev = { 1: cacheFor(1), 2: cacheFor(2) }
    const fresh = { 2: { ...cacheFor(2), ocrScale: 2.5 }, 3: cacheFor(3) }
    const merged = mergeOcrPageCaches(prev, fresh)
    expect(Object.keys(merged).map(Number).sort()).toEqual([1, 2, 3])
    // 用户已认的第 1 页不丢；新落盘的第 2 页以后写为准
    expect(merged[1]).toBe(prev[1])
    expect(merged[2]?.ocrScale).toBe(2.5)
    expect(merged[3]).toBe(fresh[3])
  })
})
