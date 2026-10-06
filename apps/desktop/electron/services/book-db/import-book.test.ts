import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { buildBookIndex } from '@montree/reader-core'
import { migrateBookDb } from './schema'
import {
  alignBlockToSpan,
  classifyMarkdownLines,
  ensureImportBookRow,
  getCompletedPages,
  importBookChunk,
  importBookPages,
  markPagesCompleted,
} from './import-book'

function openTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  migrateBookDb(db)
  return db
}

const SPANS = [
  { text: '第1章 概述', confidence: 0.9, x: 10, y: 700, width: 60, height: 12 },
  { text: '这是第一段正文内容', confidence: 0.85, x: 10, y: 680, width: 120, height: 12 },
]

describe('classifyMarkdownLines', () => {
  it('标题/段落/列表/表格分类，表格合并，页标记丢弃', () => {
    const blocks = classifyMarkdownLines([
      '# 第1章 概述',
      '',
      '<!-- Page 8 -->',
      '这是第一段正文内容',
      '- 列表项一',
      '2) 列表项二',
      '| 考点 | 说明 |',
      '|---|---|',
      '| CPU | 运算 |',
      '尾段',
    ])
    expect(blocks.map((b) => b.type)).toEqual([
      'heading',
      'paragraph',
      'list',
      'list',
      'table',
      'paragraph',
    ])
    expect(blocks[0]?.content).toBe('第1章 概述')
    expect(blocks[4]?.content).toBe('| 考点 | 说明 |\n|---|---|\n| CPU | 运算 |')
  })

  it('含绝对值符号的正文不成表', () => {
    expect(classifyMarkdownLines(['|x| + 1 的值'])[0]?.type).toBe('paragraph')
  })
})

describe('alignBlockToSpan', () => {
  it('全等命中，表格调用方跳过', () => {
    const hit = alignBlockToSpan('这是第一段正文内容', SPANS)
    expect(hit?.bbox).toMatchObject({ x: 10, y: 680 })
    expect(hit?.confidence).toBeCloseTo(0.85)
  })

  it('无匹配返回 null', () => {
    expect(alignBlockToSpan('完全不相干的句子', SPANS)).toBeNull()
  })
})

describe('importBookPages', () => {
  const args = {
    fingerprint: 'test-book-1',
    title: '测试书',
    sourcePath: 'D:/book/a.pdf',
    format: 'pdf',
    pageCount: 4,
    pageOffset: 0,
    cleanVersion: 'ocr-watermark-v3',
    printedToc: [
      { title: '第1章 概述', printedPage: 2, level: 1 },
      { title: '第2章 运算', printedPage: 4, level: 1 },
    ],
    pages: [
      { page: 1, markdown: '封面\n\n前言第一段' },
      { page: 2, markdown: '# 第1章 概述\n\n这是第一段正文内容' },
      { page: 3, markdown: '| 考点 | 说明 |\n|---|---|\n| CPU | 运算 |' },
      { page: 4, markdown: '# 第2章 运算\n\n尾章正文' },
    ],
    spansByPage: new Map([[2, SPANS]]),
  }

  it('章/块/顺序/bbox/开篇全正确', () => {
    const db = openTestDb()
    const result = importBookPages(db, args)
    expect(result).toMatchObject({ imported: true, chapters: 2, pages: 4 })
    expect(result.blocks).toBe(2 + 2 + 1 + 2)

    const chapters = db
      .prepare('SELECT chapter_index AS i, title, start_page AS s, end_page AS e FROM chapters ORDER BY chapter_index')
      .all() as { i: number; title: string; s: number; e: number }[]
    expect(chapters).toEqual([
      { i: 0, title: '第1章 概述', s: 2, e: 3 },
      { i: 1, title: '第2章 运算', s: 4, e: 4 },
    ])

    const blocks = db
      .prepare('SELECT chapter_index AS c, block_index AS b, type AS t, page_number AS p, bbox FROM blocks ORDER BY id')
      .all() as { c: number; b: number; t: string; p: number; bbox: string | null }[]
    // 开篇两段 chapter_index -1，顺序 0/1
    expect(blocks.slice(0, 2).map((r) => [r.c, r.b, r.t, r.p])).toEqual([
      [-1, 0, 'paragraph', 1],
      [-1, 1, 'paragraph', 1],
    ])
    // 第2页标题带 bbox
    const heading = blocks.find((r) => r.t === 'heading' && r.p === 2)
    expect(heading?.c).toBe(0)
    expect(heading?.bbox).toContain('700')
    // 表格块无 bbox 但内容完整
    const table = blocks.find((r) => r.t === 'table')
    expect(table?.bbox).toBeNull()
    expect(table?.c).toBe(0)
  })

  it('同版本重复导入直接复用', () => {
    const db = openTestDb()
    const first = importBookPages(db, args)
    const second = importBookPages(db, args)
    expect(second).toMatchObject({ imported: false, bookId: first.bookId, blocks: first.blocks })
  })

  it('清洗版本变更全量重导', () => {
    const db = openTestDb()
    const first = importBookPages(db, args)
    const second = importBookPages(db, { ...args, cleanVersion: 'ocr-watermark-v4' })
    expect(second.imported).toBe(true)
    expect(second.blocks).toBe(first.blocks)
    const bookCount = (db.prepare('SELECT COUNT(*) AS n FROM books').get() as { n: number }).n
    expect(bookCount).toBe(1)
  })
})

