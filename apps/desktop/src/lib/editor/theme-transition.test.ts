// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyThemeWithViewTransition, registerThemeParticipant } from './theme-transition'

describe('applyThemeWithViewTransition', () => {
  beforeEach(() => {
    document.documentElement.className = 'light'
    vi.restoreAllMocks()
  })

  it('在无 startViewTransition 时直接更新状态并替换 DOM class', () => {
    const applyFn = vi.fn()
    delete (document as { startViewTransition?: unknown }).startViewTransition

    applyThemeWithViewTransition('dark', applyFn)

    expect(applyFn).toHaveBeenCalledTimes(1)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.classList.contains('light')).toBe(false)
  })
  it('新画面等待隔离帧确认，缺失确认限时降级', async () => {
    vi.useFakeTimers()
    let callback: (() => void | Promise<void>) | undefined
    document.startViewTransition = vi.fn().mockImplementation((cb) => {
      callback = cb
      return { finished: new Promise(() => {}) }
    })
    window.matchMedia = vi.fn().mockReturnValue({ matches: false })
    let confirm!: () => void
    const participant = vi.fn(() => new Promise<void>((resolve) => { confirm = resolve }))
    const unregister = registerThemeParticipant(participant)
    try {
      applyThemeWithViewTransition('sepia', vi.fn())
      let settled = false
      const update = Promise.resolve(callback!()).then(() => { settled = true })
      await Promise.resolve()
      expect(participant).toHaveBeenCalledWith('sepia')
      expect(settled).toBe(false)
      confirm()
      await update
      expect(settled).toBe(true)
      applyThemeWithViewTransition('dark', vi.fn())
      const timeoutUpdate = Promise.resolve(callback!())
      await vi.advanceTimersByTimeAsync(160)
      await timeoutUpdate
    } finally { unregister(); vi.useRealTimers() }
  })

  it('开启 prefers-reduced-motion 时降级为即时切换', () => {
    const applyFn = vi.fn()
    document.startViewTransition = vi.fn()

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion: reduce'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    applyThemeWithViewTransition('sepia', applyFn)

    expect(applyFn).toHaveBeenCalledTimes(1)
    expect(document.startViewTransition).not.toHaveBeenCalled()
    expect(document.documentElement.classList.contains('sepia')).toBe(true)
  })

  it('支持 startViewTransition 时添加 theme-transitioning 并在结束后两帧移除', async () => {
    const applyFn = vi.fn()
    let transitionCallback: (() => void) | undefined
    let resolveFinished: () => void

    const finishedPromise = new Promise<void>((resolve) => {
      resolveFinished = resolve
    })

    document.startViewTransition = vi.fn().mockImplementation((cb: () => void) => {
      transitionCallback = cb
      return {
        finished: finishedPromise,
        ready: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        skipTransition: vi.fn(),
      }
    })

    window.matchMedia = vi.fn().mockReturnValue({ matches: false })

    applyThemeWithViewTransition('dark', applyFn)

    // startViewTransition 被调用
    expect(document.startViewTransition).toHaveBeenCalledTimes(1)
    expect(document.documentElement.classList.contains('theme-transitioning')).toBe(true)

    // 执行过渡回调
    expect(transitionCallback).toBeDefined()
    transitionCallback?.()
    expect(applyFn).toHaveBeenCalledTimes(1)
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    // 模拟 finished 完成
    const rafQueue: FrameRequestCallback[] = []
    window.requestAnimationFrame = vi.fn((fn: FrameRequestCallback) => {
      rafQueue.push(fn)
      return rafQueue.length
    })

    resolveFinished!()
    await finishedPromise
    await Promise.resolve()
    await Promise.resolve()

    // 第一帧
    expect(rafQueue.length).toBe(1)
    const firstRaf = rafQueue.shift()!
    firstRaf(0)

    // 第二帧
    expect(rafQueue.length).toBe(1)
    const secondRaf = rafQueue.shift()!
    secondRaf(0)

    // 两帧后移除 theme-transitioning
    expect(document.documentElement.classList.contains('theme-transitioning')).toBe(false)
  })
})
