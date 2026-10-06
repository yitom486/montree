import type { DetectPdfTocPagesResult } from '@montree/contracts'

/**
 * 目录探测反馈的轻量状态模型（纯函数，PdfViewer 只做薄 dispatch）。
 *
 * 语义（临时 UI 状态，永不写缓存）：
 * - found：不驻留（toast 一句即可，见 resolveDetectApply 落子逻辑）；
 * - ambiguous：驻留候选页段（只留范围，不留评分/原文），点选即填范围；
 * - not-found：驻留短提示（扫描页数 + 手填引导）。
 * 清除：新探测开始、切文件、用户手改任一页码输入（过期候选不得继续展示）。
 * 选择候选只是填数字：不调 recognize/save/detect IPC；busy 或编辑器草稿
 * 未决时拒绝并给出原因（调用方弹 toast）。
 */

/** 剥掉评分后的候选页段（UI 只允许看到范围） */
export interface TocDetectRange {
  fromPage: number
  toPage: number
}

export type TocDetectFeedback =
  | { kind: 'found'; fromPage: number; toPage: number }
  | { kind: 'ambiguous'; candidates: TocDetectRange[]; pagesScanned: number }
  | { kind: 'not-found'; pagesScanned: number }

function isValidRange(value: unknown): value is TocDetectRange {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    Number.isInteger(record.fromPage) &&
    Number.isInteger(record.toPage) &&
    (record.fromPage as number) >= 1 &&
    (record.toPage as number) >= (record.fromPage as number)
  )
}

/** 探测结果 → 反馈（found 也返回，调用方按“不驻留”只取 toast，不进 state） */
export function feedbackForDetection(
  result: DetectPdfTocPagesResult,
): TocDetectFeedback | null {
  if (!result || typeof result !== 'object') return null
  if (result.outcome === 'found') {
    const range = { fromPage: result.fromPage, toPage: result.toPage }
    if (!isValidRange(range)) return null
    return { kind: 'found', fromPage: range.fromPage, toPage: range.toPage }
  }
  if (result.outcome === 'ambiguous') {
    const candidates = (Array.isArray(result.candidates) ? result.candidates : [])
      .filter(isValidRange)
      .slice(0, 3)
      .map(({ fromPage, toPage }) => ({ fromPage, toPage }))
    if (candidates.length === 0) return null
    return {
      kind: 'ambiguous',
      candidates,
      pagesScanned:
        Number.isInteger(result.pagesScanned) && (result.pagesScanned as number) > 0
          ? (result.pagesScanned as number)
          : 0,
    }
  }
  if (result.outcome === 'not-found') {
    return {
      kind: 'not-found',
      pagesScanned:
        Number.isInteger(result.pagesScanned) && (result.pagesScanned as number) > 0
          ? (result.pagesScanned as number)
          : 0,
    }
  }
  return null
}

export type TocDetectFeedbackEvent =
  | { type: 'detect-started' }
  | { type: 'detect-finished'; result: DetectPdfTocPagesResult }
  | { type: 'file-switched' }
  | { type: 'range-edited' }

/**
 * 反馈状态归约：新探测开始、切文件、手改输入一律清旧反馈；
 * 只有 ambiguous/not-found 驻留（found 靠 toast，不驻留，避免多余状态）。
 */
export function reduceDetectFeedback(
  _state: TocDetectFeedback | null,
  event: TocDetectFeedbackEvent,
): TocDetectFeedback | null {
  void _state
  switch (event.type) {
    case 'detect-started':
    case 'file-switched':
    case 'range-edited':
      return null
    case 'detect-finished': {
      const feedback = feedbackForDetection(event.result)
      return feedback && feedback.kind !== 'found' ? feedback : null
    }
  }
}

export type DetectSelectOutcome =
  | { action: 'fill'; fromPage: number; toPage: number }
  | { action: 'blocked'; reason: 'busy' | 'draft' }

/**
 * 候选选择裁决（纯函数）：只返回填数动作或拒绝原因，自身不触碰
 * recognize/save/detect（调用方只做 setTocPageFrom/To）。
 */
export function selectDetectCandidate(
  feedback: TocDetectFeedback | null,
  index: number,
  options: { busy: boolean; hasDraft: boolean },
): DetectSelectOutcome | null {
  if (!feedback || feedback.kind !== 'ambiguous') return null
  if (options.busy) return { action: 'blocked', reason: 'busy' }
  if (options.hasDraft) return { action: 'blocked', reason: 'draft' }
  const candidate = feedback.candidates[index]
  if (!candidate || !isValidRange(candidate)) return null
  return { action: 'fill', fromPage: candidate.fromPage, toPage: candidate.toPage }
}
