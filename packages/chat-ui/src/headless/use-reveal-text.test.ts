// @vitest-environment happy-dom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRevealText } from './use-reveal-text'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function Harness({ text, streaming }: { text: string; streaming: boolean }) {
  const revealed = useRevealText(text, streaming)
  return createElement('div', { 'data-revealed': revealed }, revealed)
}

describe('useRevealText 打字机揭示', () => {
  let container: HTMLDivElement
  let root: Root
  let now = 1000
  let nowSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    // 时间算法依赖 performance.now：测试里手动推进，与 rAF 步调一致
    now = 1000
    nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    nowSpy.mockRestore()
    vi.useRealTimers()
  })

  function render(text: string, streaming: boolean) {
    act(() => {
      root.render(createElement(Harness, { text, streaming }))
    })
  }

  function frames(n: number) {
    act(() => {
      for (let i = 0; i < n; i += 1) {
        // 步进 17ms：rAF 周期约 16.67ms，用 16ms 步进会与其拍频、
        // 每两步才触发一帧（旧参数恰好卡边通过）。17ms 还原真实帧节奏。
        now += 17
        vi.advanceTimersByTime(17)
      }
    })
  }

  it('非流式直接返回原文', () => {
    render('全文在此', false)
    expect(container.textContent).toBe('全文在此')
  })

  it('流式按帧匀速揭示，最终追上原文', () => {
    const full = '甲'.repeat(500)
    render('', true)
    render(full, true)
    // 首帧只揭示一部分，不是整段砸出
    frames(1)
    const first = container.textContent ?? ''
    expect(first.length).toBeGreaterThan(0)
    expect(first.length).toBeLessThan(full.length)
    // 继续推进单调增长并收敛（小步收尾：500 字约需 58 帧，预算 72 帧；
    // 上限是“最终追上”，不是速度——拖尾由“大 backlog”用例锁定）
    frames(1)
    const second = container.textContent ?? ''
    expect(second.length).toBeGreaterThanOrEqual(first.length)
    frames(70)
    expect(container.textContent).toBe(full)
  })

  it('大 backlog 加速追赶，不无限拖尾', () => {
    // 动态封顶 40 字/帧：2400 字约 70 帧排空
    const full = '乙'.repeat(2400)
    render('', true)
    render(full, true)
    frames(130)
    expect(container.textContent).toBe(full)
  })

  it('原文改写（非追加）直接对齐，不拼出乱序', () => {
    render('旧的前缀文本内容', true)
    frames(2)
    render('完全不同的新文本', true)
    frames(5)
    expect(container.textContent).toBe('完全不同的新文本')
  })

  it('落定即全量，不等待揭示', () => {
    render('一', true)
    frames(1)
    render('一二三四五', false)
    expect(container.textContent).toBe('一二三四五')
  })

  it('多次渲染同一文本不重复调度', () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    render('稳态文本', true)
    frames(10)
    const calls = cancel.mock.calls.length
    render('稳态文本', true)
    frames(10)
    // 追上后停调度：取消次数不再增长（只有 effect 重跑的一次清理）
    expect(cancel.mock.calls.length).toBeLessThanOrEqual(calls + 1)
    expect(container.textContent).toBe('稳态文本')
    cancel.mockRestore()
  })
})
