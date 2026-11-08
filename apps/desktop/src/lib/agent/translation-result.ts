import type { TranslationOutputEvent } from '../../../contracts/translation'
import { parsePartialJson } from 'ai'

/** 只发布结构化译文字段的真实增量，不把模型前言、JSON 外壳或半截转义交给 UI。 */
export function createTranslationTextStream(onDelta?: (text: string) => void) {
  let raw = ''
  let visible = ''
  let queue = Promise.resolve()
  let received = false
  const payload = () => {
    const start = raw.search(/\{\s*"translation"\s*:\s*"/)
    return start < 0 ? undefined : raw.slice(start).trim().replace(/\s*```$/, '')
  }
  const publish = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const data = value as Record<string, unknown>
    if (Object.keys(data).some(key => !['translation', 'sourceLanguage'].includes(key))) return
    if (typeof data.translation !== 'string' || data.translation.length > 32000) return
    // 不发布半个 UTF-16 代理对；补齐转义后的字符在下一段一起显示。
    const text = data.translation.replace(/[\uD800-\uDBFF]$/, '')
    if (!text.startsWith(visible)) return
    const delta = text.slice(visible.length)
    visible = text
    if (delta) onDelta?.(delta)
  }
  return {
    append(delta: string) {
      received = true
      if (raw.length + delta.length > 192000) return
      raw += delta
      const snapshot = payload()
      queue = queue.then(async () => {
        if (snapshot) publish((await parsePartialJson(snapshot)).value)
      })
    },
    async finish(reply: string) {
      // 某些运行时只提供最终回复；支持真实增量时不再重复追加完整回复。
      if (!received && reply) this.append(reply)
      await queue
      try {
        const data = JSON.parse(payload() ?? '') as Record<string, unknown>
        if (typeof data.translation !== 'string' || !data.translation.trim() || data.translation.length > 32000
          || Object.keys(data).some(key => !['translation', 'sourceLanguage'].includes(key))
          || (data.sourceLanguage !== null && (typeof data.sourceLanguage !== 'string' || !data.sourceLanguage.trim() || data.sourceLanguage.length > 40))) return null
        publish(data)
        return { text: data.translation.trim(), sourceLanguage: typeof data.sourceLanguage === 'string' ? data.sourceLanguage.trim() : null }
      } catch { return null }
    },
  }
}
export interface TranslationExplanation { text: string; meaning: string }
export interface TranslationDetails { sourceLanguage: string | null; phrases: TranslationExplanation[]; terms: TranslationExplanation[] }
export interface TranslationOutputState { text: string; details: TranslationDetails; done: boolean }
export function emptyTranslationOutput(): TranslationOutputState {
  return { text: '', details: { sourceLanguage: null, phrases: [], terms: [] }, done: false }
}
function normalize(text: string) { return text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim() }
export function applyTranslationOutput(state: TranslationOutputState, event: TranslationOutputEvent, source: string): TranslationOutputState {
  if (state.done) return state
  if (event.type === 'done') return { ...state, done: true }
  if (event.type === 'language') return { ...state, details: { ...state.details, sourceLanguage: event.sourceLanguage } }
  if (event.type === 'text') return { ...state, text: state.text + event.text }
  const key = event.type === 'phrase' ? 'phrases' : 'terms'
  const items = state.details[key]
  const normalized = normalize(event.text)
  if (!normalized || !normalize(source).includes(normalized) || items.length >= (key === 'phrases' ? 3 : 2)
    || items.some(item => normalize(item.text) === normalized)) return state
  return { ...state, details: { ...state.details, [key]: [...items, { text: event.text, meaning: event.meaning }] } }
}

export function translationNote(sourceText: string, text: string, targetLabel: string, details?: TranslationDetails): string {
  const sections = [
    `翻译（${details?.sourceLanguage || '自动识别'} → ${targetLabel}）`,
    `原文\n${sourceText.trim()}`,
    `译文\n${text.trim()}`,
  ]
  if (details?.phrases.length) sections.push(`关键短语\n${details.phrases.map((item) => `${item.text}：${item.meaning}`).join('\n')}`)
  if (details?.terms.length) sections.push(`专有名词\n${details.terms.map((item) => `${item.text}：${item.meaning}`).join('\n')}`)
  return sections.join('\n\n')
}
