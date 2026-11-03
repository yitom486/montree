import { afterEach, describe, expect, it } from 'vitest'
import { getAcpContext, runInAcpContext, forgetAcpContext } from '../acp-context'
import { callTranslationTool, onTranslationOutput, openTranslationOutput, isTranslationOutputPermission } from './translation-tools'
import { TRANSLATION_TOOL_NAME, parseTranslationToolCall } from '../../../../contracts/translation'

const id = '12345678-1234-1234-1234-123456789abc'
const contexts: ReturnType<typeof getAcpContext>[] = []
function context() {
  const owner = getAcpContext(`translation-test-${contexts.length}`)
  owner.purpose = 'translation'
  contexts.push(owner)
  return owner
}
afterEach(() => { for (const owner of contexts.splice(0)) forgetAcpContext(owner) })
describe('translation result tool', () => {
  it('validates output shapes, rejects extra fields and oversized or empty content', () => {
    const base = { requestId: id, sequence: 0, type: 'text', text: '译文' }
    expect(parseTranslationToolCall(base)).toEqual(base)
    for (const patch of [{ sequence: -1 }, { sequence: 128 }, { text: '' }, { text: 'a'.repeat(601) }, { reasoning: 'private' }, { requestId: 'bad' }]) {
      expect(parseTranslationToolCall({ ...base, ...patch })).toBeNull()
    }
    expect(parseTranslationToolCall({ requestId: id, sequence: 0, type: 'language', sourceLanguage: null })).not.toBeNull()
  })
  it('publishes ordered increments exactly once, rejects conflicting retries and late events', async () => {
    await runInAcpContext(context(), async () => {
      const received: unknown[] = []
      const off = onTranslationOutput(event => received.push(event))
      const close = openTranslationOutput(id, 'session-a')
      const emit = (sequence: number, text: string) => callTranslationTool(TRANSLATION_TOOL_NAME, {}, { requestId: id, sequence, type: 'text', text })
      await emit(1, '第二句')
      expect(received).toHaveLength(0)
      await emit(0, '第一句')
      expect(received).toMatchObject([{ sequence: 0, sessionId: 'session-a', event: { text: '第一句' } }, { sequence: 1, event: { text: '第二句' } }])
      await emit(0, '第一句')
      expect(received).toHaveLength(2)
      expect(await emit(0, '冲突')).toHaveProperty('isError', true)
      await callTranslationTool(TRANSLATION_TOOL_NAME, {}, { requestId: id, sequence: 2, type: 'done' })
      expect(await emit(3, 'late')).toHaveProperty('isError', true)
      close()
      expect(await emit(0, '第一句')).toHaveProperty('isError', true)
      off()
    })
  })
  it('does not accept stale request IDs, other windows or non-translation contexts', async () => {
    const a = context(), b = context()
    const call = { requestId: id, sequence: 0, type: 'text', text: '译文' }
    const close = runInAcpContext(a, () => openTranslationOutput(id, 's'))
    expect(await runInAcpContext(b, () => callTranslationTool(TRANSLATION_TOOL_NAME, {}, call))).toHaveProperty('isError', true)
    a.purpose = 'chat'
    expect(await runInAcpContext(a, () => callTranslationTool(TRANSLATION_TOOL_NAME, {}, call))).toHaveProperty('isError', true)
    a.purpose = 'translation'
    expect(runInAcpContext(a, () => isTranslationOutputPermission({ title: 'shell', rawInput: { arguments: call } }))).toBe(false)
    expect(runInAcpContext(a, () => isTranslationOutputPermission({ title: TRANSLATION_TOOL_NAME, rawInput: { arguments: call } }))).toBe(true)
    close()
    expect(runInAcpContext(a, () => isTranslationOutputPermission({ title: TRANSLATION_TOOL_NAME, rawInput: { arguments: call } }))).toBe(false)
  })
})
