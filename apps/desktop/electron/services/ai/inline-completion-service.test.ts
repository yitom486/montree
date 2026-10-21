import { describe, expect, it } from 'vitest'
import { MockLanguageModelV3 } from 'ai/test'
import { createInlineCompletionService } from './inline-completion-service'
import { buildInlineCompletionPrompt, cleanCompletion } from './inline-completion-prompt'
import { e2eMockModelSource } from './inline-completion-model'

const result = (text: string) => ({
  content: [{ type: 'text' as const, text }], finishReason: { unified: 'stop' as const, raw: 'stop' },
  usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }, warnings: [],
})
const request = (overrides = {}) => ({ requestId: 'r1', filePath: '/notes/a.md', language: 'markdown', prefix: 'The quick brown', suffix: '\n\nNext', ...overrides })

describe('inline completion service (mocked model)', () => {
  it('sends prefix/suffix/file type and returns cleaned alternatives', async () => {
    const model = new MockLanguageModelV3({ doGenerate: result(' fox jumps.\n<ALT>\n cat sleeps.') })
    const service = createInlineCompletionService({ resolve: async () => ({ model, id: 'm' }) })
    const out = await service.complete('w1', request())
    expect(out.items).toEqual([' fox jumps.', ' cat sleeps.'])
    const sent = JSON.stringify(model.doGenerateCalls[0].prompt)
    expect(sent).toContain('The quick brown<CURSOR>')
    expect(sent).toContain('<AFTER>\\n\\nNext</AFTER>')
    expect(sent).toContain('Markdown')
  })
  it('falls back gracefully when no model is configured', async () => {
    const service = createInlineCompletionService({ resolve: async () => null })
    expect(await service.complete('w1', request())).toMatchObject({ items: [], reason: 'not-configured' })
    expect(await service.status()).toEqual({ configured: false })
  })
  it('a new request from the same window cancels the in-flight one; other windows are independent', async () => {
    let calls = 0
    const model = new MockLanguageModelV3({ doGenerate: async (options) => {
      calls++
      await new Promise((resolve, reject) => { const t = setTimeout(resolve, 50); options.abortSignal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')) }) })
      return result(' done')
    } })
    const service = createInlineCompletionService({ resolve: async () => ({ model, id: 'm' }) })
    const first = service.complete('w1', request({ requestId: 'a' }))
    const other = service.complete('w2', request({ requestId: 'b' }))
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = service.complete('w1', request({ requestId: 'c' }))
    expect(await first).toMatchObject({ requestId: 'a', items: [], reason: 'cancelled' })
    expect((await second).items).toEqual([' done'])
    expect((await other).items).toEqual([' done'])
    expect(calls).toBe(3)
    expect(service.inflightCount()).toBe(0)
  })
  it('explicit cancel aborts and reports errors without throwing', async () => {
    const model = new MockLanguageModelV3({ doGenerate: async (options) => new Promise((_, reject) => options.abortSignal?.addEventListener('abort', () => reject(new Error('aborted')))) })
    const service = createInlineCompletionService({ resolve: async () => ({ model, id: 'm' }) })
    const pending = service.complete('w1', request({ requestId: 'x' }))
    await new Promise((resolve) => setTimeout(resolve, 5))
    service.cancel('w1', 'x')
    expect((await pending).reason).toBe('cancelled')
    const failing = createInlineCompletionService({ resolve: async () => ({ model: new MockLanguageModelV3({ doGenerate: async () => { throw new Error('boom') } }), id: 'm' }) })
    expect(await failing.complete('w1', request())).toMatchObject({ reason: 'error', message: expect.stringContaining('boom') })
  })
  it('the E2E mock source works through generateText', async () => {
    const service = createInlineCompletionService(e2eMockModelSource())
    expect((await service.complete('w', request())).items).toEqual([' fox jumps over the lazy dog.', ' cat naps in the sun.'])
  })
})

describe('inline completion prompt helpers', () => {
  it('labels code-fence languages and truncates context', () => {
    const { prompt } = buildInlineCompletionPrompt(request({ language: 'python', prefix: 'x'.repeat(5000) }))
    expect(prompt).toContain('python 代码')
    expect(prompt.length).toBeLessThan(5000)
  })
  it('strips fences, echoed prefix and duplicated suffix', () => {
    expect(cleanCompletion('```\nfox jumps\n```', { prefix: 'quick ', suffix: '' })).toBe('fox jumps')
    expect(cleanCompletion('quick brown fox', { prefix: 'The quick brown', suffix: '' })).toBe(' fox')
    expect(cleanCompletion(' fox jumps. Next paragraph', { prefix: 'brown', suffix: 'Next paragraph' })).toBe(' fox jumps.')
    expect(cleanCompletion('   ', { prefix: 'a', suffix: '' })).toBe('')
  })
})
