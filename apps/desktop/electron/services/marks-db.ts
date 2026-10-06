import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  DueFlashcard,
  FlashcardReviewRating,
  MarkChapterRef,
  ReadingAnchor,
  ReadingMark,
  ReadingMarkCategory,
  ReadingMarkKind,
} from '@montree/contracts'
import { canonicalAnchorKey } from '@montree/contracts'
import {
  normalizeMarkFilePath as normalizeMarkFilePathCore,
  type SyncMarksPayload,
} from '@montree/annotations'
import type { ReadingMarksFile } from './reading-marks-service'
import { getBookDbDir, openBookDb } from './book-db/open-book-db'
import {
  appendReviewRow,
  countDueFlashcards,
  listDueFlashcardRows,
  markFlashcardOrphaned,
  upsertFlashcardForMark,
} from './flashcards-db'

/**
 * 卡片 SQL 后端（[2]-01）：各书 `book.db` v5 的 marks 表。
 * API 签名与文件版一致，上层（IPC/sync）零改；每本书的卡片住自己的库，
 * 章节过滤从 JS 逐条算变成 `WHERE chapter_key = ?` 走索引。
 */

interface MarksRow {
  id: string
  file_fingerprint: string
  file_path: string
  kind: string
  category: string | null
  title: string | null
  label: string | null
  note: string | null
  excerpt: string | null
  ai_summary: string | null
  key_points: string | null
  tags: string | null
  color: string | null
  collapsed: number
  diagram_id: string | null
  anchor_json: string
  anchor_format: string
  anchor_key: string
  chapter_key: string
  chapter_json: string | null
  chapter_id: number | null
  page_hint: number | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

function parseJsonArray(raw: string | null): string[] | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as string[]) : undefined
  } catch {
    return undefined
  }
}

function parseChapter(raw: string | null): MarkChapterRef | null | undefined {
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as MarkChapterRef
  } catch {
    return undefined
  }
}

