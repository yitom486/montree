import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { err, ok, type Result } from '@montree/contracts'
import type { AppError } from '@montree/contracts'
import type { BookBlockType } from '@montree/contracts'
import type {
  RosettaBodyWatermarkApplyPayload,
  RosettaBodyWatermarkApplyResult,
} from '@montree/contracts'
import {
  computeBodyWatermarkPlanSignature,
  planBodyWatermarkPatches,
  type BodyBlockInput,
  type BodyWatermarkPatch,
} from '@montree/ocr-core'
import { getBookDbPath } from './open-book-db'
import { migrateBookDb } from './schema'
import { getBookRecord } from './queries'

/**
 * 正文水印清洗备份并应用（Phase 2.3）。
 *
 * 安全边界：
 * - 写入前在同一连接重算计划并比对签名 + delete/update 统计，不一致零写入；
 * - 先备份（同目录时间戳、不可覆盖）并校验通过，才允许进入写事务；备份失败不写库；
 * - 全部变更在一个 BEGIN IMMEDIATE 事务中，`UPDATE ... WHERE id=? AND content=?`
 *   与 `DELETE ... WHERE id=? AND content=?` 条件写，每条 changes===1 否则全回滚；
 * - 仅改 blocks.content 或删水印块，不碰 books/chapters/toc_entries/目录缓存/OCR/schema/cleanVersion；
 *   FTS 靠现有 blocks_ai/ad/au 触发器同步，不手动写 block_fts；
 * - 提交后同一连接校验：blocks = 原行数 - 删除数、目录数据不变、FTS == blocks。
 */

export interface ApplyBodyWatermarkExpected {
  planSignature: string
  deleteCount: number
  updateCount: number
}

