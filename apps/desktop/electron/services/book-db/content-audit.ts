import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { err, ok, type Result } from '@montree/contracts'
import type { AppError } from '@montree/contracts'
import {
  CONTENT_AUDIT_HIT_TEXT_BUDGET,
  CONTENT_AUDIT_RESPONSE_TEXT_BUDGET,
  normalizeContentAuditQuery,
  parseContentAuditLimit,
  resolveContentAuditMatchPosition,
  windowContentAuditText,
  type ContentAuditHit,
  type ContentAuditResult,
} from '@montree/contracts'
import { getBookDbPath } from './open-book-db'
import { countSearchBookBlocks, getBookRecord, searchBookBlocks } from './queries'

/**
 * 已入库 PDF 内容审计（P0，只读取证）。
 *
 * 安全边界：
 * - 参数错误（指纹/检索词/条数）先报错，不碰文件系统；
 * - 库文件不存在直接 INVALID_STATE，绝不调用会建库的开库器、不迁移；
 * - 以 readOnly + query_only 打开，用完即关（不进句柄缓存，不留 -shm 残留）；
 * - 不调 OCR/导入/清洗/目录重建/写缓存；MCP 侧不得直连 SQLite，一律走本模块。
 */

function invalidArgument(message: string): Result<never, AppError> {
  return err({ code: 'INVALID_ARGUMENT', message })
}

function buildHits(
  blocks: ReturnType<typeof searchBookBlocks>,
  query: string,
): ContentAuditHit[] {
  // 单条预算：1200 封顶；多条时按总预算 7800 均摊，保证总响应受限且确定
  const perHitBudget = Math.min(
    CONTENT_AUDIT_HIT_TEXT_BUDGET,
    Math.floor(CONTENT_AUDIT_RESPONSE_TEXT_BUDGET / Math.max(1, blocks.length)),
  )
  return blocks.map((block) => {
    const windowed = windowContentAuditText(block.content, query, perHitBudget)
    return {
      source: 'book-index' as const,
      locator: {
        pageNumber: block.pageNumber,
        chapterTitle: block.chapterTitle,
        blockId: block.id,
      },
      text: windowed.text,
      textTruncated: windowed.truncated,
      matchPosition: resolveContentAuditMatchPosition(windowed.text, query),
    }
  })
}

/** 已打开库上的审计：参数校验 → 精确总数 → 取证（调用方保证只读打开） */
export function inspectIndexedContentInDb(
  db: DatabaseSync,
  fingerprint: string,
  rawQuery: unknown,
  rawLimit: unknown,
): Result<ContentAuditResult, AppError> {
  const fp = typeof fingerprint === 'string' ? fingerprint.trim() : ''
  if (!fp) return invalidArgument('缺少文件指纹')
  const query = normalizeContentAuditQuery(rawQuery)
  if (!query) return invalidArgument('检索词至少需要 3 个字符')
  const limit = parseContentAuditLimit(rawLimit)
  if (!limit) return invalidArgument('展示条数须为 1–10 的整数')
  const record = getBookRecord(db, fp)
  if (!record) {
    return err({ code: 'INVALID_STATE', message: '本书尚未导入罗盘索引' })
  }
  const total = countSearchBookBlocks(db, record.bookId, query)
  const blocks = total === 0 ? [] : searchBookBlocks(db, record.bookId, query, limit)
  const hits = buildHits(blocks, query)
  return ok({
    query,
    total,
    truncated: hits.length < total,
    limit,
    hits,
  })
}

/** 文件入口：判存在 → readOnly + query_only 只读打开 → 同连接审计；不存在绝不建库 */
export function inspectIndexedContentFile(
  userDataDir: string,
  fingerprint: string,
  rawQuery: unknown,
  rawLimit: unknown,
): Result<ContentAuditResult, AppError> {
  const fp = typeof fingerprint === 'string' ? fingerprint.trim() : ''
  if (!fp) return invalidArgument('缺少文件指纹')
  // 参数先行：文件系统碰都不碰
  const query = normalizeContentAuditQuery(rawQuery)
  if (!query) return invalidArgument('检索词至少需要 3 个字符')
  const limit = parseContentAuditLimit(rawLimit)
  if (!limit) return invalidArgument('展示条数须为 1–10 的整数')
  const dbPath = getBookDbPath(userDataDir, fp)
  if (!existsSync(dbPath)) {
    return err({ code: 'INVALID_STATE', message: '本书尚未导入罗盘索引' })
  }
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
    db.exec('PRAGMA query_only = ON')
    return inspectIndexedContentInDb(db, fp, query, limit)
  } catch (cause) {
    return err({
      code: 'UNKNOWN',
      message: cause instanceof Error ? cause.message : '内容审计失败',
    })
  } finally {
    try {
      db?.close()
    } catch {
      // 只读句柄关闭失败不掩盖审计结果
    }
  }
}
