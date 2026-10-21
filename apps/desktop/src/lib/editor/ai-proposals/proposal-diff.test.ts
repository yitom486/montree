import { describe, expect, it } from 'vitest'
import { wordDiff } from './proposal-diff'

describe('wordDiff', () => {
  it('diffs by word and reconstructs both sides', () => {
    const parts = wordDiff('the quick brown fox', 'the slow brown fox')
    expect(parts.filter((p) => p.kind === 'insert').map((p) => p.text)).toEqual(['slow'])
    expect(parts.filter((p) => p.kind !== 'insert').map((p) => p.text).join('')).toBe('the quick brown fox')
    expect(parts.filter((p) => p.kind !== 'delete').map((p) => p.text).join('')).toBe('the slow brown fox')
  })
  it('keeps emoji and CJK intact', () => {
    const parts = wordDiff('你好😀世界', '你好🎉世界')
    expect(parts.filter((p) => p.kind !== 'delete').map((p) => p.text).join('')).toBe('你好🎉世界')
    for (const part of parts) expect(/^[\uDC00-\uDFFF]/.test(part.text)).toBe(false)
  })
  it('handles empty sides and very long text', () => {
    expect(wordDiff('', 'new')).toEqual([{ kind: 'insert', text: 'new' }])
    expect(wordDiff('old', '')).toEqual([{ kind: 'delete', text: 'old' }])
    const long = 'x'.repeat(5000)
    expect(wordDiff(long, 'y')).toEqual([{ kind: 'delete', text: long }, { kind: 'insert', text: 'y' }])
  })
})
