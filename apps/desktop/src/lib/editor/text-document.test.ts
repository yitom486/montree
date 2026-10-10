import { describe, expect, it, vi } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { history, historyField } from '@codemirror/commands'
import { TextDocument } from './text-document'

function fixture(text = 'same\n\nsame\n<!-- Page 1 -->\n[[note]]', path = 'D:/notes/book.md') {
  const changed = vi.fn(), notify = vi.fn(), persist = vi.fn(async () => {})
  const doc = new TextDocument(path, text, text, text, changed, notify, persist)
  const edit = (edits: Array<{ from: number; to: number; expectedText: string; text: string }>, extra = {}) => doc.edit({ revision: doc.revision, edits, expectedCount: edits.length, ...extra })
  return { doc, edit, changed, persist }
}

describe('loaded Markdown/TXT tool document', () => {
  it('reads original blank lines and whitespace with bounded offsets', () => {
    const { doc } = fixture('  hi  \n\n\nend\n')
    expect(doc.read({ target: 'lines', startLine: 1, endLine: 4 })).toMatchObject({ from: 0, to: 12, text: '  hi  \n\n\nend', startLine: 1, endLine: 4, truncated: false })
    const result = doc.read({ target: 'document', maxChars: 3 })
    expect(result).toMatchObject({ text: '  h', from: 0, to: 3, requestedTo: 13, truncated: true, source: 'editor-buffer' })
  })
  it('parses real ATX/Setext headings, excluding fenced headings, and includes subsections', () => {
    const { doc } = fixture('intro\n# Root\nbody\n## Child\nchild\n```md\n# fake\n```\nOther\n=====\nlast')
    expect(doc.units().map((unit) => unit.label)).toEqual(['前言', 'Root', 'Child', 'Other'])
    expect(doc.read({ target: 'section', flatIndex: 1 })).toMatchObject({ text: '# Root\nbody\n## Child\nchild\n```md\n# fake\n```\n' })
    expect(doc.read({ target: 'section', title: 'Other' })).toMatchObject({ text: 'Other\n=====\nlast' })
  })
  it('requires unique full chapter title and strict integer indexes', () => {
    const { doc } = fixture('# Same\na\n# Same\nb')
    expect(() => doc.read({ target: 'section', title: 'Same' })).toThrow('不唯一')
    expect(() => doc.read({ target: 'section', flatIndex: 0.5 })).toThrow('整数')
  })
  it('treats TXT Markdown-looking text literally and chunks by lines', () => {
    const { doc } = fixture(Array.from({ length: 401 }, (_, i) => i === 0 ? '# no heading' : `line${i}`).join('\n'), 'D:/notes/plain.txt')
    expect(doc.units().map((unit) => unit.label)).toEqual(['第 1–200 行', '第 201–400 行', '第 401–401 行'])
    expect(doc.read({ target: 'section', flatIndex: 2 })).toMatchObject({ text: 'line400', format: 'txt' })
  })
  it('replaces duplicate text only at explicit source offsets, preserving custom markup', () => {
    const { doc, edit } = fixture()
    edit([{ from: 6, to: 10, expectedText: 'same', text: 'changed' }])
    expect(doc.text).toBe('same\n\nchanged\n<!-- Page 1 -->\n[[note]]')
    expect(doc.isDirty()).toBe(true)
  })
  it('validates every row before committing and rejects stale revision/count/overlap/unknown fields', () => {
    const { doc, edit, changed } = fixture('abcdef')
    const valid = { from: 0, to: 1, expectedText: 'a', text: 'A' }
    expect(() => edit([valid, { from: 3, to: 4, expectedText: 'wrong', text: 'D' }])).toThrow('原文')
    expect(() => edit([valid], { revision: doc.revision - 1 })).toThrow('版本')
    expect(() => edit([valid], { expectedCount: 2 })).toThrow('数量')
    expect(() => edit([valid, valid])).toThrow('重叠')
    expect(() => edit([valid], { unknown: true })).toThrow('参数')
    expect(doc.text).toBe('abcdef'); expect(changed).not.toHaveBeenCalled()
  })
  it('insertion/deletion and independent ranges form one isolated undo event', () => {
    const { doc, edit } = fixture('abcdef')
    doc.accept(doc.state.update({ changes: { from: 6, insert: ' manual' } }).state)
    edit([{ from: 0, to: 0, expectedText: '', text: '>' }, { from: 2, to: 4, expectedText: 'cd', text: '' }])
    expect(doc.text).toBe('>abef manual')
    const editedRevision = doc.revision
    doc.undo(); expect(doc.text).toBe('abcdef manual'); expect(doc.revision).toBeGreaterThan(editedRevision)
    doc.undo(); expect(doc.text).toBe('abcdef')
  })
  it('enforces fresh selected ranges, including multi-selection and whitespace', () => {
    const { doc, edit } = fixture('  aa  bb')
    doc.accept(doc.state.update({ selection: EditorSelection.create([EditorSelection.range(0, 2), EditorSelection.range(6, 8)]) }).state)
    const selection = doc.selection()!
    expect(selection.ranges.map((range) => range.text)).toEqual(['  ', 'bb'])
    expect(() => edit([{ from: 2, to: 4, expectedText: 'aa', text: 'AA' }], { selectionId: selection.selectionId })).toThrow('选区内')
    doc.accept(doc.state.update({ selection: { anchor: 2, head: 4 } }).state)
    expect(() => edit([{ from: 0, to: 2, expectedText: '  ', text: 'X' }], { selectionId: selection.selectionId })).toThrow('选区已变化')
    edit([{ from: 2, to: 4, expectedText: 'aa', text: 'AA' }], { selectionId: doc.selection()!.selectionId })
    expect(doc.text).toBe('  AA  bb')
  })
  it('notifies fresh manual selection changes without treating document edits as a new user selection', () => {
    const { doc, edit } = fixture('hello world')
    doc.onSelectionChange = vi.fn()
    doc.accept(doc.state.update({ selection: { anchor: 6, head: 11 } }).state)
    expect(doc.onSelectionChange).toHaveBeenCalledOnce()
    edit([{ from: 6, to: 11, expectedText: 'world', text: 'everyone' }])
    expect(doc.onSelectionChange).toHaveBeenCalledOnce()
    doc.accept(doc.state.update({ selection: { anchor: 0 } }).state)
    expect(doc.onSelectionChange).toHaveBeenCalledTimes(2)
  })
  it('preserves history after recreating an editor and after headless edits', () => {
    const { doc, edit } = fixture('before')
    edit([{ from: 0, to: 6, expectedText: 'before', text: 'after' }])
    const recreated = doc.createEditorState({ extensions: [history(), EditorState.allowMultipleSelections.of(true)] })
    expect(recreated.field(historyField)).toBeDefined()
    doc.accept(recreated); doc.undo(); expect(doc.text).toBe('before')
  })
  it('bounds selection context but preserves exact edit coordinates and flags truncated original text', () => {
    const { doc } = fixture('a'.repeat(30000))
    doc.accept(doc.state.update({ selection: { anchor: 0, head: 30000 } }).state)
    expect(doc.selectionSnapshot()!.ranges[0]).toMatchObject({ from: 0, to: 30000, textTruncated: true })
    expect(doc.selectionSnapshot()!.ranges[0].text.length).toBe(20000)
    expect(doc.selectionSnapshot()!.selectionId).toBe(doc.selection()!.selectionId)
    expect(() => doc.read({ target: 'document', startLine: 1 })).toThrow('不支持的参数')
  })
  it('never splits a surrogate pair during reading, editing or truncation', () => {
    const { doc, edit } = fixture('a😀b')
    expect(doc.read({ target: 'document', maxChars: 2 })).toMatchObject({ text: 'a', to: 1, truncated: true })
    expect(() => doc.read({ target: 'range', from: 2, to: 4 })).toThrow('Unicode')
    expect(() => edit([{ from: 1, to: 2, expectedText: '\ud83d', text: '' }])).toThrow('Unicode')
    edit([{ from: 1, to: 3, expectedText: '😀', text: '🙂' }]); expect(doc.text).toBe('a🙂b')
  })
  it('normalizes replacement newlines and rejects repeated insertion positions or oversized batches', () => {
    const { doc, edit } = fixture('a')
    expect(() => edit([{ from: 0, to: 0, expectedText: '', text: 'x' }, { from: 0, to: 0, expectedText: '', text: 'y' }])).toThrow('重复')
    expect(() => edit([{ from: 0, to: 0, expectedText: '', text: 'x'.repeat(200001) }])).toThrow('200000')
    edit([{ from: 0, to: 1, expectedText: 'a', text: 'a\r\nb\rc' }]); expect(doc.text).toBe('a\nb\nc')
  })
  it('labels preview fallback and supports editing/undo without a mounted view', () => {
    const { doc, edit } = fixture('# One\na\n# Two\nb')
    doc.previewUnitIndex = () => 1
    expect(doc.read({ target: 'viewport' })).toMatchObject({ text: '# Two\nb', scope: 'section-fallback' })
    edit([{ from: 14, to: 15, expectedText: 'b', text: 'B' }]); doc.undo()
    expect(doc.text.endsWith('b')).toBe(true)
  })
  it('save uses the loaded disk baseline and remains dirty if edited while saving', async () => {
    let complete!: () => void
    const persist = vi.fn(() => new Promise<void>((resolve) => { complete = resolve }))
    const doc = new TextDocument('x.md', 'a\nb', 'a\nb', 'a\r\nb', vi.fn(), vi.fn(), persist)
    doc.edit({ revision: doc.revision, expectedCount: 1, edits: [{ from: 0, to: 1, expectedText: 'a', text: 'A' }] })
    const save = doc.save()
    await expect(doc.save()).rejects.toThrow('正在保存')
    doc.edit({ revision: doc.revision, expectedCount: 1, edits: [{ from: 2, to: 3, expectedText: 'b', text: 'B' }] })
    complete(); await save
    expect(persist).toHaveBeenCalledWith('A\nb', 'a\r\nb')
    expect(doc.isDirty()).toBe(true)
  })
  it('a failed save does not mark edits as saved', async () => {
    const { doc, edit, persist } = fixture('a')
    edit([{ from: 0, to: 1, expectedText: 'a', text: 'A' }]); persist.mockRejectedValueOnce(new Error('external conflict'))
    await expect(doc.save()).rejects.toThrow('external conflict'); expect(doc.isDirty()).toBe(true)
  })
})
