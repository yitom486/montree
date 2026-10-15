// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadingMark } from '@montree/contracts'
import { EpubMarkTooltip } from './EpubMarkTooltip'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const mark = { id: 'highlight', kind: 'highlight', excerpt: '重点原文' } as ReadingMark

describe('阅读标记悬停预览', () => {
  let root: Root
  let container: HTMLDivElement
  const render = (value: ReadingMark | null, disabled = false) => act(() => root.render(createElement(EpubMarkTooltip, { mark: value, x: 40, y: 40, disabled })))
  const advance = (time: number) => act(() => { vi.advanceTimersByTime(time) })
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  })
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers() })
  it('扫过标记不会闪出预览', () => {
    render(mark); advance(100); render(null); advance(200)
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })
  it('纯重点可预览，移入浮层保持，离开收起', () => {
    render(mark); advance(180)
    const popup = document.querySelector('[role="tooltip"]')!
    expect(popup.textContent).toContain('重点原文')
    render(null)
    act(() => popup.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })))
    advance(300)
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull()
    act(() => popup.dispatchEvent(new PointerEvent('pointerout', { bubbles: true })))
    advance(160)
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })
  it('打开操作浮层时立即收起预览', () => {
    render(mark); advance(180)
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull()
    render(mark, true)
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })
})
