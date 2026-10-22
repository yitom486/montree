import { describe, expect, it } from 'vitest'
import { createInlineCompletionService, type InlineCompletionRunner } from './inline-completion-service'
import { buildInlineCompletionPrompt, cleanCompletion } from './inline-completion-prompt'
import { e2eMockModelSource } from './inline-completion-model'

const request = (overrides = {}) => ({ requestId: 'r1', filePath: '/notes/a.md', language: 'markdown', prefix: 'The quick brown', suffix: '\n\nNext', ...overrides })
const source = (generate: InlineCompletionRunner['generate']) => ({
  resolve: async () => ({ id: 'm', generate }),
})

describe('inline completion service (mocked runner)', () => {
  it('sends prefix/suffix/file type and returns cleaned alternatives', async () => {
    let sent = ''
    const service = createInlineCompletionService(source(async ({ prompt }) => {
      sent = prompt
      return ' fox jumps.\n<ALT>\n cat sleeps.'
    }))
    const out = await service.complete('w1', request())
    expect(out.items).toEqual([' fox jumps.', ' cat sleeps.'])
    expect(sent).toContain('The quick brown<CURSOR>')
    expect(sent).toContain('<AFTER>\n\nNext</AFTER>')
    expect(sent).toContain('Markdown')
  })
  it('falls back gracefully when no model is configured', async () => {
    const service = createInlineCompletionService({ resolve: async () => null })
    expect(await service.complete('w1', request())).toMatchObject({ items: [], reason: 'not-configured' })
    expect(await service.status()).toEqual({ configured: false })
  })
  it('a new request from the same window cancels the in-flight one; other windows are independent', async () => {
    let calls = 0
    const service = createInlineCompletionService(source(async ({ signal }) => {
      calls++
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 50)
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')) }, { once: true })
      })
      return ' done'
    }))
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
    const service = createInlineCompletionService(source(({ signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })))
    const pending = service.complete('w1', request({ requestId: 'x' }))
    await new Promise((resolve) => setTimeout(resolve, 5))
    service.cancel('w1', 'x')
    expect((await pending).reason).toBe('cancelled')
    const failing = createInlineCompletionService(source(async () => { throw new Error('boom') }))
    expect(await failing.complete('w1', request())).toMatchObject({ reason: 'error', message: expect.stringContaining('boom') })
  })
  it('the E2E mock runner returns deterministic alternatives', async () => {
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
  it('adds document/heading/block hints and a one-line constraint', () => {
    const { system, prompt } = buildInlineCompletionPrompt(request({
      hints: { title: 'Guide', section: ['Intro', 'Setup'], block: 'heading' },
    }))
    expect(prompt).toContain('文档标题：Guide')
    expect(prompt).toContain('当前章节：Intro > Setup')
    expect(prompt).toContain('当前块：标题')
    expect(system).toContain('不要换行')
  })
  it('strips fences, echoed prefix and duplicated suffix', () => {
    expect(cleanCompletion('```\nfox jumps\n```', { prefix: 'quick ', suffix: '' })).toBe('fox jumps')
    expect(cleanCompletion('quick brown fox', { prefix: 'The quick brown', suffix: '' })).toBe(' fox')
    expect(cleanCompletion(' fox jumps. Next paragraph', { prefix: 'brown', suffix: 'Next paragraph' })).toBe(' fox jumps.')
    expect(cleanCompletion('   ', { prefix: 'a', suffix: '' })).toBe('')
  })
  it('removes CJK leading spaces and flattens one-line blocks', () => {
    expect(cleanCompletion(' 继续', { prefix: '中文。', suffix: '' })).toBe('继续')
    expect(cleanCompletion('第一行\n第二行', {
      prefix: '## ',
      suffix: '',
      hints: { block: 'heading' },
    })).toBe('第一行 第二行')
  })
})
