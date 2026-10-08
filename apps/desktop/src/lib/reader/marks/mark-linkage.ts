import type { ReadingMark } from '@montree/contracts'
import { findTextRangeInRoot } from './excerpt-text-match'

/**
 * 卡片↔正文联动通用决策层（与文件格式无关）。
 *
 * 职责边界：
 * - 本模块只做决策：从 mark 规划 reveal 策略序列、按序执行、结构化上报 miss。
 *   不碰 DOM、不调 view、不吞错——执行失败一律落在返回值里，由调用方记日志。
 * - 几何执行（goTo CFI / 翻页描框 / 锚点滚动）由各端 RevealAdapter 实现，
 *   三端 thin 化之后只剩原语，策略顺序与兜底规则收归此处。
 *
 * 策略顺序（精确 → 粗粒度 → 文本兜底）：
 * - epub：cfi（cfiRange 优先）→ excerpt
 * - mobi：cfi → chapter → excerpt（现状 Foliate 有 cfi 时失败即停，本规划允许继续兜底）
 * - pdf：page → excerpt（页内描框/闪光是适配器的事，用 quads 或重搜由适配器定）
 * - web：url（+headingId）→ excerpt
 */

/** 与格式无关的 reveal 策略步骤。 */
export type RevealStep =
  | { type: 'cfi'; cfi: string }
  | { type: 'mobi-chapter'; chapterId: string }
  | { type: 'pdf-page'; page: number }
  | { type: 'web-url'; url: string; headingId?: string }
  | { type: 'excerpt'; text: string }

/** 规范化摘录：卡片正文优先，锚点原文次之；空白一律视为无摘录。 */
export function revealExcerptOf(mark: ReadingMark): string | null {
  const text = mark.excerpt?.trim() || mark.anchor.selectedText?.trim() || ''
  return text ? text : null
}

/** 为一张卡片规划 reveal 策略序列（至少 0 步；空计划意味着连页都定不到）。 */
export function planReveal(mark: ReadingMark): RevealStep[] {
  const steps: RevealStep[] = []
  const anchor = mark.anchor
  switch (anchor.format) {
    case 'epub': {
      const cfi = anchor.cfiRange ?? anchor.cfi
      if (cfi) steps.push({ type: 'cfi', cfi })
      break
    }
    case 'mobi': {
      const cfi = anchor.cfiRange ?? anchor.cfi
      if (cfi) steps.push({ type: 'cfi', cfi })
      if (anchor.chapterId) steps.push({ type: 'mobi-chapter', chapterId: anchor.chapterId })
      break
    }
    case 'pdf': {
      steps.push({ type: 'pdf-page', page: anchor.page })
      break
    }
    case 'web': {
      steps.push({ type: 'web-url', url: anchor.url, headingId: anchor.headingId })
      break
    }
  }
  const excerpt = revealExcerptOf(mark)
  if (excerpt) steps.push({ type: 'excerpt', text: excerpt })
  return steps
}

/** 各端几何适配器：执行单步，返回是否定位成功（抛错视为本步失败，不中断后续兜底）。 */
export interface RevealAdapter {
  tryStep(step: RevealStep, mark: ReadingMark): boolean | Promise<boolean>
}

export interface RevealStepAttempt {
  step: RevealStep
  ok: boolean
  error?: string
}

export interface LinkageMiss {
  reason: 'empty-plan' | 'all-steps-failed'
  markId: string
}

export type RevealResult =
  | { ok: true; step: RevealStep; attempts: RevealStepAttempt[] }
  | { ok: false; attempts: RevealStepAttempt[]; miss: LinkageMiss }

