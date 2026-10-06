import type { ReadingMark } from '@montree/contracts'
import type { Flashcard } from './flashcard'
import {
  highlightSortKey,
  isHighlightPassage,
  passageExcerpt,
  passageNote,
  type ReadingNotesChapterRef,
  type ReadingNotesScope,
} from '@montree/reader-core'

export interface BuildAnkiCardsExportInput {
  marks: ReadingMark[]
  toc: ReadingNotesChapterRef[]
  scope: ReadingNotesScope
  currentChapter?: ReadingNotesChapterRef | null
  bookTitle: string
  resolveChapter: (mark: ReadingMark, toc: ReadingNotesChapterRef[]) => ReadingNotesChapterRef
  now?: Date
  nameSuffix?: string
}

export interface BuildAnkiCardsExportResult {
  cards: Flashcard[]
  content: string
  suggestedName: string
  cardCount: number
}

export function escapeAnkiHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/** 规范化 Anki 标签（移除空格、冒号等不支持字符） */
export function sanitizeAnkiTag(name: string): string {
  return name
    .trim()
    .replace(/[\s:：#\t,，;；]+/g, '_')
    .replace(/^[_\-]+|[_\-]+$/g, '')
    .slice(0, 32)
}

function sanitizeFileNamePart(text: string, maxLen: number): string {
  const cleaned = text
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, maxLen)
}

function formatAnkiTimestamp(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${y}${m}${day}-${h}${min}`
}

export function buildAnkiExportFileName(
  bookTitle: string,
  scope: ReadingNotesScope,
  chapterLabel?: string | null,
  now = new Date(),
  suffix = '',
): string {
  const shortBook = sanitizeFileNamePart(bookTitle, 25) || 'book'
  const time = formatAnkiTimestamp(now)
  const tail = suffix ? `-${suffix}` : ''

  if (scope === 'chapter' && chapterLabel) {
    const shortChap = sanitizeFileNamePart(chapterLabel, 36) || 'chapter'
    return `${shortBook}：${shortChap}-anki-${time}${tail}.txt`
  }

  return `${shortBook}-anki-${time}${tail}.txt`
}

function cleanFieldForAnki(text: string): string {
  return text.replace(/\t/g, ' ').replace(/\r?\n/g, '<br>')
}

function buildAnkiMetaLine(card: Flashcard): string {
  const linkHtml = card.deepLinkUrl
    ? ` <a href="${escapeAnkiHtml(card.deepLinkUrl)}" style="color:#10b981;text-decoration:none;margin-left:6px;">[📖 原书]</a>`
    : ''
  return `<div style="margin-top:8px;font-size:12px;color:#888;">—— 《${escapeAnkiHtml(
    card.sourceTitle,
  )}》· ${escapeAnkiHtml(card.chapterName || '正文')}${linkHtml}</div>`
}

/**
 * 将纯文本 Flashcard 转为 Anki `#html:true` 字段（仅导出用）。
 */
export function formatFlashcardForAnkiHtml(card: Flashcard): { front: string; back: string } {
  const metaLine = buildAnkiMetaLine(card)

  if (card.kind === 'basic') {
    return {
      front: `<div style="font-size:15px;font-weight:600;">${escapeAnkiHtml(card.front)}</div>`,
      back: `<blockquote>${escapeAnkiHtml(card.back)}</blockquote>${metaLine}`,
    }
  }

  // cloze：front 已是 {{c1::...}}；内容需 escape，但保留 cloze 标记本身
  const front = card.front.replace(/\{\{c(\d+)::([\s\S]*?)\}\}/g, (_m, n: string, inner: string) => {
    return `{{c${n}::${escapeAnkiHtml(inner)}}}`
  })

  return {
    front,
    back: metaLine,
  }
}

/**
 * 深链构建与 `src/lib/editor/deep-link.ts` 的 `buildDeepLinkUrl` 语义逐字一致，
 * 内联于此以避免 packages 反向依赖 `src/`（原文件侧 deep-link 不动，见门面注释）。
 */
function buildAnkiDeepLinkUrl(target: {
  file: string
  page?: number
  cfi?: string
  anchor?: string
}): string {
  const params = new URLSearchParams()
  params.set('file', target.file)

  if (typeof target.page === 'number' && Number.isFinite(target.page)) {
    params.set('page', String(target.page))
  }
  if (target.cfi) {
    params.set('cfi', target.cfi)
  }
  if (target.anchor) {
    params.set('anchor', target.anchor)
  }

  return `montree://open?${params.toString()}`
}

/**
 * 转换 ReadingMark 列表为纯文本闪卡 + Anki TSV。
 */
export function buildAnkiCardsExport(
  input: BuildAnkiCardsExportInput,
): BuildAnkiCardsExportResult | null {
  const passages = input.marks
    .filter(isHighlightPassage)
    .sort((a, b) => highlightSortKey(a).localeCompare(highlightSortKey(b), 'en'))

  const filtered = passages.filter((mark) => {
    if (input.scope !== 'chapter') return true
    const current = input.currentChapter
    if (!current?.key && !current?.matchKey) return false
    const chap = input.resolveChapter(mark, input.toc)
    const match = current.matchKey || current.key
    return (chap.matchKey || chap.key) === match || chap.key === current.key
  })

  if (filtered.length === 0) {
    return null
  }

  const cards: Flashcard[] = []
  const bookTag = sanitizeAnkiTag(input.bookTitle)

  for (const mark of filtered) {
    const excerpt = passageExcerpt(mark).trim()
    const note = passageNote(mark).trim()
    if (!excerpt) continue

    const chapterRef = input.resolveChapter(mark, input.toc)
    const chapterTag = chapterRef.label ? sanitizeAnkiTag(chapterRef.label) : ''
    const tags = ['Montree']
    if (bookTag) tags.push(bookTag)
    if (chapterTag && chapterTag !== bookTag) tags.push(chapterTag)

    const bookFile = input.marks[0]?.filePath
      ? (input.marks[0].filePath.split(/[/\\]/).pop() ?? input.bookTitle)
      : input.bookTitle
    const deepLinkUrl = buildAnkiDeepLinkUrl({
      file: bookFile,
      page: mark.anchor?.format === 'pdf' ? mark.anchor.page : undefined,
      cfi: mark.anchor?.format === 'epub' ? mark.anchor.cfi : undefined,
      anchor: mark.id,
    })

    if (note) {
      cards.push({
        id: mark.id,
        kind: 'basic',
        front: note,
        back: excerpt,
        tags,
        chapterName: chapterRef.label,
        sourceTitle: input.bookTitle,
        deepLinkUrl,
      })
    } else {
      cards.push({
        id: mark.id,
        kind: 'cloze',
        front: `{{c1::${excerpt}}}`,
        back: '',
        tags,
        chapterName: chapterRef.label,
        sourceTitle: input.bookTitle,
        deepLinkUrl,
      })
    }
  }

  if (cards.length === 0) {
    return null
  }

  const lines: string[] = ['#separator:tab', '#html:true', '#tags column:3']

  for (const card of cards) {
    const html = formatFlashcardForAnkiHtml(card)
    const front = cleanFieldForAnki(html.front)
    const back = cleanFieldForAnki(html.back)
    lines.push(`${front}\t${back}\t${card.tags.join(' ')}`)
  }

  const content = lines.join('\n')
  const suggestedName = buildAnkiExportFileName(
    input.bookTitle,
    input.scope,
    input.currentChapter?.label,
    input.now,
    input.nameSuffix,
  )

  return {
    cards,
    content,
    suggestedName,
    cardCount: cards.length,
  }
}
