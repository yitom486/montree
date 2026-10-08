/** 摘录匹配：折叠空白、多候选，供 DOM / 纯文本检索共用。 */

import {
  markProposalDevFail,
  markProposalDevLog,
  markProposalTextPreview,
} from '@/lib/agent/context/mark-proposal-dev-log'

export function collapseInlineWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function excerptSearchCandidates(searchText: string): string[] {
  const trimmed = searchText.trim()
  if (!trimmed) return []
  const collapsed = collapseInlineWhitespace(trimmed)
  return trimmed === collapsed ? [trimmed] : [trimmed, collapsed]
}

/** 模糊匹配 hint 上限，避免超长 Agent 文案导致性能问题 */
export const EXCERPT_HINT_MAX_CHARS = 400

/** 单条标记摘录上限（模糊推测结果） */
export const EXCERPT_RESULT_MAX_CHARS = 320

function normalizePunctuation(text: string): string {
  return text
    .replace(/\u3000/g, ' ')
    .replace(/[，、]/g, ',')
    .replace(/[；;]/g, ';')
    .replace(/[：:]/g, ':')
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
}

function truncateHint(hint: string): string {
  const trimmed = hint.trim()
  if (trimmed.length <= EXCERPT_HINT_MAX_CHARS) return trimmed
  return trimmed.slice(0, EXCERPT_HINT_MAX_CHARS)
}

function normalizeForMatch(text: string): string {
  return normalizePunctuation(text).replace(/\s+/g, '').toLowerCase()
}

export function excerptAppearsIn(haystack: string, excerpt: string): boolean {
  const body = haystack.replace(/\s+/g, ' ')
  for (const candidate of excerptSearchCandidates(excerpt)) {
    const needle = candidate.replace(/\s+/g, ' ')
    if (needle && body.includes(needle)) return true
  }
  return false
}

export type ExcerptMatchConfidence = 'exact' | 'fuzzy'

export interface ExcerptMatchResult {
  excerpt: string
  confidence: ExcerptMatchConfidence
  score: number
}

/** 从正文中取出精确匹配的摘录（折叠空白后比对，返回折叠版原文）。 */
export function findExactExcerptInText(haystack: string, excerpt: string): string | null {
  const body = haystack.replace(/\s+/g, ' ')
  for (const candidate of excerptSearchCandidates(excerpt)) {
    const needle = candidate.replace(/\s+/g, ' ')
    if (needle && body.includes(needle)) return needle
  }
  const normalizedBody = normalizeForMatch(haystack)
  const normalizedNeedle = normalizeForMatch(excerpt)
  if (normalizedNeedle && normalizedBody.includes(normalizedNeedle)) {
    return excerpt.trim()
  }
  return null
}

function splitExcerptCandidates(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  const sentences = trimmed
    .split(/(?<=[。！？；\n])/)
    .flatMap((part) => {
      const piece = part.trim()
      if (piece.length <= 80) return piece.length >= 4 ? [piece] : []
      return piece
        .split(/(?<=[，、])/)
        .map((sub) => sub.trim())
        .filter((sub) => sub.length >= 4)
    })

  return sentences.length > 0 ? sentences.slice(0, 120) : trimmed.length >= 4 ? [trimmed] : []
}

function scoreExcerptCandidate(candidate: string, hint: string): number {
  const normCandidate = normalizeForMatch(candidate)
  const normHint = normalizeForMatch(truncateHint(hint))
  if (!normCandidate || !normHint) return 0

  if (normCandidate.includes(normHint) || normHint.includes(normCandidate)) {
    return 1000 + Math.min(normCandidate.length, normHint.length)
  }

  let score = 0

  for (let i = 0; i < normHint.length - 1; i++) {
    const bigram = normHint.slice(i, i + 2)
    if (normCandidate.includes(bigram)) score += 3
  }

  let ordered = 0
  let from = 0
  for (const ch of normHint) {
    const at = normCandidate.indexOf(ch, from)
    if (at >= 0) {
      ordered += 1
      from = at + 1
    }
  }
  score += (ordered / normHint.length) * 15

  const keywords = hint.match(/[\u4e00-\u9fff]{2,}|[a-zA-Z0-9]{3,}/g) ?? []
  for (const keyword of keywords) {
    const normalizedKeyword = normalizeForMatch(keyword)
    if (normalizedKeyword.length >= 2 && normCandidate.includes(normalizedKeyword)) {
      score += normalizedKeyword.length * 4
    }
  }

  if (candidate.length > hint.length * 10) score *= 0.65
  if (candidate.length > EXCERPT_RESULT_MAX_CHARS) score *= 0.5
  return score
}

