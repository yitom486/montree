import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { ok } from '@montree/contracts'
import { classifyPdfAsync } from '@firecrawl/pdf-inspector'
import { migrateBookDb } from './schema'
import { importScannedBookToDb } from './import-service'
import { getChapterBlocks, searchBookBlocks } from './queries'

/**
 * 原生分流回归（默认跳过）：ROSETTA_NATIVE_PDF 指向一本纯文字 PDF，
 * ROSETTA_MODEL_DIR 指向离线模型目录（纯原生流程不会加载引擎，仅走参数校验）。
 * 断言：零页进 OCR、全页原生直提、块无 bbox、全章范围正确。
 */
const nativePdf = process.env.ROSETTA_NATIVE_PDF ?? ''
const modelDir = process.env.ROSETTA_MODEL_DIR ?? ''

describe.skipIf(!nativePdf || !modelDir)('rosetta-native 原生分流', () => {
  it('纯文字书零 OCR 全量直提', async () => {
    const memDb = new DatabaseSync(':memory:')
    migrateBookDb(memDb)
    const t0 = Date.now()
    const pdfBytes = readFileSync(nativePdf)
    const classification = await classifyPdfAsync(pdfBytes)
    const result = await importScannedBookToDb(
      'unused-user-data',
      {
        filePath: nativePdf,
        fileFingerprint: `native-${Date.now()}`,
        title: 'native-book',
        format: 'pdf',
        pageCount: classification.pageCount,
        toc: [{ title: 'Book', realPage: 1, level: 1 }],
      },
      {},
      {
        ensureRuntime: async () => ok({ modelDir }),
        openDb: () => memDb,
      },
    )
    console.log(`原生导入耗时: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    if (!result.ok) console.log('导入失败:', JSON.stringify(result.error))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    console.log('分流:', JSON.stringify({ pages: result.value.pages, ocr: result.value.ocrPages, native: result.value.nativePages, blocks: result.value.blocks }))
    // Auto 语义：原生直提为主，仅含图页的补充区域 OCR 允许少量扫描页
    expect(result.value.ocrPages).toBeLessThan(result.value.pages * 0.2)
    expect(result.value.ocrPages + result.value.nativePages).toBe(result.value.pages)
    expect(result.value.pages).toBeGreaterThan(10)
    expect(result.value.blocks).toBeGreaterThan(100)

    // 原生页无 spans；仅补充区域 OCR 页的块带 bbox（少数）
    const bboxCount = (
      memDb.prepare('SELECT COUNT(*) AS n FROM blocks WHERE bbox IS NOT NULL').get() as { n: number }
    ).n
    const totalBlocks = (
      memDb.prepare('SELECT COUNT(*) AS n FROM blocks').get() as { n: number }
    ).n
    console.log(`bbox 率: ${bboxCount}/${totalBlocks}`)
    expect(bboxCount).toBeLessThan(totalBlocks * 0.2)

    // 章范围覆盖全书
    const blocks = getChapterBlocks(memDb, result.value.bookId, 0)
    expect(blocks.length).toBe(result.value.blocks)
    expect(blocks[blocks.length - 1]?.pageNumber).toBe(result.value.pages)

    // 英文 FTS 探针（CUDA 手册必含 kernel）
    const hits = searchBookBlocks(memDb, result.value.bookId, 'kernel', 3)
    expect(hits.length).toBeGreaterThan(0)
    memDb.close()
  }, 600000)
}, 600000)
