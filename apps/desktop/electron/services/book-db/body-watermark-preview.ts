import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { err, ok, type Result } from '@montree/contracts'
import type { AppError } from '@montree/contracts'
import type { BookBlockType } from '@montree/contracts'
import type {
  RosettaBodyWatermarkPreviewResult,
  RosettaBodyWatermarkPreviewSample,
} from '@montree/contracts'
import {
  computeBodyWatermarkPlanSignature,
  planBodyWatermarkPatches,
  validateCustomEdgeToken,
  type BodyBlockInput,
  type BodyWatermarkPatch,
} from '@montree/ocr-core'
import { getBookDbPath } from './open-book-db'
import { getBookRecord } from './queries'

/**
 * 正文水印清洗只读预览（Phase 2.2“预览，不应用”）。
 *
 * 只读边界：
 * - 文件入口先 `existsSync` 判存在，不存在直接返回错误，绝不调用会建库的开库器；
 * - 以 `readOnly` 打开 + `PRAGMA query_only = ON`，全链路仅做读查询，零写入、不写备份；
 * - 不碰 schema / OCR / 目录 / cleanVersion / FTS / 缓存。
 */

/** 预览最多返回的样例条数 */
export const BODY_WATERMARK_PREVIEW_MAX_SAMPLES = 20
/** 样例正文截断长度（超出补 …） */
export const BODY_WATERMARK_PREVIEW_TEXT_LIMIT = 80

export function truncatePreviewText(text: string): string {
  if (text.length <= BODY_WATERMARK_PREVIEW_TEXT_LIMIT) return text
  return `${text.slice(0, BODY_WATERMARK_PREVIEW_TEXT_LIMIT)}…`
}

/** 校验按页筛选：undefined/null 视为未传（全局）；其余须为正整数 */
function normalizeSamplePage(input: unknown): Result<number | null, AppError> {
  if (input === undefined || input === null) return ok(null)
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 1) {
    return err({ code: 'INVALID_ARGUMENT', message: '页码须为正整数' })
  }
  return ok(input)
}

function toSample(patch: BodyWatermarkPatch): RosettaBodyWatermarkPreviewSample {
  const sample: RosettaBodyWatermarkPreviewSample = {
    id: patch.id,
    pageNumber: patch.pageNumber,
    action: patch.action,
    reason: patch.reason,
    before: truncatePreviewText(patch.before),
  }
  if (patch.action === 'update' && typeof patch.after === 'string') {
    sample.after = truncatePreviewText(patch.after)
  }
  return sample
}

/** 已打开库上的只读汇总：读块 → 规划器 → 计数/聚合/截断样例；不写库 */
export function previewBodyWatermarkInDb(
  db: DatabaseSync,
  fingerprint: string,
  samplePage?: number | null,
  customToken?: unknown,
): Result<RosettaBodyWatermarkPreviewResult, AppError> {
  const fp = typeof fingerprint === 'string' ? fingerprint.trim() : ''
  if (!fp) {
    return err({ code: 'INVALID_ARGUMENT', message: '缺少文件指纹' })
  }
  const pageResult = normalizeSamplePage(samplePage)
  if (!pageResult.ok) return pageResult
  // P1 自定义 token：非法直接拒绝（带校验原因），不读库
  let customEdgeToken: unknown
  if (customToken !== undefined && customToken !== null) {
    const validated = validateCustomEdgeToken(customToken)
    if (!validated.ok) {
      return err({ code: 'INVALID_ARGUMENT', message: validated.reason })
    }
    customEdgeToken = validated.token
  }
  const record = getBookRecord(db, fp)
  if (!record) {
    return err({ code: 'INVALID_STATE', message: '本书尚未导入罗盘索引' })
  }
  const rows = db
    .prepare(
      `SELECT id, type AS type, content, page_number AS pageNumber
       FROM blocks WHERE book_id = ? ORDER BY page_number ASC, id ASC`,
    )
    .all(record.bookId) as { id?: unknown; type?: unknown; content?: unknown; pageNumber?: unknown }[]
  const inputs: BodyBlockInput[] = []
  for (const row of rows) {
    if (typeof row?.id !== 'number' || typeof row?.content !== 'string') continue
    if (typeof row?.pageNumber !== 'number' || !Number.isInteger(row.pageNumber)) continue
    inputs.push({
      id: row.id,
      type: (typeof row.type === 'string' ? row.type : 'paragraph') as BookBlockType,
      content: row.content,
      pageNumber: row.pageNumber,
    })
  }
  const patches = planBodyWatermarkPatches(inputs, { customEdgeToken })
  let deleteCount = 0
  let updateCount = 0
  const pages = new Set<number>()
  const reasonCounts: Record<string, number> = {}
  for (const patch of patches) {
    if (patch.action === 'delete') deleteCount += 1
    else updateCount += 1
    pages.add(patch.pageNumber)
    reasonCounts[patch.reason] = (reasonCounts[patch.reason] ?? 0) + 1
  }
  return ok({
    fingerprint: fp,
    bookId: record.bookId,
    totalPatches: patches.length,
    deleteCount,
    updateCount,
    pageCount: pages.size,
    reasonCounts,
    // 统计始终全局；仅样例按页过滤，未传返回全局前 20 条
    samples: (pageResult.value === null
      ? patches
      : patches.filter((patch) => patch.pageNumber === pageResult.value)
    )
      .slice(0, BODY_WATERMARK_PREVIEW_MAX_SAMPLES)
      .map(toSample),
    samplePage: pageResult.value,
    // Phase 2.2 计数/样例语义不动；仅新增确定性签名供应用守卫复用
    planSignature: computeBodyWatermarkPlanSignature(patches),
  })
}

/** 文件入口：判存在 → readOnly + query_only 只读打开 → 汇总；不存在绝不建库 */
export function previewBodyWatermarkFile(
  userDataDir: string,
  fingerprint: string,
  samplePage?: number | null,
  customToken?: unknown,
): Result<RosettaBodyWatermarkPreviewResult, AppError> {
  const fp = typeof fingerprint === 'string' ? fingerprint.trim() : ''
  if (!fp) {
    return err({ code: 'INVALID_ARGUMENT', message: '缺少文件指纹' })
  }
  const pageResult = normalizeSamplePage(samplePage)
  if (!pageResult.ok) return pageResult
  if (customToken !== undefined && customToken !== null) {
    const validated = validateCustomEdgeToken(customToken)
    if (!validated.ok) {
      return err({ code: 'INVALID_ARGUMENT', message: validated.reason })
    }
  }
  const dbPath = getBookDbPath(userDataDir, fp)
  if (!existsSync(dbPath)) {
    return err({ code: 'FILE_NOT_FOUND', message: '本书尚未导入罗盘索引' })
  }
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
    db.exec('PRAGMA query_only = ON')
    return previewBodyWatermarkInDb(db, fp, pageResult.value, customToken)
  } catch (cause) {
    return err({
      code: 'UNKNOWN',
      message: cause instanceof Error ? cause.message : '正文水印预览失败',
    })
  } finally {
    try {
      db?.close()
    } catch {
      // 只读句柄关闭失败不影响预览结果
    }
  }
}
