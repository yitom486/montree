// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContentAuditCard, type ContentAuditPayload } from './ContentAuditCard'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('ContentAuditCard', () => {
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

  it('renders content audit query, total count, and hits list', async () => {
    const payload: ContentAuditPayload = {
      query: 'initialize',
      total: 3,
      hits: [
        {
          source: 'book-index',
          locator: { pageNumber: 42 },
          text: 'The client must send initialize request first.',
          textTruncated: false,
          matchPosition: 'start',
        },
        {
          source: 'editor-buffer',
          locator: { lineStart: 15 },
          text: 'initialize handshake established.',
          textTruncated: false,
          matchPosition: 'start',
        },
      ],
    }

    await act(async () => {
      root.render(createElement(ContentAuditCard, { payload }))
    })

    expect(container.textContent).toContain('深度内容审计探针')
    expect(container.textContent).toContain('"initialize"')
    expect(container.textContent).toContain('命中 3 处原句')
    expect(container.textContent).toContain('PDF 语料库')
    expect(container.textContent).toContain('第 42 页')
    expect(container.textContent).toContain('编辑器实时')
  })

  it('triggers onHighlightAnchor when clicking locate button', async () => {
    const onHighlightAnchor = vi.fn()
    const payload: ContentAuditPayload = {
      query: 'handshake',
      total: 1,
      hits: [
        {
          source: 'ebook-section',
          locator: { chapterTitle: '第一章 握手协议' },
          text: 'Handshake protocol requirements.',
          textTruncated: false,
          matchPosition: 'start',
        },
      ],
    }

    await act(async () => {
      root.render(createElement(ContentAuditCard, { payload, onHighlightAnchor }))
    })

    const buttons = Array.from(container.querySelectorAll('button'))
    const locate = buttons.find((b) => b.textContent?.includes('定位'))
    expect(locate).toBeDefined()

    await act(async () => {
      locate?.click()
    })

    expect(onHighlightAnchor).toHaveBeenCalledWith('Handshake protocol requirements.')
  })

  it('renders web-doc source badge, url locator and triggers onNavigateHit', async () => {
    const onNavigateHit = vi.fn()
    const onHighlightAnchor = vi.fn()
    const hit = {
      source: 'web-doc' as const,
      locator: { url: 'https://developer.mozilla.org/en-US/docs/Web/API' },
      text: 'Web API interfaces for documents.',
      textTruncated: false,
      matchPosition: 'start' as const,
    }
    const payload: ContentAuditPayload = {
      query: 'interfaces',
      total: 1,
      hits: [hit],
    }

    await act(async () => {
      root.render(
        createElement(ContentAuditCard, {
          payload,
          onNavigateHit,
          onHighlightAnchor,
        }),
      )
    })

    expect(container.textContent).toContain('网页文档')
    expect(container.textContent).toContain('developer.mozilla.org/en-US/docs/Web/API')
    expect(container.textContent).toContain('Web API interfaces for documents.')

    const buttons = Array.from(container.querySelectorAll('button'))
    const locate = buttons.find((b) => b.textContent?.includes('定位'))
    expect(locate).toBeDefined()

    await act(async () => {
      locate?.click()
    })

    expect(onNavigateHit).toHaveBeenCalledWith(hit)
    expect(onHighlightAnchor).toHaveBeenCalledWith('Web API interfaces for documents.')
  })
})

