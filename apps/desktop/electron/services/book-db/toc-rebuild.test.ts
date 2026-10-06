import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { computeTocSignature } from '@montree/reader-core'
import { migrateBookDb } from './schema'
import {
  getTocEntry,
  getTocRangeBlocks,
  listTocEntries,
  searchBookBlocks,
} from './queries'
import { normalizeRebuildTocEntries, rebuildTocIndex, type RebuildTocEntryInput } from './toc-rebuild'

const PAGE_COUNT = 340

/**
 * 仿真 204 条已确认目录：level 0=8（部分）、level 1=42（章）、level 2=154（节）。
 * 8 部分聚在卷首（页 1..8），42 章从页 10 起每 7 页一章，
 * 每章 3~4 节（前 28 章 4 节、后 14 章 3 节），页序严格递增。
 */
function buildSimulatedToc(): RebuildTocEntryInput[] {
  const toc: RebuildTocEntryInput[] = []
  for (let p = 1; p <= 8; p += 1) {
    toc.push({ title: `第${p}部分 卷首语${p}`, realPage: p, level: 0 })
  }
  const chapterStart = (n: number): number => 10 + (n - 1) * 7
  let sectionBudget = 154
  for (let n = 1; n <= 42; n += 1) {
    const start = chapterStart(n)
    toc.push({ title: `第${n}章 章名${n}`, realPage: start, level: 1 })
    const remainingChapters = 42 - n + 1
    // 前 28 章每章 4 节，后 14 章每章 3 节：28*4+14*3=154
    const want = n <= 28 ? 4 : 3
    const count = Math.min(want, sectionBudget - (remainingChapters - 1) * 3)
    for (let m = 1; m <= count; m += 1) {
      toc.push({ title: `${n}.${m} 小节${n}-${m}`, realPage: start + (m - 1) * 2, level: 2 })
    }
    sectionBudget -= count
  }
  const sorted = [...toc].sort((a, b) => a.realPage - b.realPage || a.level - b.level)
  expect(toc).toHaveLength(204)
  expect(toc.filter((e) => e.level === 0)).toHaveLength(8)
  expect(toc.filter((e) => e.level === 1)).toHaveLength(42)
  expect(toc.filter((e) => e.level === 2)).toHaveLength(154)
  expect(sorted[sorted.length - 1]?.realPage ?? 0).toBeLessThanOrEqual(PAGE_COUNT)
  return toc
}

