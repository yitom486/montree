// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiagramModal } from './DiagramModal'
import type { DiagramPayload } from './tools/DiagramViewerCard'
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('./tools/DiagramViewerCard', () => ({ DiagramViewerCard: ({ payload }: { payload: DiagramPayload }) => createElement('div', { 'data-testid': 'mock-diagram-viewer' }, payload.title) }))
describe('Radix DiagramModal', () => {
  let host: HTMLDivElement, root: Root
  const diagram: DiagramPayload = { diagramId: 'd1', diagramType: 'sequence', title: '握手流程', mermaidCode: 'sequenceDiagram\n A->>B: init' }
  beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
  afterEach(() => { act(() => root.unmount()); host.remove() })
  it('closed modal mounts no dialog', async () => {
    await act(async () => root.render(createElement(DiagramModal, { isOpen: false, onClose: vi.fn(), diagram })))
    expect(document.querySelector('[role=dialog]')).toBeNull()
  })
  it('portal has an accessible title, the business payload and a working close action', async () => {
    const close = vi.fn()
    await act(async () => root.render(createElement(DiagramModal, { isOpen: true, onClose: close, diagram })))
    const dialog = document.querySelector('[role=dialog]')!
    expect(dialog.textContent).toContain('握手流程')
    expect(dialog.textContent).toContain('sequence · d1')
    expect(dialog.querySelector('[data-testid=mock-diagram-viewer]')?.textContent).toBe('握手流程')
    const title = document.getElementById(dialog.getAttribute('aria-labelledby')!)!
    expect(title.textContent).toBe('握手流程')
    await act(async () => (dialog.querySelector('[data-slot=dialog-close]') as HTMLButtonElement).click())
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('Escape dismissal is handled by Radix', async () => {
    const close = vi.fn()
    await act(async () => root.render(createElement(DiagramModal, { isOpen: true, onClose: close, diagram })))
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(close).toHaveBeenCalledTimes(1)
  })
})
