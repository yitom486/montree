import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { typstPosition, typstOffset, typstEditChanges, typstDiagnostics, safeTypstPreviewUrl, typstDocumentation, typstProjectRoot } from './typst-lsp'

describe('Typst project root selection', () => {
  it.each([
    ['D:\\文稿\\项目\\正文.typ', 'd:/文稿/项目', 'd:/文稿/项目'],
    ['D:/Work/PROJECT/sub/main.typ', 'd:\\work\\project\\', 'd:\\work\\project\\'],
    ['D:/work/project2/main.typ', 'D:/work/project', undefined],
    ['E:/work/project/main.typ', 'D:/work/project', undefined],
    ['D:/work/project/../other/main.typ', 'D:/work/project', undefined],
    ['D:/work/project/sub/../main.typ', 'D:/work/project', 'D:/work/project'],
    ['D:/main.typ', 'D:/', 'D:/'],
    ['/home/文稿/project/main.typ', '/home/文稿/project/', '/home/文稿/project/'],
    ['/home/Work/main.typ', '/home/work', undefined],
    ['/home/project-extra/main.typ', '/home/project', undefined],
    ['/home/main.typ', '/', '/'],
    ['relative/main.typ', '/home/project', undefined],
    ['C:/project/main.typ', '/project', undefined],
    ['\\\\server\\share\\main.typ', '\\\\server\\share', undefined],
  ])('chooses the correct root for %s inside %s', (file, root, expected) => {
    expect(typstProjectRoot(file, root)).toBe(expected)
  })
  it('uses backend parent fallback when no workspace is open', () => {
    expect(typstProjectRoot('D:/standalone/main.typ')).toBeUndefined()
  })
})

describe('Typst UTF-16 source positions', () => {
  const doc = EditorState.create({ doc: '中😀文\n#set text(size: 12pt)\n' }).doc
  it('round trips every offset, including CJK, surrogate pairs and the final empty line', () => {
    for (let offset = 0; offset <= doc.length; offset++) expect(typstOffset(doc, typstPosition(doc, offset))).toBe(offset)
    expect(typstPosition(doc, 3)).toEqual({ line: 0, character: 3 })
  })
  it('rejects stale or malformed positions instead of silently changing another line', () => {
    expect(typstOffset(doc, { line: 99, character: 0 })).toBeNull()
    expect(typstOffset(doc, { line: 0, character: 5 })).toBeNull()
    expect(typstOffset(doc, { line: 0.5, character: 0 })).toBeNull()
  })
  it('applies disjoint server edits atomically with original offsets', () => {
    const changes = typstEditChanges(doc, [
      { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } }, newText: '!' },
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: '中文' },
    ])
    expect(EditorState.create({ doc }).update({ changes }).state.doc.toString()).toBe('中文😀文\n!set text(size: 12pt)\n')
  })
  it('rejects overlapping or out-of-bounds edits', () => {
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }
    expect(() => typstEditChanges(doc, [{ range, newText: '' }, { range, newText: '' }])).toThrow('重叠')
    expect(() => typstEditChanges(doc, [{ range: { ...range, end: { line: 99, character: 0 } }, newText: '' }])).toThrow('无效')
  })
  it('does not map stale diagnostics onto unrelated text', () => {
    expect(typstDiagnostics(doc, [{ message: 'old', severity: 1, range: { start: { line: 90, character: 0 }, end: { line: 90, character: 1 } } }])).toEqual([])
    expect(typstDiagnostics(doc, [{ message: 'error', severity: 1, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }])[0].severity).toBe('error')
  })
})

describe('Typst preview boundary', () => {
  it('accepts native loopback previews', () => {
    expect(safeTypstPreviewUrl('http://127.0.0.1:12345/preview')).toBe('http://127.0.0.1:12345/preview')
    expect(safeTypstPreviewUrl('http://[::1]:12345/')).toBe('http://[::1]:12345/')
  })
  it.each(['https://example.com/', 'file:///C:/secret', 'javascript:alert(1)', 'http://127.0.0.1.evil.test:8080/', 'http://user@localhost:12345/', 'http://localhost/'])('rejects %s', (url) => expect(safeTypstPreviewUrl(url)).toBeNull())
  it('keeps documentation as inert text', () => {
    expect(typstDocumentation([{ kind: 'markdown', value: '<script>bad()</script>' }, 'detail'])).toBe('<script>bad()</script>\n\ndetail')
  })
})
