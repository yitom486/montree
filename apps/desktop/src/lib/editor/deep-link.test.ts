import { describe, expect, it } from 'vitest'
import {
  buildDeepLinkUrl,
  isDeepLinkUrl,
  parseDeepLinkUrl,
} from './deep-link'

describe('deep-link', () => {
  it('builds deep link with file, page and cfi', () => {
    const url = buildDeepLinkUrl({
      file: 'books/深入理解Java虚拟机.pdf',
      page: 42,
    })
    expect(url).toBe('montree://open?file=books%2F%E6%B7%B1%E5%85%A5%E7%90%86%E8%A7%A3Java%E8%99%9A%E6%8B%9F%E6%9C%BA.pdf&page=42')
  })

  it('parses valid deep link url', () => {
    const raw = 'montree://open?file=notes%2Fvue.md&line=15&anchor=heading-1'
    const target = parseDeepLinkUrl(raw)
    expect(target).toEqual({
      file: 'notes/vue.md',
      line: 15,
      anchor: 'heading-1',
    })
  })

  it('returns null for non-montree urls', () => {
    expect(parseDeepLinkUrl('https://github.com')).toBeNull()
    expect(parseDeepLinkUrl('file:///d:/test.md')).toBeNull()
    expect(parseDeepLinkUrl('')).toBeNull()
  })

  it('rejects non-/open paths and missing file param', () => {
    expect(parseDeepLinkUrl('montree://evil?file=a.pdf')).toBeNull()
    expect(parseDeepLinkUrl('montree://open?file=a.pdf')).not.toBeNull()
    expect(parseDeepLinkUrl('montree://open?page=3')).toBeNull()
  })

  it('isDeepLinkUrl correctly checks protocol', () => {
    expect(isDeepLinkUrl('montree://open?file=a.pdf')).toBe(true)
    expect(isDeepLinkUrl('http://montree://')).toBe(false)
  })
})
