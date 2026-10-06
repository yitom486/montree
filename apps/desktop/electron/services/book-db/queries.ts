import type { DatabaseSync } from 'node:sqlite'
import {
  assessNativePageText,
  NATIVE_PAGE_QUALITY_SUGGEST_OCR,
  OCR_SUGGESTED_PAGES_CAP,
} from '@montree/ocr-core'
import type { BookBlockSource, BookBlockType, BookDbBlockHit, PdfPointBBox } from '@montree/contracts'
import { getCompletedPages } from './import-book'

/** FTS5 查询转义：包成双引号短语，防 `*`/`"`/OR 等语法字符炸查询 */
export function escapeFtsQuery(keyword: string): string {
  return `"${keyword.replace(/"/g, '""')}"`
}

interface BlockRow {
  id?: unknown
  type?: unknown
  content?: unknown
  page_number?: unknown
  chapter_index?: unknown
  chapter_title?: unknown
  block_index?: unknown
  snippet?: unknown
  source?: unknown
  extract_version?: unknown
}

function toBlockSource(value: unknown): BookBlockSource {
  return value === 'native' || value === 'ocr' ? value : 'unknown'
}

function toHit(row: BlockRow, fallbackContent: string): BookDbBlockHit {
  const content = typeof row.content === 'string' ? row.content : ''
  return {
    id: typeof row.id === 'number' ? row.id : 0,
    type: (typeof row.type === 'string' ? row.type : 'paragraph') as BookBlockType,
    content,
    pageNumber: typeof row.page_number === 'number' ? row.page_number : 0,
    chapterIndex: typeof row.chapter_index === 'number' ? row.chapter_index : -1,
    chapterTitle: typeof row.chapter_title === 'string' ? row.chapter_title : null,
    blockIndex: typeof row.block_index === 'number' ? row.block_index : 0,
    snippet:
      typeof row.snippet === 'string' && row.snippet.length > 0
        ? row.snippet
        : content.slice(0, 60),
    source: toBlockSource(row.source),
    extractVersion: typeof row.extract_version === 'string' ? row.extract_version : '',
  }
}

/**
 * 全书全文搜索（trigram，中日英三语可查）：返回命中块 + 高亮片段 + 所在章。
 * 空关键词直接返回空数组（空短语是 FTS 语法错误）。
 */
export function searchBookBlocks(
  db: DatabaseSync,
  bookId: number,
  keyword: string,
  limit = 20,
): BookDbBlockHit[] {
  if (!keyword.trim() || limit <= 0) return []
  const selectList = (extra: string): string => `SELECT
        blocks.id AS id,
        blocks.type AS type,
        blocks.content AS content,
        blocks.page_number AS page_number,
        blocks.chapter_index AS chapter_index,
        chapters.title AS chapter_title,
        blocks.block_index AS block_index${extra},
        snippet(block_fts, 0, '«', '»', '…', 12) AS snippet
      FROM block_fts
      JOIN blocks ON blocks.id = block_fts.rowid
      LEFT JOIN chapters ON chapters.id = blocks.chapter_id
      WHERE block_fts MATCH ? AND blocks.book_id = ?
      LIMIT ?`
  const run = (extra: string): BlockRow[] =>
    db
      .prepare(selectList(extra))
      .all(escapeFtsQuery(keyword), bookId, Math.floor(limit)) as BlockRow[]
  try {
    return run(`,
        blocks.source AS source,
        blocks.extract_version AS extract_version`).map((row) => toHit(row, ''))
  } catch (cause) {
    // v4 前旧库无 source 列（审计等只读路径不迁移）：退化 legacy 列，
    // source 回 'unknown'；其他错误原样抛出
    if (cause instanceof Error && /no such column/i.test(cause.message)) {
      return run('').map((row) => toHit(row, ''))
    }
    throw cause
  }
}

/**
 * 全书全文搜索精确总数（与 searchBookBlocks 同一 MATCH + book 过滤；
 * limit 只截断展示，total 必须精确，调用方不得用展示数冒充）。
 */