/** 按规划依次执行，首个成功即停；全败返回结构化 miss（调用方记日志，禁止静默）。 */
export async function runRevealPlan(
  mark: ReadingMark,
  adapter: RevealAdapter,
): Promise<RevealResult> {
  const plan = planReveal(mark)
  const attempts: RevealStepAttempt[] = []
  if (plan.length === 0) {
    return { ok: false, attempts, miss: { reason: 'empty-plan', markId: mark.id } }
  }
  for (const step of plan) {
    try {
      const ok = await adapter.tryStep(step, mark)
      attempts.push({ step, ok })
      if (ok) return { ok: true, step, attempts }
    } catch (error) {
      attempts.push({
        step,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { ok: false, attempts, miss: { reason: 'all-steps-failed', markId: mark.id } }
}

/**
 * overlay 键（与 foliate apply 侧一致；书签无可视层，不进 overlay）。
 * 原 FoliateReaderViewer 私有实现，收归此处——正文命中 key→mark 必须单口径。
 */
export function overlayerKeyForMark(mark: ReadingMark): string | null {
  if (mark.kind === 'bookmark') return null
  const anchor = mark.anchor
  if (anchor.format === 'epub') return anchor.cfiRange ?? anchor.cfi ?? null
  if (anchor.format === 'mobi') return anchor.cfiRange ?? anchor.cfi ?? null
  return null
}

/** overlay 命中 key 反查 mark；无匹配返回 undefined（调用方判定 miss，不抛错）。 */
export function findMarkByOverlayerKey(
  marks: ReadingMark[],
  key: string,
): ReadingMark | undefined {
  return marks.find((mark) => overlayerKeyForMark(mark) === key)
}

export interface LocatedExcerpt {
  doc: Document
  range: Range
}

/**
 * 在多个文档中按序定位摘录（EPUB foliate 多节文档 / 单文档传入单元素数组即可）。
 * 纯定位不滚动；滚动与选区由调用方在其窗口上下文完成。空白文本直接返回 null。
 */
export function locateExcerptInDocuments(
  docs: Array<{ doc: Document }>,
  text: string,
): LocatedExcerpt | null {
  const query = text.trim()
  if (!query) return null
  for (const { doc } of docs) {
    try {
      const body = doc.body
      if (!body) continue
      const range = findTextRangeInRoot(body, query)
      if (range) return { doc, range }
    } catch {
      // 单文档失败不影响其余文档
    }
  }
  return null
}

/**
 * 把元素内摘录滚入视口中央，返回命中 Range（供调用方设置选区）。
 * happy-dom 等无 scrollIntoView 实现的环境下跳过滚动但仍返回 Range。
 */
export function scrollElementTextIntoView(el: HTMLElement, text: string): Range | null {
  const query = text.trim()
  if (!query) return null
  let range: Range | null = null
  try {
    range = findTextRangeInRoot(el, query)
  } catch {
    return null
  }
  if (!range) return null
  try {
    const host =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement
    host?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  } catch {
    // 滚动失败不否定定位结果
  }
  return range
}

/**
 * 跨面板 reveal 请求通道：悬浮窗卡片（应用级，不在 viewer 树内）点卡即 emit，
 * 各 viewer 订阅后在自家 marks 中找 mark 并走自家适配器执行。
 * 与 rail-follow / rail-focus 同族（window 事件，不经过 React state）。
 */
export const REVEAL_MARK_EVENT = 'montree:reveal-mark'

export function emitRevealMark(markId: string): void {
  if (typeof window === 'undefined' || !markId) return
  window.dispatchEvent(new CustomEvent<string>(REVEAL_MARK_EVENT, { detail: markId }))
}

export function subscribeRevealMark(handler: (markId: string) => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  const onReveal = (e: Event) => {
    const id = (e as CustomEvent<string>).detail
    if (typeof id === 'string' && id) handler(id)
  }
  window.addEventListener(REVEAL_MARK_EVENT, onReveal)
  return () => window.removeEventListener(REVEAL_MARK_EVENT, onReveal)
}

/**
 * 跨面板 anchor 高亮请求通道：Agent 卡片/探针点定位即 emit，
 * 各 Viewer（Foliate / Pdf / WebDoc）订阅后按摘录文本平滑居中滚动并设置选区高亮。
 */
export const ANCHOR_HIGHLIGHT_EVENT = 'montree:anchor-highlight'

export function emitAnchorHighlight(excerpt: string): void {
  if (typeof window === 'undefined' || !excerpt) return
  window.dispatchEvent(new CustomEvent<string>(ANCHOR_HIGHLIGHT_EVENT, { detail: excerpt }))
}

export function subscribeAnchorHighlight(handler: (excerpt: string) => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  const onHighlight = (e: Event) => {
    const text = (e as CustomEvent<string>).detail
    if (typeof text === 'string' && text.trim()) handler(text.trim())
  }
  window.addEventListener(ANCHOR_HIGHLIGHT_EVENT, onHighlight)
  return () => window.removeEventListener(ANCHOR_HIGHLIGHT_EVENT, onHighlight)
}

/**
 * 跨面板 TTS 语音朗读临时高亮通道：
 * 播放器切句时 emit 正在朗读的句子，各 Viewer 订阅后在正文中做临时高亮与居中滚动。
 * 暂停、切章或关闭播放器时 emit 清除事件，临时高亮立即撤除，不污染任何真实标注。
 * （注意：当前正文高亮已主动暂停广播以保持正文沉浸纯净，事件通道与 Viewer 接收逻辑完整保留作为技术储备）
 */
export const TTS_HIGHLIGHT_EVENT = 'montree:tts-highlight'
export const TTS_CLEAR_HIGHLIGHT_EVENT = 'montree:tts-clear-highlight'

export interface TtsHighlightDetail {
  sentence: string
  forceScroll?: boolean
}

export function emitTtsHighlight(sentence: string, forceScroll = false): void {
  if (typeof window === 'undefined' || !sentence || typeof window.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') return
  window.dispatchEvent(new CustomEvent<TtsHighlightDetail>(TTS_HIGHLIGHT_EVENT, {
    detail: { sentence, forceScroll },
  }))
}

export function emitTtsClearHighlight(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') return
  window.dispatchEvent(new CustomEvent(TTS_CLEAR_HIGHLIGHT_EVENT))
}

export function subscribeTtsHighlight(
  onHighlight: (sentence: string, forceScroll?: boolean) => void,
  onClear?: () => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined
  const handleHighlight = (e: Event) => {
    const raw = (e as CustomEvent).detail
    if (typeof raw === 'string' && raw.trim()) {
      onHighlight(raw.trim(), false)
    } else if (raw && typeof raw === 'object' && typeof raw.sentence === 'string' && raw.sentence.trim()) {
      onHighlight(raw.sentence.trim(), Boolean(raw.forceScroll))
    }
  }
  const handleClear = () => {
    onClear?.()
  }
  window.addEventListener(TTS_HIGHLIGHT_EVENT, handleHighlight)
  window.addEventListener(TTS_CLEAR_HIGHLIGHT_EVENT, handleClear)
  return () => {
    window.removeEventListener(TTS_HIGHLIGHT_EVENT, handleHighlight)
    window.removeEventListener(TTS_CLEAR_HIGHLIGHT_EVENT, handleClear)
  }
}
