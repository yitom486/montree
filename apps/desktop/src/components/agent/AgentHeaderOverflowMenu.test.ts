// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentHeaderOverflowMenu } from './AgentHeaderOverflowMenu'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Agent 头部 ⋯ 菜单：动作收敛、致灰透传、模式分支。
 */
describe('AgentHeaderOverflowMenu', () => {
  let container: HTMLDivElement
  let root: Root

  const handlers = () => ({
    onNewThread: vi.fn(),
    onClearMessages: vi.fn(),
    onMinimizeToCapsule: vi.fn(),
    onDockPanel: vi.fn(),
    onFloatPanel: vi.fn(),
  })

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
    document.body.innerHTML = ''
  })

  async function renderMenu(props: Record<string, unknown>) {
    await act(async () => {
      root.render(createElement(AgentHeaderOverflowMenu, props as never))
    })
  }

  async function ensureOpen() {
    if (document.body.querySelectorAll('[role="menuitem"]').length > 0) return
    const trigger = container.querySelector(
      'button[aria-label="更多面板操作"]',
    ) as HTMLElement | null
    expect(trigger).not.toBeNull()
    try {
      trigger!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    } catch {
      // 无 PointerEvent 实现时回落纯 click
    }
    trigger!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    trigger!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await act(async () => {})
  }

  function menuItems(): HTMLElement[] {
    return Array.from(document.body.querySelectorAll('[role="menuitem"]')) as HTMLElement[]
  }

  async function clickItem(text: string) {
    await ensureOpen()
    const el = menuItems().find((item) => (item.textContent ?? '').includes(text)) as HTMLElement
    expect(el).not.toBeUndefined()
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await act(async () => {})
  }

  it('悬浮模式：新对话/清空/最小化/停靠齐全', async () => {
    await renderMenu({ ...handlers(), floating: true })
    await ensureOpen()
    const names = menuItems().map((el) => el.textContent ?? '')
    for (const expected of ['新对话', '清空当前对话', '最小化为极简胶囊', '停靠回侧栏']) {
      expect(names.some((name) => name.includes(expected))).toBe(true)
    }
    expect(names.some((name) => name.includes('切换为悬浮伴读小窗'))).toBe(false)
  })

  it('侧栏模式：展示悬浮化入口', async () => {
    await renderMenu({ ...handlers(), floating: false })
    await ensureOpen()
    const names = menuItems().map((el) => el.textContent ?? '')
    expect(names.some((name) => name.includes('切换为悬浮伴读小窗'))).toBe(true)
    expect(names.some((name) => name.includes('停靠回侧栏'))).toBe(false)
  })

  it('点击直达回调', async () => {
    const h = handlers()
    await renderMenu({ ...h, floating: true })
    await clickItem('新对话')
    expect(h.onNewThread).toHaveBeenCalledTimes(1)
    await clickItem('清空当前对话')
    expect(h.onClearMessages).toHaveBeenCalledTimes(1)
    await clickItem('停靠回侧栏')
    expect(h.onDockPanel).toHaveBeenCalledTimes(1)
  })

  it('对话进行中新建/清空致灰', async () => {
    await renderMenu({ ...handlers(), floating: false, actionDisabled: true })
    await ensureOpen()
    const byName = (text: string) =>
      menuItems().find((el) => (el.textContent ?? '').includes(text)) as HTMLElement
    expect(byName('新对话').getAttribute('aria-disabled')).toBe('true')
    expect(byName('清空当前对话').getAttribute('aria-disabled')).toBe('true')
  })

  it('生成回复时仍可查看只读 MCP 和 Skills 详情', async () => {
    const onInspectMcp = vi.fn(), onInspectSkills = vi.fn()
    await renderMenu({ ...handlers(), floating: false, actionDisabled: true, onInspectMcp, onInspectSkills })
    await clickItem('MCP 连接详情')
    expect(onInspectMcp).toHaveBeenCalledOnce()
    await clickItem('Skills 技能详情')
    expect(onInspectSkills).toHaveBeenCalledOnce()
  })
})