describe('importBookChunk', () => {
  const meta = {
    fingerprint: 'chunk-book-1',
    title: '分块书',
    sourcePath: 'D:/book/c.pdf',
    format: 'pdf',
    pageCount: 4,
    pageOffset: 0,
    cleanVersion: 'ocr-watermark-v3',
  }
  const printedToc = [
    { title: '第1章 概述', printedPage: 2, level: 1 },
    { title: '第2章 运算', printedPage: 4, level: 1 },
  ]
  const pageInput = [
    { page: 1, markdown: '封面\n\n前言第一段' },
    { page: 2, markdown: '# 第1章 概述\n\n这是第一段正文内容' },
    { page: 3, markdown: '| 考点 | 说明 |\n|---|---|\n| CPU | 运算 |' },
    { page: 4, markdown: '# 第2章 运算\n\n尾章正文' },
  ]
  const spans = new Map([[2, SPANS]])

  function setupChunkDb(): { db: DatabaseSync; bookId: number; index: ReturnType<typeof buildBookIndex> } {
    const db = openTestDb()
    const index = buildBookIndex({ pageCount: 4, pageOffset: 0, printedToc, contents: [] })
    const { bookId } = ensureImportBookRow(db, meta, index)
    return { db, bookId, index }
  }

  it('分两块导入与整库一致，章内序号连续', () => {
    const { db, bookId, index } = setupChunkDb()
    importBookChunk(db, { bookId, index, pages: pageInput.slice(0, 2), spansByPage: spans })
    const second = importBookChunk(db, { bookId, index, pages: pageInput.slice(2), spansByPage: spans })
    expect(second.blocks).toBe(1 + 2)
    const rows = db
      .prepare('SELECT chapter_index AS c, block_index AS b, page_number AS p FROM blocks ORDER BY id')
      .all() as { c: number; b: number; p: number }[]
    expect(rows).toHaveLength(7)
    // 第1章块（2/3 页）：序号 0,1,2 连续
    expect(rows.filter((r) => r.c === 0).map((r) => [r.b, r.p])).toEqual([
      [0, 2],
      [1, 2],
      [2, 3],
    ])
  })

  it('重复导入同范围幂等', () => {
    const { db, bookId, index } = setupChunkDb()
    importBookChunk(db, { bookId, index, pages: pageInput.slice(0, 2), spansByPage: spans })
    importBookChunk(db, { bookId, index, pages: pageInput.slice(0, 2), spansByPage: spans })
    const total = (db.prepare('SELECT COUNT(*) AS n FROM blocks').get() as { n: number }).n
    expect(total).toBe(4)
  })

  it('P1.1：路由/spans 页记 ocr，其余记 native，extract_version 落盘', () => {
    const { db, bookId, index } = setupChunkDb()
    importBookChunk(db, {
      bookId,
      index,
      pages: pageInput,
      spansByPage: spans,
      ocrPages: new Set([2]),
      extractVersion: 'ocr-watermark-v3',
    })
    const rows = db
      .prepare(
        'SELECT page_number AS p, source AS s, extract_version AS v FROM blocks ORDER BY id',
      )
      .all() as { p: number; s: string; v: string }[]
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.v).toBe('ocr-watermark-v3')
      expect(row.s).toBe(row.p === 2 ? 'ocr' : 'native')
    }
  })

  it('P1.1：显式路由集合优先于 spans 推断', () => {
    const { db, bookId, index } = setupChunkDb()
    importBookChunk(db, {
      bookId,
      index,
      pages: pageInput.slice(1, 2),
      spansByPage: spans,
      ocrPages: new Set<number>(),
      extractVersion: 'ocr-watermark-v3',
    })
    const rows = db
      .prepare('SELECT source AS s FROM blocks WHERE page_number = 2')
      .all() as { s: string }[]
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row.s).toBe('native')
  })

  it('P1.1 续跑保护：native 重跑不得覆盖已有 ocr 块', () => {
    const { db, bookId, index } = setupChunkDb()
    importBookChunk(db, {
      bookId,
      index,
      pages: pageInput.slice(1, 2),
      spansByPage: spans,
      ocrPages: new Set([2]),
      extractVersion: 'ocr-watermark-v3',
    })
    const readPage = () =>
      db
        .prepare('SELECT content AS c, source AS s FROM blocks WHERE page_number = 2 ORDER BY id')
        .all() as { c: string; s: string }[]
    const before = readPage()
    expect(before.length).toBeGreaterThan(0)
    expect(before.every((row) => row.s === 'ocr')).toBe(true)
    // 同页以 native 重跑（无 spans、未路由）：整页跳过，内容与来源逐字不变
    const retry = importBookChunk(db, {
      bookId,
      index,
      pages: pageInput.slice(1, 2),
      ocrPages: new Set<number>(),
      extractVersion: 'ocr-watermark-v3',
    })
    expect(retry.blocks).toBe(0)
    expect(readPage()).toEqual(before)
  })
})

