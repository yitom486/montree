// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatMessageBubble } from './agent-message-bubble'
import type { ChatMessage as AcpChatMessage } from '@montree/chat-core'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('ChatMessageBubble', () => {
  let container: HTMLDivElement
  let root: Root
  const resolveMarkProposal = vi.fn()

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

  // 懒块（streamdown/katex/mermaid）在满载并行转译下可能超默认 5s：只放宽本用例时钟，不断言内容。
  it('renders agent markdown text bubble correctly', { timeout: 20000 }, async () => {
    const msg: AcpChatMessage = {
      id: 'msg-1',
      role: 'agent',
      text: '这是一个包含**加粗**与`代码`的测试消息。',
      createdAt: Date.now(),
    }

    // 正文走懒加载分块：先预热模块，再等待落定后断言（生产首屏不受影响）
    await import('@montree/chat-ui/lazy')
    await act(async () => {
      root.render(createElement(ChatMessageBubble, { message: msg, resolveMarkProposal, pendingPermission: null }))
    })
    // 内层 streamdown 分块体积大：动态 import 落定需若干事件循环，轮询等待（只补等待，内容断言不变）
    await vi.waitFor(
      () => {
        expect(container.querySelector('strong')?.textContent).toBe('加粗')
      },
      { timeout: 20000 },
    )
    await act(async () => {})

    expect(container.textContent).toContain('这是一个包含')
    expect(container.textContent).toContain('加粗')
    expect(container.textContent).toContain('代码')
    expect(container.querySelector('strong')?.textContent).toBe('加粗')
  })

  it('流式助手气泡挂光环、落定即卸（无布局占位的 ::after，不测像素）', () => {
    const streaming: AcpChatMessage = {
      id: 'beam-1',
      role: 'agent',
      text: '正在输出正文',
      createdAt: Date.now(),
      streaming: true,
    }
    act(() => {
      root.render(createElement(ChatMessageBubble, { message: streaming, resolveMarkProposal, pendingPermission: null }))
    })
    expect(container.querySelector('.agent-beam-ring-emerald')).not.toBeNull()
    const done: AcpChatMessage = { ...streaming, id: 'beam-2', streaming: false }
    act(() => {
      root.render(createElement(ChatMessageBubble, { message: done, resolveMarkProposal, pendingPermission: null }))
    })
    expect(container.querySelector('.agent-beam-ring-emerald')).toBeNull()
    // 旧扫光条已删除，不再有脱节横线
    expect(container.querySelector('.agent-stream-sweep')).toBeNull()
  })

  it('renders user attachments with names and image preview', () => {    const msg: AcpChatMessage = {
      id: 'user-att-1',
      role: 'user',
      text: '看这两份材料',
      createdAt: Date.now(),
      attachments: [
        { id: 'a1', kind: 'image', name: 'shot.png', mimeType: 'image/png', previewUrl: 'blob:mock-shot', size: 12 },
        { id: 'a2', kind: 'file', name: 'notes.md', mimeType: 'text/markdown', absolutePath: 'D:/w/notes.md', size: 34 },
      ],
    }

    act(() => {
      root.render(createElement(ChatMessageBubble, { message: msg, resolveMarkProposal, pendingPermission: null }))
    })

    expect(container.textContent).toContain('看这两份材料')
    expect(container.textContent).toContain('shot.png')
    expect(container.textContent).toContain('notes.md')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:mock-shot')
  })

  it('renders thought accordion when role is thought', () => {    const msg: AcpChatMessage = {
      id: 'thought-1',
      role: 'thought',
      text: '分析当前协议版本握手条件',
      createdAt: Date.now(),
    }

    act(() => {
      root.render(createElement(ChatMessageBubble, { message: msg, resolveMarkProposal, pendingPermission: null }))
    })

    expect(container.textContent).toContain('思考')
    expect(container.textContent).toContain('分析当前协议版本握手条件')
  })

  it('renders protocol flow steps and jump buttons', () => {
    const msg: AcpChatMessage = {
      id: 'msg-steps-1',
      role: 'agent',
      text: 'ACP 协议生命周期流转解析：',
      createdAt: Date.now(),
      steps: [
        {
          num: 1,
          title: '握手初始化',
          desc: 'Client 发送 initialize 请求',
          anchorId: 'handshake-init',
        },
        {
          num: 2,
          title: '能力协商',
          desc: '双方确认 fs/terminal/mcp 支持',
          anchorId: 'capabilities-ack',
        },
      ],
    }

    act(() => {
      root.render(createElement(ChatMessageBubble, { message: msg, resolveMarkProposal, pendingPermission: null }))
    })

    expect(container.textContent).toContain('交互经纬流转')
    expect(container.textContent).toContain('握手初始化')
    expect(container.textContent).toContain('Client 发送 initialize 请求')
    expect(container.textContent).toContain('能力协商')
    expect(container.textContent).toContain('对应章句')
  })

  it('用户消息可复制正文、无回调时不渲染编辑', async () => {
    const msg: AcpChatMessage = {
      id: 'user-act-1',
      role: 'user',
      text: '复制我这段话',
      createdAt: Date.now(),
    }
    const written: string[] = []
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (text: string) => { written.push(text); return Promise.resolve() } },
    })
    act(() => {
      root.render(createElement(ChatMessageBubble, { message: msg, resolveMarkProposal, pendingPermission: null }))
    })
    const copy = container.querySelector('button[aria-label="复制正文"]') as HTMLElement
    expect(copy).not.toBeNull()
    await act(async () => {
      copy.click()
    })
    expect(written).toEqual(['复制我这段话'])
    expect(container.querySelector('button[aria-label="编辑后继续"]')).toBeNull()
  })

  it('用户消息编辑回填原文（发送后为新回合，不改写历史）', () => {
    const onEditMessage = vi.fn()
    const msg: AcpChatMessage = {
      id: 'user-act-2',
      role: 'user',
      text: '续改这句',
      createdAt: Date.now(),
    }
    act(() => {
      root.render(createElement(ChatMessageBubble, { message: msg, resolveMarkProposal, pendingPermission: null, onEditMessage }))
    })
    const edit = container.querySelector('button[aria-label="编辑后继续"]') as HTMLElement
    expect(edit).not.toBeNull()
    expect(edit.getAttribute('title')).toContain('新回合')
    act(() => {
      edit.click()
    })
    expect(onEditMessage).toHaveBeenCalledWith('续改这句')
  })

  it('助手回答可复制 Markdown 原文', async () => {
    const msg: AcpChatMessage = {
      id: 'agent-act-1',
      role: 'agent',
      text: '普通文本回答',
      createdAt: Date.now(),
    }
    const written: string[] = []
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (text: string) => { written.push(text); return Promise.resolve() } },
    })
    act(() => {
      root.render(createElement(ChatMessageBubble, { message: msg, resolveMarkProposal, pendingPermission: null }))
    })
    const copy = container.querySelector('button[aria-label="复制回答原文"]') as HTMLElement
    expect(copy).not.toBeNull()
    await act(async () => {
      copy.click()
    })
    expect(written).toEqual(['普通文本回答'])
  })
})
