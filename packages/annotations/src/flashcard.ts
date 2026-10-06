/**
 * 记忆卡片核心契约。
 *
 * front / back 一律为**纯文本**（复习 UI 直接展示）。
 * Anki 导出时再由导出层包一层 HTML（见 `export-anki-cards`）。
 */

export type FlashcardKind = 'basic' | 'cloze'

export interface Flashcard {
  id: string
  kind: FlashcardKind
  /** 问答卡正面（批注/问题），或填空卡正文（含 {{c1::...}}，纯文本） */
  front: string
  /** 问答卡背面（原文摘录）；填空卡可为空或附加说明（纯文本） */
  back: string
  /** Anki 标签列表，如 ['Montree', '书名', '章名'] */
  tags: string[]
  chapterName?: string
  sourceTitle: string
  /** 导出 Anki 时写入背面的原书深链（复习 UI 不依赖此字段） */
  deepLinkUrl?: string
}
