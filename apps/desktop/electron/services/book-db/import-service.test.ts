import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { ok } from '@montree/contracts'
import type { PdfOcrPageCache } from '@montree/contracts'
import { migrateBookDb } from './schema'
import { countBookBlocks } from './queries'
import { isRosettaImportActive, importScannedBookToDb, formatRosettaImportDoneMessage, ROSETTA_CLEAN_VERSION, type RosettaImportDeps } from './import-service'

// 最小 fake：3 页书，每页回固定标题行 + 正文行 + span
type FakeLoader = NonNullable<RosettaImportDeps['loadInspector']>
function fakeLoader(calls: string[]): FakeLoader {
  const loader = async () => ({
    OcrMode: { Auto: 'Auto' },
    processPdfWithOcr: async (_data: unknown, options: { pageNumbers?: number[] }) => {
      const pageNumbers = options.pageNumbers ?? [1, 2, 3]
      calls.push(`ocr:${pageNumbers.join(',')}`)
      return {
        pageCount: 3,
        pagesRoutedToOcr: [1, 2, 3],
        pages: pageNumbers.map((page) => ({
          pageNumber: page,
          markdown: `# P${page} 标题\n\nP${page} 正文第一段`,
          spans: [
            { text: `P${page} 标题`, confidence: 0.9, x: 1, y: 2, width: 3, height: 4 },
            { text: `P${page} 正文第一段`, confidence: 0.8, x: 1, y: 2, width: 3, height: 4 },
          ],
        })),
      }
    },
  })
  return loader as unknown as FakeLoader
}

function openMemDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  migrateBookDb(db)
  return db
}

const memDeps = (calls: string[], memDb: DatabaseSync) => ({
  loadInspector: fakeLoader(calls),
  ensureRuntime: async () => ok({ modelDir: 'models' }),
  readPdf: async () => Buffer.from('pdf'),
  openDb: () => memDb,
})

const basePayload = {
  filePath: 'D:/book/fake.pdf',
  fileFingerprint: 'fake-fp-1',
  title: '假书',
  format: 'pdf',
  pageCount: 3,
  toc: [
    { title: '第一章', realPage: 1, level: 1 },
    { title: '第二章', realPage: 3, level: 1 },
  ],
}

