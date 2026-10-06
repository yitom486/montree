import type { DatabaseSync } from 'node:sqlite'
import {
  buildBookIndex,
  findChapterForPage,
  modulePageRange,
  type BookIndex,
  type PrintedTocEntry,
} from '@montree/reader-core'
import type { InspectorSpanLike } from '@montree/ocr-core'
// 复用同一套归一化做 span 对齐（空格/标点/全角折叠），保证入库匹配与清洗一致
import { normalizeWatermarkText } from '@montree/ocr-core'
import type { BookBlockType, PdfPointBBox } from '@montree/contracts'
import { computeTocSignature } from '@montree/reader-core'
import { migrateBookDb } from './schema'

export interface ImportBookPageInput {
  page: number
  markdown: string
}

export interface ImportBookArgs {
  fingerprint: string
  title: string
  sourcePath: string
  format: string
  pageCount: number
  pageOffset: number
  /** 清洗管线版本（如 ocr-watermark-v3）；变更则全量重导 */
  cleanVersion: string
  printedToc: readonly PrintedTocEntry[]
  pages: readonly ImportBookPageInput[]
  spansByPage?: ReadonlyMap<number, readonly InspectorSpanLike[]>
}

export interface ImportBookResult {
  bookId: number
  /** false 表示同 fingerprint + 同清洗版本已存在，直接复用 */
  imported: boolean
  chapters: number
  blocks: number
  pages: number
}

export interface ClassifiedBlock {
  type: BookBlockType
  content: string
}

const PAGE_MARKER_LINE = /^<!--\s*[Pp][Aa][Gg][Ee]\s+\d+\s*-->$/
const HEADING_LINE = /^(#{1,6})\s+(.+)$/
const LIST_LINE = /^([-*+]\s+|\d+[.)]\s+)/
const TABLE_ROW_LINE = /^\s*\|.*\|\s*$/
const TABLE_SEPARATOR_LINE = /^[\s|:-]+$/

function isTableLine(text: string): boolean {
  // 以 | 起止的是表格行；纯分隔符且含 | 的是分隔线（含绝对值符号的正文不会命中）
  return TABLE_ROW_LINE.test(text) || (text.includes('|') && TABLE_SEPARATOR_LINE.test(text))
}

/**
 * 页 markdown 行 → blocks：标题 / 列表 / 表格（连续表格行合并为一个 block，
 * AI 读表不断裂）/ 段落；空行与页标记丢弃。
 */
export function classifyMarkdownLines(lines: readonly string[]): ClassifiedBlock[] {
  const blocks: ClassifiedBlock[] = []
  let tableBuffer: string[] = []
  const flushTable = (): void => {
    if (tableBuffer.length > 0) {
      blocks.push({ type: 'table', content: tableBuffer.join('\n') })
      tableBuffer = []
    }
  }
  for (const raw of lines) {
    const text = raw.trim()
    if (text.length === 0 || PAGE_MARKER_LINE.test(text)) {
      flushTable()
      continue
    }
    if (isTableLine(text)) {
      tableBuffer.push(text)
      continue
    }
    flushTable()
    const heading = HEADING_LINE.exec(text)
    if (heading) {
      const content = (heading[2] ?? '').trim()
      if (content) blocks.push({ type: 'heading', content })
      continue
    }
    if (LIST_LINE.test(text)) {
      blocks.push({ type: 'list', content: text })
      continue
    }
    blocks.push({ type: 'paragraph', content: text })
  }
  flushTable()
  return blocks
}

/**
 * block 文本 ↔ 同页 OCR span 对齐，取几何 bbox（点坐标，y-up，与 span 同帧）。
 * 全等优先，否则取首个双向包含；表格块多行不硬对齐，记 null。
 */
