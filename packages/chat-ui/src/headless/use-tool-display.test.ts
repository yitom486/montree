// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { toToolDisplayModel } from '@montree/chat-core'
import type { ChatMessage } from '@montree/chat-core'
import { useToolDisplay } from './use-tool-display'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function toolMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'tool-1',
    role: 'tool',
    text: '',
    createdAt: 1000,
    updatedAt: 1500,
    toolCallId: 'tc-1',
    toolTitle: 'Read: /a.ts',
    toolStatus: 'completed',
    toolContentText: 'file content',
    ...overrides,
  }
}

function Harness({
  message,
  needsApproval,
  onResult,
}: {
  message: ChatMessage
  needsApproval?: boolean
  onResult: (v: ReturnType<typeof useToolDisplay>) => void
}) {
  const model = useToolDisplay(message, { needsApproval })
  onResult(model)
  return createElement('div', { 'data-state': model.state })
}

describe('useToolDisplay', () => {
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

  function render(message: ChatMessage, needsApproval?: boolean) {
    let captured: ReturnType<typeof useToolDisplay> | null = null
    act(() => {
      root.render(
        createElement(Harness, {
          message,
          needsApproval,
          onResult: (v) => {
            captured = v
          },
        }),
      )
    })
    return () => captured as ReturnType<typeof useToolDisplay>
  }

  it('返回与直接调 toToolDisplayModel deep-equal', () => {
    const message = toolMsg()
    const get = render(message)
    expect(get()).toEqual(toToolDisplayModel(message))
    expect(get().state).toBe('completed')
  })

  it('重渲染（needsApproval 变化）后返回更新且仍与 core 一致', () => {
    const message = toolMsg({ toolStatus: 'pending', streaming: true })
    const get = render(message, false)
    expect(get()).toEqual(toToolDisplayModel(message, { needsApproval: false }))

    const get2 = render(message, true)
    expect(get2()).toEqual(toToolDisplayModel(message, { needsApproval: true }))
    expect(get2().state).toBe('awaiting-approval')
  })
})
