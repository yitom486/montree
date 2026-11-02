import { describe, expect, it, vi } from 'vitest'
import { buildTranslationPrompt, hasUnreadableText, sendTranslationPrompt } from './translation-session'
import { sendSubsessionPrompt } from './acp-subsession'

vi.mock('./acp-subsession', () => ({
  sendSubsessionPrompt: vi.fn(async () => ({ status: 'ok', reply: '译文' })),
}))

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
        key: 'current:default',
        onDelta,
      }),
      expect.stringContaining('English'),
    )
  })

  it('uses an independent model patch and isolates the session key', async () => {
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
        key: 'opencode:fast-model',
        runtimeId: 'opencode',
        configPatches: [{ configId: 'model', value: 'fast-model' }],
      }),
      expect.any(String),
    )
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