export function countSearchBookBlocks(db: DatabaseSync, bookId: number, keyword: string): number {
  if (!keyword.trim()) return 0
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total
       FROM block_fts
       JOIN blocks ON blocks.id = block_fts.rowid
       WHERE block_fts MATCH ? AND blocks.book_id = ?`,
    )
    .get(escapeFtsQuery(keyword), bookId) as { total?: unknown } | undefined
  return typeof row?.total === 'number' ? row.total : 0
}

/** 按章顺序读块：AI “第 N 章讲了什么”的直接数据源 */
export function getChapterBlocks(
  db: DatabaseSync,
  bookId: number,
  chapterIndex: number,
): BookDbBlockHit[] {
  const rows = db
    .prepare(
      `SELECT
        blocks.id AS id,
        blocks.type AS type,
        blocks.content AS content,
        blocks.page_number AS page_number,
        blocks.chapter_index AS chapter_index,
        chapters.title AS chapter_title,
        blocks.block_index AS block_index,
        blocks.source AS source,
        blocks.extract_version AS extract_version,
        '' AS snippet
      FROM blocks
      LEFT JOIN chapters ON chapters.id = blocks.chapter_id
      WHERE blocks.book_id = ? AND blocks.chapter_index = ?
      ORDER BY blocks.block_index ASC`,
    )
    .all(bookId, chapterIndex) as BlockRow[]
  return rows.map((row) => toHit(row, ''))
}

/** 单页块（顺序）：AI 当前页走库时的直接数据源 */
export function getPageBlocks(db: DatabaseSync, bookId: number, page: number): BookDbBlockHit[] {
  if (!Number.isInteger(page) || page < 1) return []
  const rows = db
    .prepare(
      `SELECT
        blocks.id AS id,
        blocks.type AS type,
        blocks.content AS content,
        blocks.page_number AS page_number,
        blocks.chapter_index AS chapter_index,
        chapters.title AS chapter_title,
        blocks.block_index AS block_index,
        blocks.source AS source,
        blocks.extract_version AS extract_version,
        '' AS snippet
      FROM blocks
      LEFT JOIN chapters ON chapters.id = blocks.chapter_id
      WHERE blocks.book_id = ? AND blocks.page_number = ?
      ORDER BY blocks.chapter_index ASC, blocks.block_index ASC`,
    )
    .all(bookId, page) as BlockRow[]
  return rows.map((row) => toHit(row, ''))
}

/** 块上下文：同章前后各 radius 个块（AI 当前块 ±N，不重解析全书） */
export function getBlockContext(
  db: DatabaseSync,
  bookId: number,
  chapterIndex: number,
  blockIndex: number,
  radius = 2,
): BookDbBlockHit[] {
  const safeRadius = Math.max(0, Math.floor(radius))
  const rows = db
    .prepare(
      `SELECT
        blocks.id AS id,
        blocks.type AS type,
        blocks.content AS content,
        blocks.page_number AS page_number,
        blocks.chapter_index AS chapter_index,
        chapters.title AS chapter_title,
        blocks.block_index AS block_index,
        blocks.source AS source,
        blocks.extract_version AS extract_version,
        '' AS snippet
      FROM blocks
      LEFT JOIN chapters ON chapters.id = blocks.chapter_id
      WHERE blocks.book_id = ?
        AND blocks.chapter_index = ?
        AND blocks.block_index BETWEEN ? AND ?
      ORDER BY blocks.block_index ASC`,
    )
    .all(bookId, chapterIndex, blockIndex - safeRadius, blockIndex + safeRadius) as BlockRow[]
  return rows.map((row) => toHit(row, ''))
}

/** 块定位：点 AI 文本 → 原图页 + 块级 bbox（PDF point，y-up，与 Inspector span 同帧） */
export function locateBlock(
  db: DatabaseSync,
  blockId: number,
): { pageNumber: number; bbox: PdfPointBBox | null } | null {
  const row = db
    .prepare('SELECT page_number AS pageNumber, bbox FROM blocks WHERE id = ?')
    .get(blockId) as { pageNumber?: unknown; bbox?: unknown } | undefined
  if (!row || typeof row.pageNumber !== 'number') return null
  let bbox: PdfPointBBox | null = null
  if (typeof row.bbox === 'string' && row.bbox) {
    try {
      const parsed = JSON.parse(row.bbox) as Record<string, unknown>
      if (
        typeof parsed.x === 'number' &&
        typeof parsed.y === 'number' &&
        typeof parsed.width === 'number' &&
        typeof parsed.height === 'number'
      ) {
        bbox = { x: parsed.x, y: parsed.y, width: parsed.width, height: parsed.height }
      }
    } catch {
      bbox = null
    }
  }
  return { pageNumber: row.pageNumber, bbox }
}

export function countBookBlocks(db: DatabaseSync, bookId: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS total FROM blocks WHERE book_id = ?')
    .get(bookId) as { total?: unknown } | undefined
  return typeof row?.total === 'number' ? row.total : 0
}

/**
 * 给定页中跑过 OCR 的页数（有 bbox 的块所在页去重）。
 * OCR 页必有 spans → 对齐出 bbox；原生页 spans 为空 → bbox 全空。
 * 用于续跑统计回补（跳过的块没经过本轮路由集合）。
 */
export function countPagesWithBbox(
  db: DatabaseSync,
  bookId: number,
  pages: readonly number[],
): number {
  const valid = [...new Set(pages)].filter((page) => Number.isInteger(page) && page > 0)
  if (valid.length === 0) return 0
  const placeholders = valid.map(() => '?').join(',')
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT page_number) AS total FROM blocks
       WHERE book_id = ? AND bbox IS NOT NULL AND page_number IN (${placeholders})`,
    )
    .get(bookId, ...valid) as { total?: unknown } | undefined
  return typeof row?.total === 'number' ? row.total : 0
}