describe('ensureImportBookRow / getCompletedPages / markPagesCompleted', () => {
  const meta = {
    fingerprint: 'progress-book-1',
    title: '进度书',
    sourcePath: 'D:/book/p.pdf',
    format: 'pdf',
    pageCount: 4,
    pageOffset: 0,
    cleanVersion: 'ocr-watermark-v3',
  }

  it('建行复用与版本变更重建', () => {
    const db = openTestDb()
    const index = buildBookIndex({ pageCount: 4, pageOffset: 0, printedToc: [], contents: [] })
    const first = ensureImportBookRow(db, meta, index)
    expect(first.fresh).toBe(true)
    expect(ensureImportBookRow(db, meta, index)).toMatchObject({ bookId: first.bookId, fresh: false })
    // 旧版本残留一块一切页标记，版本变更后应被清空
    markPagesCompleted(db, first.bookId, [1])
    const rebuilt = ensureImportBookRow(db, { ...meta, cleanVersion: 'v4' }, index)
    expect(rebuilt.fresh).toBe(true)
    expect(getCompletedPages(db, rebuilt.bookId).size).toBe(0)
    const bookCount = (db.prepare('SELECT COUNT(*) AS n FROM books').get() as { n: number }).n
    expect(bookCount).toBe(1)
  })

  it('进度标记读写与脏数据容错', () => {
    const db = openTestDb()
    const index = buildBookIndex({ pageCount: 4, pageOffset: 0, printedToc: [], contents: [] })
    const { bookId } = ensureImportBookRow(db, meta, index)
    expect(getCompletedPages(db, bookId).size).toBe(0)
    markPagesCompleted(db, bookId, [1, 2, 2, 3])
    expect([...getCompletedPages(db, bookId)].sort()).toEqual([1, 2, 3])
    db.prepare("UPDATE books SET completed_pages = 'not-json' WHERE id = ?").run(bookId)
    expect(getCompletedPages(db, bookId).size).toBe(0)
  })
})
