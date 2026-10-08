import { afterEach, describe, expect, it, vi } from 'vitest'
import { GeminiQuotaRegistry, parseGeminiQuotaError } from './gemini-quota'

describe('Gemini quota classification', () => {
  afterEach(() => vi.useRealTimers())
  it('recognizes the nested daily quota error from the reported logs and preserves the server delay', () => {
    const cause = new Error(JSON.stringify({ error: { code: 429, message: JSON.stringify({ error: {
      code: 429, status: 'RESOURCE_EXHAUSTED',
      message: 'Quota exceeded, Please retry in 8h6m24.229317612s.',
      details: [
        { violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '10' }] },
        { retryDelay: '29184s' },
      ],
    } }) } }))
    expect(parseGeminiQuotaError(cause)).toEqual({ kind: 'daily', retryMs: 29184000 })
  })
  it('keeps a short rate limit separate and honors a longer explicit delay', () => {
    expect(parseGeminiQuotaError(Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 }))).toEqual({ kind: 'rate', retryMs: 60001 })
    expect(parseGeminiQuotaError(new Error('429 RESOURCE_EXHAUSTED: retry in 90s'))).toEqual({ kind: 'rate', retryMs: 90000 })
    expect(parseGeminiQuotaError(new Error('云端语音未正常完成（OTHER）'))).toBeUndefined()
  })
  it('persists only hashes and blocks the same key/model until recovery, while allowing other credentials', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100000)
    const registry = new GeminiQuotaRegistry()
    registry.record('private-test-key', 'model', 29184000)
    const snapshot = registry.snapshot()
    expect(JSON.stringify(snapshot)).not.toContain('private-test-key')
    const restored = new GeminiQuotaRegistry()
    restored.restore(snapshot)
    expect(() => restored.assertAvailable('private-test-key', 'model')).toThrow('当天请求额度')
    expect(() => restored.assertAvailable('new-key', 'model')).not.toThrow()
    expect(() => restored.assertAvailable('private-test-key', 'another-model')).not.toThrow()
    vi.advanceTimersByTime(29184000)
    expect(() => restored.assertAvailable('private-test-key', 'model')).not.toThrow()
  })
  it('limits only the affected key and model after a rate error, without persisting that short cooldown', () => {
    vi.useFakeTimers()
    const registry = new GeminiQuotaRegistry()
    registry.recordRate('primary', 'model', 90000)
    expect(() => registry.assertAvailable('primary', 'model')).toThrow('请求频率')
    expect(() => registry.assertAvailable('backup', 'model')).not.toThrow()
    expect(registry.snapshot()).toEqual({})
    vi.advanceTimersByTime(90000)
    expect(() => registry.assertAvailable('primary', 'model')).not.toThrow()
  })
})
