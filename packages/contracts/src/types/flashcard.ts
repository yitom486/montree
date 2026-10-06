/**
 * 记忆卡片复习态的跨进程契约（[2]-02b 落库，UI 批接线）。
 *
 * 快照口径与 Anki 导出一致（有批注→basic，无批注→cloze），见
 * `apps/desktop/electron/services/flashcards-db.ts` 的 `deriveFlashcard`。
 * `id`恒等于来源 `ReadingMark.id`，渲染端按 id 与内存 marks join 出
 * 章节名/书名/deepLink 等展示字段。
 */

/** 复习评分（与 `@montree/annotations` 的同名字面一致，线上传输以本定义为准） */
export type FlashcardReviewRating = 'again' | 'hard' | 'good'

/** 待复习卡（本书库 `flashcards` 行 + 复习统计） */
export interface DueFlashcard {
  id: string
  markId: string
  kind: 'basic' | 'cloze'
  front: string
  back: string
  tags: string[]
  chapterKey: string
  lastReviewed: number | null
  reviewCount: number
}

/** `flashcards:list-due` 请求 */
export interface ListDueFlashcardsPayload {
  filePath: string
  limit?: number
}

/** `flashcards:append-review` 请求 */
export interface AppendFlashcardReviewPayload {
  filePath: string
  cardId: string
  rating: FlashcardReviewRating
}
