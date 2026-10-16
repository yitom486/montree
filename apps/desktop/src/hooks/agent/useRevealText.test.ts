// @vitest-environment happy-dom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRevealText } from './useRevealText'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// 记录每次「揭示值真正变化」的时刻，供节流契约用例校验 minCommitMs 是否被遵守。
// complete 标记本帧揭示已追平 source（isComplete 短路提交，不受节流约束）。
const revealLog: Array<{ t: number; complete: boolean }> = []
let prevRevealed = ''

function Harness({ text, streaming }: { text: string; streaming: boolean }) {
  const revealed = useRevealText(text, streaming)
  if (revealed !== prevRevealed) {
    revealLog.push({ t: performance.now(), complete: revealed === text })
    prevRevealed = revealed
  }
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
    revealLog.length = 0
    prevRevealed = ''
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

  it('节流契约：source 高频增量下，连续提交间隔不小于 minCommitMs', () => {
    // 真实流式形态：source 每 60ms 增长 12 字，rAF 每 17ms 一帧。
    // 若计时状态随 effect 重跑被重置，每次 delta 到达后的首帧都会破例立即提交
    // （32ms 节流退化成「每个 delta 提交一次」）。
    const total = 2400
    const charsPerDelta = 12
    const deltaEveryMs = 60
    const frameMs = 17
    const minCommitMs = 32

    render('', true)
    revealLog.length = 0

    let emitted = 0
    let nextDeltaAt = 0
    let ms = 0
    while (ms < 60_000) {
      const boundary = ms + frameMs
      while (nextDeltaAt < boundary && emitted < total) {
        emitted = Math.min(total, emitted + charsPerDelta)
        render('文'.repeat(emitted), true)
        nextDeltaAt += deltaEveryMs
      }
      frames(1)
      ms = boundary
      if (emitted >= total && (container.textContent ?? '').length >= total) break
    }
    expect(container.textContent).toBe('文'.repeat(total))

    // 首帧（lastCommitTime 初值 -Infinity）允许立即提交，排除在外；
    // 追平帧（isComplete 短路）本身不受节流约束，但仍会刷新 lastCommitTime，
    // 因此保留在时间轴里参与间隔计算，只豁免它自身的间隔检查。
    const log = revealLog.slice(1)
    const violations = log.filter(
      (entry, i) => i > 0 && !entry.complete && entry.t - log[i - 1].t < minCommitMs,
    )
    expect(violations).toHaveLength(0)
  })
})
