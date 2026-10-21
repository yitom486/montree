// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView, runScopeHandlers } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { fenceLanguageAt, ghostField, inlineCompletion, shouldTrigger, type InlineCompletionContext } from './inline-completion-extension'

function mount(doc: string, fetch: (context: InlineCompletionContext, signal: AbortSignal) => Promise<string[]>, enabled = () => true) {
  const parent = document.createElement('div'); document.body.append(parent)
  const view = new EditorView({ parent, state: EditorState.create({ doc, selection: { anchor: doc.length },
    extensions: [markdown({ base: markdownLanguage }), inlineCompletion({ fetch, enabled, language: 'markdown', debounceMs: 10 })] }) })
  const type = (text: string) => {
    const pos = view.state.selection.main.head
    view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length }, userEvent: 'input.type' })
  }
  const key = (key: string, extra: KeyboardEventInit = {}) => runScopeHandlers(view, new KeyboardEvent('keydown', { key, ...extra }), 'editor')
  return { view, type, key, cleanup: () => { view.destroy(); parent.remove() } }
}
const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))
afterEach(() => { vi.useRealTimers() })

describe('inline completion ghost text', () => {
  it('debounces, shows ghost text, Tab accepts', async () => {
    const fetch = vi.fn(async () => [' fox jumps.'])
    const { view, type, key, cleanup } = mount('The quick brow', fetch)
    type('n')
    expect(fetch).not.toHaveBeenCalled()
    await wait()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect((fetch.mock.calls[0] as unknown[])[0]).toMatchObject({ prefix: 'The quick brown', suffix: '', language: 'markdown' })
    expect(view.contentDOM.querySelector('.cm-ai-ghost')?.textContent).toBe(' fox jumps.')
    expect(key('Tab')).toBe(true)
    expect(view.state.doc.toString()).toBe('The quick brown fox jumps.')
    expect(view.state.field(ghostField)).toBeNull()
    cleanup()
  })
  it('Esc dismisses; typing a non-matching char dismisses; matching chars type through', async () => {
    const { view, type, key, cleanup } = mount('Hello', async () => [' world!'])
    type(' '); await wait()
    // 已键入空格，候选以空格开头 → 不命中时消失
    expect(view.state.field(ghostField)).toBeTruthy()
    type('w')
    expect(view.state.field(ghostField)).toBeNull()
    type('x'); await wait()
    expect(key('Escape')).toBe(true)
    expect(view.state.field(ghostField)).toBeNull()
    expect(key('Escape')).toBe(false)
    cleanup()
  })
  it('type-through keeps the remaining suggestion', async () => {
    const { view, type, cleanup } = mount('Hello', async () => [' world!'])
    type(','); await wait()
    view.dispatch({ effects: [] })
    // 手动设定场景：候选 " world!"，用户键入空格
    expect(view.state.field(ghostField)?.items[0]).toBe(' world!')
    type(' ')
    expect(view.state.field(ghostField)?.items[0]).toBe('world!')
    cleanup()
  })
  it('Ctrl/Cmd+Right accepts word by word; Alt+] cycles alternatives', async () => {
    const { view, type, key, cleanup } = mount('Say', async () => [' hello big world', ' goodbye'])
    type(':'); await wait()
    expect(view.contentDOM.querySelector('.cm-ai-ghost-hint')?.textContent).toBe(' 1/2')
    key(']', { altKey: true })
    expect(view.contentDOM.querySelector('.cm-ai-ghost')?.textContent).toContain('goodbye')
    key('[', { altKey: true })
    key('ArrowRight', { ctrlKey: true })
    expect(view.state.doc.toString()).toBe('Say: hello')
    expect(view.state.field(ghostField)?.items[0]).toBe(' big world')
    key('ArrowRight', { ctrlKey: true })
    expect(view.state.doc.toString()).toBe('Say: hello big')
    cleanup()
  })
  it('typing cancels the in-flight request and stale results are dropped', async () => {
    const signals: AbortSignal[] = []
    let release!: (value: string[]) => void
    const fetch = vi.fn((_context: InlineCompletionContext, signal: AbortSignal) => { signals.push(signal); return new Promise<string[]>((resolve) => { release = resolve }) })
    const { view, type, cleanup } = mount('abc', fetch)
    type('d'); await wait()
    expect(fetch).toHaveBeenCalledTimes(1)
    type('e')
    expect(signals[0].aborted).toBe(true)
    release(['stale'])
    await wait(0)
    expect(view.state.field(ghostField)).toBeNull()
    cleanup()
  })
  it('does not request while disabled, during IME composition, or in a fence without language', async () => {
    const fetch = vi.fn(async () => ['x'])
    const off = mount('text', fetch, () => false)
    off.type('s'); await wait(); expect(fetch).not.toHaveBeenCalled(); off.cleanup()
    const ime = mount('中文', fetch)
    Object.defineProperty(ime.view, 'composing', { configurable: true, get: () => true })
    ime.type('输'); await wait(); expect(fetch).not.toHaveBeenCalled(); ime.cleanup()
    const fence = mount('```\ncode', fetch)
    fence.type('x'); await wait(); expect(fetch).not.toHaveBeenCalled(); fence.cleanup()
    const py = mount('```python\nprint(', fetch)
    py.type('1'); await wait()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect((fetch.mock.calls[0] as unknown as [InlineCompletionContext])[0].language).toBe('python')
    py.cleanup()
  })
  it('helpers: fence language and trigger position', () => {
    const state = EditorState.create({ doc: '```js\nlet a\n```\ntext', extensions: [markdown({ base: markdownLanguage })] })
    expect(fenceLanguageAt(state, 8)).toBe('js')
    expect(fenceLanguageAt(state, state.doc.length)).toBeUndefined()
    expect(shouldTrigger(EditorState.create({ doc: 'ab cd', selection: { anchor: 2 } }))).toBe(false)
    expect(shouldTrigger(EditorState.create({ doc: 'ab)', selection: { anchor: 2 } }))).toBe(true)
  })
})