export function alignBlockToSpan(
  blockContent: string,
  spans: readonly InspectorSpanLike[],
): { bbox: PdfPointBBox; confidence: number } | null {
  const norm = normalizeWatermarkText(blockContent)
  if (!norm) return null
  let fuzzy: InspectorSpanLike | null = null
  for (const span of spans) {
    if (!span || typeof span.text !== 'string') continue
    const spanNorm = normalizeWatermarkText(span.text)
    if (!spanNorm) continue
    if (spanNorm === norm) {
      return { bbox: { x: span.x, y: span.y, width: span.width, height: span.height }, confidence: span.confidence }
    }
    if (!fuzzy && (spanNorm.includes(norm) || norm.includes(spanNorm))) fuzzy = span
  }
  if (!fuzzy) return null
  return {
    bbox: { x: fuzzy.x, y: fuzzy.y, width: fuzzy.width, height: fuzzy.height },
    confidence: fuzzy.confidence,
  }
}

function findBookId(db: DatabaseSync, fingerprint: string): { id: number; cleanVersion: string } | null {
  const row = db
    .prepare('SELECT id, clean_version AS cleanVersion FROM books WHERE fingerprint = ?')
    .get(fingerprint) as { id?: unknown; cleanVersion?: unknown } | undefined
  if (!row || typeof row.id !== 'number') return null
  return { id: row.id, cleanVersion: typeof row.cleanVersion === 'string' ? row.cleanVersion : '' }
}

/**
 * 整书导入：book-index 定章归属 → 逐页分类 → span 对齐 → 入库（单事务）。
 * 同 fingerprint + 同清洗版本直接复用；清洗版本变更则删书重导。
 */
