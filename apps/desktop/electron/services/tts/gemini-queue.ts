export type GeminiRequestPriority = 'foreground' | 'background'
export interface GeminiQueueState {
  phase: 'queued' | 'started' | 'cancelled'
  reason?: 'busy' | 'rate-limit'
  waitMs: number
  queueLength: number
}

interface PendingRequest {
  start: () => Promise<void>
  cancel: () => void
  signal?: AbortSignal
  priority: GeminiRequestPriority
  report: (state: GeminiQueueState) => void
}

/** All interactive Gemini synthesis, including retries and key tests, shares this budget. */
export class GeminiRequestQueue {
  private readonly pending: PendingRequest[] = []
  private starts: number[] = []
  private busy = false
  private blockedUntil = 0
  private timer?: ReturnType<typeof setTimeout>

  constructor(private readonly maxRequests = 3, private readonly windowMs = 60_001) {}

  run<T>(work: () => Promise<T>, context?: { signal?: AbortSignal; priority?: GeminiRequestPriority; onQueueState?: (state: GeminiQueueState) => void }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const signal = context?.signal
      if (signal?.aborted) { reject(signal.reason); return }
      const removeListener = () => signal?.removeEventListener('abort', request.cancel)
      let lastReason: GeminiQueueState['reason'] | 'initial' = 'initial'
      const request: PendingRequest = {
        signal,
        priority: context?.priority ?? 'foreground',
        report: (state) => {
          if (state.phase === 'queued' && state.reason === lastReason) return
          lastReason = state.reason
          context?.onQueueState?.(state)
        },
        cancel: () => {
          const index = this.pending.indexOf(request)
          if (index < 0) return
          this.pending.splice(index, 1)
          removeListener()
          request.report({ phase: 'cancelled', waitMs: 0, queueLength: this.pending.length })
          reject(signal?.reason)
          this.drain()
        },
        start: async () => {
          removeListener()
          try { resolve(await work()) } catch (cause) { reject(cause) }
        },
      }
      signal?.addEventListener('abort', request.cancel, { once: true })
      this.pending.push(request)
      this.drain()
    })
  }

  coolDown(ms = this.windowMs): void {
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + ms)
    this.drain()
  }

  private drain(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    if (!this.pending.length) return
    const now = Date.now()
    this.starts = this.starts.filter((time) => now - time < this.windowMs)
    const availableAt = Math.max(this.blockedUntil, this.starts.length >= this.maxRequests ? this.starts[0] + this.windowMs : now)
    if (this.busy || availableAt > now) {
      for (const request of this.pending) request.report({ phase: 'queued', reason: availableAt > now ? 'rate-limit' : 'busy', waitMs: Math.max(0, availableAt - now), queueLength: this.pending.length })
    }
    if (this.busy) return
    if (availableAt > now) {
      this.timer = setTimeout(() => this.drain(), availableAt - now)
      return
    }
    const foreground = this.pending.findIndex((request) => request.priority === 'foreground')
    const index = foreground < 0 ? 0 : foreground
    const request = this.pending[index]
    if (request.signal?.aborted) { request.cancel(); return }
    this.pending.splice(index, 1)
    this.starts.push(now)
    this.busy = true
    request.report({ phase: 'started', waitMs: 0, queueLength: this.pending.length })
    void request.start().finally(() => {
      this.busy = false
      this.drain()
    })
  }
}

export const geminiRequestQueue = new GeminiRequestQueue()

/**
 * Gemini 语音文本分段切分：
 * 默认单段上限约 3300 字，且分段时前序各段至少充实到 2500 字以上才寻找断句边界，
 * 优先段落换行，其次句末标点，最大化吃满 Gemini 免费配额与长文本合成吞吐。
 */
export function splitGeminiText(
  text: string,
  maxCharacters = 3300,
  minCharacters?: number,
): string[] {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 1) throw new Error('语音分段长度无效')
  const characters = Array.from(text)
  const segments: string[] = []

  // 最小分段门槛：默认 2500（当 maxCharacters >= 3000 时），小预算则等比例按 1/3 处理
  const effectiveMin =
    minCharacters !== undefined
      ? Math.min(minCharacters, maxCharacters)
      : maxCharacters >= 3000
        ? Math.min(2500, maxCharacters)
        : Math.floor(maxCharacters / 3)

  for (let start = 0; start < characters.length; ) {
    let end = Math.min(start + maxCharacters, characters.length)
    if (end < characters.length) {
      let splitAt = -1
      const searchFloor = start + effectiveMin

      // 1. 优先在 [searchFloor, end) 区间内寻找自然段落边界（\n\n 或 \n）
      for (let index = end - 1; index >= searchFloor; index--) {
        if (characters[index] === '\n') {
          if (index > start && characters[index - 1] === '\n') {
            splitAt = index + 1
            break
          }
          if (splitAt === -1) splitAt = index + 1
        }
      }

      // 2. 无段落分界时在 [searchFloor, end) 区间寻找句末标点（。！？!?）及后引号
      if (splitAt === -1) {
        for (let index = end - 1; index >= searchFloor; index--) {
          if (/[。！？!?]/u.test(characters[index])) {
            let next = index + 1
            while (next < characters.length && /[”’」）"']/.test(characters[next])) next++
            splitAt = next
            break
          }
        }
      }

      // 3. 兜底分句标点（；;，,）在 [searchFloor, end) 区间
      if (splitAt === -1) {
        for (let index = end - 1; index >= searchFloor; index--) {
          if (/[；;，,]/u.test(characters[index])) {
            splitAt = index + 1
            break
          }
        }
      }

      // 4. 若在 [searchFloor, end) 区间内未找到任何标点，向后半区 [start + max/2, searchFloor) 放宽回退寻找
      if (splitAt === -1) {
        const fallbackFloor = start + Math.floor(maxCharacters / 2)
        for (let index = searchFloor - 1; index >= fallbackFloor; index--) {
          if (characters[index] === '\n' || /[。！？!?；;，,]/u.test(characters[index])) {
            let next = index + 1
            while (next < characters.length && /[”’」）"']/.test(characters[next])) next++
            splitAt = next
            break
          }
        }
      }

      if (splitAt !== -1) {
        end = splitAt
      }
    }
    segments.push(characters.slice(start, end).join(''))
    start = end
  }
  return segments
}
