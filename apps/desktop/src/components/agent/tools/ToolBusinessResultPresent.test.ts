// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolBusinessResult } from './ToolBusinessResult'
import { toast } from 'sonner'
import type { AcpChatMessage } from '@/stores/acp-chat-types'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function toolMessage(detail: string, title = 'montree_present'): AcpChatMessage {
  return {
    id: 'tool-present-1',
    role: 'tool',
    text: detail,
    createdAt: 1000,
    updatedAt: 2000,
    toolCallId: 'tc-present-1',
    toolKind: 'other',
    toolTitle: title,
    toolStatus: 'completed',
    streaming: false,
    toolContentText: detail,
  }
}

const COMPARE = JSON.stringify({
  schemaVersion: 1,
  kind: 'chapter-comparison',
  id: 'present-chapter-comparison-e2e01',
  title: '两章比较',
  documentFingerprint: '/books/a.epub',
  chapters: [
    { key: 'c1', label: '第一章', flatIndex: 0 },
    { key: 'c2', label: '第二章', flatIndex: 1 },
  ],
  items: [{ id: 'i1', dimension: '论点', chapterKey: 'c1', excerpt: '原文', verified: true, flatIndex: 0 }],
})

const ARTIFACT = JSON.stringify({
  schemaVersion: 1,
  kind: 'html-artifact',
  id: 'present-html-artifact-e2e01',
  title: '计数器',
  html: '<button>按</button>',
})

describe('ToolBusinessResult present 分发', () => {
  let container: HTMLDivElement
  let root: Root
  const queryClient = new QueryClient()

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

  function render(message: AcpChatMessage) {
    act(() => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(ToolBusinessResult, { message }),
        ),
      )
    })
  }

  it('比较卡挂载并可筛选', () => {
    render(toolMessage(COMPARE))
    expect(container.querySelector('[data-testid="chapter-comparison-card"]')).not.toBeNull()
    expect(container.textContent).toContain('两章比较')
  })

  it('HTML 卡挂载且未打开不执行脚本', () => {
    render(toolMessage(ARTIFACT))
    expect(container.querySelector('[data-testid="html-artifact-card"]')).not.toBeNull()
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('montree_present 非法载荷给可读失败不崩溃', () => {
    render(toolMessage('{"kind":"chapter-comparison","schemaVersion":1}'))
    expect(container.textContent).toContain('呈现结果无法解析')
  })

  it('enrich 挂载的 presentResult 优先使用', () => {
    const message = toolMessage(COMPARE)
    message.presentResult = JSON.parse(COMPARE)
    render(message)
    expect(container.querySelector('[data-testid="chapter-comparison-card"]')).not.toBeNull()
  })

  it('跨文档定位被禁止：不导航、给引导（需结合归属）', async () => {
    const markFailure = await import('@/lib/agent/mark-proposal-failure')
    const openSpy = vi.spyOn(markFailure, 'openChapterForMarkRecovery')
    const toastSpy = vi.spyOn(toast, 'message')
    const { useActiveDocumentStore } = await import('@/stores/active-document-store')
    const prev = useActiveDocumentStore.getState().filePath
    useActiveDocumentStore.setState({ filePath: '/books/b.epub' })
    try {
      const message = toolMessage(COMPARE)
      message.presentResult = {
        ...JSON.parse(COMPARE),
        documentFingerprint: '/books/a.epub',
        documentLabel: 'a.epub',
      }
      render(message)
      const locate = [...container.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('定位原文'),
      ) as HTMLElement
      expect(locate).toBeTruthy()
      await act(async () => {
        locate.click()
      })
      expect(openSpy).not.toHaveBeenCalled()
      expect(toastSpy).toHaveBeenCalledOnce()
      expect(String(toastSpy.mock.calls[0]?.[0] ?? '')).toContain('请先打开原文档后再定位')
    } finally {
      openSpy.mockRestore()
      toastSpy.mockRestore()
      useActiveDocumentStore.setState({ filePath: prev })
    }
  })

  it('等待定位期间切换文档不广播（P1：await 后复核）', async () => {
    const markFailure = await import('@/lib/agent/mark-proposal-failure')
    const linkage = await import('@/lib/reader/marks/mark-linkage')
    let release!: (ok: boolean) => void
    const pending = new Promise<boolean>((r) => { release = r })
    const openSpy = vi.spyOn(markFailure, 'openChapterForMarkRecovery').mockReturnValueOnce(pending)
    const emitSpy = vi.spyOn(linkage, 'emitAnchorHighlight')
    const toastSpy = vi.spyOn(toast, 'message')
    const { useActiveDocumentStore } = await import('@/stores/active-document-store')
    const prev = useActiveDocumentStore.getState().filePath
    useActiveDocumentStore.setState({ filePath: '/books/a.epub' })
    try {
      const message = toolMessage(COMPARE)
      message.presentResult = {
        ...JSON.parse(COMPARE),
        documentFingerprint: '/books/a.epub',
        documentLabel: 'a.epub',
      }
      render(message)
      const locate = [...container.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('定位原文'),
      ) as HTMLElement
      expect(locate).toBeTruthy()
      act(() => {
        locate.click()
      })
      // 导航等待期间切到 B：完成后不得把 A 摘录广播到 B
      useActiveDocumentStore.setState({ filePath: '/books/b.epub' })
      await act(async () => {
        release(true)
        await pending
      })
      expect(emitSpy).not.toHaveBeenCalled()
      expect(String(toastSpy.mock.calls.at(-1)?.[0] ?? '')).toContain('请先打开原文档后再定位')
    } finally {
      openSpy.mockRestore()
      emitSpy.mockRestore()
      toastSpy.mockRestore()
      useActiveDocumentStore.setState({ filePath: prev })
    }
  })
})
