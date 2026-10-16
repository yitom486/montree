// @vitest-environment happy-dom
import { act, createElement, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentMessageList } from './AgentMessageList'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import type { AcpChatMessage } from '@/stores/acp-chat-types'
import {
  getOwnedChatSessionStore,
  resetOwnedChatSessionStoreForTests,
} from '@/lib/agent/chat-session-owner'
import { resetThreadMirrorForTests } from '@/lib/agent/chat-store-mirror'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/**
 * P4b 切换面渲染：`messageSource="package-mirror"` 时列表改读包对账镜像。
 * 包镜像注入消息 → 该面正常渲染；宿主独有消息 → 该面不渲染（读源已切）。
 * 既有 `AgentMessageList.test.ts` 一行不动（默认 host 路径零改动）。
 */
describe('AgentMessageList 包镜像读源', () => {
  let container: HTMLDivElement
  let root: Root

  function seedHostOnlyThread() {
    useAcpUiStore.setState({
      threads: [
        {
          id: 'host-only',
          title: '宿主线程',
          createdAt: 1,
          updatedAt: 1,
          messages: [
            { id: 'h1', role: 'user', text: '宿主独有问题', createdAt: 1000 },
          ] as AcpChatMessage[],
        },
      ],
      activeThreadId: 'host-only',
    } as never)
  }

  function seedPackageMirror() {
    resetThreadMirrorForTests()
    const pkg = getOwnedChatSessionStore()
    pkg.clearActiveThread()
    pkg.appendUser('包镜像问题')
    pkg.beginReply()
    pkg.ingestTextChunk('包镜像回答')
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    seedHostOnlyThread()
    seedPackageMirror()
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    getOwnedChatSessionStore().clearActiveThread()
    useAcpUiStore.setState({
      threads: [],
      activeThreadId: '',
      chatScrollByThread: {},
    } as never)
  })

  async function renderList() {
    const hostRef = createRef<HTMLDivElement>()
    await act(async () => {
      root.render(
        createElement(
          'div',
          { ref: hostRef },
          createElement(AgentMessageList, {
            messagesRef: hostRef,
            bottomRef: createRef<HTMLDivElement>(),
            authHint: null,
            messageSource: 'package-mirror',
          }),
        ),
      )
    })
  }

  it('包镜像消息正常渲染，宿主消息不渲染', async () => {
    await renderList()
    const text = container.textContent ?? ''
    expect(text).toContain('包镜像问题')
    expect(text).toContain('包镜像回答')
    expect(text).not.toContain('宿主独有问题')
  })
})
