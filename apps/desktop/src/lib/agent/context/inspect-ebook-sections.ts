import {
  CONTENT_AUDIT_HIT_TEXT_BUDGET,
  CONTENT_AUDIT_RESPONSE_TEXT_BUDGET,
  resolveContentAuditMatchPosition,
  windowContentAuditText,
  type ContentAuditHit,
  type ContentAuditResult,
} from '@montree/contracts'
import type { ReaderUnitText } from './reader-content-registry'

/**
 * EPUB/MOBI 章节单元内存取证（P3.1，纯逻辑 + 惰性迭代）。
 *
 * 按单元逐个迭代（Foliate 章节文本），每单元按行字面匹配；
 * total 为全书各单元命中行数之和（精确），limit 只截断展示——
 * 展示满 limit 后仍须走完迭代才能给出精确 total，不得提前 break。
 * 单单元异常/空文本跳过该单元，不整次失败；零命中返回 total=0 合法 JSON。
 */
export async function inspectEbookSections(
  units: AsyncIterable<ReaderUnitText>,
  query: string,
  limit: number,
): Promise<ContentAuditResult> {
  const needle = query.toLowerCase()
  const matched: { chapterTitle: string; lineStart: number; line: string }[] = []
  const iterator = units[Symbol.asyncIterator]()
  for (;;) {
    let next: IteratorResult<ReaderUnitText>
    try {
      next = await iterator.next()
    } catch {
      // 迭代器本身坏掉（某单元加载失败）：已收集的保留，直接收尾
      break
    }
    if (next.done) break
    let unit: ReaderUnitText
    try {
      unit = next.value
      if (!unit || typeof unit.text !== 'string') continue
    } catch {
      continue
    }
    const label = typeof unit.label === 'string' && unit.label ? unit.label : ''
    const lines = unit.text.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? ''
      if (!line.toLowerCase().includes(needle)) continue
      matched.push({ chapterTitle: label, lineStart: index + 1, line })
    }
  }
  const shown = matched.slice(0, Math.max(0, limit))
  // 与库/内存审计同口径：单条 1200 封顶，多条按总预算 7800 均摊
  const perHitBudget = Math.min(
    CONTENT_AUDIT_HIT_TEXT_BUDGET,
    Math.floor(CONTENT_AUDIT_RESPONSE_TEXT_BUDGET / Math.max(1, shown.length)),
  )
  const hits: ContentAuditHit[] = shown.map(({ chapterTitle, lineStart, line }) => {
    const windowed = windowContentAuditText(line, query, perHitBudget)
    return {
      source: 'ebook-section' as const,
      locator: { chapterTitle, lineStart },
      text: windowed.text,
      textTruncated: windowed.truncated,
      matchPosition: resolveContentAuditMatchPosition(windowed.text, query),
    }
  })
  return {
    query,
    total: matched.length,
    truncated: hits.length < matched.length,
    limit,
    hits,
  }
}
