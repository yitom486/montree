import { describe, expect, it } from 'vitest'
import type { OcrTocCacheAssessment } from '@montree/ocr-core'
import {
  noticeForFreshRecognize,
  noticeForRestoredCache,
  placeOcrTocNotice,
} from './ocr-toc-notice'

function assessment(
  status: OcrTocCacheAssessment['status'],
  reasons: string[] = [],
): OcrTocCacheAssessment {
  return { status, reasons }
}

describe('ocr-toc-notice', () => {
  it('重开 suspect：有提示（不再依赖侧栏 outlineNotice）', () => {
    const notice = noticeForRestoredCache(assessment('suspect', ['自动识别结果未经人工确认（共 137 条）']))
    expect(notice?.kind).toBe('suspect')
    expect(notice?.message).toContain('137')
    expect(notice?.message).toContain('校正目录')
  })

  it('重开 legacy：有提示', () => {
    const notice = noticeForRestoredCache(assessment('legacy', ['旧版缓存缺少来源记录']))
    expect(notice?.kind).toBe('legacy')
    expect(notice?.message).toContain('旧版')
  })

  it('用户保存确认（usable）：提示清除', () => {
    expect(noticeForRestoredCache(assessment('usable', []))).toBeNull()
    expect(placeOcrTocNotice(null, 'ocr')).toEqual({ bannerExtra: null, statusBar: null })
  })

  it('invalid：原因可见（跟横幅，不进侧栏）', () => {
    const notice = noticeForRestoredCache(assessment('invalid', ['页码越界']))
    expect(notice?.kind).toBe('invalid')
    expect(notice?.message).toContain('页码越界')
    expect(notice?.message).toContain('重新识别')
  })

  it('自动识别当次：立即提示核对入口', () => {
    const notice = noticeForFreshRecognize(137)
    expect(notice.kind).toBe('fresh')
    expect(notice.message).toContain('137')
    expect(notice.message).toContain('校正目录')
  })

  it('落点裁决：suspect/legacy/fresh 走状态条（不打开侧栏也可见），invalid 走横幅', () => {
    const statusBar = placeOcrTocNotice(
      { kind: 'suspect', message: 'm' },
      'ocr',
    )
    expect(statusBar.statusBar?.kind).toBe('suspect')
    expect(statusBar.bannerExtra).toBeNull()

    const banner = placeOcrTocNotice({ kind: 'invalid', message: 'm' }, 'page-fallback')
    expect(banner.bannerExtra).toBe('m')
    expect(banner.statusBar).toBeNull()
  })
})
