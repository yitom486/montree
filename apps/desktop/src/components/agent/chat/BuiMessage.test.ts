// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BuiMessage } from './BuiMessage'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('BuiMessage 消息布局', () => {
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

  it('用户消息为右侧气泡', () => {
    act(() => {
      root.render(createElement(BuiMessage, { from: 'user', children: '你好' }))
    })
    const row = container.querySelector('[data-bui-message="user"]') as HTMLElement
    expect(row).not.toBeNull()
    expect(row.className).toContain('justify-end')
    const bubble = row.firstElementChild as HTMLElement
    expect(bubble.className).toContain('bg-secondary')
    expect(bubble.className).toContain('max-w-[85%]')
    expect(container.textContent).toContain('你好')
  })

  it('助手消息为通栏行，动作行 hover/focus 才显', () => {
    act(() => {
      root.render(
        createElement(
          BuiMessage,
          {
            from: 'assistant',
            actions: createElement('button', { type: 'button' }, '复制'),
            children: '回答正文',
          },
        ),
      )
    })
    const row = container.querySelector('[data-bui-message="assistant"]') as HTMLElement
    expect(row).not.toBeNull()
    expect(row.className).toContain('group')
    const actionRow = container.querySelector('[aria-label="消息操作"]') as HTMLElement
    expect(actionRow).not.toBeNull()
    expect(actionRow.className).toContain('opacity-0')
    expect(actionRow.className).toContain('group-hover:opacity-100')
    expect(actionRow.className).toContain('focus-within:opacity-100')
    expect(container.textContent).toContain('回答正文')
  })

  it('动作按钮可被键盘聚焦', () => {
    act(() => {
      root.render(
        createElement(
          BuiMessage,
          {
            from: 'assistant',
            actions: createElement('button', { type: 'button', 'aria-label': '复制回答原文' }, '复制'),
            children: '回答正文',
          },
        ),
      )
    })
    const button = container.querySelector('[aria-label="复制回答原文"]') as HTMLButtonElement
    expect(button).not.toBeNull()
    expect(button.disabled).toBe(false)
    expect(button.tabIndex).toBeGreaterThanOrEqual(0)
    button.focus()
    expect(document.activeElement).toBe(button)
  })

  it('无 actions 时不渲染动作行', () => {
    act(() => {
      root.render(createElement(BuiMessage, { from: 'assistant', children: '回答正文' }))
    })
    expect(container.querySelector('[aria-label="消息操作"]')).toBeNull()
  })

  it('流式助手挂载描边光环', () => {
    act(() => {
      root.render(createElement(BuiMessage, { from: 'assistant', streaming: true, children: '生成中' }))
    })
    expect(container.querySelector('.agent-beam-ring')).not.toBeNull()
    act(() => {
      root.render(createElement(BuiMessage, { from: 'assistant', streaming: false, children: '生成完' }))
    })
    expect(container.querySelector('.agent-beam-ring')).toBeNull()
  })

  it('系统消息居中弱化展示', () => {
    act(() => {
      root.render(createElement(BuiMessage, { from: 'system', children: '已连接到运行时' }))
    })
    const row = container.querySelector('[data-bui-message="system"]') as HTMLElement
    expect(row).not.toBeNull()
    expect(row.className).toContain('text-center')
    expect(row.className).toContain('text-muted-foreground')
  })
})