export interface TocEntryRow {
  tocIndex: number
  title: string
  level: number
  startPage: number
  endPage: number
}

/** 全量目录项（全部层级）：AI 按 toc_index 取小节范围的定位依据 */
export function listTocEntries(db: DatabaseSync, bookId: number): TocEntryRow[] {
  let rows: { tocIndex?: unknown; title?: unknown; level?: unknown; startPage?: unknown; endPage?: unknown }[]
  try {
    rows = db
      .prepare(
        `SELECT toc_index AS tocIndex, title, level, start_page AS startPage, end_page AS endPage
         FROM toc_entries WHERE book_id = ? ORDER BY toc_index ASC`,
      )
      .all(bookId) as { tocIndex?: unknown; title?: unknown; level?: unknown; startPage?: unknown; endPage?: unknown }[]
  } catch {
    // v3 前旧库无 toc_entries：返回空，调用方回退章节逻辑
    return []
  }
  return rows
    .filter((row) => typeof row.tocIndex === 'number' && typeof row.title === 'string')
    .map((row) => ({
      tocIndex: row.tocIndex as number,
      title: row.title as string,
      level: typeof row.level === 'number' ? row.level : 0,
      startPage: typeof row.startPage === 'number' ? row.startPage : 0,
      endPage: typeof row.endPage === 'number' ? row.endPage : 0,
    }))
}

export function getTocEntry(db: DatabaseSync, bookId: number, tocIndex: number): TocEntryRow | null {
  if (!Number.isInteger(tocIndex) || tocIndex < 0) return null
  const entries = listTocEntries(db, bookId)
  return entries.find((entry) => entry.tocIndex === tocIndex) ?? null
}

/**
 * 目录项范围读块：一级章读整章，二三级读对应小节（start_page..end_page）。
 * 按页/入库顺序返回；当前页仍走 getPageBlocks（不动）。
 */
export function getTocRangeBlocks(
  db: DatabaseSync,
  bookId: number,
  tocIndex: number,
): BookDbBlockHit[] {
  const entry = getTocEntry(db, bookId, tocIndex)
  if (!entry) return []
  const rows = db
    .prepare(
      `SELECT
        blocks.id AS id,
        blocks.type AS type,
        blocks.content AS content,
        blocks.page_number AS page_number,
        blocks.chapter_index AS chapter_index,
        chapters.title AS chapter_title,
        blocks.block_index AS block_index,
        blocks.source AS source,
        blocks.extract_version AS extract_version,
        '' AS snippet
      FROM blocks
      LEFT JOIN chapters ON chapters.id = blocks.chapter_id
      WHERE blocks.book_id = ? AND blocks.page_number BETWEEN ? AND ?
      ORDER BY blocks.page_number ASC, blocks.id ASC`,
    )
    .all(bookId, entry.startPage, entry.endPage) as BlockRow[]
  return rows.map((row) => toHit(row, ''))
}

export interface BookChapterRow {
  index: number
  title: string
  startPage: number
  endPage: number
}

