import diff from 'fast-diff'

export type DiffPart = { kind: 'equal' | 'insert' | 'delete'; text: string }

const MAX_WORD_DIFF = 4000
const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null

/** 拆成词/标点/空白片段；中文按 Intl.Segmenter 词粒度，不拆开代理对。 */
export function tokenize(text: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(text), (segment) => segment.segment)
  return text.match(/\s+|[\p{L}\p{N}_]+|[\s\S]/gu) ?? []
}

/**
 * 词级 diff：把每个词映射成一个私有区字符后交给 fast-diff，再还原，
 * 避免字符级 diff 把单词切碎；超长文本退化为整段删除+插入。
 */
export function wordDiff(before: string, after: string): DiffPart[] {
  if (before === after) return before ? [{ kind: 'equal', text: before }] : []
  if (before.length + after.length > MAX_WORD_DIFF) {
    return [...(before ? [{ kind: 'delete' as const, text: before }] : []), ...(after ? [{ kind: 'insert' as const, text: after }] : [])]
  }
  const dictionary = new Map<string, string>()
  const tokens: string[] = []
  const encode = (text: string) => tokenize(text).map((token) => {
    let code = dictionary.get(token)
    if (code === undefined) {
      if (tokens.length >= 0x1900) return null
      code = String.fromCharCode(0xe000 + tokens.length)
      dictionary.set(token, code)
      tokens.push(token)
    }
    return code
  })
  const a = encode(before), b = encode(after)
  if (a.includes(null) || b.includes(null)) return [{ kind: 'delete', text: before }, { kind: 'insert', text: after }]
  const parts: DiffPart[] = []
  for (const [op, encoded] of diff(a.join(''), b.join(''))) {
    const text = Array.from(encoded, (ch) => tokens[ch.charCodeAt(0) - 0xe000]).join('')
    const kind = op === diff.EQUAL ? 'equal' : op === diff.INSERT ? 'insert' : 'delete'
    const last = parts.at(-1)
    if (last && last.kind === kind) last.text += text
    else parts.push({ kind, text })
  }
  return parts
}
