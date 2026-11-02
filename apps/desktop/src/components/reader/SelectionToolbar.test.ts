// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SelectionToolbar } from './SelectionToolbar'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('SelectionToolbar', () => {
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

  it('keeps only copy, highlight, read-aloud and AI at the top level', async () => {
    await act(async () => {
      root.render(
        createElement(SelectionToolbar, {
          x: 100,
          y: 200,
          onCopy: vi.fn(),
          onAnnotate: vi.fn(),
          onHighlight: vi.fn(),
          onReadAloud: vi.fn(),
          onGenerateCardPreset: vi.fn(),
          onAskDeepAnswer: vi.fn(),
          onAskAgent: vi.fn(),
          onDismiss: vi.fn(),
        }),
      )
    })

    expect(container.textContent).toContain('复制')
    expect(container.textContent).toContain('高亮')
    expect(container.textContent).toContain('朗读')
    expect(container.textContent).toContain('AI')
    expect(container.textContent).not.toContain('引用')
    expect(container.textContent).not.toContain('深度问答')
    expect(container.textContent).not.toContain('智能制卡')
  })

  it('applies the last highlight color from the main button', async () => {
    const onHighlight = vi.fn()

    await act(async () => {
      root.render(
        createElement(SelectionToolbar, {
          x: 100,
          y: 200,
          onCopy: vi.fn(),
          onHighlight,
          onDismiss: vi.fn(),
        }),
      )
    })

    const highlightBtn = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('高亮'),
    )
    expect(highlightBtn).toBeDefined()

    await act(async () => {
      highlightBtn?.click()
    })

    expect(onHighlight).toHaveBeenCalledWith('yellow')
  })

  it('opens the color palette and picks a color or writes a note', async () => {
    const onHighlight = vi.fn()
    const onAnnotate = vi.fn()

    await act(async () => {
      root.render(
        createElement(SelectionToolbar, {
          x: 100,
          y: 200,
          onCopy: vi.fn(),
          onAnnotate,
          onHighlight,
          onDismiss: vi.fn(),
        }),
      )
    })

    const paletteTrigger = container.querySelector('button[aria-label="选择高亮颜色"]') as HTMLButtonElement
    expect(paletteTrigger).not.toBeNull()

    await act(async () => {
      paletteTrigger.click()
    })

    const green = container.querySelector('button[aria-label="高亮 绿"]') as HTMLButtonElement
    expect(green).not.toBeNull()
    await act(async () => {
      green.click()
    })
    expect(onHighlight).toHaveBeenCalledWith('green')

    await act(async () => {
      paletteTrigger.click()
    })
    const note = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('写批注'),
    )
    expect(note).toBeDefined()
    await act(async () => {
      note?.click()
    })
    expect(onAnnotate).toHaveBeenCalledTimes(1)
  })

  it('groups card presets, quick answers and composer entry in the AI menu', async () => {
    const onGenerateCardPreset = vi.fn()
    const onAskDeepAnswer = vi.fn()
    const onAskAgent = vi.fn()

    await act(async () => {
      root.render(
        createElement(SelectionToolbar, {
          x: 100,
          y: 200,
          onCopy: vi.fn(),
          onGenerateCardPreset,
          onAskDeepAnswer,
          onAskAgent,
          onDismiss: vi.fn(),
        }),
      )
    })

    const aiBtn = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('AI'),
    )
    expect(aiBtn).toBeDefined()

    await act(async () => {
      aiBtn?.click()
    })
    expect(container.textContent).toContain('生成卡片')
    expect(container.textContent).toContain('通用提炼')
    expect(container.textContent).toContain('快速问答')
    expect(container.textContent).toContain('深入解释')
    expect(container.textContent).toContain('去 Agent 面板细问')

    const concept = Array.from(container.querySelectorAll('[role="menuitem"]')).find((button) =>
      button.textContent?.includes('概念界定'),
    )
    expect(concept).toBeDefined()
    await act(async () => {
      ;(concept as HTMLButtonElement).click()
    })
    expect(onGenerateCardPreset).toHaveBeenCalledWith('concept', undefined)

    await act(async () => {
      aiBtn?.click()
    })
    const explain = Array.from(container.querySelectorAll('[role="menuitem"]')).find((button) =>
      button.textContent?.includes('深入解释'),
    )
    expect(explain).toBeDefined()
    await act(async () => {
      ;(explain as HTMLButtonElement).click()
    })
    expect(onAskDeepAnswer).toHaveBeenCalledWith('explain')

    await act(async () => {
      aiBtn?.click()
    })
    const composer = Array.from(container.querySelectorAll('[role="menuitem"]')).find((button) =>
      button.textContent?.includes('去 Agent 面板细问'),
    )
    expect(composer).toBeDefined()
    await act(async () => {
      ;(composer as HTMLButtonElement).click()
    })
    expect(onAskAgent).toHaveBeenCalledTimes(1)
  })

  it('does not render an AI entry when no AI action is available', async () => {
    await act(async () => {
      root.render(
        createElement(SelectionToolbar, {
          x: 100,
          y: 200,
          onCopy: vi.fn(),
          onDismiss: vi.fn(),
        }),
      )
    })

    expect(container.textContent).not.toContain('AI')
  })
})