/** 旧库：340 个“第 N 页”占位章 + 覆盖全页的块 + completed_pages='[]' */
function seedLegacyDb(db: DatabaseSync): { bookId: number; blockIds: number[]; contents: string[] } {
  const now = Date.now()
  const bookId = Number(
    db
      .prepare(
        `INSERT INTO books
          (fingerprint, title, source_path, format, page_count, page_offset, clean_version, completed_pages, toc_signature, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '', ?, ?)`,
      )
      .run(
        'legacy-compass-book',
        '旧罗盘库',
        'D:/book/legacy.pdf',
        'pdf',
        PAGE_COUNT,
        12,
        'ocr-watermark-v3',
        now,
        now,
      ).lastInsertRowid,
  )
  const insertChapter = db.prepare(
    `INSERT INTO chapters (book_id, chapter_index, title, level, start_page, end_page)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const chapterIdByPage = new Map<number, number>()
  for (let page = 1; page <= PAGE_COUNT; page += 1) {
    const result = insertChapter.run(bookId, page - 1, `第 ${page} 页`, 1, page, page)
    chapterIdByPage.set(page, Number(result.lastInsertRowid))
  }
  const insertBlock = db.prepare(
    `INSERT INTO blocks
      (book_id, chapter_id, chapter_index, block_index, type, content, page_number, bbox, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const blockIds: number[] = []
  const contents: string[] = []
  for (let page = 1; page <= PAGE_COUNT; page += 1) {
    for (let k = 0; k < 3; k += 1) {
      const content = `第${page}页正文块${k} 流水线测试文本${page}-${k}`
      const result = insertBlock.run(
        bookId,
        chapterIdByPage.get(page) ?? null,
        page - 1,
        k,
        'paragraph',
        content,
        page,
        null,
        null,
      )
      blockIds.push(Number(result.lastInsertRowid))
      contents.push(content)
    }
  }
  return { bookId, blockIds, contents }
}

describe('toc-rebuild 罗盘目录重建（纯本地，不做 OCR）', () => {
  it('重建后块数文本不变、FTS 仍可查、completed_pages 修复为完整', () => {
    const db = new DatabaseSync(':memory:')
    migrateBookDb(db)
    const { bookId, blockIds, contents } = seedLegacyDb(db)
    expect(blockIds).toHaveLength(PAGE_COUNT * 3)

    const beforeIds = (
      db.prepare('SELECT id FROM blocks WHERE book_id = ? ORDER BY id').all(bookId) as { id: number }[]
    ).map((r) => r.id)
    const beforeSearch = searchBookBlocks(db, bookId, '流水线', 5)
    expect(beforeSearch.length).toBeGreaterThan(0)

    const toc = buildSimulatedToc()
    const result = rebuildTocIndex(db, bookId, toc)

    expect(result.tocEntries).toBe(204)
    expect(result.chapters).toBe(50)
    expect(result.blocks).toBe(PAGE_COUNT * 3)
    expect(result.tocSignature).toBe(computeTocSignature(toc))

    // blocks.id / content 原样保留
    const afterRows = db
      .prepare('SELECT id, content FROM blocks WHERE book_id = ? ORDER BY id')
      .all(bookId) as { id: number; content: string }[]
    expect(afterRows.map((r) => r.id)).toEqual(beforeIds)
    expect(afterRows.map((r) => r.content)).toEqual(contents)

    // FTS 可检索性保留：同关键词命中数一致
    const afterSearch = searchBookBlocks(db, bookId, '流水线', 5)
    expect(afterSearch.length).toBe(beforeSearch.length)
    expect(searchBookBlocks(db, bookId, '锟斤拷烫')).toEqual([])

    // toc_entries 落库完整，层级分布断言
    const entries = listTocEntries(db, bookId)
    expect(entries).toHaveLength(204)
    expect(entries.filter((e) => e.level === 0)).toHaveLength(8)
    expect(entries.filter((e) => e.level === 1)).toHaveLength(42)
    expect(entries.filter((e) => e.level === 2)).toHaveLength(154)

    // chapters 为 level<=1 模块范围（一级章按 204 条中 level<=1 划分）
    const chapters = db
      .prepare('SELECT chapter_index AS i, title, start_page AS s, end_page AS e FROM chapters WHERE book_id = ? ORDER BY chapter_index')
      .all(bookId) as { i: number; title: string; s: number; e: number }[]
    expect(chapters).toHaveLength(50)
    expect(chapters[0]?.s).toBe(1)

    // completed_pages 修复为 1..340 完整列表
    const completedRaw = (
      db.prepare('SELECT completed_pages AS c FROM books WHERE id = ?').get(bookId) as { c: string }
    ).c
    expect(JSON.parse(completedRaw)).toEqual(Array.from({ length: PAGE_COUNT }, (_, i) => i + 1))
    expect(result.completedPages).toEqual(Array.from({ length: PAGE_COUNT }, (_, i) => i + 1))

    // toc_signature 落库
    const sig = (db.prepare('SELECT toc_signature AS s FROM books WHERE id = ?').get(bookId) as { s: string }).s
    expect(sig).toBe(result.tocSignature)
    expect(sig).not.toBe('')
    db.close()
  })

  it('第 7 章（一级）与 7.3 小节（三级）范围查询起止页正确', () => {
    const db = new DatabaseSync(':memory:')
    migrateBookDb(db)
    const { bookId } = seedLegacyDb(db)
    const toc = buildSimulatedToc()
    rebuildTocIndex(db, bookId, toc)

    const ch7 = listTocEntries(db, bookId).find((e) => e.level === 1 && e.title === '第7章 章名7')
    expect(ch7).toBeDefined()
    // 第7章@52，下一 level<=1 为第8章@59 → [52,58]
    expect(ch7).toMatchObject({ startPage: 52, endPage: 58 })
    expect(getTocEntry(db, bookId, ch7?.tocIndex ?? -1)).toEqual(ch7)

    const sec73 = listTocEntries(db, bookId).find((e) => e.level === 2 && e.title === '7.3 小节7-3')
    expect(sec73).toBeDefined()
    // 7.3@56，下一同级或更高级为 7.4@58 → [56,57]
    expect(sec73).toMatchObject({ startPage: 56, endPage: 57 })

    const ch7Blocks = getTocRangeBlocks(db, bookId, ch7?.tocIndex ?? -1)
    expect(ch7Blocks.length).toBeGreaterThan(0)
    expect(ch7Blocks.every((b) => b.pageNumber >= 52 && b.pageNumber <= 58)).toBe(true)
    expect(ch7Blocks.map((b) => b.pageNumber).sort((a, b) => a - b)[0]).toBe(52)

    const secBlocks = getTocRangeBlocks(db, bookId, sec73?.tocIndex ?? -1)
    expect(secBlocks.length).toBeGreaterThan(0)
    expect(secBlocks.every((b) => b.pageNumber >= 56 && b.pageNumber <= 57)).toBe(true)
    // 小节范围是一级章范围的子集
    expect(secBlocks.length).toBeLessThan(ch7Blocks.length)
    db.close()
  })

  it('重建过程零 OCR 调用：重建路径不 import 引擎/清洗/缓存模块', () => {
    const testDir = dirname(fileURLToPath(import.meta.url))
    const rebuildPath = join(testDir, 'toc-rebuild.ts')
    const source = readFileSync(rebuildPath, 'utf8')
    const forbidden = [
      'pdf-inspector',
      'inspector-ocr-runtime',
      'processPdfWithOcr',
      'ensureInspectorOcrRuntime',
      'ensureRuntime',
      'OcrMode',
      'cleanOcrWatermarks',
      'pdf-ocr-toc-service',
      'ocr-cache',
      "from '../ocr",
      'from "./import-service"',
    ]
    for (const token of forbidden) {
      expect(source, `rebuild 路径不应出现 ${token}`).not.toContain(token)
    }
    // 同步纯函数：误接 OCR 必变异步，此处锁死同步签名
    expect(rebuildTocIndex.constructor.name).toBe('Function')
    const db = new DatabaseSync(':memory:')
    migrateBookDb(db)
    const { bookId } = seedLegacyDb(db)
    const toc = buildSimulatedToc().slice(0, 10)
    const result = rebuildTocIndex(db, bookId, toc)
    expect(result).not.toBeInstanceOf(Promise)
    db.close()
  })

  it('toc_signature 基于规范化页/标题/层级，不含本机路径', () => {
    const toc = buildSimulatedToc()
    const a = computeTocSignature(toc)
    const spaced = toc.map((e) => ({ ...e, title: `  ${e.title.replace(/ /g, '  ')}  ` }))
    expect(computeTocSignature(spaced)).toBe(a)
    const reordered = [...toc].reverse()
    expect(computeTocSignature(reordered)).toBe(a)
    const changed = toc.map((e, i) => (i === 0 ? { ...e, title: `${e.title}改` } : e))
    expect(computeTocSignature(changed)).not.toBe(a)
    expect(computeTocSignature([])).toBe('')

    // 同目录不同本机路径签名一致：建两个书行对比
    const db = new DatabaseSync(':memory:')
    migrateBookDb(db)
    const now = Date.now()
    const mkBook = (fp: string, path: string): number =>
      Number(
        db
          .prepare(
            `INSERT INTO books
              (fingerprint, title, source_path, format, page_count, page_offset, clean_version, completed_pages, toc_signature, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '', ?, ?)`,
          )
          .run(fp, 't', path, 'pdf', PAGE_COUNT, 0, 'ocr-watermark-v3', now, now).lastInsertRowid,
      )
    const idA = mkBook('fp-a', 'C:/Users/a/book.pdf')
    const idB = mkBook('fp-b', 'D:/other/book.pdf')
    const ra = rebuildTocIndex(db, idA, toc)
    const rb = rebuildTocIndex(db, idB, toc)
    expect(ra.tocSignature).toBe(rb.tocSignature)
    expect(ra.tocSignature).not.toContain('C:/Users')
    db.close()
  })

  it('normalizeRebuildTocEntries 过滤非法条目并排序', () => {
    const entries = normalizeRebuildTocEntries(
      [
        { title: '  ', realPage: 5, level: 1 },
        { title: '坏页', realPage: -2, level: 1 },
        { title: '超页', realPage: 999, level: 1 },
        { title: '好章', realPage: 10, level: 1 },
      ],
      PAGE_COUNT,
    )
    expect(entries).toEqual([{ title: '好章', realPage: 10, level: 1 }])
  })

  it('空目录 [] 触发守卫且不写入（事务开启前抛错）', () => {
    const db = new DatabaseSync(':memory:')
    migrateBookDb(db)
    const { bookId } = seedLegacyDb(db)
    rebuildTocIndex(db, bookId, buildSimulatedToc())
    const before = snapshotRebuildState(db, bookId)
    expect(() => rebuildTocIndex(db, bookId, [])).toThrow(/有效目录/)
    expect(snapshotRebuildState(db, bookId)).toEqual(before)
    db.close()
  })

  it('原始非空但全部非法目录触发守卫且不写入', () => {
    const db = new DatabaseSync(':memory:')
    migrateBookDb(db)
    const { bookId } = seedLegacyDb(db)
    rebuildTocIndex(db, bookId, buildSimulatedToc())
    const before = snapshotRebuildState(db, bookId)
    const allInvalid: RebuildTocEntryInput[] = [
      { title: '   ', realPage: 5, level: 1 },
      { title: '', realPage: 10, level: 0 },
      { title: '坏页', realPage: -2, level: 1 },
      { title: '超页', realPage: 9999, level: 1 },
      { title: '负层', realPage: 10, level: -1 },
      { title: '非数页', realPage: Number.NaN, level: 1 },
    ]
    expect(normalizeRebuildTocEntries(allInvalid, PAGE_COUNT)).toEqual([])
    expect(() => rebuildTocIndex(db, bookId, allInvalid)).toThrow(/有效目录/)
    expect(snapshotRebuildState(db, bookId)).toEqual(before)
    db.close()
  })
})

/** 重建守卫回归快照：toc_entries / chapters / blocks(id+content) / 签名 / 完成页 */
function snapshotRebuildState(db: DatabaseSync, bookId: number): {
  tocEntries: unknown[]
  chapters: unknown[]
  blocks: unknown[]
  tocSignature: unknown
  completedPages: unknown
} {
  const tocEntries = db
    .prepare('SELECT book_id, toc_index, title, level, start_page, end_page FROM toc_entries WHERE book_id = ? ORDER BY toc_index')
    .all(bookId)
  const chapters = db
    .prepare('SELECT book_id, chapter_index, title, level, start_page, end_page FROM chapters WHERE book_id = ? ORDER BY chapter_index')
    .all(bookId)
  const blocks = db
    .prepare('SELECT id, content FROM blocks WHERE book_id = ? ORDER BY id')
    .all(bookId)
  const book = db
    .prepare('SELECT toc_signature, completed_pages FROM books WHERE id = ?')
    .get(bookId) as { toc_signature?: unknown; completed_pages?: unknown } | undefined
  return {
    tocEntries,
    chapters,
    blocks,
    tocSignature: book?.toc_signature,
    completedPages: book?.completed_pages,
  }
}
