// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BookDbBlockHit } from '@montree/contracts'

const { mockQueryBook } = vi.hoisted(() => ({ mockQueryBook: vi.fn() }))

vi.mock('@/api/rosetta-api', () => ({
  rosettaApi: { queryBook: mockQueryBook },
}))

import { PdfBookSearch } from './PdfBookSearch'
import { registerReaderContent } from '@/lib/agent/context/reader-content-registry'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function hit(over: Partial<BookDbBlockHit> = {}): BookDbBlockHit {
  return {
    id: 1,
    type: 'paragraph',
    content: '移码表示法用于阶码',
    pageNumber: 36,
    chapterIndex: 1,
    chapterTitle: '第2章',
    blockIndex: 0,
    snippet: '',
    source: 'ocr',
    extractVersion: '',
    ...over,
  }
}

function searchOk(blocks: BookDbBlockHit[]) {
  return { ok: true as const, value: { kind: 'search' as const, blocks } }
}

async function renderSearch(props: {
  fingerprint?: string
  indexed?: boolean
  onJump?: (page: number) => void
  backend?: 'index' | 'memory'
  docKey?: string
  onJumpToLabel?: (label: string) => void
}) {
  const onJumpToPage = props.onJump ?? vi.fn()
  const onJumpToLabel = props.onJumpToLabel ?? vi.fn()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const renderProps = (nextFingerprint: string) =>
    createElement(PdfBookSearch, {
      fingerprint: nextFingerprint,
      indexed: props.indexed ?? true,
      onJumpToPage,
      backend: props.backend,
      docKey: props.docKey,
      onJumpToLabel,
    })
  await act(async () => {
    root.render(renderProps(props.fingerprint ?? 'fp-1'))
  })
  return {
    container,
    onJumpToPage: onJumpToPage as ReturnType<typeof vi.fn>,
    onJumpToLabel: onJumpToLabel as ReturnType<typeof vi.fn>,
    unmount: async () => {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    },
    rerender: async (nextFingerprint: string) => {
      await act(async () => {
        root.render(renderProps(nextFingerprint))
      })
    },
  }
}

function typeInto(input: HTMLInputElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, text)
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function trigger(container: ParentNode): HTMLButtonElement {
  return container.querySelector('button[aria-label="搜索正文"]') as HTMLButtonElement
}

function keywordInput(container: ParentNode): HTMLInputElement {
  return container.querySelector('input[aria-label="搜索正文关键词"]') as HTMLInputElement
}

function submitButton(container: ParentNode): HTMLButtonElement {
  return container.querySelector('button[title*="至少 3 个字符"]') as HTMLButtonElement
}

afterEach(() => {
  mockQueryBook.mockReset()
  document.body.innerHTML = ''
})