/** 章目录：AI 章级问答先定位章范围 */
export function listBookChapters(db: DatabaseSync, bookId: number): BookChapterRow[] {
  const rows = db
    .prepare(
      `SELECT chapter_index AS chapterIndex, title, start_page AS startPage, end_page AS endPage
       FROM chapters WHERE book_id = ? ORDER BY chapter_index ASC`,
    )
    .all(bookId) as { chapterIndex?: unknown; title?: unknown; startPage?: unknown; endPage?: unknown }[]
  return rows
    .filter((row) => typeof row.chapterIndex === 'number' && typeof row.title === 'string')
    .map((row) => ({
      index: row.chapterIndex as number,
      title: row.title as string,
      startPage: typeof row.startPage === 'number' ? row.startPage : 0,
      endPage: typeof row.endPage === 'number' ? row.endPage : 0,
    }))
}

export interface BookRecordInfo {
  bookId: number
  title: string
  pageCount: number
  cleanVersion: string
  chapters: number
  blocks: number
  tocSignature: string
  tocEntries: number
}

/** 按指纹取书 + 统计；未导入返回 null（toc 签名缺列/缺表时回 ''/0，不抛错） */
export function getBookRecord(db: DatabaseSync, fingerprint: string): BookRecordInfo | null {
  const book = db
    .prepare('SELECT id, title, page_count AS pageCount, clean_version AS cleanVersion FROM books WHERE fingerprint = ?')
    .get(fingerprint) as { id?: unknown; title?: unknown; pageCount?: unknown; cleanVersion?: unknown } | undefined
  if (!book || typeof book.id !== 'number') return null
  const chapters = db
    .prepare('SELECT COUNT(*) AS total FROM chapters WHERE book_id = ?')
    .get(book.id) as { total?: unknown } | undefined
  let tocSignature = ''
  try {
    const sigRow = db
      .prepare('SELECT toc_signature AS sig FROM books WHERE id = ?')
      .get(book.id) as { sig?: unknown } | undefined
    if (typeof sigRow?.sig === 'string') tocSignature = sigRow.sig
  } catch {
    tocSignature = ''
  }
  let tocEntries = 0
  try {
    const tocRow = db
      .prepare('SELECT COUNT(*) AS total FROM toc_entries WHERE book_id = ?')
      .get(book.id) as { total?: unknown } | undefined
    if (typeof tocRow?.total === 'number') tocEntries = tocRow.total
  } catch {
    tocEntries = 0
  }
  return {
    bookId: book.id,
    title: typeof book.title === 'string' ? book.title : '',
    pageCount: typeof book.pageCount === 'number' ? book.pageCount : 0,
    cleanVersion: typeof book.cleanVersion === 'string' ? book.cleanVersion : '',
    chapters: typeof chapters?.total === 'number' ? chapters.total : 0,
    blocks: countBookBlocks(db, book.id),
    tocSignature,
    tocEntries,
  }
}

/**
 * P1.3：已入库且仅有原生/空文本的页中，质量差（空或乱码）者建议手动 OCR。
 * 已有 ocr 块的页永不列入；未完成入库的页不列入。只读，不触发 OCR。
 */
export function listOcrSuggestedPages(db: DatabaseSync, bookId: number): number[] {
  const ocrPages = new Set<number>()
  const nativeParts = new Map<number, string[]>()
  const rows = db
    .prepare(
      `SELECT page_number AS p, source AS s, content AS c FROM blocks WHERE book_id = ?`,
    )
    .all(bookId) as { p?: unknown; s?: unknown; c?: unknown }[]
  for (const row of rows) {
    if (typeof row.p !== 'number' || !Number.isInteger(row.p) || row.p < 1) continue
    if (row.s === 'ocr') {
      ocrPages.add(row.p)
      continue
    }
    const parts = nativeParts.get(row.p) ?? []
    parts.push(typeof row.c === 'string' ? row.c : '')
    nativeParts.set(row.p, parts)
  }
  const completed = getCompletedPages(db, bookId)
  const pages =
    completed.size > 0
      ? [...completed].sort((a, b) => a - b)
      : [...nativeParts.keys()].sort((a, b) => a - b)
  const suggested: number[] = []
  for (const page of pages) {
    if (ocrPages.has(page)) continue
    const text = (nativeParts.get(page) ?? []).join('\n')
    if (assessNativePageText(text) !== NATIVE_PAGE_QUALITY_SUGGEST_OCR) continue
    suggested.push(page)
    if (suggested.length >= OCR_SUGGESTED_PAGES_CAP) break
  }
  return suggested
}
