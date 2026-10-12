// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PdfZoomControls } from './PdfZoomControls'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('PdfZoomControls', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('展示当前缩放百分比 (1.2 -> 120%)', async () => {
    const setScale = vi.fn()
    const fitWidth = vi.fn()

    await act(async () => {
      root.render(
        createElement(PdfZoomControls, {
          scale: 1.2,
          setScale,
          fitWidth,
        }),
      )
    })

    expect(container.textContent).toContain('120%')
  })

  it('点击缩小按钮触发 setScale 递减', async () => {
    let currentScale = 1.2
    const setScale = vi.fn((update: React.SetStateAction<number>) => {
      if (typeof update === 'function') {
        currentScale = update(currentScale)
      } else {
        currentScale = update
      }
    })
    const fitWidth = vi.fn()

    await act(async () => {
      root.render(
        createElement(PdfZoomControls, {
          scale: 1.2,
          setScale,
          fitWidth,
        }),
      )
    })

    const minusBtn = container.querySelector('button[aria-label="缩小页面"]')
    expect(minusBtn).toBeDefined()

    await act(async () => {
      minusBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(setScale).toHaveBeenCalledTimes(1)
    expect(currentScale).toBeCloseTo(1.05, 2)
  })

  it('点击放大按钮触发 setScale 递增', async () => {
    let currentScale = 1.0
    const setScale = vi.fn((update: React.SetStateAction<number>) => {
      if (typeof update === 'function') {
        currentScale = update(currentScale)
      } else {
        currentScale = update
      }
    })
    const fitWidth = vi.fn()

    await act(async () => {
      root.render(
        createElement(PdfZoomControls, {
          scale: 1.0,
          setScale,
          fitWidth,
        }),
      )
    })

    const plusBtn = container.querySelector('button[aria-label="放大页面"]')
    expect(plusBtn).toBeDefined()

    await act(async () => {
      plusBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(setScale).toHaveBeenCalledTimes(1)
    expect(currentScale).toBeCloseTo(1.15, 2)
  })

  it('点击适合宽度按钮触发 fitWidth 回调', async () => {
    const setScale = vi.fn()
    const fitWidth = vi.fn()

    await act(async () => {
      root.render(
        createElement(PdfZoomControls, {
          scale: 1.0,
          setScale,
          fitWidth,
        }),
      )
    })

    const fitWidthBtn = container.querySelector('button[aria-label="适合宽度"]')
    expect(fitWidthBtn).toBeDefined()

    await act(async () => {
      fitWidthBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(fitWidth).toHaveBeenCalledTimes(1)
  })

  it('disabled 属性下按钮被禁用', async () => {
    const setScale = vi.fn()
    const fitWidth = vi.fn()

    await act(async () => {
      root.render(
        createElement(PdfZoomControls, {
          scale: 1.0,
          setScale,
          fitWidth,
          disabled: true,
        }),
      )
    })

    const minusBtn = container.querySelector('button[aria-label="缩小页面"]') as HTMLButtonElement
    const plusBtn = container.querySelector('button[aria-label="放大页面"]') as HTMLButtonElement
    const fitWidthBtn = container.querySelector('button[aria-label="适合宽度"]') as HTMLButtonElement

    expect(minusBtn?.disabled).toBe(true)
    expect(plusBtn?.disabled).toBe(true)
    expect(fitWidthBtn?.disabled).toBe(true)
  })
})