describe('PdfBookSearch', () => {
  it('工具栏只占一个紧凑触发按钮，点击才展开浮层', async () => {
    const view = await renderSearch({})
    expect(trigger(view.container)).not.toBeNull()
    // 未展开时没有输入框，不挤占工具栏
    expect(keywordInput(view.container)).toBeNull()
    await act(async () => {
      trigger(view.container).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    expect(keywordInput(view.container)).not.toBeNull()
    await view.unmount()
  })

  it('短词禁用提交，Enter 不请求并提示', async () => {
    const view = await renderSearch({})
    await act(async () => {
      trigger(view.container).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      typeInto(keywordInput(view.container), '王道')
    })
    expect(submitButton(view.container).disabled).toBe(true)
    expect(view.container.textContent).toContain('至少输入 3 个字符')
    await act(async () => {
      keywordInput(view.container).dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      )
    })
    expect(mockQueryBook).not.toHaveBeenCalled()
    await view.unmount()
  })

  it('改输入立即清空旧结果：旧词结果不伪装成新词结果', async () => {
    mockQueryBook.mockResolvedValue(searchOk([hit({ id: 7, pageNumber: 36, content: '王道计是出版社' })]))
    const view = await renderSearch({})
    await act(async () => {
      trigger(view.container).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      typeInto(keywordInput(view.container), '王道计')
    })
    await act(async () => {
      submitButton(view.container).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    await flush()
    expect(view.container.textContent).toContain('王道计是出版社')
    // 改成短词：旧结果立即消失，只剩提示，不发新请求
    await act(async () => {
      typeInto(keywordInput(view.container), '王道')
    })
    expect(view.container.textContent).not.toContain('王道计是出版社')
    expect(view.container.textContent).toContain('至少输入 3 个字符')
    expect(mockQueryBook).toHaveBeenCalledTimes(1)
    await view.unmount()
  })

  it('无章节标题时页码只显示一次', async () => {
    mockQueryBook.mockResolvedValue(searchOk([hit({ id: 9, pageNumber: 3, chapterTitle: null, content: '王道计算机教育' })]))
    const view = await renderSearch({})
    await act(async () => {
      trigger(view.container).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      typeInto(keywordInput(view.container), '王道计')
    })
    await act(async () => {
      submitButton(view.container).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    await flush()
    const occurrences = (view.container.textContent ?? '').split('第 3 页').length - 1
    expect(occurrences).toBe(1)
    await view.unmount()
  })

  it('按钮搜索传参正确，点击结果跳页并关闭浮层', async () => {
    mockQueryBook.mockResolvedValue(searchOk([hit({ id: 7, pageNumber: 36 })]))
    const view = await renderSearch({})
    await act(async () => {
      trigger(view.container).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      typeInto(keywordInput(view.container), '移码表示法')
    })
    await act(async () => {
      submitButton(view.container).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    expect(mockQueryBook).toHaveBeenCalledTimes(1)
    expect(mockQueryBook).toHaveBeenCalledWith({
      kind: 'search',
      fingerprint: 'fp-1',
      keyword: '移码表示法',
      limit: 20,
    })
    await flush()
    expect(view.container.textContent).toContain('最多显示 20 条')
    expect(view.container.textContent).toContain('第2章 · 第 36 页')
    const item = view.container.querySelector('button.block') as HTMLButtonElement
    await act(async () => {
      item.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    expect(view.onJumpToPage).toHaveBeenCalledWith(36)
    expect(keywordInput(view.container)).toBeNull()
    await view.unmount()
  })

  it('Enter 同样触发搜索', async () => {
    mockQueryBook.mockResolvedValue(searchOk([]))
    const view = await renderSearch({})
    await act(async () => {
      trigger(view.container).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      typeInto(keywordInput(view.container), '补码加法器')
    })
    await act(async () => {
      keywordInput(view.container).dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      )
    })
    expect(mockQueryBook).toHaveBeenCalledTimes(1)
    await flush()
    expect(view.container.textContent).toContain('未命中')
    await view.unmount()
  })

  it('未索引禁用入口并提示，不请求', async () => {
    const view = await renderSearch({ indexed: false })
    expect(trigger(view.container).disabled).toBe(true)
    expect(mockQueryBook).not.toHaveBeenCalled()
    await view.unmount()
  })

  it('文件切换清空旧结果', async () => {
    mockQueryBook.mockResolvedValue(searchOk([hit()]))
    const view = await renderSearch({ fingerprint: 'fp-1' })
    await act(async () => {
      trigger(view.container).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      typeInto(keywordInput(view.container), '移码表示法')
    })
    await act(async () => {
      submitButton(view.container).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    await flush()
    expect(view.container.textContent).toContain('最多显示 20 条')
    await view.rerender('fp-2')
    expect(keywordInput(view.container)).toBeNull()
    expect(view.container.textContent).not.toContain('最多显示 20 条')
    await view.unmount()
  })

  it('memory：不调 queryBook，标题是章节名，点击走 onJumpToLabel', async () => {
    const unregister = registerReaderContent({
      filePath: '/book/demo.epub',
      getCurrentText: () => '',
      iterateUnits: async function* () {
        yield { label: '第一章 概述', text: '本章讲述移码表示法的定义' }
        yield { label: '第二章 运算', text: '与检索词无关的正文' }
      },
    })
    try {
      const view = await renderSearch({ backend: 'memory', docKey: '/book/demo.epub' })
      await act(async () => {
        trigger(view.container).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      })
      await act(async () => {
        typeInto(keywordInput(view.container), '移码表示法')
      })
      await act(async () => {
        submitButton(view.container).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      })
      await flush()
      expect(mockQueryBook).not.toHaveBeenCalled()
      expect(view.container.textContent).toContain('第一章 概述')
      expect(view.container.textContent).not.toContain('第 0 页')
      const item = view.container.querySelector('button.block') as HTMLButtonElement
      await act(async () => {
        item.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      })
      expect(view.onJumpToLabel).toHaveBeenCalledWith('第一章 概述')
      expect(view.onJumpToPage).not.toHaveBeenCalled()
      expect(keywordInput(view.container)).toBeNull()
      await view.unmount()
    } finally {
      unregister()
    }
  })

  it('memory：改输入清旧结果', async () => {
    const unregister = registerReaderContent({
      filePath: '/book/demo.epub',
      getCurrentText: () => '',
      iterateUnits: async function* () {
        yield { label: '第一章', text: '移码表示法正文' }
      },
    })
    try {
      const view = await renderSearch({ backend: 'memory', docKey: '/book/demo.epub' })
      await act(async () => {
        trigger(view.container).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      })
      await act(async () => {
        typeInto(keywordInput(view.container), '移码表示法')
      })
      await act(async () => {
        submitButton(view.container).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      })
      await flush()
      expect(view.container.textContent).toContain('第一章')
      await act(async () => {
        typeInto(keywordInput(view.container), '王道')
      })
      expect(view.container.textContent).not.toContain('第一章')
      expect(view.container.textContent).toContain('至少输入 3 个字符')
      await view.unmount()
    } finally {
      unregister()
    }
  })
})
