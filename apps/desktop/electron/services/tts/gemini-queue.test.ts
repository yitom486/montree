import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GeminiRequestQueue, splitGeminiText } from './gemini-queue'

describe('Gemini shared request budget', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
  afterEach(() => { vi.useRealTimers() })

  it('allows at most three starts in every rolling minute, including failed requests', async () => {
    const queue = new GeminiRequestQueue()
    const starts: number[] = []
    const results = Array.from({ length: 7 }, (_, index) => queue.run(async () => {
      starts.push(Date.now())
      if (index === 1) throw new Error('failed')
    }).catch(() => {}))
    await vi.advanceTimersByTimeAsync(0)
    expect(starts).toEqual([0, 0, 0])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(starts).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(starts).toEqual([0, 0, 0, 60_001, 60_001, 60_001])
    await vi.advanceTimersByTimeAsync(60_001)
    await Promise.all(results)
    expect(starts).toHaveLength(7)
    for (const time of starts) expect(starts.filter((start) => start >= time && start < time + 60_000).length).toBeLessThanOrEqual(3)
  })

  it('serializes requests and gives waiting foreground synthesis priority over prefetch', async () => {
    const queue = new GeminiRequestQueue()
    const order: string[] = []
    let release!: () => void
    const first = queue.run(() => new Promise<void>((resolve) => { release = resolve; order.push('first') }))
    const background = queue.run(async () => { order.push('background') }, { priority: 'background' })
    const foreground = queue.run(async () => { order.push('foreground') })
    expect(order).toEqual(['first'])
    release()
    await Promise.all([first, background, foreground])
    expect(order).toEqual(['first', 'foreground', 'background'])
  })

  it('removes cancelled waiting requests without consuming a slot or leaving a timer', async () => {
    const queue = new GeminiRequestQueue()
    for (let index = 0; index < 3; index++) await queue.run(async () => {})
    await vi.advanceTimersByTimeAsync(0)
    const abort = new AbortController()
    const work = vi.fn(async () => {})
    const pending = queue.run(work, { signal: abort.signal })
    const rejected = expect(pending).rejects.toThrow('cancelled')
    abort.abort(new Error('cancelled'))
    await rejected
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(60_001)
    await queue.run(work)
    expect(work).toHaveBeenCalledOnce()
  })

  it('waits after a server quota error even when the local budget has spare slots', async () => {
    const queue = new GeminiRequestQueue()
    await queue.run(async () => { queue.coolDown() })
    const work = vi.fn(async () => {})
    const pending = queue.run(work)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(work).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(work).toHaveBeenCalledOnce()
  })

  it('reports a wait for the request budget and cancellation without starting another request', async () => {
    const queue = new GeminiRequestQueue()
    for (let index = 0; index < 3; index++) await queue.run(async () => {})
    await vi.advanceTimersByTimeAsync(0)
    const abort = new AbortController()
    const state = vi.fn()
    const work = vi.fn(async () => {})
    const result = queue.run(work, { signal: abort.signal, onQueueState: state })
    expect(state).toHaveBeenCalledWith(expect.objectContaining({ phase: 'queued', reason: 'rate-limit', waitMs: 60001 }))
    const rejected = expect(result).rejects.toThrow('cancelled')
    abort.abort(new Error('cancelled'))
    await rejected
    expect(state).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'cancelled' }))
    expect(work).not.toHaveBeenCalled()
  })
})

describe('Gemini text segmentation', () => {
  it.each(['中文。'.repeat(700), 'a'.repeat(1700), '🙂'.repeat(1700), '首段\n\n' + '中'.repeat(1500) + '\n尾段。'])('preserves every character within the budget', (text) => {
    const segments = splitGeminiText(text)
    expect(segments.join('')).toBe(text)
    expect(segments.every((segment) => Array.from(segment).length <= 800)).toBe(true)
    expect(segments.every((segment) => !/[\uD800-\uDBFF]$/.test(segment))).toBe(true)
  })
  it('prefers sentence boundaries and handles empty text', () => {
    expect(splitGeminiText('中'.repeat(600) + '。' + '后'.repeat(300))[0]).toBe('中'.repeat(600) + '。')
    expect(splitGeminiText('')).toEqual([])
  })
  it('prefers paragraph boundaries over sentence boundaries when within budget', () => {
    const text = '第一段内容。还有一句话。' + '\n\n' + '第二段内容。还有一句话。'
    const segs = splitGeminiText(text, 25)
    expect(segs[0]).toBe('第一段内容。还有一句话。\n\n')
    expect(segs[1]).toBe('第二段内容。还有一句话。')
  })
})
