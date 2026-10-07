// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReaderToolbarShell } from './ReaderToolbarShell'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('ReaderToolbarShell', () => {
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

  async function renderShell(props?: Partial<React.ComponentProps<typeof ReaderToolbarShell>>) {
    await act(async () => {
      root.render(
        createElement(ReaderToolbarShell, {
          onTocToggle: vi.fn(),
          onMarksToggle: vi.fn(),
          onAddBookmark: vi.fn(),
          ...props,
        }),
      )
    })
  }

  it('渲染目录/加书签/卡片流/札记箱/考考我，且已移除冗余批注簿与内部重复的AI伴读按钮', async () => {
    await renderShell()
    const text = container.textContent ?? ''
    for (const label of ['目录', '加书签', '卡片流', '札记箱', '考考我']) {
      expect(text).toContain(label)
    }
    expect(text).not.toContain('批注簿')
    expect(text).not.toContain('AI 伴读')
  })

  it('考考我按钮可触发出题回调', async () => {
    const onOpenQuiz = vi.fn()
    await renderShell({ onOpenQuiz })

    const quizBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('考考我')
    )
    expect(quizBtn).toBeDefined()

    await act(async () => {
      quizBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onOpenQuiz).toHaveBeenCalledTimes(1)
  })

  it('展示卡片流数量角标', async () => {
    await renderShell({ cardCount: 5 })
    const text = container.textContent ?? ''
    expect(text).toContain('卡片流')
    expect(text).toContain('5')
  })
})
