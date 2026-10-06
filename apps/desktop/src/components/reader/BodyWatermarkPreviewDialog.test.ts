// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RosettaBodyWatermarkPreviewResult } from '@montree/contracts'

const { mockPreview } = vi.hoisted(() => ({ mockPreview: vi.fn() }))

vi.mock('@/api/rosetta-api', () => ({
  rosettaApi: {
    previewBodyWatermark: mockPreview,
    applyBodyWatermark: vi.fn(),
  },
}))

import { BodyWatermarkPreviewDialog } from './BodyWatermarkPreviewDialog'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function builtinResult(): RosettaBodyWatermarkPreviewResult {
  return {
    fingerprint: 'fp-1',
    bookId: 1,
    totalPatches: 1,
    deleteCount: 1,
    updateCount: 0,
    pageCount: 1,
    reasonCounts: { 'whole-block:王道计': 1 },
    samples: [
      {
        id: 7,
        pageNumber: 36,
        action: 'delete',
        reason: 'whole-block:王道计',
        before: '王道计',
      },
    ],
    samplePage: null,
    planSignature: 'a'.repeat(64),
  }
}

function customResult(): RosettaBodyWatermarkPreviewResult {
  return {
    fingerprint: 'fp-1',
    bookId: 1,
    totalPatches: 2,
    deleteCount: 1,
    updateCount: 1,
    pageCount: 2,
    reasonCounts: { 'whole-block:王道计': 1, 'custom-edge-start:版权所有': 1 },
    samples: [
      {
        id: 7,
        pageNumber: 36,
        action: 'delete',
        reason: 'whole-block:王道计',
        before: '王道计',
      },
      {
        id: 9,
        pageNumber: 40,
        action: 'update',
        reason: 'custom-edge-start:版权所有',
        before: '版权所有 翻印必究',
        after: '翻印必究',
      },
    ],
    samplePage: null,
    planSignature: 'b'.repeat(64),
  }
}

async function renderDialog() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      createElement(BodyWatermarkPreviewDialog, {
        open: true,
        fingerprint: 'fp-1',
        onOpenChange: () => {},
      }),
    )
  })
  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount()
      })
      container.remove()
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

function customInput(container: ParentNode): HTMLInputElement {
  return container.querySelector('input[aria-label="自定义水印文本"]') as HTMLInputElement
}

function customSubmit(container: ParentNode): HTMLButtonElement {
  const buttons = [...container.querySelectorAll('button')]
  return buttons.find((b) => b.textContent === '生成预览') as HTMLButtonElement
}

afterEach(() => {
  mockPreview.mockReset()
  document.body.innerHTML = ''
})

describe('BodyWatermarkPreviewDialog 自定义预览', () => {
  it('生成预览透传 customToken 并展示自定义候选', async () => {
    mockPreview.mockResolvedValueOnce({ ok: true, value: builtinResult() })
    mockPreview.mockResolvedValueOnce({ ok: true, value: customResult() })
    const view = await renderDialog()
    await flush()
    expect(mockPreview).toHaveBeenCalledWith({ fingerprint: 'fp-1' })
    await act(async () => {
      typeInto(customInput(document.body), '版权所有')
    })
    await act(async () => {
      customSubmit(document.body).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    expect(mockPreview).toHaveBeenLastCalledWith({ fingerprint: 'fp-1', customToken: '版权所有' })
    await flush()
    expect(document.body.textContent).toContain('自定义候选 1 条')
    expect(document.body.textContent).toContain('custom-edge-start:版权所有')
    expect(document.body.textContent).toContain('翻印必究')
    // 自定义区无应用按钮
    expect(document.body.textContent).not.toContain('确认应用自定义')
    await view.unmount()
  })

  it('输入变化立即清空旧自定义结果，不发请求', async () => {
    mockPreview.mockResolvedValueOnce({ ok: true, value: builtinResult() })
    mockPreview.mockResolvedValueOnce({ ok: true, value: customResult() })
    const view = await renderDialog()
    await flush()
    await act(async () => {
      typeInto(customInput(document.body), '版权所有')
    })
    await act(async () => {
      customSubmit(document.body).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    await flush()
    expect(document.body.textContent).toContain('自定义候选 1 条')
    const calls = mockPreview.mock.calls.length
    await act(async () => {
      typeInto(customInput(document.body), '版权所有啊')
    })
    expect(document.body.textContent).not.toContain('自定义候选 1 条')
    expect(document.body.textContent).not.toContain('翻印必究')
    expect(mockPreview.mock.calls.length).toBe(calls)
    await view.unmount()
  })

  it('非法输入不请求并给出原因', async () => {
    mockPreview.mockResolvedValueOnce({ ok: true, value: builtinResult() })
    const view = await renderDialog()
    await flush()
    await act(async () => {
      typeInto(customInput(document.body), 'ab')
    })
    expect(document.body.textContent).toContain('至少需要 3 个字符')
    await act(async () => {
      customSubmit(document.body).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    // 仅初始 builtin 预览一次调用，自定义非法不再请求
    expect(mockPreview).toHaveBeenCalledTimes(1)
    await view.unmount()
  })
})
