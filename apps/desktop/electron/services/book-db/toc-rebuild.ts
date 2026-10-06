import type { DatabaseSync } from 'node:sqlite'
import { buildBookIndex, findChapterForPage, modulePageRange } from '@montree/reader-core'
import { computeTocSignature, normalizeTocTitle } from '@montree/reader-core'
import { migrateBookDb } from './schema'

/**
 * 纯本地罗盘目录重建（第一阶段：只重建索引，不做 OCR）。
 * 输入调用方传入的已确认目录（真实页帧），不读 OCR 缓存、不调引擎。
 * 占位 chapters 删除重建；已有 blocks 只改归属列（id/content 不动，FTS 由触发器跟随）。
 */

export interface RebuildTocEntryInput {
  title: string
  realPage: number
  level: number
}

export interface RebuildTocResult {
  bookId: number
  tocEntries: number
  chapters: number
  blocks: number
  completedPages: number[]
  tocSignature: string
}

interface NormalizedTocEntry {
  title: string
  realPage: number
  level: number
}

/** 过滤非法条目 → 规范标题 → 按（真实页，层级，标题码点）排序；与签名 canonical 顺序一致 */
export function normalizeRebuildTocEntries(
  toc: readonly RebuildTocEntryInput[],
  pageCount: number,
): NormalizedTocEntry[] {
  const out: NormalizedTocEntry[] = []
  for (const entry of toc) {
    if (!entry || !Number.isFinite(entry.realPage) || !Number.isFinite(entry.level)) continue
    const realPage = Math.round(entry.realPage)
    const level = Math.trunc(entry.level)
    if (!Number.isInteger(realPage) || realPage < 1 || realPage > pageCount) continue
    if (!Number.isInteger(level) || level < 0) continue
    const title = normalizeTocTitle(typeof entry.title === 'string' ? entry.title : '')
    if (!title) continue
    out.push({ title, realPage, level })
  }
  out.sort((a, b) => {
    if (a.realPage !== b.realPage) return a.realPage - b.realPage
    if (a.level !== b.level) return a.level - b.level
    if (a.title === b.title) return 0
    return a.title < b.title ? -1 : 1
  })
  return out
}

function readBookPageCount(db: DatabaseSync, bookId: number): number {
  const row = db
    .prepare('SELECT page_count AS pageCount FROM books WHERE id = ?')
    .get(bookId) as { pageCount?: unknown } | undefined
  return typeof row?.pageCount === 'number' ? row.pageCount : 0
}

function readDistinctBlockPages(db: DatabaseSync, bookId: number): Set<number> {
  const rows = db
    .prepare('SELECT DISTINCT page_number AS page FROM blocks WHERE book_id = ?')
    .all(bookId) as { page?: unknown }[]
  const pages = new Set<number>()
  for (const row of rows) {
    if (typeof row?.page === 'number' && Number.isInteger(row.page) && row.page > 0) {
      pages.add(row.page)
    }
  }
  return pages
}

/**
 * 重建目录索引：toc_entries 全量替换 → chapters（level<=1）删除重建 →
 * 已有 blocks 重归属（两阶段避 UNIQUE 冲突）→ 全页覆盖时修复 completed_pages →
 * 写回 toc_signature。单事务，原子。
 */
