// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BuiApprovalCard, type BuiApprovalOption } from './BuiApprovalCard'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const OPTIONS: BuiApprovalOption[] = [
  { id: 'allow-read', label: '读取工作区文件', kind: 'allow_once' },
  { id: 'allow-exec', label: '执行命令', kind: 'allow_once' },
  { id: 'reject', label: '拒绝', kind: 'reject_once' },
]

describe('BuiApprovalCard 权限卡视觉', () => {
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
    vi.restoreAllMocks()
  })

  function renderCard(props: Partial<Parameters<typeof BuiApprovalCard>[0]> = {}) {
    act(() => {
      root.render(
        createElement(BuiApprovalCard, {
          title: '需要批准',
          options: OPTIONS,
          requestKey: 'req-1',
          onSelect: () => {},
          onCancel: () => {},
          ...props,
        }),
      )
    })
  }

  it('渲染标题与全部真实选项', () => {
    renderCard()
    const card = container.querySelector('[data-testid="bui-approval-card"]') as HTMLElement
    expect(card).not.toBeNull()
    expect(card.getAttribute('data-request-key')).toBe('req-1')
    expect(container.textContent).toContain('需要批准')
    expect(container.textContent).toContain('读取工作区文件')
    expect(container.textContent).toContain('执行命令')
    expect(container.textContent).toContain('拒绝')
    // 单请求静态计数，无多步问答翻页
    expect(container.textContent).toContain('1/1')
  })

  it('点击选项触发选择回调并携带真实 id', () => {
    const onSelect = vi.fn()
    renderCard({ onSelect })
    const option = container.querySelector('[aria-label="执行命令"]') as HTMLButtonElement
    act(() => {
      option.click()
    })
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('allow-exec')
  })

  it('选中选项以 aria-pressed 表达', () => {
    renderCard({ selectedId: 'allow-read' })
    expect((container.querySelector('[aria-label="读取工作区文件"]') as HTMLElement).getAttribute('aria-pressed')).toBe('true')
    expect((container.querySelector('[aria-label="执行命令"]') as HTMLElement).getAttribute('aria-pressed')).toBe('false')
  })

  it('busy 时全部禁用，执行中选项转圈', () => {
    const onSelect = vi.fn()
    const onCancel = vi.fn()
    renderCard({ busy: true, busyId: 'allow-exec', onSelect, onCancel })
    const card = container.querySelector('[data-testid="bui-approval-card"]') as HTMLElement
    expect(card.getAttribute('aria-busy')).toBe('true')
    for (const button of container.querySelectorAll('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
    const running = container.querySelector('[aria-label="执行命令"]') as HTMLElement
    expect(running.querySelector('.animate-spin')).not.toBeNull()
    act(() => {
      ;(container.querySelector('[aria-label="执行命令"]') as HTMLButtonElement).click()
    })
    expect(onSelect).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('取消按钮触发取消回调', () => {
    const onCancel = vi.fn()
    renderCard({ onCancel })
    const cancel = [...container.querySelectorAll('button')].find((b) => b.textContent === '取消') as HTMLButtonElement
    expect(cancel).toBeTruthy()
    act(() => {
      cancel.click()
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
