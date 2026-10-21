import diff from 'fast-diff'

/** 一条建议内按句拆出的子修改；from/to 相对建议原文起点。 */
export interface ProposalHunk { from: number; to: number; original: string; insert: string }

const sentenceSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'sentence' }) : null
const FALLBACK_SENTENCE = /[^。！？!?.;；\n]*(?:[。！？!?;；]+|\.(?=\s|$)|\n+|$)\s*/gu

/** 句子切分（中文 。！？；与拉丁 .!? 及换行），返回首尾相接覆盖全文的区间。 */
export function sentenceSpans(text: string): Array<{ from: number; to: number }> {
  if (!text) return []
  const spans: Array<{ from: number; to: number }> = []
  if (sentenceSegmenter) {
    for (const segment of sentenceSegmenter.segment(text)) {
      // ICU 不把换行视为句界的情况下，再按换行细分
      let start = segment.index
      const value = segment.segment
      const parts = value.split(/(?<=\n)/)
      for (const part of parts) { if (part) { spans.push({ from: start, to: start + part.length }); start += part.length } }
    }
  } else {
    for (const match of text.matchAll(FALLBACK_SENTENCE)) if (match[0]) spans.push({ from: match.index!, to: match.index! + match[0].length })
  }
  // 再按中文句末标点细分（部分 ICU 版本对 CJK 无空格句界不切）
  const refined: Array<{ from: number; to: number }> = []
  for (const span of spans) {
    let start = span.from
    const slice = text.slice(span.from, span.to)
    for (const match of slice.matchAll(/[。！？；]+/gu)) {
      const end = span.from + match.index! + match[0].length
      if (end < span.to) { refined.push({ from: start, to: end }); start = end }
    }
    refined.push({ from: start, to: span.to })
  }
  return refined
}

/**
 * 把“原文 → 替换文本”拆成逐句子修改：以原文句子为单位，
 * 每句收集落入其中的删除/插入（句界上的插入归前一句，开头插入归第一句）。
 * 仅返回有变化的句子；纯插入（原文为空）视为一个整体。
 */
export function splitIntoHunks(original: string, replacement: string): ProposalHunk[] {
  if (original === replacement) return []
  if (!original) return [{ from: 0, to: 0, original: '', insert: replacement }]
  const spans = sentenceSpans(original)
  const outputs = spans.map(() => '')
  let pos = 0
  const sentenceAt = (offset: number, preferPrevious: boolean) => {
    const i = preferPrevious
      ? spans.findIndex((span) => offset > span.from && offset <= span.to)
      : spans.findIndex((span) => offset >= span.from && offset < span.to)
    return i >= 0 ? i : (offset === 0 ? 0 : spans.length - 1)
  }
  for (const [op, text] of diff(original, replacement)) {
    if (op === diff.INSERT) { outputs[sentenceAt(pos, true)] += text; continue }
    // equal / delete：可能跨句，逐句切片
    let rest = text
    while (rest) {
      const i = sentenceAt(pos, false)
      const take = Math.max(1, Math.min(rest.length, spans[i].to - pos))
      if (op === diff.EQUAL) outputs[i] += rest.slice(0, take)
      pos += take; rest = rest.slice(take)
    }
  }
  return spans.flatMap((span, i) => {
    const before = original.slice(span.from, span.to)
    return before === outputs[i] ? [] : [{ from: span.from, to: span.to, original: before, insert: outputs[i] }]
  })
}

/** 只应用所选子修改后，建议范围内的结果文本。 */
export function applyHunks(original: string, hunks: readonly ProposalHunk[]): string {
  let out = '', pos = 0
  for (const hunk of [...hunks].sort((a, b) => a.from - b.from)) { out += original.slice(pos, hunk.from) + hunk.insert; pos = hunk.to }
  return out + original.slice(pos)
}
