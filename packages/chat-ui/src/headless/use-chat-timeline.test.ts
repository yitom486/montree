// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupChatTimeline } from '@montree/chat-core'
import type { ChatMessage } from '@montree/chat-core'
import { useChatTimeline } from './use-chat-timeline'
import type { UseChatTimelineOptions } from './use-chat-timeline'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let seq = 0
function msg(overrides: Partial<ChatMessage>): ChatMessage {
  seq += 1
  return {
    id: `msg-${seq}`,
    role: 'agent',
    text: '',
    createdAt: 1000 + seq,
    ...overrides,
  }
}

function Harness({
  messages,
  opts,
  onResult,
}: {
  messages: ChatMessage[]
  opts: UseChatTimelineOptions
  onResult: (v: ReturnType<typeof useChatTimeline>) => void
}) {
  const timeline = useChatTimeline(messages, opts)
  onResult(timeline)
  return createElement('div', { 'data-items': timeline.length })
}

describe('useChatTimeline', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    seq = 0
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

  function render(messages: ChatMessage[], opts: UseChatTimelineOptions) {
    let captured: ReturnType<typeof useChatTimeline> = []
    act(() => {
      root.render(
        createElement(Harness, {
          messages,
          opts,
          onResult: (v) => {
            captured = v
          },
        }),
      )
    })
    return () => captured
  }

  it('返回与直接调 groupChatTimeline deep-equal', () => {
    const user = msg({ role: 'user', text: '你好' })
    const thought = msg({ role: 'thought', text: '想' })
    const t1 = msg({ role: 'tool', toolTitle: 'Read: /a.ts', toolStatus: 'completed' })
    const reply = msg({ role: 'agent', text: '好' })
    const messages = [user, thought, t1, reply]
    const get = render(messages, { nowMs: 5000 })
    expect(get()).toEqual(groupChatTimeline(messages, { nowMs: 5000 }))
  })

  it('重渲染（消息追加）后返回更新且仍与 core 一致', () => {
    const user = msg({ role: 'user', text: '你好' })
    const t1 = msg({ role: 'tool', toolTitle: 'Read: /a.ts', toolStatus: 'completed' })
    const first = [user, t1]
    const get = render(first, { nowMs: 5000 })
    expect(get()).toEqual(groupChatTimeline(first, { nowMs: 5000 }))

    const reply = msg({ role: 'agent', text: '好' })
    const second = [...first, reply]
    const get2 = render(second, { nowMs: 5000 })
    expect(get2()).toEqual(groupChatTimeline(second, { nowMs: 5000 }))
    expect(get2().map((i) => i.kind)).toEqual(['message', 'work-log', 'message'])
  })
})
