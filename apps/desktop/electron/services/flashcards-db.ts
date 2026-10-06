import type { DatabaseSync } from 'node:sqlite'
import type {
  DueFlashcard,
  FlashcardReviewRating,
  ReadingMark,
} from '@montree/contracts'
import type { FlashcardKind } from '@montree/annotations'
import { isHighlightPassage, passageExcerpt, passageNote } from '@montree/reader-core'

/**
 * 记忆卡片 SQL 后端（[2]-02b）：本书库 `book.db` v6 的 flashcards + review_log。
 * 本模块只做行操作（调用方给 db 句柄 + mark 对象），不碰 userDataDir：
 * 跨书扫描/回填入口收敛在 `marks-db.ts`，避免两模块循环依赖。
 *
 * 快照口径与 Anki 导出（`anki-cards.ts`）逐字一致：有批注 → basic
 *（front=批注/back=摘录），无批注 → cloze（front=`{{c1::摘录}}`）；
 * 书签/无摘录卡不入复习（`isHighlightPassage` 同判据，含 anchor.selectedText 兜底）。
 * 章节名/书名/deepLink 等导出上下文不入库——快照只存复习必需字段。
 */

export interface FlashcardSnapshot {
  kind: FlashcardKind
  front: string
  back: string
  tags: string[]
  chapterKey: string
}

export function deriveFlashcard(mark: ReadingMark): FlashcardSnapshot | null {
  if (!isHighlightPassage(mark)) return null
  const excerpt = passageExcerpt(mark)
  if (!excerpt) return null
  const note = passageNote(mark)
  return {
    kind: note ? 'basic' : 'cloze',
    front: note ? note : `{{c1::${excerpt}}}`,
    back: note ? excerpt : '',
    tags: mark.tags ?? [],
    chapterKey: mark.chapter?.key ?? '',
  }
}

export const FLASHCARD_REVIEW_RATINGS: readonly FlashcardReviewRating[] = [
  'again',
  'hard',
  'good',
]

export function isReviewRating(value: unknown): value is FlashcardReviewRating {
  return (
    value === 'again' || value === 'hard' || value === 'good'
  )
}

interface FlashcardRow {
  id: string
  mark_id: string
  kind: string
  front: string
  back: string
  tags: string | null
  chapter_key: string
  chapter_id: number | null
  orphaned: number
  created_at: number
  updated_at: number
}

function parseTags(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

export function getFlashcardRow(db: DatabaseSync, id: string): FlashcardRow | null {
  const row = db.prepare('SELECT * FROM flashcards WHERE id = ?').get(id) as
    | FlashcardRow
    | undefined
  return row ?? null
}

/**
 * 卡片变则 upsert（`ON CONFLICT DO UPDATE`，`review_log` 原位保留）；
 * 卡片删改到失格（转书签/摘录清空）则标 orphan（日志照样保留）。
 * 新卡解 orphan（同步复活路径）。
 */
export function upsertFlashcardForMark(db: DatabaseSync, mark: ReadingMark): void {
  const snapshot = deriveFlashcard(mark)
  if (!snapshot) {
    markFlashcardOrphaned(db, mark.id, mark.updatedAt)
    return
  }
  db.prepare(
    `INSERT INTO flashcards (
      id, mark_id, kind, front, back, tags, chapter_key, chapter_id, orphaned,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind,
      front = excluded.front,
      back = excluded.back,
      tags = excluded.tags,
      chapter_key = excluded.chapter_key,
      orphaned = 0,
      updated_at = excluded.updated_at`,
  ).get(
    mark.id,
    mark.id,
    snapshot.kind,
    snapshot.front,
    snapshot.back,
    JSON.stringify(snapshot.tags),
    snapshot.chapterKey,
    mark.createdAt,
    mark.updatedAt,
  )
}

/** 来源卡片删除时标脏（无行则 noop；物理删会连带 review_log，线上禁用） */
export function markFlashcardOrphaned(db: DatabaseSync, markId: string, at: number): void {
  db.prepare('UPDATE flashcards SET orphaned = 1, updated_at = ? WHERE id = ?').get(at, markId)
}

/** 记一次复习评分；卡片不存在或评级非法返回 false，不写库 */
export function appendReviewRow(
  db: DatabaseSync,
  cardId: string,
  rating: FlashcardReviewRating,
  reviewedAt: number,
): boolean {
  if (!isReviewRating(rating)) return false
  if (!getFlashcardRow(db, cardId)) return false
  db.prepare('INSERT INTO review_log (card_id, rating, reviewed_at) VALUES (?, ?, ?)').get(
    cardId,
    rating,
    reviewedAt,
  )
  return true
}

export interface DueFlashcardRow extends FlashcardRow {
  last_reviewed: number | null
  review_count: number
}

function toDueFlashcard(row: DueFlashcardRow): DueFlashcard {
  return {
    id: row.id,
    markId: row.mark_id,
    kind: row.kind as DueFlashcard['kind'],
    front: row.front,
    back: row.back,
    tags: parseTags(row.tags),
    chapterKey: row.chapter_key,
    lastReviewed: row.last_reviewed,
    reviewCount: row.review_count,
  }
}

/**
 * 本书"待复习"（v1 启发式，无 SRS）：未 orphan，按最近复习时间升序
 *（从未复习的 NULL 天然排前），同值按更新时间倒序。跨书联查另议（见 03"不做"）。
 */
export function listDueFlashcardRows(db: DatabaseSync, limit = 50): DueFlashcard[] {
  const rows = db
    .prepare(
      `SELECT f.*, MAX(r.reviewed_at) AS last_reviewed, COUNT(r.id) AS review_count
       FROM flashcards f LEFT JOIN review_log r ON r.card_id = f.id
       WHERE f.orphaned = 0
       GROUP BY f.id
       ORDER BY last_reviewed ASC, f.updated_at DESC
       LIMIT ?`,
    )
    .all(limit) as unknown as DueFlashcardRow[]
  return rows.map(toDueFlashcard)
}

export function countDueFlashcards(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM flashcards WHERE orphaned = 0').get() as {
    c: number
  }
  return row.c
}

export function listReviewRows(
  db: DatabaseSync,
  cardId: string,
): Array<{ rating: string; reviewed_at: number }> {
  return db
    .prepare('SELECT rating, reviewed_at FROM review_log WHERE card_id = ? ORDER BY reviewed_at')
    .all(cardId) as unknown as Array<{ rating: string; reviewed_at: number }>
}
