// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView, runScopeHandlers } from '@codemirror/view'
import { selectionActionsExtension } from './selection-actions-extension'
import { buildSelectionEditPrompt } from './selection-prompt'
import { requestAgentPrompt, subscribeAgentPrompts, pendingAgentPromptCount, setAgentPanelOpener } from '@/lib/agent/agent-prompt-bus'

const selection = { kind: 'text' as const, documentPath: '/a.md', revision: 7, from: 0, to: 5, selectionId: 'text:7:0-5', ranges: [{ from: 0, to: 5, text: 'Hello' }] }

describe('selection edit prompt', () => {
  it('asks the agent to use montree_text_propose with the selection id', () => {
    const { displayText, promptText } = buildSelectionEditPrompt(selection, 'polish')
    expect(displayText).toContain('润色')
    expect(promptText).toContain('montree_text_propose')
    expect(promptText).toContain('selectionId: text:7:0-5')
    expect(promptText).toContain('revision: 7')
    expect(promptText).toContain('Hello')
    expect(promptText).toContain('不要调用 montree_text_edit')
  })
  it('custom instructions are required; long selections are truncated', () => {
    expect(() => buildSelectionEditPrompt(selection, 'custom', '  ')).toThrow('指令')
    const long = { ...selection, documentPath: '/p.typ', ranges: [{ from: 0, to: 9000, text: 'x'.repeat(9000) }] }
    const out = buildSelectionEditPrompt(long, 'custom', '改成被动语态')
    expect(out.promptText).toContain('已截断')
    expect(out.promptText).toContain('Typst')
    expect(out.displayText).toContain('改成被动语态')
  })
})

describe('agent prompt bus', () => {
  it('queues until the agent panel subscribes and opens the panel', () => {
    const open = vi.fn(); setAgentPanelOpener(open)
    requestAgentPrompt({ displayText: 'a', promptText: 'A' })
    expect(open).toHaveBeenCalled()
    expect(pendingAgentPromptCount()).toBe(1)
    const seen: string[] = []
    const off = subscribeAgentPrompts((request) => seen.push(request.promptText))
    requestAgentPrompt({ displayText: 'b', promptText: 'B' })
    expect(seen).toEqual(['A', 'B'])
    off(); setAgentPanelOpener(null)
  })
})

describe('selection toolbar extension', () => {
  function mount(doc = 'Hello world') {
    const handler = vi.fn()
    const parent = document.createElement('div'); document.body.append(parent)
    const view = new EditorView({ parent, state: EditorState.create({ doc, extensions: [selectionActionsExtension(handler)] }) })
    return { view, handler, cleanup: () => { view.destroy(); parent.remove() } }
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
  it('shows on a non-empty selection and runs preset actions', async () => {
    const { view, handler, cleanup } = mount()
    expect(document.querySelector('.cm-ai-selection-toolbar')).toBeNull()
    view.dispatch({ selection: { anchor: 0, head: 5 } })
    await flush()
    const toolbar = document.querySelector('.cm-ai-selection-toolbar')!
    expect([...toolbar.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['改写', '润色', '缩短', '扩写', '翻译', '自定义…'])
    toolbar.querySelector<HTMLButtonElement>('[data-selection-action="shorten"]')!.click()
    expect(handler).toHaveBeenCalledWith('shorten', undefined)
    await flush()
    expect(document.querySelector('.cm-ai-selection-toolbar')).toBeNull()
    view.dispatch({ selection: { anchor: 0, head: 0 } })
    view.dispatch({ selection: { anchor: 6, head: 11 } })
    await flush()
    expect(document.querySelector('.cm-ai-selection-toolbar')).not.toBeNull()
    cleanup()
  })
  it('Ctrl/Cmd+J opens the custom instruction input (selecting the line if empty)', async () => {
    const { view, handler, cleanup } = mount('Line one\nLine two')
    view.dispatch({ selection: { anchor: 3 } })
    expect(runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'j', keyCode: 74, ctrlKey: true }), 'editor')).toBe(true)
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('Line one')
    await flush(); await flush()
    const input = document.querySelector<HTMLInputElement>('.cm-ai-selection-input')!
    expect(input).not.toBeNull()
    input.value = '更正式'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(handler).toHaveBeenCalledWith('custom', '更正式')
    cleanup()
  })
})
