// 评分字面归 contracts 所有（线上传输单源）；本包 re-export，调用方零改。
import type { FlashcardReviewRating } from '@montree/contracts'

export type { FlashcardReviewRating }

export interface FlashcardReviewStats {
  total: number
  reviewed: number
  counts: {
    again: number
    hard: number
    good: number
  }
}

export interface ClozeParsedResult {
  /** 正面呈现的挖空文本（纯文本遮罩） */
  frontText: string
  /** 挖空提取出的答案数组 */
  answers: string[]
  /** 背面呈现的高亮完整 HTML（答案与字面文本已 escape） */
  backHtml: string
  /** 是否整段全被挖空（无上下文语境） */
  isEntirelyMasked: boolean
  /** 记忆引导线索（前缀诱饵） */
  clue?: string
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 解析 Anki Cloze 语法（{{c1::答案}}），生成正面遮罩与背面高亮
 */
export function parseClozeContent(text: string): ClozeParsedResult {
  const clozeRegex = /\{\{c\d+::([\s\S]*?)\}\}/g
  const answers: string[] = []

  let match: RegExpExecArray | null
  while ((match = clozeRegex.exec(text)) !== null) {
    if (match[1]) {
      answers.push(match[1].trim())
    }
  }

  const frontText = text.replace(
    /\{\{c\d+::([\s\S]*?)\}\}/g,
    ' [ ❓ 点击翻转查看答案 ] ',
  )

  const strippedText = frontText.replace(/\[\s*❓\s*点击翻转查看答案\s*\]/g, '').trim()
  const isEntirelyMasked = strippedText.length === 0 && answers.length > 0

  let clue: string | undefined
  if (isEntirelyMasked && answers[0]) {
    const firstAnswer = answers[0]
    clue = firstAnswer.length > 40 ? `${firstAnswer.slice(0, 38)}……` : firstAnswer
  }

  // 先按段切分：字面 / cloze，再分别 escape 字面与答案
  const parts: string[] = []
  let lastIndex = 0
  const highlightRegex = /\{\{c\d+::([\s\S]*?)\}\}/g
  let highlightMatch: RegExpExecArray | null
  while ((highlightMatch = highlightRegex.exec(text)) !== null) {
    if (highlightMatch.index > lastIndex) {
      parts.push(escapeHtml(text.slice(lastIndex, highlightMatch.index)))
    }
    parts.push(
      `<mark class="bg-primary/20 text-primary font-semibold px-1.5 py-0.5 rounded border border-primary/30">${escapeHtml(
        highlightMatch[1] ?? '',
      )}</mark>`,
    )
    lastIndex = highlightMatch.index + highlightMatch[0].length
  }
  if (lastIndex < text.length) {
    parts.push(escapeHtml(text.slice(lastIndex)))
  }

  return {
    frontText,
    answers,
    backHtml: parts.join(''),
    isEntirelyMasked,
    clue,
  }
}

/**
 * 计算复习统计数据
 */
export function calculateReviewStats(
  ratings: Record<string, FlashcardReviewRating>,
  total: number,
): FlashcardReviewStats {
  const counts = {
    again: 0,
    hard: 0,
    good: 0,
  }

  for (const rating of Object.values(ratings)) {
    if (rating === 'again') counts.again++
    else if (rating === 'hard') counts.hard++
    else if (rating === 'good') counts.good++
  }

  const reviewed = Object.keys(ratings).length

  return {
    total,
    reviewed,
    counts,
  }
}
