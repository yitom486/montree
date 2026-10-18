// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { getDocumentTools } from '@/lib/agent/context/document-tool-registry'
import { getSelectionProvider } from '@/lib/agent/context/reader-selection-registry'
import { useTextDocumentTools } from './useTextDocumentTools'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('Typst shared text document', () => {
  it('registers Agent text tools, keeps undo through save-as, and reloads on a new session', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    let model: ReturnType<typeof useTextDocumentTools>
    const changed = vi.fn()
    let options = { filePath: 'D:/论文/main.typ', content: '= 原文😀', savedContent: '= 原文😀', diskContent: '= 原文😀', session: 1,
      onChange: changed, onSaved: vi.fn() }
    function Harness() { model = useTextDocumentTools(options); return null }
    const render = async () => { await act(async () => { root.render(createElement(Harness)) }) }
    try {
      await render()
      const original = model!
      const provider = getDocumentTools(options.filePath)
      expect(provider).not.toBeNull()
      expect(provider?.kind).toBe('text')

      // MCP text-read: Typst is raw source, formatted as typst and split by lines, not Markdown headings.
      const metadata = provider!.read({ documentPath: options.filePath, target: 'metadata' }) as {
        format: string; revision: number; units: Array<{ label: string }>; dirty: boolean
      }
      expect(metadata.format).toBe('typst')
      expect(metadata.units[0]?.label).toContain('行')
      expect(metadata.dirty).toBe(false)

      // MCP text-edit: same UTF-16 revision/expectedText contract, shared with manual undo.
      const edited = provider!.edit({
        documentPath: options.filePath,
        revision: metadata.revision,
        expectedCount: 1,
        edits: [{ from: 0, to: 0, expectedText: '', text: '// ' }],
      }) as { editedCount: number; format: string }
      expect(edited.format).toBe('typst')
      expect(edited.editedCount).toBe(1)
      expect(model!.text).toBe('// = 原文😀')
      expect(model!.isDirty()).toBe(true)

      // Selection provider exposes the Typst editor selection to montree_get_selection.
      act(() => { model!.accept(model!.state.update({ selection: { anchor: 0, head: 2 } }).state) })
      expect(getSelectionProvider()?.getSelectionText()).toBe('//')
      expect(getSelectionProvider()?.getSelectionTarget?.()).toMatchObject({ documentPath: options.filePath, kind: 'text' })

      act(() => { model!.accept(model!.state.update({ changes: { from: model!.state.doc.length, insert: '\n追加' } }).state) })
      expect(changed).toHaveBeenLastCalledWith('// = 原文😀\n追加')
      options = { ...options, filePath: 'D:/论文/copy.typ', content: original.text, savedContent: original.text, diskContent: original.text }
      await render()
      expect(model).toBe(original)
      expect(model!.filePath).toBe('D:/论文/copy.typ')
      // Save-as keeps the same history but moves the registered Agent tool path.
      expect(getDocumentTools('D:/论文/main.typ')).toBeNull()
      expect(getDocumentTools(options.filePath)?.kind).toBe('text')
      expect(model!.isDirty()).toBe(false)

      act(() => { model!.undo() })
      expect(model!.text).toBe('// = 原文😀')
      expect(model!.isDirty()).toBe(true)
      expect(changed).toHaveBeenLastCalledWith('// = 原文😀')
      options = { ...options, content: '= 外部重载', savedContent: '= 外部重载', diskContent: '= 外部重载', session: 2 }
      await render()
      expect(model).not.toBe(original)
      expect(model!.text).toBe('= 外部重载')
      expect(() => model!.undo()).toThrow('没有可撤销')
    } finally { await act(async () => { root.unmount() }); container.remove() }
  })
})
