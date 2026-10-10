import { describe, expect, it } from 'vitest'
import { getDocumentKind } from '@montree/contracts'

describe('document-types', () => {
  it('识别 Markdown、PDF、EPUB、MOBI 与 Kindle AZW3 以及数据与 Office 格式', () => {
    expect(getDocumentKind('D:\\notes\\readme.md')).toBe('markdown')
    expect(getDocumentKind('/books/guide.epub')).toBe('epub')
    expect(getDocumentKind('C:\\docs\\paper.pdf')).toBe('pdf')
    expect(getDocumentKind('/books/legacy.mobi')).toBe('mobi')
    expect(getDocumentKind('/books/kindle.azw3')).toBe('mobi')
    expect(getDocumentKind('/books/kindle.azw')).toBe('mobi')
    expect(getDocumentKind('https://react.dev/learn')).toBe('web')
    expect(getDocumentKind('01-花名册.csv')).toBe('csv')
    expect(getDocumentKind('02-统计.tsv')).toBe('tsv')
    expect(getDocumentKind('03-配置.json')).toBe('json')
    expect(getDocumentKind('04-运行.log')).toBe('log')
    expect(getDocumentKind('05-报告.docx')).toBe('docx')
    expect(getDocumentKind('06-预算.xlsx')).toBe('xlsx')
    expect(getDocumentKind('07-汇报.pptx')).toBe('pptx')
    expect(getDocumentKind('index.html')).toBe('html')
    expect(getDocumentKind('D:\\sites\\page.htm')).toBe('html')
    expect(getDocumentKind('image.png')).toBe('unknown')
  })
})
