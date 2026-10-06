import { describe, expect, it, vi } from 'vitest'
import type { PdfOcrPageCache } from '@montree/contracts'
import { loadPersistedOcrPageCaches } from './pdf-ocr-page-hydrate'

const cacheFor = (page: number): PdfOcrPageCache => ({
  fileFingerprint: 'fp|1',
  page,
  pageWidth: 612,
  pageHeight: 792,
  ocrScale: 2,
  words: [{ text: '甲', bbox: { x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 } }],
  createdAt: '2026-01-01',
})

describe('loadPersistedOcrPageCaches', () => {
  it('混合书有缓存也会载（不分扫描/混合，有缓存就载）', async () => {
    const listPages = vi.fn(async () => [2])
    const getPage = vi.fn(async (page: number) => cacheFor(page))
    const hydrated = await loadPersistedOcrPageCaches('fp|1', { listPages, getPage })
    expect(listPages).toHaveBeenCalledTimes(1)
    expect(getPage).toHaveBeenCalledWith(2)
    expect(hydrated[2]?.words).toHaveLength(1)
  })

  it('扫描书多页全载（回归）', async () => {
    const hydrated = await loadPersistedOcrPageCaches('fp|1', {
      listPages: async () => [1, 2, 3],
      getPage: async (page: number) => cacheFor(page),
    })
    expect(Object.keys(hydrated).map(Number).sort()).toEqual([1, 2, 3])
  })

  it('页码不一致与失败条目丢弃', async () => {
    const hydrated = await loadPersistedOcrPageCaches('fp|1', {
      listPages: async () => [1, 2, 99],
      getPage: async (page: number) => {
        if (page === 2) throw new Error('io')
        if (page === 99) return { ...cacheFor(7) }
        return cacheFor(page)
      },
    })
    expect(Object.keys(hydrated).map(Number)).toEqual([1])
  })

  it('无指纹/无缓存返回空（不调依赖）', async () => {
    const listPages = vi.fn(async () => [1])
    const getPage = vi.fn(async (_page: number) => cacheFor(1))
    await expect(loadPersistedOcrPageCaches('', { listPages, getPage })).resolves.toEqual({})
    expect(listPages).not.toHaveBeenCalled()
    await expect(
      loadPersistedOcrPageCaches('fp|1', { listPages: async () => [], getPage }),
    ).resolves.toEqual({})
    expect(getPage).not.toHaveBeenCalled()
  })

  it('list 失败返回空（打开不受影响）', async () => {
    await expect(
      loadPersistedOcrPageCaches('fp|1', {
        listPages: async () => {
          throw new Error('io')
        },
        getPage: async (page: number) => cacheFor(page),
      }),
    ).resolves.toEqual({})
  })
})