export function rowToReadingMark(row: MarksRow): ReadingMark {
  return {
    id: row.id,
    filePath: row.file_path,
    fileFingerprint: row.file_fingerprint,
    kind: row.kind as ReadingMarkKind,
    anchor: JSON.parse(row.anchor_json) as ReadingAnchor,
    label: row.label ?? undefined,
    note: row.note ?? undefined,
    excerpt: row.excerpt ?? undefined,
    color: row.color ?? undefined,
    category: (row.category as ReadingMarkCategory | null) ?? undefined,
    title: row.title ?? undefined,
    aiSummary: row.ai_summary ?? undefined,
    keyPoints: parseJsonArray(row.key_points),
    tags: parseJsonArray(row.tags),
    collapsed: row.collapsed === 1 ? true : undefined,
    diagramId: row.diagram_id ?? undefined,
    chapter: parseChapter(row.chapter_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function pageHintForAnchor(anchor: ReadingAnchor): number | null {
  return anchor.format === 'pdf' ? anchor.page : null
}

export function insertMarkRow(db: DatabaseSync, mark: ReadingMark): void {
  db.prepare(
    `INSERT INTO marks (
      id, file_fingerprint, file_path, kind, category, title, label, note, excerpt,
      ai_summary, key_points, tags, color, collapsed, diagram_id,
      anchor_json, anchor_format, anchor_key, chapter_key, chapter_json, chapter_id, page_hint,
      created_at, updated_at, deleted_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL
    )`,
  ).get(
    mark.id,
    mark.fileFingerprint,
    mark.filePath,
    mark.kind,
    mark.category ?? null,
    mark.title ?? null,
    mark.label ?? null,
    mark.note ?? null,
    mark.excerpt ?? null,
    mark.aiSummary ?? null,
    mark.keyPoints ? JSON.stringify(mark.keyPoints) : null,
    mark.tags ? JSON.stringify(mark.tags) : null,
    mark.color ?? null,
    mark.collapsed ? 1 : 0,
    mark.diagramId ?? null,
    JSON.stringify(mark.anchor),
    mark.anchor.format,
    canonicalAnchorKey(mark.anchor),
    mark.chapter?.key ?? '',
    mark.chapter ? JSON.stringify(mark.chapter) : null,
    // chapter_id opportunistic：chapters 表无 key 列，01 期恒 NULL
    null,
    pageHintForAnchor(mark.anchor),
    mark.createdAt,
    mark.updatedAt,
  )
}

export function updateMarkRow(db: DatabaseSync, mark: ReadingMark): void {
  db.prepare(
    `UPDATE marks SET
      kind = ?, category = ?, title = ?, label = ?, note = ?, excerpt = ?,
      ai_summary = ?, key_points = ?, tags = ?, color = ?, collapsed = ?, diagram_id = ?,
      anchor_json = ?, anchor_format = ?, anchor_key = ?, chapter_key = ?, chapter_json = ?, page_hint = ?,
      updated_at = ?
    WHERE id = ?`,
  ).get(
    mark.kind,
    mark.category ?? null,
    mark.title ?? null,
    mark.label ?? null,
    mark.note ?? null,
    mark.excerpt ?? null,
    mark.aiSummary ?? null,
    mark.keyPoints ? JSON.stringify(mark.keyPoints) : null,
    mark.tags ? JSON.stringify(mark.tags) : null,
    mark.color ?? null,
    mark.collapsed ? 1 : 0,
    mark.diagramId ?? null,
    JSON.stringify(mark.anchor),
    mark.anchor.format,
    canonicalAnchorKey(mark.anchor),
    mark.chapter?.key ?? '',
    mark.chapter ? JSON.stringify(mark.chapter) : null,
    pageHintForAnchor(mark.anchor),
    mark.updatedAt,
    mark.id,
  )
}

export function getMarkRow(db: DatabaseSync, id: string): MarksRow | null {
  const row = db.prepare('SELECT * FROM marks WHERE id = ?').get(id) as MarksRow | undefined
  return row ?? null
}

/** 本书库内有效（未软删除）卡片；调用方再按归一化路径过滤（与文件版语义一致） */
export function listLiveMarkRows(db: DatabaseSync): MarksRow[] {
  return db
    .prepare('SELECT * FROM marks WHERE deleted_at IS NULL ORDER BY updated_at DESC')
    .all() as unknown as MarksRow[]
}

/**
 * 按章查卡（[3] 索引化章节查询）：`chapter_key IN (...)` 走
 * `idx_marks_chapter_key`；另捎带 `chapter_key = ''` 的未固化卡，
 * 调用方按 MarginaliaBar 同规则窄化（固化优先、缺失回落运行时解析），
 * 保证 DB/file 双后端输出一致。空 keys 直接返回空（调用方无章可查）。
 */
export function listMarkRowsByChapter(db: DatabaseSync, chapterKeys: string[]): MarksRow[] {
  const keys = [...new Set(chapterKeys.map((key) => key.trim()).filter(Boolean))]
  if (keys.length === 0) return []
  const placeholders = keys.map(() => '?').join(',')
  return db
    .prepare(
      `SELECT * FROM marks
       WHERE deleted_at IS NULL AND (chapter_key IN (${placeholders}) OR chapter_key = '')
       ORDER BY updated_at DESC`,
    )
    .all(...keys) as unknown as MarksRow[]
}

/**
 * 按锚查卡（一对多绑定的 DB 入口）：同一段正文的多张卡共享 anchor_key，
 * 无唯一约束、可共存；走 `idx_marks_anchor_key`。软删除排除。
 * 空 key 直接返回空（调用方无锚可查）。
 */
export function findLiveMarkRowsByAnchorKey(db: DatabaseSync, anchorKey: string): MarksRow[] {
  if (!anchorKey) return []
  return db
    .prepare(
      `SELECT * FROM marks
       WHERE deleted_at IS NULL AND anchor_key = ?
       ORDER BY updated_at DESC`,
    )
    .all(anchorKey) as unknown as MarksRow[]
}

function normalizeFilePath(filePath: string): string {
  return normalizeMarkFilePathCore(filePath, process.platform)
}

function listBookDbFiles(userDataDir: string): string[] {
  try {
    return readdirSync(join(userDataDir, 'book-index'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/** 探测打开：只 SELECT，不触发迁移；调用方负责 close */
function openDbProbe(userDataDir: string, dirName: string): DatabaseSync | null {
  const dbPath = join(userDataDir, 'book-index', dirName, 'book.db')
  if (!existsSync(dbPath)) return null
  try {
    return new DatabaseSync(dbPath)
  } catch {
    return null
  }
}

function closeQuietly(db: DatabaseSync | null): void {
  if (!db) return
  try {
    db.close()
  } catch {
    // 忽略
  }
}

/**
 * filePath → fingerprint：先查各库 books.source_path（索引入库的书），
 * 再退化查 marks.file_path（有卡但未索引的书）。
 * 若同一书籍因指纹格式演进（如裸路径升级为 路径|大小）分散在多个库，
 * 优先选定精准主库，并自动将旧库卡片合并至主库，杜绝双库幽灵隔离。
 */
export function resolveFingerprintForFile(
  userDataDir: string,
  filePath: string,
): string | null {
  const wanted = normalizeFilePath(filePath)
  const candidates: Array<{
    dirName: string
    fingerprint: string
    isDirectBook: boolean
    markCount: number
    latestUpdatedAt: number
  }> = []

  for (const dirName of listBookDbFiles(userDataDir)) {
    const db = openDbProbe(userDataDir, dirName)
    if (!db) continue
    try {
      let directFingerprint: string | null = null
      try {
        const rows = db
          .prepare('SELECT fingerprint, source_path FROM books')
          .all() as Array<{ fingerprint: string; source_path: string }>
        directFingerprint = rows.find((row) => normalizeFilePath(row.source_path) === wanted)?.fingerprint ?? null
      } catch {
        // 无 books 表的老库
      }

      let marksFingerprint: string | null = null
      let markCount = 0
      let latestUpdatedAt = 0
      try {
        const rows = db
          .prepare(
            'SELECT file_fingerprint, file_path, updated_at FROM marks WHERE deleted_at IS NULL',
          )
          .all() as Array<{ file_fingerprint: string; file_path: string; updated_at: number }>
        const matching = rows.filter((row) => normalizeFilePath(row.file_path) === wanted)
        if (matching.length > 0) {
          markCount = matching.length
          marksFingerprint = matching[0]!.file_fingerprint
          latestUpdatedAt = Math.max(...matching.map((m) => m.updated_at ?? 0))
        }
      } catch {
        // 无 marks 表
      }

      const hitFp = directFingerprint ?? marksFingerprint
      if (hitFp) {
        candidates.push({
          dirName,
          fingerprint: hitFp,
          isDirectBook: Boolean(directFingerprint),
          markCount,
          latestUpdatedAt,
        })
      }
    } catch {
      // 单库异常不阻断
    } finally {
      closeQuietly(db)
    }
  }

  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]!.fingerprint

  // 多个候选库（历史指纹演化）：优选主指纹
  // 优先级：1. 带 | 大小后缀的精准指纹 2. 属于 books 索引表直接登记 3. 卡片数多 4. 最近更新
  candidates.sort((a, b) => {
    const aHasPipe = a.fingerprint.includes('|') ? 1 : 0
    const bHasPipe = b.fingerprint.includes('|') ? 1 : 0
    if (aHasPipe !== bHasPipe) return bHasPipe - aHasPipe

    const aDirect = a.isDirectBook ? 1 : 0
    const bDirect = b.isDirectBook ? 1 : 0
    if (aDirect !== bDirect) return bDirect - aDirect

    if (a.markCount !== b.markCount) return b.markCount - a.markCount
    return b.latestUpdatedAt - a.latestUpdatedAt
  })

  const primary = candidates[0]!

  // 将其它副库中属于该书的卡片自动迁移汇聚到主库，确保全部历史与新卡合体
  try {
    const primaryDb = openBookDb(userDataDir, primary.fingerprint)
    for (let i = 1; i < candidates.length; i++) {
      const secondary = candidates[i]!
      if (secondary.markCount === 0) continue
      const secDb = openDbProbe(userDataDir, secondary.dirName)
      if (!secDb) continue
      try {
        const secRows = secDb
          .prepare('SELECT * FROM marks WHERE deleted_at IS NULL')
          .all() as unknown as MarksRow[]
        for (const row of secRows) {
          if (normalizeFilePath(row.file_path) !== wanted) continue
          if (!getMarkRow(primaryDb, row.id)) {
            const mark = rowToReadingMark(row)
            insertMarkRow(primaryDb, {
              ...mark,
              fileFingerprint: primary.fingerprint,
            })
            syncFlashcardForMark(userDataDir, primary.fingerprint, primaryDb, mark)
          }
        }
      } finally {
        closeQuietly(secDb)
      }
    }
  } catch {
    // 合并不阻断主流程
  }

  return primary.fingerprint
}

/** mark id → 所在库（更新/删除路径用；低频，全量扫描可接受） */
export function findMarkDb(
  userDataDir: string,
  id: string,
): { db: DatabaseSync; fingerprint: string } | null {
  for (const dirName of listBookDbFiles(userDataDir)) {
    const probe = openDbProbe(userDataDir, dirName)
    if (!probe) continue
    let fingerprint: string | null = null
    try {
      const row = probe.prepare('SELECT file_fingerprint FROM marks WHERE id = ?').get(id) as
        | { file_fingerprint: string }
        | undefined
      fingerprint = row?.file_fingerprint ?? null
    } catch {
      // 无 marks 表：忽略
    } finally {
      closeQuietly(probe)
    }
    if (fingerprint) return { db: openBookDb(userDataDir, fingerprint), fingerprint }
  }
  return null
}

/**
 * FTS 搜本书卡片（标题/摘录/批注/AI 洞见），软删除排除。
 * FTS5 trigram 查不了 <3 字的词（原理限制，blocks 搜索同样）：
 * 短词走 LIKE 兜底（单书量级，全表扫可接受）。
 */
export function searchMarks(
  userDataDir: string,
  fingerprint: string,
  query: string,
): ReadingMark[] {
  const keyword = query.trim()
  if (!keyword) return []
  const db = openBookDb(userDataDir, fingerprint)
  if ([...keyword].length >= 3) {
    const rows = db
      .prepare(
        `SELECT m.* FROM marks_fts JOIN marks m ON m.rowid = marks_fts.rowid
         WHERE marks_fts MATCH ? AND m.deleted_at IS NULL
         ORDER BY m.updated_at DESC`,
      )
      .all(escapeFtsPhrase(keyword)) as unknown as MarksRow[]
    return rows.map(rowToReadingMark)
  }
  const like = `%${keyword.replace(/[%_\\]/g, (char) => `\\${char}`)}%`
  const rows = db
    .prepare(
      `SELECT * FROM marks WHERE deleted_at IS NULL AND (
        title LIKE ? ESCAPE '\\' OR excerpt LIKE ? ESCAPE '\\'
        OR note LIKE ? ESCAPE '\\' OR ai_summary LIKE ? ESCAPE '\\'
      ) ORDER BY updated_at DESC`,
    )
    .all(like, like, like, like) as unknown as MarksRow[]
  return rows.map(rowToReadingMark)
}

/** FTS5 查询转义：包双引号短语（与 searchBookBlocks 同口径） */
function escapeFtsPhrase(keyword: string): string {
  return `"${keyword.replace(/"/g, '""')}"`
}

/** 同步/导出：全书架有效卡片 + 全量 tombstones（读库导出，merge 纯函数不变） */
export function exportMarksStore(userDataDir: string): ReadingMarksFile {
  const marks: ReadingMark[] = []
  const tombstones: Record<string, number> = {}
  // 未解析 id 的远端 tombstones 溢出文件（import 时写，见 importMarksStore）
  try {
    const overflow = readFileSync(join(userDataDir, 'marks-tombstones.json'), 'utf-8')
    Object.assign(tombstones, JSON.parse(overflow) as Record<string, number>)
  } catch {
    // 无溢出文件是常态
  }
  for (const dirName of listBookDbFiles(userDataDir)) {
    const db = openDbProbe(userDataDir, dirName)
    if (!db) continue
    try {
      for (const row of listLiveMarkRows(db)) marks.push(rowToReadingMark(row))
      try {
        const tombRows = db
          .prepare('SELECT mark_id, deleted_at FROM marks_tombstones')
          .all() as Array<{ mark_id: string; deleted_at: number }>
        for (const tomb of tombRows) tombstones[tomb.mark_id] = tomb.deleted_at
      } catch {
        // 旧库无 tombstones 表（v5 前）：忽略
      }
    } catch {
      // 单库损坏不阻断
    } finally {
      closeQuietly(db)
    }
  }
  marks.sort((a, b) => b.updatedAt - a.updatedAt)
  return { marks, tombstones }
}

/**
 * 同步/迁移写回：读库导出 ⇄ 合并 ⇄ 写库（sync-manager 零改）。
 * tombstones 若定位不到归属库，进全局溢出文件（远端删了我方从未见过的卡）。
 */
export function importMarksStore(userDataDir: string, store: SyncMarksPayload): void {
  for (const mark of store.marks) {
    if (!mark.fileFingerprint) continue
    const db = openBookDb(userDataDir, mark.fileFingerprint)
    const existing = getMarkRow(db, mark.id)
    if (existing) {
      if (existing.deleted_at !== null) {
        db.prepare('UPDATE marks SET deleted_at = NULL WHERE id = ?').get(mark.id)
      }
      updateMarkRow(db, mark)
    } else {
      insertMarkRow(db, mark)
    }
    // 同步复活的卡一并解 orphan，快照跟随最新
    syncFlashcardForMark(userDataDir, mark.fileFingerprint, db, mark)
  }
  const overflow: Record<string, number> = {}
  for (const [markId, deletedAt] of Object.entries(store.tombstones ?? {})) {
    const found = findMarkDb(userDataDir, markId)
    if (found) {
      found.db.prepare('DELETE FROM marks WHERE id = ?').get(markId)
      found.db
        .prepare('INSERT OR REPLACE INTO marks_tombstones (mark_id, deleted_at) VALUES (?, ?)')
        .get(markId, deletedAt)
      // 远端删的卡本地标脏（复习日志保留，待复习排除）
      markFlashcardOrphaned(found.db, markId, deletedAt)
    } else {
      overflow[markId] = deletedAt
    }
  }
  if (Object.keys(overflow).length > 0) {
    writeFileSync(join(userDataDir, 'marks-tombstones.json'), JSON.stringify(overflow, null, 2))
  }
}

/** 一次性迁移：reading-marks.json 按 fingerprint 灌各书库（含脏卡） */
export function migrateMarksStoreToDb(
  userDataDir: string,
  store: ReadingMarksFile,
): { migrated: number; skipped: number } {
  let migrated = 0
  let skipped = 0
  for (const mark of store.marks) {
    if (!mark.fileFingerprint) {
      skipped += 1
      continue
    }
    const db = openBookDb(userDataDir, mark.fileFingerprint)
    if (getMarkRow(db, mark.id)) {
      skipped += 1
      continue
    }
    insertMarkRow(db, mark)
    syncFlashcardForMark(userDataDir, mark.fileFingerprint, db, mark)
    migrated += 1
  }
  for (const [markId, deletedAt] of Object.entries(store.tombstones ?? {})) {
    const found = findMarkDb(userDataDir, markId)
    if (found) {
      found.db
        .prepare('INSERT OR REPLACE INTO marks_tombstones (mark_id, deleted_at) VALUES (?, ?)')
        .get(markId, deletedAt)
      markFlashcardOrphaned(found.db, markId, deletedAt)
    }
  }
  return { migrated, skipped }
}

/** 回填过的本书库目录（进程内记忆，跨书互不干扰） */
const flashcardsBackfilledDirs = new Set<string>()

/** 仅单测用：模拟新进程（marker 文件才是 durable guard） */
export function clearFlashcardsBackfillCache(): void {
  flashcardsBackfilledDirs.clear()
}

/**
 * 存量回填（[2]-02b）：v6 前已存在的卡（01 时代写入）逐卡派生快照。
 * 02b 起所有写入路径 inline 跟随，回填只服务升级上来的旧书。
 */
export function backfillFlashcardsForBook(
  userDataDir: string,
  fingerprint: string,
): { cards: number } {
  const db = openBookDb(userDataDir, fingerprint)
  for (const row of listLiveMarkRows(db)) upsertFlashcardForMark(db, rowToReadingMark(row))
  return { cards: countDueFlashcards(db) }
}

function ensureFlashcardsBackfilled(userDataDir: string, fingerprint: string): void {
  const dir = getBookDbDir(userDataDir, fingerprint)
  if (flashcardsBackfilledDirs.has(dir)) return
  flashcardsBackfilledDirs.add(dir)
  const marker = join(dir, 'flashcards-backfilled.json')
  if (existsSync(marker)) return
  const stats = backfillFlashcardsForBook(userDataDir, fingerprint)
  writeFileSync(marker, JSON.stringify({ at: Date.now(), ...stats }))
}

/** 写入路径单入口：先保回填，再跟随单卡 */
export function syncFlashcardForMark(
  userDataDir: string,
  fingerprint: string,
  db: DatabaseSync,
  mark: ReadingMark,
): void {
  ensureFlashcardsBackfilled(userDataDir, fingerprint)
  upsertFlashcardForMark(db, mark)
}

/** 删除路径单入口：先保回填，再标脏 */
export function dropFlashcardForMark(
  userDataDir: string,
  fingerprint: string,
  db: DatabaseSync,
  markId: string,
  at: number,
): void {
  ensureFlashcardsBackfilled(userDataDir, fingerprint)
  markFlashcardOrphaned(db, markId, at)
}

/** 读路径（UI 接线用，02b 暂无调用方，单测覆盖）：先保回填 */
export function listDueFlashcards(
  userDataDir: string,
  fingerprint: string,
  limit = 50,
): DueFlashcard[] {
  ensureFlashcardsBackfilled(userDataDir, fingerprint)
  return listDueFlashcardRows(openBookDb(userDataDir, fingerprint), limit)
}

export function countDueFlashcardsForBook(userDataDir: string, fingerprint: string): number {
  ensureFlashcardsBackfilled(userDataDir, fingerprint)
  return countDueFlashcards(openBookDb(userDataDir, fingerprint))
}

/** 复习评分落盘（UI 接线用，02b 暂无调用方，单测覆盖） */
export function appendFlashcardReview(
  userDataDir: string,
  fingerprint: string,
  cardId: string,
  rating: FlashcardReviewRating,
  reviewedAt: number,
): boolean {
  ensureFlashcardsBackfilled(userDataDir, fingerprint)
  return appendReviewRow(openBookDb(userDataDir, fingerprint), cardId, rating, reviewedAt)
}