/** 模糊匹配最低分：短 hint 需更高重合，避免误匹配。 */
function fuzzyMinScore(hint: string): number {
  const len = normalizeForMatch(hint).length
  if (len <= 4) return 18
  if (len <= 8) return 14
  return 10
}

/**
 * 在正文中定位摘录：先精确匹配，再按句子模糊推测（适配用户口述 / Agent  paraphrase）。
 */
export function findExcerptInText(haystack: string, hint: string): ExcerptMatchResult | null {
  try {
    const trimmedHint = truncateHint(hint)
    if (!trimmedHint || !haystack.trim()) return null

    const exact = findExactExcerptInText(haystack, trimmedHint)
    if (exact) {
      return { excerpt: exact.slice(0, EXCERPT_RESULT_MAX_CHARS), confidence: 'exact', score: 1000 }
    }

    if (normalizeForMatch(trimmedHint).length < 3) return null

    let best: { excerpt: string; score: number } | null = null
    for (const candidate of splitExcerptCandidates(haystack)) {
      if (candidate.length > EXCERPT_RESULT_MAX_CHARS * 2) continue
      const score = scoreExcerptCandidate(candidate, trimmedHint)
      if (!best || score > best.score) {
        best = { excerpt: candidate, score }
      }
    }

    const minScore = fuzzyMinScore(trimmedHint)
    if (!best || best.score < minScore) return null

    return {
      excerpt: best.excerpt.slice(0, EXCERPT_RESULT_MAX_CHARS),
      confidence: 'fuzzy',
      score: best.score,
    }
  } catch (error) {
    markProposalDevFail('match:text', error, {
      hint: markProposalTextPreview(hint),
      haystackLen: haystack.length,
    })
    throw error
  }
}

export function excerptAppearsInOrFuzzy(haystack: string, hint: string): boolean {
  return findExcerptInText(haystack, hint) !== null
}

const MARK_SELECTOR =
  '.mobi-mark-highlight, .mobi-mark-note, .mobi-mark-note-hit, #reader-mark-layer, .code-block-toolbar, script, style'