export function importBookPages(db: DatabaseSync, args: ImportBookArgs): ImportBookResult {
  migrateBookDb(db)
  const existing = findBookId(db, args.fingerprint)
  if (existing && existing.cleanVersion === args.cleanVersion) {
    const counts = db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM chapters WHERE book_id = ?) AS chapters,
          (SELECT COUNT(*) FROM blocks WHERE book_id = ?) AS blocks`,
      )
      .get(existing.id, existing.id) as { chapters?: unknown; blocks?: unknown } | undefined
    return {
      bookId: existing.id,
      imported: false,
      chapters: typeof counts?.chapters === 'number' ? counts.chapters : 0,
      blocks: typeof counts?.blocks === 'number' ? counts.blocks : 0,
      pages: args.pageCount,
    }
  }

  const index = buildBookIndex({
    pageCount: args.pageCount,
    pageOffset: args.pageOffset,
    printedToc: args.printedToc,
    contents: [],
  })
  const { bookId } = ensureImportBookRow(db, { ...args }, index)
  const { blocks } = importBookChunk(db, {
    bookId,
    index,
    pages: args.pages.filter((p) => Number.isInteger(p.page) && p.page >= 1 && p.page <= args.pageCount),
    spansByPage: args.spansByPage,
    extractVersion: args.cleanVersion,
  })
  return {
    bookId,
    imported: true,
    chapters: index.toc.filter((entry) => entry.level <= 1).length,
    blocks,
    pages: args.pageCount,
  }
}

export interface ImportBookMeta {
  fingerprint: string
  title: string
  sourcePath: string
  format: string
  pageCount: number
  pageOffset: number
  cleanVersion: string
}

/**
 * 建书行（含章节行）：同版本已存在直接复用；版本变更/缺失则删书重建。
 * chapters 随书行一起落（崩溃重建可重复执行，幂等）。
 */
export function ensureImportBookRow(
  db: DatabaseSync,
  meta: ImportBookMeta,
  index: BookIndex,
): { bookId: number; fresh: boolean } {
  migrateBookDb(db)
  const existing = findBookId(db, meta.fingerprint)
  if (existing && existing.cleanVersion === meta.cleanVersion) {
    return { bookId: existing.id, fresh: false }
  }
  const now = Date.now()
  db.exec('BEGIN IMMEDIATE')
  try {
    if (existing) {
      db.prepare('DELETE FROM books WHERE id = ?').run(existing.id)
    }
    const tocSignature = computeTocSignature(
      index.toc.map((entry) => ({ title: entry.title, realPage: entry.realPage, level: entry.level })),
    )
    const bookResult = db
      .prepare(
        `INSERT INTO books
          (fingerprint, title, source_path, format, page_count, page_offset, clean_version, completed_pages, toc_signature, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)`,
      )
      .run(
        meta.fingerprint,
        meta.title,
        meta.sourcePath,
        meta.format,
        meta.pageCount,
        meta.pageOffset,
        meta.cleanVersion,
        tocSignature,
        now,
        now,
      )
    const bookId = Number(bookResult.lastInsertRowid)
    const chapterEntries = index.toc.filter((entry) => entry.level <= 1)
    chapterEntries.forEach((entry, chapterIndex) => {
      const tocIndex = index.toc.indexOf(entry)
      const range = modulePageRange(index, tocIndex) ?? [entry.realPage, entry.realPage]
      db.prepare(
        `INSERT INTO chapters (book_id, chapter_index, title, level, start_page, end_page)
        VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(bookId, chapterIndex, entry.title, entry.level, range[0], range[1])
    })
    const insertToc = db.prepare(
      `INSERT INTO toc_entries (book_id, toc_index, title, level, start_page, end_page)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    index.toc.forEach((entry, tocIndex) => {
      const range = modulePageRange(index, tocIndex) ?? [entry.realPage, entry.realPage]
      insertToc.run(bookId, tocIndex, entry.title, entry.level, range[0], range[1])
    })
    db.exec('COMMIT')
    return { bookId, fresh: true }
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // 回滚失败时保留原错
    }
    throw error
  }
}

function parseCompletedPages(raw: unknown): Set<number> {
  const done = new Set<number>()
  if (typeof raw !== 'string' || !raw) return done
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      for (const page of parsed) {
        if (Number.isInteger(page) && (page as number) > 0) done.add(page as number)
      }
    }
  } catch {
    // 脏数据视为未完成，下次续跑覆盖
  }
  return done
}

/** 已完成 OCR+入库的页（含空页；崩溃/取消后续跑的依据） */
export function getCompletedPages(db: DatabaseSync, bookId: number): Set<number> {
  const row = db
    .prepare('SELECT completed_pages AS completed FROM books WHERE id = ?')
    .get(bookId) as { completed?: unknown } | undefined
  return parseCompletedPages(row?.completed)
}

export function markPagesCompleted(db: DatabaseSync, bookId: number, pages: readonly number[]): void {
  const done = getCompletedPages(db, bookId)
  for (const page of pages) {
    if (Number.isInteger(page) && page > 0) done.add(page)
  }
  db.prepare('UPDATE books SET completed_pages = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify([...done].sort((a, b) => a - b)),
    Date.now(),
    bookId,
  )
}

export interface ImportChunkInput {
  bookId: number
  index: BookIndex
  pages: readonly ImportBookPageInput[]
  spansByPage?: ReadonlyMap<number, readonly InspectorSpanLike[]>
  /**
   * P1.1：本轮路由进 OCR 的页（import-service 按 chunk.pagesRoutedToOcr 给）。
   * 显式集合优先；缺省时按有无可用 spans 推断（有 spans→ocr，否则 native）。
   */
  ocrPages?: ReadonlySet<number>
  /** P1.1：写入块的 extract_version（调用方传清洗管线版本；缺省 ''） */
  extractVersion?: string
}

/** 本页来源：显式路由集合优先，否则有可用 spans 即 ocr */
function resolvePageSource(
  page: number,
  spans: readonly InspectorSpanLike[],
  ocrPages: ReadonlySet<number> | undefined,
): 'native' | 'ocr' {
  if (ocrPages) return ocrPages.has(page) ? 'ocr' : 'native'
  return spans.length > 0 ? 'ocr' : 'native'
}

/**
 * 该页已有 ocr 块时，本轮 native 结果不得覆盖（续跑保护）。
 * v4 前旧库无 source 列时查不到，视为空集（调用方均先迁移）。
 */
function findProtectedPages(db: DatabaseSync, bookId: number, pages: readonly number[]): Set<number> {
  const fenced = new Set<number>()
  if (pages.length === 0) return fenced
  try {
    const placeholders = pages.map(() => '?').join(',')
    const rows = db
      .prepare(
        `SELECT DISTINCT page_number AS page FROM blocks
         WHERE book_id = ? AND source = 'ocr' AND page_number IN (${placeholders})`,
      )
      .all(bookId, ...pages) as { page?: unknown }[]
    for (const row of rows) {
      if (typeof row?.page === 'number') fenced.add(row.page)
    }
  } catch {
    // 旧库无 source 列：无保护信息，按原流程走（调用方均先 migrateBookDb）
  }
  return fenced
}

/**
 * 单块导入（单事务，原子）：先删该页范围旧块再插，重复执行幂等；
 * 章内序号从库中现有计数续排，跨块连续。空页只记进度不插块。
 * P1.1：native 页已有 ocr 块时整页跳过（不删不插，保护已有 OCR 结果）。
 */
export function importBookChunk(
  db: DatabaseSync,
  input: ImportChunkInput,
): { blocks: number } {
  const validPages = [...new Set(input.pages.map((p) => p.page))].filter(
    (page) => Number.isInteger(page) && page >= 1 && page <= input.index.pageCount,
  )
  if (validPages.length === 0) return { blocks: 0 }
  const chapterEntries = input.index.toc.filter((entry) => entry.level <= 1)
  const extractVersion = typeof input.extractVersion === 'string' ? input.extractVersion : ''
  // 先算每页来源：native 撞上已有 ocr 块的页整页跳过
  const spansByPage = input.spansByPage
  const incomingSource = new Map<number, 'native' | 'ocr'>()
  for (const page of validPages) {
    incomingSource.set(
      page,
      resolvePageSource(page, spansByPage?.get(page) ?? [], input.ocrPages),
    )
  }
  const nativePages = validPages.filter((page) => incomingSource.get(page) === 'native')
  const fenced = findProtectedPages(db, input.bookId, nativePages)
  const writablePages = validPages.filter((page) => !fenced.has(page))
  if (writablePages.length === 0) return { blocks: 0 }
  db.exec('BEGIN IMMEDIATE')
  try {
    const placeholders = writablePages.map(() => '?').join(',')
    db.prepare(
      `DELETE FROM blocks WHERE book_id = ? AND page_number IN (${placeholders})`,
    ).run(input.bookId, ...writablePages)

    const chapterIdRows = db
      .prepare('SELECT chapter_index AS c, id FROM chapters WHERE book_id = ?')
      .all(input.bookId) as { c?: unknown; id?: unknown }[]
    const chapterIdByIndex = new Map<number, number>()
    for (const row of chapterIdRows) {
      if (typeof row.c === 'number' && typeof row.id === 'number') chapterIdByIndex.set(row.c, row.id)
    }
    const counterRows = db
      .prepare('SELECT chapter_index AS c, COUNT(*) AS n FROM blocks WHERE book_id = ? GROUP BY chapter_index')
      .all(input.bookId) as { c?: unknown; n?: unknown }[]
    const counters = new Map<number, number>()
    for (const row of counterRows) {
      if (typeof row.c === 'number' && typeof row.n === 'number') counters.set(row.c, row.n)
    }

    const insertBlock = db.prepare(
      `INSERT INTO blocks
        (book_id, chapter_id, chapter_index, block_index, type, content, page_number, bbox, confidence, source, extract_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    let blocks = 0
    const orderedPages = [...input.pages]
      .filter((p) => writablePages.includes(p.page))
      .sort((a, b) => a.page - b.page)
    for (const { page, markdown } of orderedPages) {
      const classified = classifyMarkdownLines(markdown.split('\n'))
      if (classified.length === 0) continue
      const chapter = findChapterForPage(input.index, page)
      const chapterIndex = chapter ? chapterEntries.indexOf(chapter) : -1
      const chapterId = chapterIndex >= 0 ? (chapterIdByIndex.get(chapterIndex) ?? null) : null
      const spans = input.spansByPage?.get(page) ?? []
      const pageSource = incomingSource.get(page) ?? 'native'
      for (const block of classified) {
        const blockIndex = counters.get(chapterIndex) ?? 0
        counters.set(chapterIndex, blockIndex + 1)
        const aligned = block.type === 'table' ? null : alignBlockToSpan(block.content, spans)
        insertBlock.run(
          input.bookId,
          chapterId,
          chapterIndex,
          blockIndex,
          block.type,
          block.content,
          page,
          aligned ? JSON.stringify(aligned.bbox) : null,
          aligned ? aligned.confidence : null,
          pageSource,
          extractVersion,
        )
        blocks += 1
      }
    }
    db.exec('COMMIT')
    return { blocks }
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // 回滚失败时保留原错
    }
    throw error
  }
}
