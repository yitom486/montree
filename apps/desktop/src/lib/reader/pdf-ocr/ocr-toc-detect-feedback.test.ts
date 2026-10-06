import { describe, expect, it } from 'vitest'
import type { DetectPdfTocPagesResult } from '@montree/contracts'
import {
  feedbackForDetection,
  reduceDetectFeedback,
  selectDetectCandidate,
} from './ocr-toc-detect-feedback'

function ambiguousResult(): DetectPdfTocPagesResult {
  return {
    outcome: 'ambiguous',
    candidates: [
      { fromPage: 8, toPage: 12, score: 256 },
      { fromPage: 30, toPage: 32, score: 200 },
      { fromPage: 50, toPage: 51, score: 100 },
      { fromPage: 60, toPage: 61, score: 90 },
    ],
    pagesScanned: 40,
    ocrPages: 12,
  }
}

describe('feedbackForDetection', () => {
  it('ambiguous 只留范围（不留评分），最多 3 个', () => {
    const feedback = feedbackForDetection(ambiguousResult())
    expect(feedback).toEqual({
      kind: 'ambiguous',
      candidates: [
        { fromPage: 8, toPage: 12 },
        { fromPage: 30, toPage: 32 },
        { fromPage: 50, toPage: 51 },
      ],
      pagesScanned: 40,
    })
    for (const candidate of (feedback as { candidates: unknown[] }).candidates) {
      expect(candidate).not.toHaveProperty('score')
    }
  })

  it('found 带合法范围才返回', () => {
    expect(
      feedbackForDetection({
        outcome: 'found',
        fromPage: 8,
        toPage: 12,
        candidates: [],
        pagesScanned: 40,
        ocrPages: 5,
      }),
    ).toEqual({ kind: 'found', fromPage: 8, toPage: 12 })
    expect(
      feedbackForDetection({ outcome: 'found', candidates: [], pagesScanned: 40, ocrPages: 1 }),
    ).toBeNull()
  })

  it('not-found 带扫描页数', () => {
    expect(
      feedbackForDetection({ outcome: 'not-found', candidates: [], pagesScanned: 40, ocrPages: 40 }),
    ).toEqual({ kind: 'not-found', pagesScanned: 40 })
  })

  it('非法输入一律 null（不抛异常）', () => {
    expect(feedbackForDetection(null as never)).toBeNull()
    expect(feedbackForDetection({ outcome: 'weird' } as never)).toBeNull()
    expect(
      feedbackForDetection({
        outcome: 'ambiguous',
        candidates: [{ fromPage: 0, toPage: -1, score: 1 }],
        pagesScanned: 40,
        ocrPages: 0,
      }),
    ).toBeNull()
  })
})

describe('reduceDetectFeedback 清除语义', () => {
  const kept = feedbackForDetection(ambiguousResult())

  it('新探测开始、切文件、手改输入都清除旧反馈', () => {
    expect(reduceDetectFeedback(kept, { type: 'detect-started' })).toBeNull()
    expect(reduceDetectFeedback(kept, { type: 'file-switched' })).toBeNull()
    expect(reduceDetectFeedback(kept, { type: 'range-edited' })).toBeNull()
  })

  it('ambiguous/not-found 驻留，found 不驻留', () => {
    expect(
      reduceDetectFeedback(null, { type: 'detect-finished', result: ambiguousResult() }),
    ).toEqual(kept)
    expect(
      reduceDetectFeedback(null, {
        type: 'detect-finished',
        result: { outcome: 'not-found', candidates: [], pagesScanned: 40, ocrPages: 40 },
      }),
    ).toEqual({ kind: 'not-found', pagesScanned: 40 })
    expect(
      reduceDetectFeedback(kept, {
        type: 'detect-finished',
        result: { outcome: 'found', fromPage: 8, toPage: 12, candidates: [], pagesScanned: 40, ocrPages: 5 },
      }),
    ).toBeNull()
  })
})

describe('selectDetectCandidate', () => {
  const feedback = feedbackForDetection(ambiguousResult())

  it('正常选择只返回填数动作（无识别/保存语义）', () => {
    expect(selectDetectCandidate(feedback, 1, { busy: false, hasDraft: false })).toEqual({
      action: 'fill',
      fromPage: 30,
      toPage: 32,
    })
  })

  it('越界下标与非 ambiguous 反馈返回 null', () => {
    expect(selectDetectCandidate(feedback, 9, { busy: false, hasDraft: false })).toBeNull()
    expect(selectDetectCandidate(null, 0, { busy: false, hasDraft: false })).toBeNull()
    expect(
      selectDetectCandidate({ kind: 'not-found', pagesScanned: 40 }, 0, {
        busy: false,
        hasDraft: false,
      }),
    ).toBeNull()
  })

  it('busy 与草稿未决时拒绝并说明原因（busy 优先）', () => {
    expect(selectDetectCandidate(feedback, 0, { busy: true, hasDraft: false })).toEqual({
      action: 'blocked',
      reason: 'busy',
    })
    expect(selectDetectCandidate(feedback, 0, { busy: false, hasDraft: true })).toEqual({
      action: 'blocked',
      reason: 'draft',
    })
    expect(selectDetectCandidate(feedback, 0, { busy: true, hasDraft: true })).toEqual({
      action: 'blocked',
      reason: 'busy',
    })
  })
})
