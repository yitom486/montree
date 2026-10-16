// @vitest-environment happy-dom
// BuiThinking 纯展示回归：标题切换、展开回调、行渲染、reduced-motion 可操作。
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BuiThinking } from './BuiThinking'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const ROWS = [
  { primary: '正在梳理章节结构', secondary: '第一章', mono: false },
  { primary: '读取章节文件', secondary: 'chapter-01.md', mono: true },
]

describe('BuiThinking 纯展示', () => {
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

  function render(props: Partial<Parameters<typeof BuiThinking>[0]> = {}) {
    const onToggle = vi.fn()
    act(() => {
      root.render(
        createElement(BuiThinking, {
          state: 'running',
          titleActive: '正在思考',
          titleDone: '已思考 4 秒',
          rows: ROWS,
          expanded: false,
          onToggle,
          partKey: 'part-1',
          ...props,
        }),
      )
    })
    return { onToggle }
  }

  it('running 显示进行标题，done 显示落定标题', () => {
    render({ state: 'running' })
    expect(container.querySelector('[role="status"]')?.textContent).toContain('正在思考')
    render({ state: 'done' })
    expect(container.querySelector('[role="status"]')?.textContent).toContain('已思考 4 秒')
  })

  it('点击头调用 onToggle，aria-expanded 随受控值切换', () => {
    const { onToggle } = render({ expanded: false })
    const header = container.querySelector('button[aria-expanded]') as HTMLElement
    expect(header.getAttribute('aria-expanded')).toBe('false')
    act(() => {
      header.click()
    })
    expect(onToggle).toHaveBeenCalledTimes(1)
    render({ expanded: true })
    expect(container.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('行渲染主副文本，mono 行副文本走等宽', () => {
    render({ expanded: true })
    expect(container.textContent).toContain('正在梳理章节结构')
    expect(container.textContent).toContain('chapter-01.md')
    const mono = [...container.querySelectorAll('span')].find((s) =>
      s.textContent?.includes('chapter-01.md'),
    )
    expect(mono?.className).toContain('font-mono')
  })

  it('收起正文退出键盘与读屏访问，展开恢复同一个正文节点', () => {
    const body = createElement('a', { href: '#source' }, '查看来源')
    render({ expanded: false, body })
    const header = container.querySelector('button[aria-controls]')!
    const content = document.getElementById(header.getAttribute('aria-controls')!)!
    expect(content.hasAttribute('inert')).toBe(true)
    expect(content.getAttribute('aria-hidden')).toBe('true')
    render({ expanded: true, body })
    expect(document.getElementById(header.getAttribute('aria-controls')!)).toBe(content)
    expect(content.hasAttribute('inert')).toBe(false)
    expect(content.getAttribute('aria-hidden')).toBe('false')
  })

  it('reduced-motion 下结构仍可操作（不断言动画帧）', () => {
    const stub = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    const prev = window.matchMedia
    Object.defineProperty(window, 'matchMedia', { value: stub, configurable: true })
    try {
      const { onToggle } = render({ expanded: false })
      expect(container.querySelector('.bui-anim')).not.toBeNull()
      act(() => {
        ;(container.querySelector('button[aria-expanded]') as HTMLElement).click()
      })
      expect(onToggle).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(window, 'matchMedia', { value: prev, configurable: true })
    }
  })
})
