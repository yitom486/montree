import { createHash } from 'node:crypto'

export interface GeminiQuotaInfo {
  kind: 'daily' | 'rate'
  retryMs: number
}

/** Providers can wrap the Google error JSON inside another JSON message. */
export function parseGeminiQuotaError(cause: unknown): GeminiQuotaInfo | undefined {
  const texts: string[] = []
  const seen = new Set<object>()
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 8 || value == null) return
    if (typeof value === 'string') {
      texts.push(value)
      try { const parsed: unknown = JSON.parse(value); if (parsed !== value) visit(parsed, depth + 1) } catch {}
    } else if (typeof value === 'number') texts.push(String(value))
    else if (typeof value === 'object' && !seen.has(value)) {
      seen.add(value)
      if (value instanceof Error) visit(value.message, depth + 1)
      for (const item of Object.values(value)) visit(item, depth + 1)
    }
  }
  visit(cause)
  const text = texts.join('\n')
  if (!/429|RESOURCE_EXHAUSTED|quota exceeded|rate limit/i.test(text)) return
  const daily = /RequestsPerDay|TokensPerDay|PerDayPerProject|per[_ ]day|daily|每日|日额度/i.test(text)
  const retryMatch = /retryDelay["'\\\s:]+(\d+(?:\.\d+)?)s/i.exec(text)
  const humanMatch = /retry in\s+(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(\d+(?:\.\d+)?)s/i.exec(text)
  let retryMs = retryMatch ? Number(retryMatch[1]) * 1000
    : humanMatch ? (Number(humanMatch[1] ?? 0) * 3600 + Number(humanMatch[2] ?? 0) * 60 + Number(humanMatch[3])) * 1000 : 0
  if (!retryMs && daily) {
    // Conservative estimate if the server omits RetryInfo; daily quotas reset at Pacific midnight.
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
    const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? 0)
    retryMs = (86400 - part('hour') * 3600 - part('minute') * 60 - part('second')) * 1000
  }
  return { kind: daily ? 'daily' : 'rate', retryMs: Math.max(60_001, Math.ceil(retryMs)) }
}

export class GeminiQuotaError extends Error {
  constructor(readonly retryAt: number, readonly kind: GeminiQuotaInfo['kind']) {
    super(kind === 'daily' ? '此 Gemini API Key 的当天请求额度已耗尽' : '此 Gemini API Key 的请求频率或额度受限')
    this.name = 'GeminiQuotaError'
  }
}

export class GeminiDailyQuotaError extends GeminiQuotaError {
  constructor(retryAt: number) {
    super(retryAt, 'daily')
    this.name = 'GeminiDailyQuotaError'
  }
}

export class GeminiQuotaRegistry {
  private blocked = new Map<string, number>()
  private rateBlocked = new Map<string, number>()
  private key(apiKey: string, model: string): string {
    return createHash('sha256').update(`${apiKey.trim()}::${model}`).digest('hex')
  }
  record(apiKey: string, model: string, retryMs: number): GeminiDailyQuotaError {
    const retryAt = Date.now() + retryMs
    this.blocked.set(this.key(apiKey, model), retryAt)
    return new GeminiDailyQuotaError(retryAt)
  }
  recordRate(apiKey: string, model: string, retryMs: number): GeminiQuotaError {
    const retryAt = Date.now() + retryMs
    this.rateBlocked.set(this.key(apiKey, model), retryAt)
    return new GeminiQuotaError(retryAt, 'rate')
  }
  assertAvailable(apiKey: string, model: string): void {
    const key = this.key(apiKey, model)
    const retryAt = this.blocked.get(key) ?? 0
    if (retryAt > Date.now()) throw new GeminiDailyQuotaError(retryAt)
    this.blocked.delete(key)
    const rateRetryAt = this.rateBlocked.get(key) ?? 0
    if (rateRetryAt > Date.now()) throw new GeminiQuotaError(rateRetryAt, 'rate')
    this.rateBlocked.delete(key)
  }
  snapshot(): Record<string, number> {
    return Object.fromEntries([...this.blocked].filter(([, until]) => until > Date.now()))
  }
  restore(saved: unknown): void {
    if (!saved || typeof saved !== 'object') return
    for (const [key, until] of Object.entries(saved)) {
      if (/^[a-f0-9]{64}$/.test(key) && typeof until === 'number' && until > Date.now()) this.blocked.set(key, Math.max(this.blocked.get(key) ?? 0, until))
    }
  }
}

export const geminiQuota = new GeminiQuotaRegistry()
