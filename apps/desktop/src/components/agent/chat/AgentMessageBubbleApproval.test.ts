// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatMessageBubble } from '@montree/chat-ui'
import type { AcpChatMessage } from '@/stores/acp-chat-types'
import { useAcpUiStore } from '@/stores/acp-ui-store'

vi.mock('../../../../../../packages/chat-ui/src/ui/propose-mark-chat-block', () => ({
  ProposeMarkChatBlock: () => createElement('div', null, 'proposal-result'),
  ProposeMarkBlockList: () => null,
}))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('AgentMessageBubble 提议分支审批外挂', () => {
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
    useAcpUiStore.getState().setPendingPermission(null)
  })

  it('带未 dismiss 提议的待审批工具仍有一份审批卡', () => {
    useAcpUiStore.getState().setPendingPermission({
      requestId: 71,
      summary: 'approve this',
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
      toolCallId: 'review-tc',
    })
    const message: AcpChatMessage = {
      id: 'review-tool',
      role: 'tool',
      text: 'read result',
      createdAt: 1000,
      toolCallId: 'review-tc',
      toolTitle: 'read_text_file',
      toolStatus: 'pending',
      streaming: false,
      markProposalStatus: 'pending',
      markProposal: { id: 'p', kind: 'note', source: 'agent', excerpt: 'x', note: 'y' },
    }
    act(() => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(ChatMessageBubble, {
            message,
            resolveMarkProposal: useAcpUiStore.getState().resolveMarkProposal,
            pendingPermission: useAcpUiStore.getState().pendingPermission,
          }),
        ),
      )
    })
    expect(container.textContent).toContain('proposal-result')
    expect(container.querySelectorAll('[data-testid="agent-permission-card"]')).toHaveLength(1)
  })
})