export interface ApplyBodyWatermarkOptions {
  /** 文件库原始路径（文件入口透传，用于同目录备份）；内存库传 ':memory:' 或不传 */
  dbPath?: string
  /** 内存库测试用：备份落盘目录（tmp）；文件库可不传（默认同目录） */
  backupDir?: string
  /** 测试用：强制指定备份路径（存在即视为不可覆盖失败） */
  backupPathOverride?: string
  /** 测试用：固定备份时间戳 */
  now?: Date
  /** 测试用：mock 注入备份失败（如 () => { throw new Error('no space') }） */
  vacuumRunner?: (db: DatabaseSync, backupPath: string) => void
  /**
   * 测试用：备份校验通过后、BEGIN 前的并发篡改钩子（模拟另一连接在重算后改库，
   * 使条件写 changes=0 触发全回滚）。生产调用不传。
   */
  onBeforeTransaction?: (db: DatabaseSync) => void
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isPlanSignature(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

/** 时间戳 `YYYYMMDD-HHmmss-SSS`（本地时间，Windows 无冒号，可做文件名） */
export function formatBodyWatermarkBackupTimestamp(now: Date = new Date()): string {
  const pad = (n: number, len = 2): string => String(n).padStart(len, '0')
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}` +
    `-${pad(now.getMilliseconds(), 3)}`
  )
}

/**
 * 同目录、不可覆盖的时间戳备份路径：`<dbPath>.<timestamp>.bak`，
 * 已存在则追加 `-1/-2/...`。调用方仍须处理 VACUUM INTO 的 exists 失败（双保险）。
 */
export function resolveBodyWatermarkBackupPath(dbPath: string, now: Date = new Date()): string {
  const stamp = formatBodyWatermarkBackupTimestamp(now)
  const base = `${dbPath}.${stamp}.bak`
  if (!existsSync(base)) return base
  for (let i = 1; i < 1000; i += 1) {
    const candidate = `${dbPath}.${stamp}-${i}.bak`
    if (!existsSync(candidate)) return candidate
  }
  // 极端冲突：追加随机后缀，仍不可覆盖
  return `${dbPath}.${stamp}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.bak`
}

function resolveBackupPathForDb(
  opts: ApplyBodyWatermarkOptions | undefined,
  now: Date,
): Result<string, AppError> {
  if (opts?.backupPathOverride) {
    if (existsSync(opts.backupPathOverride)) {
      return err({ code: 'FILE_WRITE_ERROR', message: '备份文件已存在，拒绝覆盖' })
    }
    return ok(opts.backupPathOverride)
  }
  const dbPath = opts?.dbPath
  if (typeof dbPath === 'string' && dbPath !== '' && dbPath !== ':memory:') {
    return ok(resolveBodyWatermarkBackupPath(dbPath, now))
  }
  const backupDir = opts?.backupDir
  if (typeof backupDir === 'string' && backupDir !== '') {
    const stamp = formatBodyWatermarkBackupTimestamp(now)
    const base = join(backupDir, `book.db.${stamp}.bak`)
    if (!existsSync(base)) return ok(base)
    for (let i = 1; i < 1000; i += 1) {
      const candidate = join(backupDir, `book.db.${stamp}-${i}.bak`)
      if (!existsSync(candidate)) return ok(candidate)
    }
    return ok(join(backupDir, `book.db.${stamp}-${Date.now()}.bak`))
  }
  return err({ code: 'INVALID_ARGUMENT', message: '缺少备份落盘位置' })
}

function loadPatches(db: DatabaseSync, bookId: number): BodyWatermarkPatch[] {
  const rows = db
    .prepare(
      `SELECT id, type AS type, content, page_number AS pageNumber
       FROM blocks WHERE book_id = ? ORDER BY page_number ASC, id ASC`,
    )
    .all(bookId) as { id?: unknown; type?: unknown; content?: unknown; pageNumber?: unknown }[]
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
  return planBodyWatermarkPatches(inputs)
}

interface CoreCounts {
  blocks: number
  chapters: number
  tocEntries: number
  tocSignature: string
  completedPagesRaw: string
  cleanVersion: string
  globalBlocks: number
  ftsRows: number
}

function countOr(
  db: DatabaseSync,
  sql: string,
  params: Array<string | number | null>,
  fallback: number,
): number {
  try {
    const row = db.prepare(sql).get(...params) as { total?: unknown } | undefined
    return typeof row?.total === 'number' ? row.total : fallback
  } catch {
    return fallback
  }
}

function textOr(
  db: DatabaseSync,
  sql: string,
  params: Array<string | number | null>,
  fallback: string,
): string {
  try {
    const row = db.prepare(sql).get(...params) as Record<string, unknown> | undefined
    const first = row ? Object.values(row)[0] : undefined
    return typeof first === 'string' ? first : fallback
  } catch {
    return fallback
  }
}

function readCoreCounts(db: DatabaseSync, bookId: number): CoreCounts {
  return {
    blocks: countOr(db, 'SELECT COUNT(*) AS total FROM blocks WHERE book_id = ?', [bookId], -1),
    chapters: countOr(db, 'SELECT COUNT(*) AS total FROM chapters WHERE book_id = ?', [bookId], -1),
    tocEntries: countOr(
      db,
      'SELECT COUNT(*) AS total FROM toc_entries WHERE book_id = ?',
      [bookId],
      -1,
    ),
    tocSignature: textOr(db, 'SELECT toc_signature AS v FROM books WHERE id = ?', [bookId], ''),
    completedPagesRaw: textOr(
      db,
      'SELECT completed_pages AS v FROM books WHERE id = ?',
      [bookId],
      '[]',
    ),
    cleanVersion: textOr(db, 'SELECT clean_version AS v FROM books WHERE id = ?', [bookId], ''),
    globalBlocks: countOr(db, 'SELECT COUNT(*) AS total FROM blocks', [], -1),
    ftsRows: countOr(db, 'SELECT COUNT(*) AS total FROM block_fts', [], -1),
  }
}

/** 已打开库上的备份并应用：重算比对 → 备份校验 → 单事务条件写 → 提交后校验；不建库不碰目录 */
export function applyBodyWatermarkInDb(
  db: DatabaseSync,
  fingerprint: string,
  expected: ApplyBodyWatermarkExpected,
  opts?: ApplyBodyWatermarkOptions,
): Result<RosettaBodyWatermarkApplyResult, AppError> {
  const fp = typeof fingerprint === 'string' ? fingerprint.trim() : ''
  if (!fp) return err({ code: 'INVALID_ARGUMENT', message: '缺少文件指纹' })
  if (!isPlanSignature(expected?.planSignature)) {
    return err({ code: 'INVALID_ARGUMENT', message: '缺少计划签名' })
  }
  if (!isNonNegativeInt(expected?.deleteCount) || !isNonNegativeInt(expected?.updateCount)) {
    return err({ code: 'INVALID_ARGUMENT', message: '计划统计无效' })
  }
  const record = getBookRecord(db, fp)
  if (!record) {
    return err({ code: 'INVALID_STATE', message: '本书尚未导入罗盘索引' })
  }
  const bookId = record.bookId

  // 同一连接重算计划并比对：签名或统计不一致立即中止，零写入（备份都未建）
  const patches = loadPatches(db, bookId)
  const actualSignature = computeBodyWatermarkPlanSignature(patches)
  let actualDelete = 0
  let actualUpdate = 0
  for (const patch of patches) {
    if (patch.action === 'delete') actualDelete += 1
    else actualUpdate += 1
  }
  if (
    actualSignature !== expected.planSignature ||
    actualDelete !== expected.deleteCount ||
    actualUpdate !== expected.updateCount
  ) {
    return err({ code: 'INVALID_STATE', message: '计划签名或统计不一致，已中止（零写入）' })
  }

  const before = readCoreCounts(db, bookId)

  // 空计划幂等：签名匹配且 0/0，直接返回 noop，不备份不写库（非报错）
  if (patches.length === 0) {
    return ok({
      fingerprint: fp,
      bookId,
      planSignature: actualSignature,
      deleteCount: 0,
      updateCount: 0,
      totalPatches: 0,
      status: 'noop',
      backupPath: '',
      backupSize: 0,
      backupHash: '',
      blocksBefore: before.blocks,
      blocksAfter: before.blocks,
    })
  }

  // 备份：同目录时间戳、不可覆盖；先完成并校验才允许进入写事务
  const now = opts?.now ?? new Date()
  const backupPathResult = resolveBackupPathForDb(opts, now)
  if (!backupPathResult.ok) return backupPathResult
  const backupPath = backupPathResult.value
  // 防御：派生路径也可能在并发下被占位，存在即拒（VACUUM 自身也会拒）
  if (existsSync(backupPath)) {
    return err({ code: 'FILE_WRITE_ERROR', message: '备份文件已存在，拒绝覆盖' })
  }
  const vacuumRunner =
    opts?.vacuumRunner ??
    ((target: DatabaseSync, targetPath: string): void => {
      target.prepare('VACUUM INTO ?').run(targetPath)
    })
  try {
    vacuumRunner(db, backupPath)
  } catch (cause) {
    return err({
      code: 'FILE_WRITE_ERROR',
      message: cause instanceof Error ? `备份失败，未写库：${cause.message}` : '备份失败，未写库',
    })
  }
  let backupSize = 0
  let backupHash = ''
  if (!existsSync(backupPath)) {
    return err({ code: 'FILE_WRITE_ERROR', message: '备份文件缺失，未写库' })
  }
  try {
    const stat = statSync(backupPath)
    if (!stat.isFile() || stat.size <= 0) {
      return err({ code: 'FILE_WRITE_ERROR', message: '备份文件为空，未写库' })
    }
    backupSize = stat.size
    backupHash = createHash('sha256').update(readFileSync(backupPath)).digest('hex')
  } catch (cause) {
    return err({
      code: 'FILE_WRITE_ERROR',
      message: cause instanceof Error ? `备份校验失败，未写库：${cause.message}` : '备份校验失败，未写库',
    })
  }
  // 只读打开校验核心计数一致
  {
    let backupDb: DatabaseSync | undefined
    try {
      backupDb = new DatabaseSync(backupPath, { readOnly: true })
      const backupCounts = readCoreCounts(backupDb, bookId)
      if (
        backupCounts.blocks !== before.blocks ||
        backupCounts.chapters !== before.chapters ||
        backupCounts.tocEntries !== before.tocEntries ||
        backupCounts.tocSignature !== before.tocSignature ||
        backupCounts.completedPagesRaw !== before.completedPagesRaw ||
        backupCounts.cleanVersion !== before.cleanVersion
      ) {
        return err({ code: 'FILE_WRITE_ERROR', message: '备份校验不一致，未写库' })
      }
    } catch (cause) {
      return err({
        code: 'FILE_WRITE_ERROR',
        message:
          cause instanceof Error ? `备份校验失败，未写库：${cause.message}` : '备份校验失败，未写库',
      })
    } finally {
      try {
        backupDb?.close()
      } catch {
        // 关闭失败不影响已校验的备份
      }
    }
  }

  // 写事务：全部变更在一个 BEGIN IMMEDIATE 中，条件写 + changes===1 守卫
  // 测试钩子在 BEGIN 前执行，用于模拟重算后、写事务前的并发篡改
  if (opts?.onBeforeTransaction) {
    try {
      opts.onBeforeTransaction(db)
    } catch (cause) {
      return err({
        code: 'UNKNOWN',
        message: cause instanceof Error ? `写前钩子失败：${cause.message}` : '写前钩子失败',
      })
    }
  }
  try {
    db.exec('BEGIN IMMEDIATE')
  } catch (cause) {
    return err({
      code: 'UNKNOWN',
      message: cause instanceof Error ? `写事务开启失败：${cause.message}` : '写事务开启失败',
    })
  }
  try {
    const updateStmt = db.prepare('UPDATE blocks SET content=? WHERE id=? AND content=?')
    const deleteStmt = db.prepare('DELETE FROM blocks WHERE id=? AND content=?')
    for (const patch of patches) {
      let changes = 0
      if (patch.action === 'update') {
        if (typeof patch.after !== 'string') {
          throw new Error(`补丁缺少 after：id=${patch.id}`)
        }
        const result = updateStmt.run(patch.after, patch.id, patch.before) as unknown as {
          changes?: unknown
        }
        changes = typeof result?.changes === 'number' ? result.changes : 0
      } else {
        const result = deleteStmt.run(patch.id, patch.before) as unknown as {
          changes?: unknown
        }
        changes = typeof result?.changes === 'number' ? result.changes : 0
      }
      if (changes !== 1) {
        throw new Error(`乐观并发冲突：id=${patch.id} changes=${changes}`)
      }
    }

    // 事务内校验（提交前）：任一不符即回滚
    const mid = readCoreCounts(db, bookId)
    if (mid.blocks !== before.blocks - actualDelete) {
      throw new Error(`块数校验失败：${before.blocks}→${mid.blocks}，期望删除 ${actualDelete}`)
    }
    if (
      mid.chapters !== before.chapters ||
      mid.tocEntries !== before.tocEntries ||
      mid.tocSignature !== before.tocSignature ||
      mid.completedPagesRaw !== before.completedPagesRaw ||
      mid.cleanVersion !== before.cleanVersion
    ) {
      throw new Error('目录/版本数据被触碰，已回滚')
    }
    if (mid.ftsRows !== mid.globalBlocks) {
      throw new Error(`FTS 未同步：fts=${mid.ftsRows} blocks=${mid.globalBlocks}`)
    }

    db.exec('COMMIT')

    // 提交后同一连接内复验
    const after = readCoreCounts(db, bookId)
    if (after.blocks !== before.blocks - actualDelete) {
      return err({ code: 'UNKNOWN', message: '提交后块数校验失败' })
    }
    if (
      after.chapters !== before.chapters ||
      after.tocEntries !== before.tocEntries ||
      after.tocSignature !== before.tocSignature ||
      after.completedPagesRaw !== before.completedPagesRaw ||
      after.cleanVersion !== before.cleanVersion
    ) {
      return err({ code: 'UNKNOWN', message: '提交后目录数据校验失败' })
    }
    if (after.ftsRows !== after.globalBlocks) {
      return err({ code: 'UNKNOWN', message: '提交后 FTS 校验失败' })
    }

    return ok({
      fingerprint: fp,
      bookId,
      planSignature: actualSignature,
      deleteCount: actualDelete,
      updateCount: actualUpdate,
      totalPatches: patches.length,
      status: 'applied',
      backupPath,
      backupSize,
      backupHash,
      blocksBefore: before.blocks,
      blocksAfter: after.blocks,
    })
  } catch (cause) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // 回滚失败保留原错
    }
    const message = cause instanceof Error ? cause.message : '应用失败，已回滚'
    if (message.includes('乐观并发冲突')) {
      return err({ code: 'INVALID_STATE', message: `${message}，已整体回滚` })
    }
    if (message.includes('校验失败') || message.includes('被触碰') || message.includes('FTS')) {
      return err({ code: 'UNKNOWN', message: `${message}，已整体回滚` })
    }
    return err({ code: 'UNKNOWN', message: `${message}，已整体回滚` })
  }
}

/** 文件入口：判存在 → 读写打开 → 同一连接备份+应用；不存在绝不建库 */
export function applyBodyWatermarkFile(
  userDataDir: string,
  fingerprint: string,
  payload: RosettaBodyWatermarkApplyPayload,
  opts?: Omit<ApplyBodyWatermarkOptions, 'dbPath'>,
): Result<RosettaBodyWatermarkApplyResult, AppError> {
  const fp = typeof fingerprint === 'string' ? fingerprint.trim() : ''
  if (!fp) return err({ code: 'INVALID_ARGUMENT', message: '缺少文件指纹' })
  if (!isPlanSignature(payload?.planSignature)) {
    return err({ code: 'INVALID_ARGUMENT', message: '缺少计划签名' })
  }
  if (!isNonNegativeInt(payload?.deleteCount) || !isNonNegativeInt(payload?.updateCount)) {
    return err({ code: 'INVALID_ARGUMENT', message: '计划统计无效' })
  }
  const dbPath = getBookDbPath(userDataDir, fp)
  if (!existsSync(dbPath)) {
    return err({ code: 'FILE_NOT_FOUND', message: '本书尚未导入罗盘索引' })
  }
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(dbPath)
    // 写前与其他写路径一致先迁移（v4 加来源列；已迁移则空操作）
    migrateBookDb(db)
    return applyBodyWatermarkInDb(
      db,
      fp,
      { planSignature: payload.planSignature, deleteCount: payload.deleteCount, updateCount: payload.updateCount },
      { ...opts, dbPath },
    )
  } catch (cause) {
    return err({
      code: 'UNKNOWN',
      message: cause instanceof Error ? cause.message : '正文水印应用失败',
    })
  } finally {
    try {
      db?.close()
    } catch {
      // 写句柄关闭失败不掩盖应用结果（结果已在上面返回）
    }
  }
}