export function findTextRangeExact(
  root: HTMLElement,
  doc: Document,
  searchText: string,
): Range | null {
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (parent?.closest(MARK_SELECTOR)) return NodeFilter.FILTER_REJECT
      // 代码块行号常混进 textContent，跳过常见行号节点
      if (parent?.closest('.linenumber, .line-numbers, .code-line-number, [data-line-number]')) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  let combined = ''
  const segments: Array<{ node: Text; start: number; end: number }> = []

  let current = walker.nextNode()
  while (current) {
    const textNode = current as Text
    const text = textNode.textContent ?? ''
    const start = combined.length
    combined += text
    segments.push({ node: textNode, start, end: combined.length })
    current = walker.nextNode()
  }

  const mapRange = (index: number, endIndex: number): Range | null => {
    let startNode: Text | null = null
    let startOffset = 0
    let endNode: Text | null = null
    let endOffset = 0

    for (const segment of segments) {
      if (!startNode && index >= segment.start && index < segment.end) {
        startNode = segment.node
        startOffset = index - segment.start
      }
      if (endIndex > segment.start && endIndex <= segment.end) {
        endNode = segment.node
        endOffset = endIndex - segment.start
        break
      }
    }

    if (!startNode || !endNode) return null

    const range = doc.createRange()
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset)
    return range
  }

  const directIndex = combined.indexOf(searchText)
  if (directIndex !== -1) {
    return mapRange(directIndex, directIndex + searchText.length)
  }

  // 折叠空白后匹配，再映射回原始 Text 偏移（适配代码块 / Sandpack 静态残留）
  const collapsedNeedle = collapseInlineWhitespace(searchText)
  if (!collapsedNeedle) return null

  let collapsed = ''
  const collapsedMap: number[] = []
  for (let i = 0; i < combined.length; i++) {
    const ch = combined[i]!
    if (/\s/.test(ch)) {
      if (collapsed.length === 0 || collapsed[collapsed.length - 1] === ' ') continue
      collapsedMap.push(i)
      collapsed += ' '
      continue
    }
    collapsedMap.push(i)
    collapsed += ch
  }
  const collapsedTrimmed = collapsed.trim()
  const trimStart = collapsed.length - collapsed.replace(/^\s+/, '').length
  const needleInCollapsed = collapsedTrimmed.indexOf(collapsedNeedle)
  if (needleInCollapsed !== -1) {
    const startCollapsed = trimStart + needleInCollapsed
    const endCollapsed = startCollapsed + collapsedNeedle.length - 1
    if (startCollapsed >= 0 && endCollapsed < collapsedMap.length) {
      const rawStart = collapsedMap[startCollapsed]!
      const rawEndExclusive = collapsedMap[endCollapsed]! + 1
      const mapped = mapRange(rawStart, rawEndExclusive)
      if (mapped) return mapped
    }
  }

  // 3. 语义字符级韧性对齐（免疫中英标点互换、引号形态、角标消除、零宽字符与轻微排版差异）
  const cleanCharIndices: number[] = []
  let cleanCombined = ''
  for (let i = 0; i < combined.length; i++) {
    const ch = combined[i]!
    if (/[\p{L}\p{N}]/u.test(ch)) {
      cleanCharIndices.push(i)
      cleanCombined += ch.toLowerCase()
    }
  }

  const cleanNeedle = searchText.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()
  if (cleanNeedle && cleanNeedle.length >= 2) {
    const needleIdx = cleanCombined.indexOf(cleanNeedle)
    if (needleIdx !== -1) {
      const rawStart = cleanCharIndices[needleIdx]!
      const rawEndExclusive = cleanCharIndices[needleIdx + cleanNeedle.length - 1]! + 1
      const res = mapRange(rawStart, rawEndExclusive)
      if (res) return res
    }
    // 若长句两端标点或轻微断句有出入，取前 12~16 个语义字符核心前缀对齐
    if (cleanNeedle.length >= 8) {
      const prefix = cleanNeedle.slice(0, Math.min(16, cleanNeedle.length))
      const pIdx = cleanCombined.indexOf(prefix)
      if (pIdx !== -1) {
        const matchLen = Math.min(cleanNeedle.length, cleanCombined.length - pIdx)
        const rawStart = cleanCharIndices[pIdx]!
        const rawEndExclusive = cleanCharIndices[pIdx + matchLen - 1]! + 1
        const res = mapRange(rawStart, rawEndExclusive)
        if (res) return res
      }
    }
  }

  return null
}

export function findTextRangeInRoot(root: HTMLElement, searchText: string): Range | null {
  const doc = root.ownerDocument
  if (!doc) return null

  try {
    const tryFind = (needle: string): Range | null => {
      for (const candidate of excerptSearchCandidates(needle)) {
        const range = findTextRangeExact(root, doc, candidate)
        if (range) return range
        const normalizedCandidate = normalizePunctuation(candidate).replace(/\s+/g, ' ')
        if (normalizedCandidate !== candidate) {
          const normalizedRange = findTextRangeExact(root, doc, normalizedCandidate)
          if (normalizedRange) return normalizedRange
        }
      }
      return null
    }

    markProposalDevLog('match:dom', {
      excerpt: markProposalTextPreview(searchText),
      rootTag: root.tagName,
    })

    const direct = tryFind(searchText)
    if (direct) return direct

    const bodyText = root.innerText || root.textContent || ''
    const inferred = findExcerptInText(bodyText, searchText.slice(0, EXCERPT_HINT_MAX_CHARS))
    if (inferred) {
      return tryFind(inferred.excerpt)
    }

    return null
  } catch (error) {
    markProposalDevFail('match:dom', error, {
      excerpt: markProposalTextPreview(searchText),
      rootTag: root.tagName,
    })
    throw error
  }
}
