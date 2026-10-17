// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { getDocumentTools } from '@/lib/agent/context/document-tool-registry'
import { useTextDocumentTools } from './useTextDocumentTools'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('Typst shared text document', () => {
  it('keeps undo through save-as and reloads on a new session without advertising Agent tools', async () => {
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
      expect(getDocumentTools(options.filePath)).toBeNull()
      act(() => { model!.accept(model!.state.update({ changes: { from: model!.state.doc.length, insert: '\n追加' } }).state) })
      expect(changed).toHaveBeenLastCalledWith('= 原文😀\n追加')
      options = { ...options, filePath: 'D:/论文/copy.typ', content: original.text, savedContent: original.text, diskContent: original.text }
      await render()
      expect(model).toBe(original)
      expect(model!.filePath).toBe('D:/论文/copy.typ')
      expect(getDocumentTools(options.filePath)).toBeNull()
      expect(model!.isDirty()).toBe(false)
      act(() => { model!.undo() })
      expect(model!.text).toBe('= 原文😀')
      expect(model!.isDirty()).toBe(true)
      expect(changed).toHaveBeenLastCalledWith('= 原文😀')
      options = { ...options, content: '= 外部重载', savedContent: '= 外部重载', diskContent: '= 外部重载', session: 2 }
      await render()
      expect(model).not.toBe(original)
      expect(model!.text).toBe('= 外部重载')
      expect(() => model!.undo()).toThrow('没有可撤销')
    } finally { await act(async () => { root.unmount() }); container.remove() }
  })
})
