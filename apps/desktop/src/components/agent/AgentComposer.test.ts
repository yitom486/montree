// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentComposer } from './AgentComposer'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
describe('community composer keyboard', () => {
  let host: HTMLDivElement, root: Root
  beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
  afterEach(() => { act(() => root.unmount()); host.remove() })
  const mount = async (prompting = false) => {
    const send = vi.fn(), cancel = vi.fn()
    await act(async () => root.render(createElement(AgentComposer, { draft: '中文内容', onDraftChange: vi.fn(), disabled: false, prompting, promptCapabilities: { image: false, audio: false, embeddedContext: false }, toolbarStart: null, onSubmit: send, onCancel: cancel })))
    return { send, cancel, textarea: host.querySelector('textarea')! }
  }
  it('Enter submits; Shift+Enter and native IME confirmation do not', async () => {
    const { send, textarea } = await mount()
    await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })))
    await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })))
    expect(send).not.toHaveBeenCalled()
    await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].text).toBe('中文内容')
  })
  it('composition lifecycle protects Enter even when a platform omits isComposing', async () => {
    const { send, textarea } = await mount()
    await act(async () => textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
    await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(send).not.toHaveBeenCalled()
    await act(async () => textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
    await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('streaming Stop cancels without submitting another message', async () => {
    const { send, cancel } = await mount(true)
    await act(async () => (host.querySelector('[aria-label="停止"]') as HTMLButtonElement).click())
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
  })
})
