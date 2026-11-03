import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AcpConfigOption } from '@yitom/contracts'
import { ok, err } from '@yitom/contracts'
import { translationApi } from '@/api/translation-api'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { TRANSLATION_LOWEST_THOUGHT, TRANSLATION_DEFAULT_THOUGHT } from './translation-config'
import { buildTranslationPrompt, hasUnreadableText, sendTranslationPrompt } from './translation-session'
import { sendSubsessionPrompt } from './acp-subsession'

vi.mock('./acp-subsession', () => ({
  sendSubsessionPrompt: vi.fn(async () => ({ status: 'ok', reply: '译文' })),
}))
vi.mock('@/api/translation-api', () => ({ translationApi: { setConfigOption: vi.fn() } }))

const models: AcpConfigOption = {
  configId: 'language-model', category: 'model', name: 'Model', type: 'select', currentValue: 'large',
  options: [{ value: 'large', name: 'Large' }, { value: 'small', name: 'Small' }],
}
const effort: AcpConfigOption = {
  configId: 'thinking-level', category: 'thought_level', name: 'Effort', type: 'select', currentValue: 'max',
  options: [{ value: 'max', name: 'Max' }, { value: 'low', name: 'Low' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  useAcpUiStore.setState({ sessionId: 'main', configOptions: [models, effort] })
})

describe('translation-session', () => {
  it('only asks for the target language and does not require a source language', () => {
    const prompt = buildTranslationPrompt('Hello world', '简体中文')
    expect(prompt).toContain('简体中文')
    expect(prompt).toContain('Hello world')
    expect(prompt).not.toContain('source language:')
  })

  it('uses the hidden translate subsession with the streaming delta callback', async () => {
    const onDelta = vi.fn()
    await sendTranslationPrompt({ text: '  Hello  ', targetLang: 'English', onDelta })
    expect(sendSubsessionPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'translate',
        key: JSON.stringify(['opencode', '', TRANSLATION_LOWEST_THOUGHT, 0]),
        inheritConfigPreferences: false,
        onDelta,
      }),
      expect.stringContaining('English'),
    )
  })

  it('uses independent model/effort configuration and isolates the session key', async () => {
    vi.mocked(sendSubsessionPrompt).mockClear()
    await sendTranslationPrompt({
      text: 'Hello',
      targetLang: 'English',
      runtimeId: 'opencode',
      model: 'fast-model',
    })
    expect(sendSubsessionPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'translate',
        key: JSON.stringify(['opencode', 'fast-model', TRANSLATION_LOWEST_THOUGHT, 0]),
        runtimeId: 'opencode',
        configureSession: expect.any(Function),
      }),
      expect.any(String),
    )
  })

  it('applies model first then lowest effort from refreshed options, without changing main chat', async () => {
    const updatedEffort = { ...effort, options: [{ value: 'high', name: 'High' }, { value: 'minimal', name: 'Minimal' }] }
    vi.mocked(translationApi.setConfigOption)
      .mockResolvedValueOnce(ok({ configOptions: [{ ...models, currentValue: 'small' }, updatedEffort] }))
      .mockResolvedValueOnce(ok({ configOptions: [{ ...models, currentValue: 'small' }, { ...updatedEffort, currentValue: 'minimal' }] }))
    await sendTranslationPrompt({ text: 'Hello', targetLang: 'English', runtimeId: 'opencode', model: 'small' })
    const opts = vi.mocked(sendSubsessionPrompt).mock.calls[0][0]
    const result = await opts.configureSession!('translation', [models, effort])
    expect(translationApi.setConfigOption).toHaveBeenNthCalledWith(1, { runtimeId: 'opencode', sessionId: 'translation', configId: 'language-model', value: 'small' })
    expect(translationApi.setConfigOption).toHaveBeenNthCalledWith(2, { runtimeId: 'opencode', sessionId: 'translation', configId: 'thinking-level', value: 'minimal' })
    expect(result[1].currentValue).toBe('minimal')
    expect(useAcpUiStore.getState().configOptions).toEqual([models, effort])
  })

  it('runtime default effort skips overrides and different efforts get different sessions', async () => {
    await sendTranslationPrompt({ text: 'Hello', targetLang: 'English', thought: TRANSLATION_DEFAULT_THOUGHT })
    const first = vi.mocked(sendSubsessionPrompt).mock.calls[0][0]
    expect(await first.configureSession!('translation', [models, effort])).toEqual([models, effort])
    expect(translationApi.setConfigOption).not.toHaveBeenCalled()
    await sendTranslationPrompt({ text: 'Hello', targetLang: 'English', thought: 'low' })
    expect(vi.mocked(sendSubsessionPrompt).mock.calls[1][0].key).not.toBe(first.key)
  })

  it('does not silently ignore unavailable models or rejected effort changes', async () => {
    await sendTranslationPrompt({ text: 'Hello', targetLang: 'English', model: 'removed' })
    await expect(vi.mocked(sendSubsessionPrompt).mock.calls[0][0].configureSession!('translation', [models, effort])).rejects.toThrow('模型已不可用')
    await sendTranslationPrompt({ text: 'Hello', targetLang: 'English' })
    vi.mocked(translationApi.setConfigOption).mockResolvedValueOnce(err({ code: 'INVALID_ARGUMENT', message: 'effort rejected' }))
    await expect(vi.mocked(sendSubsessionPrompt).mock.calls[1][0].configureSession!('translation', [models, effort])).rejects.toThrow('effort rejected')
  })

  it('detects PDF text-layer replacement characters', () => {
    expect(hasUnreadableText('normal text')).toBe(false)
    expect(hasUnreadableText('�is is the second edition ��� book')).toBe(true)
  })

  it('detects control codes and private glyphs while preserving real typography', () => {
    for (const text of ['\u0001is', '\uE001\uE002', '\u{F0001}', '\uD800', '\u0080']) {
      expect(hasUnreadableText(text)).toBe(true)
    }
    for (const text of ['This SICP book', 'ﬃ ligature', '中文\nEnglish\t✓ □ ☑', '∫ α 𝑥 😀']) {
      expect(hasUnreadableText(text)).toBe(false)
    }
  })

  it('does not send empty selections', async () => {
    vi.mocked(sendSubsessionPrompt).mockClear()
    const result = await sendTranslationPrompt({ text: '   ', targetLang: 'English' })
    expect(result.status).toBe('failed')
    expect(sendSubsessionPrompt).not.toHaveBeenCalled()
  })
})
