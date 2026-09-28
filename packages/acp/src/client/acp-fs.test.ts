import { describe, expect, it } from 'vitest'
import { assertPathInsideWorkspace } from './acp-fs'

describe('assertPathInsideWorkspace', () => {
  it('allows paths under workspace', () => {
    const root = process.platform === 'win32' ? 'D:\\book' : '/tmp/book'
    const child = process.platform === 'win32' ? 'D:\\book\\a.md' : '/tmp/book/a.md'
    expect(assertPathInsideWorkspace(child, root)).toContain('a.md')
  })

  it('rejects paths outside workspace', () => {
    const root = process.platform === 'win32' ? 'D:\\book' : '/tmp/book'
    const outside = process.platform === 'win32' ? 'D:\\other\\x.md' : '/tmp/other/x.md'
    expect(() => assertPathInsideWorkspace(outside, root)).toThrow(/工作区/)
  })
})
