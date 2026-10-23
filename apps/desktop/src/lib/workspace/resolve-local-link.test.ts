import { describe, expect, it } from 'vitest'
import { rememberLocalAnchor, resolveLocalLink, takeLocalAnchor } from './resolve-local-link'

describe('resolveLocalLink', () => {
  it('resolves sibling, parent and encoded document links', () => {
    expect(resolveLocalLink('D:\\docs\\01.html', 'index.html')).toBe('D:\\docs\\index.html')
    expect(resolveLocalLink('D:\\docs\\chapter\\01.html', '../index.html#sources')).toBe('D:\\docs\\index.html')
    expect(resolveLocalLink('/home/work/01.md', './notes/%E6%B5%8B%E8%AF%95.md')).toBe('/home/work/notes/测试.md')
    expect(resolveLocalLink('D:\\docs\\01.html', 'file:///D:/docs/02.html')).toBe('D:\\docs\\02.html')
  })

  it('leaves same-page anchors, external and non-file schemes to the browser', () => {
    expect(resolveLocalLink('D:\\docs\\a.html', '#evidence')).toBeNull()
    expect(resolveLocalLink('D:\\docs\\a.html', '?print=1')).toBeNull()
    expect(resolveLocalLink('D:\\docs\\a.html', 'https://example.com/a')).toBeNull()
    expect(resolveLocalLink('D:\\docs\\a.html', 'mailto:test@example.com')).toBeNull()
    expect(resolveLocalLink('D:\\docs\\a.html', 'javascript:alert(1)')).toBeNull()
    expect(resolveLocalLink('D:\\docs\\a.html', '//example.com/a')).toBeNull()
  })

  it('returns the current document for relative links so callers can keep anchors in-page', () => {
    expect(resolveLocalLink('D:\\docs\\a.html', './a.html')).toBe('D:\\docs\\a.html')
  })

  it('remembers one pending anchor per target and consumes it once', () => {
    rememberLocalAnchor('D:\\docs\\target.html', 'sources')
    expect(takeLocalAnchor('d:/docs/target.html')).toBe('sources')
    expect(takeLocalAnchor('D:\\docs\\target.html')).toBeUndefined()
  })
})
