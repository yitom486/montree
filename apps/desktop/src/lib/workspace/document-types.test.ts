import { describe, expect, it } from 'vitest'
import { getDocumentKind } from '@montree/contracts'

describe('document-types', () => {
  it('识别 Markdown、PDF、EPUB、MOBI 与 Kindle AZW3', () => {
    expect(getDocumentKind('D:\\notes\\readme.md')).toBe('markdown')
    expect(getDocumentKind('/books/guide.epub')).toBe('epub')
    expect(getDocumentKind('C:\\docs\\paper.pdf')).toBe('pdf')
    expect(getDocumentKind('/books/legacy.mobi')).toBe('mobi')
    expect(getDocumentKind('/books/kindle.azw3')).toBe('mobi')
    expect(getDocumentKind('/books/kindle.azw')).toBe('mobi')
    expect(getDocumentKind('https://react.dev/learn')).toBe('web')
    expect(getDocumentKind('image.png')).toBe('unknown')
  })
})
