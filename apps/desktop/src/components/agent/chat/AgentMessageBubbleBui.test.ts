// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentMessageBubble } from './AgentMessageBubble'
import type { AcpChatMessage } from '@/stores/acp-chat-types'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/**
 * BUI 接线回归：思考走 BuiThinking 壳（正文仍是 AgentMarkdown 管线）、
 * 用户/系统走 BuiMessage 布局。批注助手直渲染同一 Bubble，此单测即其
 * 展示复用回归（批注助手暂无 E2E harness）。
 */
describe('AgentMessageBubble BUI 壳回归', () => {
  let container: HTMLDivElement
  let root: Root
  const queryClient = new QueryClient()

  function render(message: AcpChatMessage) {
    act(() => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(AgentMessageBubble, { message }),
        ),
      )
    })
  }

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

  it('思考消息渲染 BuiThinking 壳（标题+展开），点击展开见正文', () => {
    render({ id: 'th-1', role: 'thought', text: '先读当前页内容摘要', streaming: false } as AcpChatMessage)
    const shell = container.querySelector('[data-part-key="thought-th-1"]')
    expect(shell).not.toBeNull()
    expect(container.textContent).toContain('已思考')
    const toggle = shell!.querySelector('button[aria-expanded="false"]')
    expect(toggle).not.toBeNull()
    act(() => {
      toggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(shell!.querySelector('button[aria-expanded="true"]')).not.toBeNull()
  })

  it('流式思考显示“思考中”运行态', () => {
    render({ id: 'th-2', role: 'thought', text: '正在分析', streaming: true } as AcpChatMessage)
    expect(container.querySelector('[data-part-key="thought-th-2"]')).not.toBeNull()
    expect(container.textContent).toContain('思考中')
    expect(container.querySelector('button[aria-expanded="true"]')).not.toBeNull()
  })

  it('空白流式回复等待响应，不伪称思考；有正文后切到输出外壳', () => {
    render({ id: 'a-1', role: 'agent', text: '', createdAt: Date.now(), streaming: true } as AcpChatMessage)
    expect(container.textContent).toContain('等待响应')
    expect(container.textContent).not.toContain('正在思考')
    render({ id: 'a-1', role: 'agent', text: '正文', createdAt: Date.now(), streaming: true } as AcpChatMessage)
    expect(container.querySelector('[data-slot="streaming-response"]')?.getAttribute('aria-busy')).toBe('true')
    expect(container.querySelector('button[aria-label="复制回答原文"]')).toBeNull()
    render({ id: 'a-1', role: 'agent', text: '正文', streaming: false } as AcpChatMessage)
    expect(container.querySelector('[data-slot="streaming-response"]')?.getAttribute('aria-busy')).toBe('false')
    expect(container.querySelector('button[aria-label="复制回答原文"]')).not.toBeNull()
  })

  it('思考落定自动收起一次，之后可手动展开', () => {
    const message = { id: 'th-finish', role: 'thought', text: '分析证据', streaming: true } as AcpChatMessage
    render(message)
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded]')!
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    render({ ...message, streaming: false })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    act(() => toggle.click())
    render({ ...message, streaming: false, text: '分析证据完成' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })

  it('系统消息走 BuiMessage system 布局', () => {
    render({ id: 'sys-1', role: 'system', text: '会话已重置' } as AcpChatMessage)
    const node = container.querySelector('[data-bui-message="system"]')
    expect(node).not.toBeNull()
    expect(node!.textContent).toContain('会话已重置')
  })

  it('用户消息走 BuiMessage user 布局并保留复制按钮', () => {
    render({ id: 'u-1', role: 'user', text: '总结一下', createdAt: Date.now() } as AcpChatMessage)
    const node = container.querySelector('[data-bui-message="user"]')
    expect(node).not.toBeNull()
    expect(node!.textContent).toContain('总结一下')
    expect(node!.querySelector('button[aria-label="复制正文"]')).not.toBeNull()
    expect(container.querySelectorAll('.bg-secondary')).toHaveLength(1)
  })
})
