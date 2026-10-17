// @vitest-environment happy-dom
import { act, createElement, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import { undo } from '@codemirror/commands'
import { acceptCompletion, completionStatus, startCompletion } from '@codemirror/autocomplete'
import { diagnosticCount } from '@codemirror/lint'
import { TextDocument } from '@/lib/editor/text-document'
import { TypstEditor, type TypstEditorHandle, type TypstEditorProps } from './TypstEditor'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('Typst CodeMirror editing', () => {
  let container: HTMLDivElement, root: Root
  let props: TypstEditorProps
  const ref = createRef<TypstEditorHandle>()
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    props = { filePath: '/project/main.typ', value: '= 中文😀', uri: 'file:///project/main.typ', diagnostics: [], theme: 'light', fontSize: 15, tabSize: 2,
      capabilities: { completionProvider: { resolveProvider: true }, documentFormattingProvider: true, hoverProvider: true },
      request: vi.fn(async () => null), onChange: vi.fn(), onError: vi.fn() }
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })
  const render = async () => { await act(async () => root.render(createElement(TypstEditor, { ...props, ref }))) }
  const view = () => EditorView.findFromDOM(container.querySelector('.cm-editor')!)!

  it('keeps editor instance and undo history across theme/font rerenders', async () => {
    await render()
    const editor = view()
    act(() => editor.dispatch({ changes: { from: editor.state.doc.length, insert: '新增' } }))
    expect(props.onChange).toHaveBeenCalledWith('= 中文😀新增')
    props = { ...props, value: '= 中文😀新增', theme: 'dark', fontSize: 19 }
    await render()
    expect(view()).toBe(editor)
    act(() => undo(editor))
    expect(editor.state.doc.toString()).toBe('= 中文😀')
  })
  it('syncs external source changes without echoing a dirty update', async () => {
    await render()
    props = { ...props, value: '= 外部修改' }; await render()
    expect(view().state.doc.toString()).toBe('= 外部修改')
    expect(props.onChange).not.toHaveBeenCalled()
  })
  it('preserves the shared document history after editor remount', async () => {
    props.textDocument = new TextDocument(props.filePath, props.value, props.value, props.value, vi.fn(), vi.fn(), async () => {})
    await render()
    act(() => view().dispatch({ changes: { from: 0, to: 1, insert: '==' } }))
    props = { ...props, value: '== 中文😀' }
    act(() => root.render(null)); await render()
    expect(view().state.doc.toString()).toBe('== 中文😀')
    act(() => undo(view()))
    expect(view().state.doc.toString()).toBe('= 中文😀')
  })
  it('rejects format results if the buffer changed while the request was pending', async () => {
    let finish!: (value: unknown) => void
    props.request = vi.fn(() => new Promise((resolve) => { finish = resolve }))
    await render()
    const formatting = ref.current!.format()
    act(() => view().dispatch({ changes: { from: 0, insert: '// keep\n' } }))
    finish([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: 'stale' }])
    await act(async () => { await formatting })
    expect(view().state.doc.toString()).toBe('// keep\n= 中文😀')
  })
  it('applies server formatting as one undoable operation', async () => {
    props.request = vi.fn(async () => [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: '==' }])
    await render()
    await act(async () => { await ref.current!.format() })
    expect(view().state.doc.toString()).toBe('== 中文😀')
    act(() => undo(view()))
    expect(view().state.doc.toString()).toBe('= 中文😀')
  })
  it('discards pending formatting when the same document reconnects to another session', async () => {
    let finish!: (value: unknown) => void
    props = { ...props, sessionKey: 'old', request: vi.fn(() => new Promise((resolve) => { finish = resolve })) }
    await render()
    const formatting = ref.current!.format()
    props = { ...props, sessionKey: 'new' }; await render()
    finish([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: 'stale' }])
    await act(async () => { await formatting })
    expect(view().state.doc.toString()).toBe('= 中文😀')
  })
  it('displays native diagnostics and clears them when a newer buffer arrives', async () => {
    props.diagnostics = [{ message: 'unknown variable', severity: 1, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }]
    await render()
    expect(diagnosticCount(view().state)).toBe(1)
    props = { ...props, diagnostics: [] }; await render()
    expect(diagnosticCount(view().state)).toBe(0)
  })
  it('uses native completion replacement ranges and snippet tabstops', async () => {
    props.value = '#te'
    props.request = vi.fn(async () => ({ items: [{ label: 'text', insertTextFormat: 2,
      textEdit: { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } }, newText: 'text(${1:body})$0' } }] }))
    await render()
    act(() => { view().dispatch({ selection: { anchor: 3 } }); view().focus(); startCompletion(view()) })
    await vi.waitFor(() => expect(completionStatus(view().state)).toBe('active'))
    await new Promise((resolve) => setTimeout(resolve, 100))
    await act(async () => { view().contentDOM.blur(); acceptCompletion(view()); await Promise.resolve() })
    expect(props.onError).not.toHaveBeenCalled()
    expect(view().state.doc.toString()).toBe('#text(body)')
    expect(view().state.sliceDoc(view().state.selection.main.from, view().state.selection.main.to)).toBe('body')
    expect(props.request).toHaveBeenCalledWith('textDocument/completion', expect.objectContaining({ position: { line: 0, character: 3 } }))
  })
  it('applies extra import edits and snippet insertion in one undo step', async () => {
    props.value = '#te'
    props.request = vi.fn(async () => ({ items: [{ label: 'text', insertTextFormat: 2,
      additionalTextEdits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: '// imported\n' }],
      textEdit: { replace: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } }, insert: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } }, newText: 'text(${1:body})$0' } }] }))
    await render()
    act(() => { view().dispatch({ selection: { anchor: 3 } }); view().focus(); startCompletion(view()) })
    await vi.waitFor(() => expect(completionStatus(view().state)).toBe('active'))
    await new Promise((resolve) => setTimeout(resolve, 100))
    await act(async () => { view().contentDOM.blur(); acceptCompletion(view()); await Promise.resolve() })
    expect(props.onError).not.toHaveBeenCalled()
    expect(view().state.doc.toString()).toBe('// imported\n#text(body)')
    expect(view().state.sliceDoc(view().state.selection.main.from, view().state.selection.main.to)).toBe('body')
    act(() => undo(view()))
    expect(view().state.doc.toString()).toBe('#te')
  })
  it('does not apply a displayed completion after a session restart with identical source', async () => {
    props = { ...props, value: '#te', sessionKey: 'old', request: vi.fn(async () => [{ label: 'text' }]) }
    await render()
    act(() => { view().dispatch({ selection: { anchor: 3 } }); view().focus(); startCompletion(view()) })
    await vi.waitFor(() => expect(completionStatus(view().state)).toBe('active'))
    await new Promise((resolve) => setTimeout(resolve, 100))
    props = { ...props, sessionKey: 'new' }; await render()
    await act(async () => { view().contentDOM.blur(); acceptCompletion(view()); await Promise.resolve() })
    expect(view().state.doc.toString()).toBe('#te')
  })
})
