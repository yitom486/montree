import { describe, expect, it } from 'vitest'
import { applyTranslationOutput, createTranslationTextStream, emptyTranslationOutput, translationNote } from './translation-result'
const details = { sourceLanguage: '英语', phrases: [{ text: 'second edition', meaning: '第二版' }], terms: [{ text: 'SICP', meaning: '此处的书名缩写' }] }
const source = 'This is the second edition SICP book.'
describe('structured translation results', () => {
  it('appends text and each explanation immediately, filters invented/duplicate entries', () => {
    let state = emptyTranslationOutput()
    state = applyTranslationOutput(state, { type: 'text', text: '这是' }, source)
    state = applyTranslationOutput(state, { type: 'text', text: '第二版。' }, source)
    expect(state.text).toBe('这是第二版。')
    state = applyTranslationOutput(state, { type: 'phrase', ...details.phrases[0] }, source)
    expect(state.details.phrases).toEqual(details.phrases)
    for (const text of ['SECOND EDITION', 'invented phrase']) state = applyTranslationOutput(state, { type: 'phrase', text, meaning: 'discard' }, source)
    expect(state.details.phrases).toHaveLength(1)
    state = applyTranslationOutput(state, { type: 'term', ...details.terms[0] }, source)
    expect(state.details.terms).toEqual(details.terms)
    state = applyTranslationOutput(state, { type: 'done' }, source)
    expect(applyTranslationOutput(state, { type: 'text', text: 'late' }, source)).toBe(state)
  })
  it('formats a self-contained note with original text, translation, language and explanations', () => {
    const note = translationNote(source, '译文', '简体中文', details)
    for (const text of [source, '译文', '英语 → 简体中文', '关键短语', 'second edition：第二版', '专有名词', 'SICP：此处的书名缩写']) expect(note).toContain(text)
  })
})

describe('real translation text stream', () => {
  it('publishes incomplete translation strings without waiting for a JSON object or turn completion', async () => {
    const deltas: string[] = []
    const stream = createTranslationTextStream(delta => deltas.push(delta))
    stream.append('Explanation that must stay hidden.\n{"translation":"第')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(deltas.join('')).toBe('第')
    stream.append('一段')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(deltas.join('')).toBe('第一段')
    stream.append('。","sourceLanguage":"英语"}')
    expect(await stream.finish('complete reply is not appended twice')).toEqual({ text: '第一段。', sourceLanguage: '英语' })
    expect(deltas.join('')).toBe('第一段。')
  })
  it('handles every chunk boundary in escaped text, newlines and surrogate pairs without flicker', async () => {
    const original = '中文 "quoted" \n next \u003c literal 😀 𝑥'
    const body = JSON.stringify({ translation: original, sourceLanguage: null }).replace('😀', '\\ud83d\\ude00')
    let visible = ''
    const stream = createTranslationTextStream(delta => {
      visible += delta
      expect(original.startsWith(visible)).toBe(true)
      expect(visible).not.toContain('\ufffd')
    })
    for (const char of body) { stream.append(char); await new Promise(resolve => setTimeout(resolve, 0)) }
    expect(await stream.finish(body)).toEqual({ text: original, sourceLanguage: null })
    expect(visible).toBe(original)
  })
  it('rejects plain narration, wrong shapes and unfinished final results', async () => {
    for (const raw of ['Translating text into Chinese.', '{"translation":123}', '{"translation":"译文","reasoning":"private"}', '{"translation":"unfinished']) {
      const stream = createTranslationTextStream()
      stream.append(raw)
      expect(await stream.finish(raw)).toBeNull()
    }
  })
})
