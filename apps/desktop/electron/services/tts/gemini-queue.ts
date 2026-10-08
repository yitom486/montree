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

/** Conservative character budget, preserving paragraph boundaries first and sentences second. */
export function splitGeminiText(text: string, maxCharacters = 800): string[] {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 1) throw new Error('语音分段长度无效')
  const characters = Array.from(text)
  const segments: string[] = []
  for (let start = 0; start < characters.length;) {
    let end = Math.min(start + maxCharacters, characters.length)
    if (end < characters.length) {
      let splitAt = -1
      // 1. 优先段落边界（\n\n 或 \n），在后 2/3 区间寻找自然段分隔
      for (let index = end - 1; index >= start + Math.floor(maxCharacters / 3); index--) {
        if (characters[index] === '\n') {
          if (index > start && characters[index - 1] === '\n') {
            splitAt = index + 1
            break
          }
          if (splitAt === -1) splitAt = index + 1
        }
      }
      // 2. 无段落分界时退化为句末标点（。！？!?），在后半区间切分
      if (splitAt === -1) {
        for (let index = end - 1; index >= start + Math.floor(maxCharacters / 2); index--) {
          if (/[。！？!?]/u.test(characters[index])) {
            let next = index + 1
            while (next < characters.length && /[”’」）"']/.test(characters[next])) next++
            splitAt = next
            break
          }
        }
      }
      // 3. 兜底分句标点（；;，,）
      if (splitAt === -1) {
        for (let index = end - 1; index >= start + Math.floor(maxCharacters / 2); index--) {
          if (/[；;，,]/u.test(characters[index])) {
            splitAt = index + 1
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