export function rebuildTocIndex(
  db: DatabaseSync,
  bookId: number,
  toc: readonly RebuildTocEntryInput[],
): RebuildTocResult {
  migrateBookDb(db)
  const pageCount = readBookPageCount(db, bookId)
  if (!Number.isInteger(bookId) || bookId < 1 || !Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error('书籍不存在，无法重建目录')
  }
  const normalized = normalizeRebuildTocEntries(toc, pageCount)
  if (normalized.length === 0) {
    throw new Error('当前没有有效目录，无法重建')
  }
  const index = buildBookIndex({
    pageCount,
    pageOffset: 0,
    printedToc: normalized.map((e) => ({ title: e.title, level: e.level, realPage: e.realPage })),
    contents: [],
  })
  const tocSignature = computeTocSignature(normalized)
  const chapterEntries = index.toc.filter((entry) => entry.level <= 1)

  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('DELETE FROM toc_entries WHERE book_id = ?').run(bookId)
    const insertToc = db.prepare(
      `INSERT INTO toc_entries (book_id, toc_index, title, level, start_page, end_page)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    normalized.forEach((_entry, tocIndex) => {
      const range = modulePageRange(index, tocIndex)
      const source = index.toc[tocIndex]
      const fallback = source?.realPage ?? 1
      const start = range ? Math.max(1, Math.min(pageCount, range[0])) : fallback
      const end = range ? Math.max(start, Math.min(pageCount, range[1])) : fallback
      insertToc.run(
        bookId,
        tocIndex,
        source?.title ?? _entry.title,
        source?.level ?? _entry.level,
        start,
        end,
      )
    })

    db.prepare('DELETE FROM chapters WHERE book_id = ?').run(bookId)
    const insertChapter = db.prepare(
      `INSERT INTO chapters (book_id, chapter_index, title, level, start_page, end_page)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    const chapterIdByIndex = new Map<number, number>()
    chapterEntries.forEach((entry, chapterIndex) => {
      const tocIndex = index.toc.indexOf(entry)
      const range = modulePageRange(index, tocIndex)
      const start = range ? Math.max(1, Math.min(pageCount, range[0])) : entry.realPage
      const end = range ? Math.max(start, Math.min(pageCount, range[1])) : entry.realPage
      const result = insertChapter.run(bookId, chapterIndex, entry.title, entry.level, start, end)
      chapterIdByIndex.set(chapterIndex, Number(result.lastInsertRowid))
    })

    const blocks = db
      .prepare('SELECT id, page_number AS page FROM blocks WHERE book_id = ? ORDER BY page_number ASC, id ASC')
      .all(bookId) as { id?: unknown; page?: unknown }[]
    const validBlocks: { id: number; page: number }[] = []
    for (const row of blocks) {
      if (typeof row?.id === 'number' && typeof row?.page === 'number') {
        validBlocks.push({ id: row.id, page: row.page })
      }
    }
    // 两阶段避 UNIQUE(book_id, chapter_index, block_index) 冲突：先停到负数区再落位
    const park = db.prepare('UPDATE blocks SET chapter_id = NULL, chapter_index = ?, block_index = ? WHERE id = ?')
    for (const block of validBlocks) {
      park.run(-1000000 - block.id, block.id, block.id)
    }
    const place = db.prepare('UPDATE blocks SET chapter_id = ?, chapter_index = ?, block_index = ? WHERE id = ?')
    const counters = new Map<number, number>()
    for (const block of validBlocks) {
      const chapter = findChapterForPage(index, block.page)
      const chapterIndex = chapter ? chapterEntries.indexOf(chapter) : -1
      const blockIndex = counters.get(chapterIndex) ?? 0
      counters.set(chapterIndex, blockIndex + 1)
      place.run(chapterIndex >= 0 ? (chapterIdByIndex.get(chapterIndex) ?? null) : null, chapterIndex, blockIndex, block.id)
    }

    // 全页覆盖（1..page_count 都有块）时修复 completed_pages，避免下次误触发全量 OCR
    const covered = readDistinctBlockPages(db, bookId)
    let completed: number[] = []
    let fullyCovered = covered.size === pageCount
    if (fullyCovered) {
      for (let page = 1; page <= pageCount; page += 1) {
        if (!covered.has(page)) {
          fullyCovered = false
          break
        }
      }
    }
    if (fullyCovered) {
      completed = Array.from({ length: pageCount }, (_, i) => i + 1)
      db.prepare('UPDATE books SET completed_pages = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(completed),
        Date.now(),
        bookId,
      )
    } else {
      const row = db
        .prepare('SELECT completed_pages AS completed FROM books WHERE id = ?')
        .get(bookId) as { completed?: unknown } | undefined
      try {
        const parsed: unknown = typeof row?.completed === 'string' ? JSON.parse(row.completed) : []
        if (Array.isArray(parsed)) {
          completed = (parsed as unknown[]).filter(
            (p): p is number => typeof p === 'number' && Number.isInteger(p) && p > 0,
          )
        }
      } catch {
        completed = []
      }
    }

    db.prepare('UPDATE books SET toc_signature = ?, updated_at = ? WHERE id = ?').run(
      tocSignature,
      Date.now(),
      bookId,
    )
    db.exec('COMMIT')
    return {
      bookId,
      tocEntries: normalized.length,
      chapters: chapterEntries.length,
      blocks: validBlocks.length,
      completedPages: completed,
      tocSignature,
    }
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // 回滚失败时保留原错
    }
    throw error
  }
}
