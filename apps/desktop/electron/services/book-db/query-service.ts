import type { DatabaseSync } from 'node:sqlite'
import { err, ok, type Result } from '@montree/contracts'
import type { AppError } from '@montree/contracts'
import type { RosettaBookInfo, RosettaQuery, RosettaQueryResult } from '@montree/contracts'
import { openBookDb } from './open-book-db'
import {
  getBookRecord,
  getBlockContext,
  getChapterBlocks,
  getPageBlocks,
  getTocEntry,
  getTocRangeBlocks,
  listBookChapters,
  listOcrSuggestedPages,
  listTocEntries,
  searchBookBlocks,
} from './queries'

/** 罗盘统一读查询编排（InDb）：调用方已开库 → 取书 → 按 kind 分发；未导入返回 INVALID_STATE */
export function queryRosettaBookInDb(
  db: DatabaseSync,
  query: RosettaQuery,
): Result<RosettaQueryResult, AppError> {
  const fingerprint =
    query && typeof (query as { fingerprint?: unknown }).fingerprint === 'string'
      ? ((query as { fingerprint: string }).fingerprint.trim())
      : ''
  if (!fingerprint) {
    return err({ code: 'INVALID_ARGUMENT', message: '缺少文件指纹' })
  }
  const record = getBookRecord(db, fingerprint)
  if (!record) {
    return err({ code: 'INVALID_STATE', message: '本书尚未导入罗盘索引' })
  }
  const bookId = record.bookId
  switch (query.kind) {
    case 'page': {
      if (!Number.isInteger(query.page) || query.page < 1) {
        return err({ code: 'INVALID_ARGUMENT', message: '页码无效' })
      }
      return ok({ kind: 'page', blocks: getPageBlocks(db, bookId, query.page) })
    }
    case 'chapter': {
      if (!Number.isInteger(query.chapterIndex) || query.chapterIndex < -1) {
        return err({ code: 'INVALID_ARGUMENT', message: '章节序号无效' })
      }
      return ok({ kind: 'chapter', blocks: getChapterBlocks(db, bookId, query.chapterIndex) })
    }
    case 'chapters': {
      const chapters = listBookChapters(db, bookId)
      return ok({
        kind: 'chapters',
        chapters: chapters.map((chapter) => ({
          index: chapter.index,
          title: chapter.title,
          startPage: chapter.startPage,
          endPage: chapter.endPage,
        })),
      })
    }
    case 'search': {
      const limit =
        query.limit === undefined ? 20 : Math.max(1, Math.min(100, Math.floor(query.limit)))
      return ok({ kind: 'search', blocks: searchBookBlocks(db, bookId, query.keyword, limit) })
    }
    case 'context': {
      if (!Number.isInteger(query.chapterIndex) || !Number.isInteger(query.blockIndex)) {
        return err({ code: 'INVALID_ARGUMENT', message: '块定位参数无效' })
      }
      return ok({
        kind: 'context',
        blocks: getBlockContext(db, bookId, query.chapterIndex, query.blockIndex, query.radius ?? 2),
      })
    }
    case 'toc': {
      if (!Number.isInteger(query.tocIndex) || query.tocIndex < 0) {
        return err({ code: 'INVALID_ARGUMENT', message: '目录序号无效' })
      }
      const entry = getTocEntry(db, bookId, query.tocIndex)
      if (!entry) {
        return err({ code: 'INVALID_ARGUMENT', message: '目录项不存在' })
      }
      return ok({
        kind: 'toc',
        entry: {
          tocIndex: entry.tocIndex,
          title: entry.title,
          level: entry.level,
          startPage: entry.startPage,
          endPage: entry.endPage,
        },
        blocks: getTocRangeBlocks(db, bookId, query.tocIndex),
      })
    }
    case 'tocEntries': {
      const tocEntries = listTocEntries(db, bookId)
      return ok({
        kind: 'tocEntries',
        tocEntries: tocEntries.map((entry) => ({
          tocIndex: entry.tocIndex,
          title: entry.title,
          level: entry.level,
          startPage: entry.startPage,
          endPage: entry.endPage,
        })),
      })
    }
    default:
      return err({ code: 'INVALID_ARGUMENT', message: '未知查询类型' })
  }
}

/** 罗盘统一读查询编排（File）：指纹开库 → 调 InDb 版；register-handlers 入口，行为不变 */
export function queryRosettaBook(
  userDataDir: string,
  query: RosettaQuery,
): Result<RosettaQueryResult, AppError> {
  const fingerprint =
    query && typeof (query as { fingerprint?: unknown }).fingerprint === 'string'
      ? ((query as { fingerprint: string }).fingerprint.trim())
      : ''
  if (!fingerprint) {
    return err({ code: 'INVALID_ARGUMENT', message: '缺少文件指纹' })
  }
  let db: DatabaseSync
  try {
    db = openBookDb(userDataDir, fingerprint)
  } catch (cause) {
    return err({
      code: 'UNKNOWN',
      message: cause instanceof Error ? cause.message : '罗盘库打开失败',
    })
  }
  return queryRosettaBookInDb(db, query)
}

export function getRosettaBookInfoInDb(
  db: DatabaseSync,
  fingerprint: string,
): Result<RosettaBookInfo | null, AppError> {
  if (!fingerprint.trim()) {
    return err({ code: 'INVALID_ARGUMENT', message: '缺少文件指纹' })
  }
  const record = getBookRecord(db, fingerprint.trim())
  if (!record) return ok(null)
  return ok({
    fingerprint: fingerprint.trim(),
    bookId: record.bookId,
    title: record.title,
    chapters: record.chapters,
    blocks: record.blocks,
    pages: record.pageCount,
    pageCount: record.pageCount,
    cleanVersion: record.cleanVersion,
    tocSignature: record.tocSignature,
    tocEntries: record.tocEntries,
    ocrSuggestedPages: listOcrSuggestedPages(db, record.bookId),
  })
}

export function getRosettaBookInfo(
  userDataDir: string,
  fingerprint: string,
): Result<RosettaBookInfo | null, AppError> {
  if (!fingerprint.trim()) {
    return err({ code: 'INVALID_ARGUMENT', message: '缺少文件指纹' })
  }
  const db = openBookDb(userDataDir, fingerprint.trim())
  return getRosettaBookInfoInDb(db, fingerprint)
}
