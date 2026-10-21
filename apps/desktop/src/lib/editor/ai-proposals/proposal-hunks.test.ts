import { describe, expect, it } from 'vitest'
import { applyHunks, sentenceSpans, splitIntoHunks } from './proposal-hunks'

describe('sentence hunks', () => {
  it('splits CJK and Latin sentences covering the whole text', () => {
    const text = '你好。今天天气很好！Is it? Yes. 最后'
    const spans = sentenceSpans(text)
    expect(spans.map((s) => text.slice(s.from, s.to))).toEqual(['你好。', '今天天气很好！', 'Is it? ', 'Yes. ', '最后'])
    expect(spans[0].from).toBe(0); expect(spans.at(-1)!.to).toBe(text.length)
  })
  it('splits at newlines', () => {
    expect(sentenceSpans('line one\nline two').length).toBe(2)
  })
  it('round-trips: applying all hunks yields the replacement', () => {
    const cases: Array<[string, string]> = [
      ['A b. C d. E f.', 'A x. C d. E y and more.'],
      ['第一句。第二句。', '第一句。插入一句。第二句改。'],
      ['Hello world.', 'Hello brave new world. Extra sentence.'],
      ['Emoji 😀 here. Next.', 'Emoji 🎉 here. Next!'],
    ]
    for (const [a, b] of cases) {
      const hunks = splitIntoHunks(a, b)
      expect(applyHunks(a, hunks)).toBe(b)
      for (const hunk of hunks) expect(a.slice(hunk.from, hunk.to)).toBe(hunk.original)
    }
  })
  it('pure insertion is one hunk', () => {
    expect(splitIntoHunks('', 'new')).toEqual([{ from: 0, to: 0, original: '', insert: 'new' }])
  })
})