describe('importScannedBookToDb', () => {
  it('全量导入：单次调用→入库→阶段进度', async () => {
    const calls: string[] = []
    const progress: [number, number, string][] = []
    const memDb = openMemDb()
    const result = await importScannedBookToDb(
      'unused-user-data',
      basePayload,
      { onProgress: (done, total, phase) => progress.push([done, total, phase]) },
      memDeps(calls, memDb),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({ chapters: 2, blocks: 6, pages: 3, ocrPages: 3, nativePages: 0 })
    // 小书 single chunk：同一次调用完成
    expect(calls).toEqual(['ocr:1,2,3'])
    expect(progress).toEqual([
      [0, 3, 'ocr'],
      [3, 3, 'ocr'],
      [3, 3, 'import'],
    ])
    expect(countBookBlocks(memDb, result.value.bookId)).toBe(6)
    expect(isRosettaImportActive()).toBe(false)
    memDb.close()
  })

  it('大书分大块：100 页两块，进度 50 步进', async () => {
    const calls: string[] = []
    const progress: [number, number, string][] = []
    const memDb = openMemDb()
    const bigLoader = (async () => ({
      OcrMode: { Auto: 'Auto' },
      processPdfWithOcr: async (_data: unknown, options: { pageNumbers?: number[] }) => {
        const pageNumbers = options.pageNumbers ?? []
        calls.push(`ocr:${pageNumbers[0]}-${pageNumbers[pageNumbers.length - 1]}`)
        return {
          pagesRoutedToOcr: [...pageNumbers],
          pages: pageNumbers.map((page) => ({
            pageNumber: page,
            markdown: `P${page} 正文`,
            spans: [{ text: `P${page} 正文`, confidence: 0.9, x: 1, y: 2, width: 3, height: 4 }],
          })),
        }
      },
    })) as unknown as FakeLoader
    const result = await importScannedBookToDb(
      'unused-user-data',
      { ...basePayload, pageCount: 100, toc: [{ title: '全书', realPage: 1, level: 1 }] },
      { onProgress: (done, total, phase) => progress.push([done, total, phase]) },
      {
        loadInspector: bigLoader,
        ensureRuntime: async () => ok({ modelDir: 'models' }),
        readPdf: async () => Buffer.from('pdf'),
        openDb: () => memDb,
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(calls).toEqual(['ocr:1-50', 'ocr:51-100'])
    expect(progress).toEqual([
      [0, 100, 'ocr'],
      [50, 100, 'ocr'],
      [100, 100, 'ocr'],
      [100, 100, 'import'],
    ])
    expect(result.value).toMatchObject({ pages: 100, ocrPages: 100, nativePages: 0 })
    expect(countBookBlocks(memDb, result.value.bookId)).toBe(100)
    memDb.close()
  })

  it('缺页数直接拒绝', async () => {
    const calls: string[] = []
    const result = await importScannedBookToDb(
      'unused-user-data',
      { ...basePayload, pageCount: 0 },
      {},
      memDeps(calls, openMemDb()),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_ARGUMENT')
    expect(calls).toEqual([])
  })

  it('P1.1 混合路由：扫描页 ocr、文字页 native，版本落盘', async () => {
    const memDb = openMemDb()
    const mixedLoader = (async () => ({
      OcrMode: { Auto: 'Auto' },
      processPdfWithOcr: async (_data: unknown, options: { pageNumbers?: number[] }) => {
        const pageNumbers = options.pageNumbers ?? [1, 2, 3]
        return {
          pagesRoutedToOcr: [1, 3],
          pages: pageNumbers.map((page) =>
            page === 2
              ? { pageNumber: page, markdown: `# P${page} 标题\n\nP${page} 原生正文`, spans: [] }
              : {
                  pageNumber: page,
                  markdown: `# P${page} 标题\n\nP${page} 正文第一段`,
                  spans: [
                    { text: `P${page} 正文第一段`, confidence: 0.9, x: 1, y: 2, width: 3, height: 4 },
                  ],
                },
          ),
        }
      },
    })) as unknown as FakeLoader
    const result = await importScannedBookToDb('unused-user-data', basePayload, undefined, {
      loadInspector: mixedLoader,
      ensureRuntime: async () => ok({ modelDir: 'models' }),
      readPdf: async () => Buffer.from('pdf'),
      openDb: () => memDb,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      memDb.close()
      return
    }
    expect(result.value).toMatchObject({ ocrPages: 2, nativePages: 1 })
    const rows = memDb
      .prepare('SELECT page_number AS p, source AS s, extract_version AS v FROM blocks ORDER BY id')
      .all() as { p: number; s: string; v: string }[]
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.v).toBe(ROSETTA_CLEAN_VERSION)
      expect(row.s).toBe(row.p === 2 ? 'native' : 'ocr')
    }
    memDb.close()
  })

  it('P1.2 preferNative：零运行时调用、无模型目录、ocrPages=0、全块 native', async () => {
    const memDb = openMemDb()
    let runtimeCalls = 0
    const seenOptions: Record<string, unknown>[] = []
    const nativeLoader = (async () => ({
      OcrMode: { Auto: 'Auto', Off: 'Off' },
      processPdfWithOcr: async (_data: unknown, options: Record<string, unknown>) => {
        seenOptions.push({ ...options })
        const pageNumbers = (options.pageNumbers as number[] | undefined) ?? [1, 2, 3]
        return {
          pagesRoutedToOcr: [],
          pages: pageNumbers.map((page) => ({
            pageNumber: page,
            markdown: `# P${page} 标题\n\nP${page} 原生正文`,
            spans: [],
          })),
        }
      },
    })) as unknown as FakeLoader
    const result = await importScannedBookToDb(
      'unused-user-data',
      { ...basePayload, preferNative: true },
      undefined,
      {
        loadInspector: nativeLoader,
        ensureRuntime: async () => {
          runtimeCalls += 1
          return ok({ modelDir: 'models' })
        },
        readPdf: async () => Buffer.from('pdf'),
        openDb: () => memDb,
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) {
      memDb.close()
      return
    }
    expect(runtimeCalls).toBe(0)
    expect(seenOptions).toHaveLength(1)
    expect(seenOptions[0]?.mode).toBe('Off')
    expect(seenOptions[0]?.modelDirectory).toBeUndefined()
    expect(result.value).toMatchObject({ ocrPages: 0, nativePages: 3, ocrSuggestedPages: [] })
    const rows = memDb
      .prepare('SELECT source AS s, extract_version AS v FROM blocks')
      .all() as { s: string; v: string }[]
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.s).toBe('native')
      expect(row.v).toBe(ROSETTA_CLEAN_VERSION)
    }
    memDb.close()
  })

  it('P1.2 缺省仍走 OCR 运行时（回归）', async () => {
    const memDb = openMemDb()
    let runtimeCalls = 0
    const result = await importScannedBookToDb(
      'unused-user-data',
      basePayload,
      undefined,
      {
        ...memDeps([], memDb),
        ensureRuntime: async () => {
          runtimeCalls += 1
          return ok({ modelDir: 'models' })
        },
      },
    )
    expect(result.ok).toBe(true)
    expect(runtimeCalls).toBeGreaterThan(0)
    memDb.close()
  })

  it('P1.2 直提全轮无字明确报错，不静默建空索引', async () => {
    const memDb = openMemDb()
    let runtimeCalls = 0
    const emptyLoader = (async () => ({
      OcrMode: { Auto: 'Auto', Off: 'Off' },
      processPdfWithOcr: async (_data: unknown, options: { pageNumbers?: number[] }) => {
        const pageNumbers = options?.pageNumbers ?? [1, 2, 3]
        return {
          pagesRoutedToOcr: [],
          pages: pageNumbers.map((page) => ({ pageNumber: page, markdown: '  ', spans: [] })),
        }
      },
    })) as unknown as FakeLoader
    const result = await importScannedBookToDb(
      'unused-user-data',
      { ...basePayload, preferNative: true },
      undefined,
      {
        loadInspector: emptyLoader,
        ensureRuntime: async () => {
          runtimeCalls += 1
          return ok({ modelDir: 'models' })
        },
        readPdf: async () => Buffer.from('pdf'),
        openDb: () => memDb,
      },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('原生文字')
    expect(runtimeCalls).toBe(0)
    expect(
      (memDb.prepare('SELECT COUNT(*) AS n FROM blocks').get() as { n: number }).n,
    ).toBe(0)
    memDb.close()
  })

  it('取消后重进只做剩余块（续跑）', async () => {
    const calls: string[] = []
    const memDb = openMemDb()
    const bigLoader = (async () => ({
      OcrMode: { Auto: 'Auto' },
      processPdfWithOcr: async (_data: unknown, options: { pageNumbers?: number[] }) => {
        const pageNumbers = options.pageNumbers ?? []
        calls.push(`ocr:${pageNumbers[0]}-${pageNumbers[pageNumbers.length - 1]}`)
        return {
          pagesRoutedToOcr: [...pageNumbers],
          pages: pageNumbers.map((page) => ({
            pageNumber: page,
            markdown: `P${page} 正文`,
            spans: [{ text: `P${page} 正文`, confidence: 0.9, x: 1, y: 2, width: 3, height: 4 }],
          })),
        }
      },
    })) as unknown as FakeLoader
    const deps = {
      loadInspector: bigLoader,
      ensureRuntime: async () => ok({ modelDir: 'models' }),
      readPdf: async () => Buffer.from('pdf'),
      openDb: () => memDb,
    }
    const payload100 = {
      ...basePayload,
      pageCount: 100,
      toc: [{ title: '全书', realPage: 1, level: 1 }],
    }
    // 第一轮：做完第 1 块后取消（shouldCancel 第 3 次调用起生效）
    let checks = 0
    const cancelled = await importScannedBookToDb('unused-user-data', payload100, {
      shouldCancel: () => {
        checks += 1
        return checks >= 3
      },
    }, deps)
    expect(cancelled.ok).toBe(false)
    if (!cancelled.ok) {
      expect(cancelled.error.code).toBe('CANCELLED')
      expect(cancelled.error.message).toContain('50/100')
    }
    expect(calls).toEqual(['ocr:1-50'])

    // 第二轮：跳过已入库块，只做 51-100
    const progress: [number, number, string][] = []
    const resumed = await importScannedBookToDb(
      'unused-user-data',
      payload100,
      { onProgress: (done, total, phase) => progress.push([done, total, phase]) },
      deps,
    )
    expect(resumed.ok).toBe(true)
    if (!resumed.ok) return
    expect(calls).toEqual(['ocr:1-50', 'ocr:51-100'])
    expect(progress[0]).toEqual([50, 100, 'ocr'])
    expect(progress).toContainEqual([100, 100, 'import'])
    expect(resumed.value).toMatchObject({ pages: 100, ocrPages: 100, nativePages: 0 })
    expect(countBookBlocks(memDb, resumed.value.bookId)).toBe(100)
    // 章内序号连续无断号重号
    const indexes = (
      memDb.prepare('SELECT block_index AS b FROM blocks ORDER BY block_index').all() as { b: number }[]
    ).map((r) => r.b)
    expect(indexes).toEqual(indexes.map((_, i) => i))
    memDb.close()
  })

  it('混合路由：仅扫描页计入 ocrPages，其余原生直提', async () => {
    const calls: string[] = []
    const memDb = openMemDb()
    const mixedLoader = (async () => ({
      OcrMode: { Auto: 'Auto' },
      processPdfWithOcr: async () => ({
        pageCount: 3,
        pagesRoutedToOcr: [2],
        pages: [1, 2, 3].map((page) => ({
          pageNumber: page,
          markdown: `# P${page}\n\n正文`,
          // 原生页无 spans（引擎没跑），扫描页有
          spans: page === 2 ? [{ text: '正文', confidence: 0.9, x: 1, y: 2, width: 3, height: 4 }] : [],
        })),
      }),
    })) as unknown as FakeLoader
    const result = await importScannedBookToDb(
      'unused-user-data',
      basePayload,
      {},
      {
        loadInspector: mixedLoader,
        ensureRuntime: async () => ok({ modelDir: 'models' }),
        readPdf: async () => Buffer.from('pdf'),
        openDb: () => memDb,
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({ pages: 3, ocrPages: 1, nativePages: 2 })
    // 原生页块无 bbox（引擎没跑就没有坐标），定位回退到页
    const nativeBlocks = memDb
      .prepare('SELECT COUNT(*) AS n FROM blocks WHERE page_number = 1 AND bbox IS NULL')
      .get() as { n: number }
    expect(nativeBlocks.n).toBeGreaterThan(0)
    memDb.close()
  })

  it('缺指纹直接拒绝，不碰引擎', async () => {
    const calls: string[] = []
    const result = await importScannedBookToDb(
      'unused-user-data',
      { ...basePayload, fileFingerprint: '  ' },
      {},
      memDeps(calls, openMemDb()),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_ARGUMENT')
    expect(calls).toEqual([])
  })

  it('取消标记在首批前生效，不调 OCR', async () => {
    const calls: string[] = []
    let cancelled = false
    const result = await importScannedBookToDb(
      'unused-user-data',
      basePayload,
      { shouldCancel: () => cancelled },
      {
        ...memDeps(calls, openMemDb()),
        readPdf: async () => {
          cancelled = true
          return Buffer.from('pdf')
        },
      },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CANCELLED')
    // 取消在 readPdf 后即闩锁，一次 napi 调用都没发生
    expect(calls).toEqual([])
    expect(isRosettaImportActive()).toBe(false)
  })

  it('并发第二个导入被拒（引擎串行）', async () => {
    const calls: string[] = []
    const first = importScannedBookToDb('unused-user-data', basePayload, {}, memDeps(calls, openMemDb()))
    const second = await importScannedBookToDb(
      'unused-user-data',
      { ...basePayload, fileFingerprint: 'fake-fp-2' },
      {},
      memDeps(calls, openMemDb()),
    )
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error.code).toBe('INVALID_STATE')
    await first
    expect(isRosettaImportActive()).toBe(false)
  })

  it('P1.3 preferNative 差页只标记不 OCR，完成文案带建议数', async () => {    const memDb = openMemDb()
    let runtimeCalls = 0
    const seenModes: unknown[] = []
    const nativeLoader = (async () => ({
      OcrMode: { Auto: 'Auto', Off: 'Off' },
      processPdfWithOcr: async (_data: unknown, options: Record<string, unknown>) => {
        seenModes.push(options.mode)
        return {
          pagesRoutedToOcr: [],
          pages: [
            { pageNumber: 1, markdown: '流水线技术通过重叠执行指令提升吞吐率', spans: [] },
            { pageNumber: 2, markdown: '', spans: [] },
            { pageNumber: 3, markdown: '(cid:11)(cid:12)(cid:13)(cid:14)', spans: [] },
          ],
        }
      },
    })) as unknown as FakeLoader
    const result = await importScannedBookToDb(
      'unused-user-data',
      { ...basePayload, preferNative: true },
      undefined,
      {
        loadInspector: nativeLoader,
        ensureRuntime: async () => {
          runtimeCalls += 1
          return ok({ modelDir: 'models' })
        },
        readPdf: async () => Buffer.from('pdf'),
        openDb: () => memDb,
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) {
      memDb.close()
      return
    }
    expect(runtimeCalls).toBe(0)
    expect(seenModes).toEqual(['Off'])
    expect(result.value.ocrSuggestedPages).toEqual([2, 3])
    expect(result.value.ocrPages).toBe(0)
    expect(
      formatRosettaImportDoneMessage(result.value),
    ).toContain('2 页原生质量较差可手动识别')
    memDb.close()
  })
})

describe('U1 导入写页词缓存', () => {
  const sizes612x792 = async (_data: Buffer, pages: readonly number[]) =>
    new Map(pages.map((page) => [page, { width: 612, height: 792 }]))

  it('OCR chunk 成功后对应页有 page cache（spans→words，不碰 blocks.bbox）', async () => {
    const calls: string[] = []
    const memDb = openMemDb()
    const written: PdfOcrPageCache[] = []
    const result = await importScannedBookToDb(
      'unused-user-data',
      basePayload,
      {},
      {
        ...memDeps(calls, memDb),
        readPageSizes: sizes612x792,
        writePageCache: async (cache) => {
          written.push(cache)
        },
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) {
      memDb.close()
      return
    }
    // 3 页全路由且有 spans → 3 份缓存，字段对齐单页识别
    expect(written.map((cache) => cache.page).sort()).toEqual([1, 2, 3])
    for (const cache of written) {
      expect(cache.fileFingerprint).toBe('fake-fp-1')
      expect(cache.pageWidth).toBe(612)
      expect(cache.pageHeight).toBe(792)
      expect(cache.ocrScale).toBe(2)
      expect(typeof cache.createdAt).toBe('string')
      // 词来自 spans 文本（`P${page} 标题` → P1/标/题…），非 blocks.bbox 反推
      const pageTag = `P${cache.page}`
      expect(cache.words.slice(0, 3).map((word) => word.text)).toEqual([pageTag, '标', '题'])
      expect(cache.words.map((word) => word.text).join('')).toBe(
        `${pageTag}标题${pageTag}正文第一段`,
      )
      for (const word of cache.words) {
        expect(word.bbox.x0).toBeGreaterThanOrEqual(0)
        expect(word.bbox.x1).toBeLessThanOrEqual(1)
        expect(word.bbox.y0).toBeGreaterThanOrEqual(0)
        expect(word.bbox.y1).toBeLessThanOrEqual(1)
        expect(word.bbox.x1).toBeGreaterThan(word.bbox.x0)
      }
    }
    memDb.close()
  })

  it('原生直提页不写空 cache（混合路由只有 OCR 页落盘）', async () => {
    const memDb = openMemDb()
    const written: PdfOcrPageCache[] = []
    const mixedLoader = (async () => ({
      OcrMode: { Auto: 'Auto' },
      processPdfWithOcr: async (_data: unknown, options: { pageNumbers?: number[] }) => {
        const pageNumbers = options.pageNumbers ?? [1, 2, 3]
        return {
          pagesRoutedToOcr: [1, 3],
          pages: pageNumbers.map((page) =>
            page === 2
              ? { pageNumber: page, markdown: `# P${page} 标题\n\nP${page} 原生正文`, spans: [] }
              : {
                  pageNumber: page,
                  markdown: `# P${page} 标题\n\nP${page} 正文第一段`,
                  spans: [
                    { text: `P${page} 正文第一段`, confidence: 0.9, x: 1, y: 2, width: 3, height: 4 },
                  ],
                },
          ),
        }
      },
    })) as unknown as FakeLoader
    const result = await importScannedBookToDb(
      'unused-user-data',
      basePayload,
      {},
      {
        loadInspector: mixedLoader,
        ensureRuntime: async () => ok({ modelDir: 'models' }),
        readPdf: async () => Buffer.from('pdf'),
        openDb: () => memDb,
        readPageSizes: sizes612x792,
        writePageCache: async (cache) => {
          written.push(cache)
        },
      },
    )
    expect(result.ok).toBe(true)
    expect(written.map((cache) => cache.page).sort()).toEqual([1, 3])
    expect(written.every((cache) => cache.words.length > 0)).toBe(true)
    memDb.close()
  })

  it('尺寸缺失则不写 cache，导入仍成功（停手路径）', async () => {
    const calls: string[] = []
    const memDb = openMemDb()
    const written: PdfOcrPageCache[] = []
    const result = await importScannedBookToDb(
      'unused-user-data',
      basePayload,
      {},
      {
        ...memDeps(calls, memDb),
        readPageSizes: async () => new Map(),
        writePageCache: async (cache) => {
          written.push(cache)
        },
      },
    )
    expect(result.ok).toBe(true)
    expect(written).toEqual([])
    memDb.close()
  })

  it('缓存写入失败不回滚 SQLite（记日志即可）', async () => {
    const calls: string[] = []
    const memDb = openMemDb()
    const result = await importScannedBookToDb(
      'unused-user-data',
      basePayload,
      {},
      {
        ...memDeps(calls, memDb),
        readPageSizes: sizes612x792,
        writePageCache: async () => {
          throw new Error('disk full')
        },
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) {
      memDb.close()
      return
    }
    expect(countBookBlocks(memDb, result.value.bookId)).toBe(6)
    memDb.close()
  })

  it('V2：chunk 内跨页已证方形戳印不写进缓存（正文保留）', async () => {
    const calls: string[] = []
    const memDb = openMemDb()
    const written: PdfOcrPageCache[] = []
    // 三页同位置同文本的方形 span ⇒ 几何发现为水印；每页正文 span 各不同 ⇒ 保留
    const stampLoader = (async () => ({
      OcrMode: { Auto: 'Auto' },
      processPdfWithOcr: async (_data: unknown, options: { pageNumbers?: number[] }) => {
        const pageNumbers = options.pageNumbers ?? [1, 2, 3]
        calls.push(`ocr:${pageNumbers.join(',')}`)
        return {
          pagesRoutedToOcr: [...pageNumbers],
          pages: pageNumbers.map((page) => ({
            pageNumber: page,
            markdown: `Body${page} 正文`,
            spans: [
              { text: `Body${page} 正文`, confidence: 0.9, x: 81, y: 600, width: 200, height: 12 },
              { text: 'STAMP', confidence: 0.95, x: 200, y: 300, width: 100, height: 100 },
            ],
          })),
        }
      },
    })) as unknown as FakeLoader
    const result = await importScannedBookToDb(
      'unused-user-data',
      basePayload,
      {},
      {
        loadInspector: stampLoader,
        ensureRuntime: async () => ok({ modelDir: 'models' }),
        readPdf: async () => Buffer.from('pdf'),
        openDb: () => memDb,
        readPageSizes: sizes612x792,
        writePageCache: async (cache) => {
          written.push(cache)
        },
      },
    )
    expect(result.ok).toBe(true)
    expect(written).toHaveLength(3)
    for (const cache of written) {
      const text = cache.words.map((word) => word.text).join('')
      expect(text).toContain('正文')
      expect(text).not.toContain('STAMP')
    }
    memDb.close()
  })
})

describe('U2 forceRebuild', () => {
  it('缺省仍续跑：第二次不调 OCR、不碰清除注入点', async () => {
    const calls: string[] = []
    const wiped: string[] = []
    const memDb = openMemDb()
    const deps = {
      ...memDeps(calls, memDb),
      closeBookDb: () => {
        wiped.push('close')
        return true
      },
      removeBookDbDir: async () => {
        wiped.push('rm')
      },
      deletePageCaches: async () => {
        wiped.push('pages')
      },
      deleteTocCache: async () => {
        wiped.push('toc')
      },
    }
    const first = await importScannedBookToDb('unused-user-data', basePayload, {}, deps)
    expect(first.ok).toBe(true)
    const second = await importScannedBookToDb('unused-user-data', basePayload, {}, deps)
    expect(second.ok).toBe(true)
    expect(calls).toEqual(['ocr:1,2,3'])
    expect(wiped).toEqual([])
    memDb.close()
  })

  it('forceRebuild=true：清旧库后全量重跑 OCR（注入点按序全调）', async () => {
    const calls: string[] = []
    const wiped: string[] = []
    // 真实语义：删目录后 openDb 拿到的是空库（每轮新 :memory: 库）
    const dbs: DatabaseSync[] = []
    const deps = {
      loadInspector: fakeLoader(calls),
      ensureRuntime: async () => ok({ modelDir: 'models' }),
      readPdf: async () => Buffer.from('pdf'),
      openDb: () => {
        const db = openMemDb()
        dbs.push(db)
        return db
      },
      closeBookDb: () => {
        wiped.push('close')
        return true
      },
      removeBookDbDir: async () => {
        wiped.push('rm')
      },
      deletePageCaches: async (fp: string) => {
        wiped.push(`pages:${fp}`)
      },
      deleteTocCache: async (fp: string) => {
        wiped.push(`toc:${fp}`)
      },
    }
    const first = await importScannedBookToDb('unused-user-data', basePayload, {}, deps)
    expect(first.ok).toBe(true)
    const rebuilt = await importScannedBookToDb(
      'unused-user-data',
      { ...basePayload, forceRebuild: true },
      {},
      deps,
    )
    expect(rebuilt.ok).toBe(true)
    // 第二次再次全量 OCR（非续跑跳过），清除四步按序执行
    expect(calls).toEqual(['ocr:1,2,3', 'ocr:1,2,3'])
    expect(wiped).toEqual(['close', 'rm', 'pages:fake-fp-1', 'toc:fake-fp-1'])
    if (rebuilt.ok) expect(countBookBlocks(dbs[1], rebuilt.value.bookId)).toBe(6)
    dbs.forEach((db) => db.close())
  })

  it('删库失败则中止，不开跑 OCR', async () => {
    const calls: string[] = []
    const memDb = openMemDb()
    const result = await importScannedBookToDb(
      'unused-user-data',
      { ...basePayload, fileFingerprint: 'fake-fp-del-fail', forceRebuild: true },
      {},
      {
        ...memDeps(calls, memDb),
        removeBookDbDir: async () => {
          throw new Error('EPERM')
        },
      },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('FILE_WRITE_ERROR')
      expect(result.error.message).toContain('未开始重新识别')
    }
    expect(calls).toEqual([])
    memDb.close()
  })
})
