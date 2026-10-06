import { describe, expect, it } from 'vitest'
import {
  DEFAULT_READER_TYPOGRAPHY,
  READER_FONT_SIZE_OPTIONS,
  READER_LINE_HEIGHT_OPTIONS,
} from '@montree/reader-core'
import { buildReaderLayoutCss, getEpubThemeRules } from './epub-themes'

describe('reader typography defaults', () => {
  it('默认值属于用户可选范围', () => {
    expect(READER_FONT_SIZE_OPTIONS).toContain(DEFAULT_READER_TYPOGRAPHY.fontSize)
    expect(READER_LINE_HEIGHT_OPTIONS).toContain(DEFAULT_READER_TYPOGRAPHY.lineHeight)
  })

  it('将字号与行距写入 EPUB / MOBI 共用布局 CSS', () => {
    const typography = { fontSize: 24 as const, lineHeight: 2.05 as const }

    expect(getEpubThemeRules('dark', typography).body).toMatchObject({
      'font-size': '24px',
      'line-height': '2.05',
    })
    expect(buildReaderLayoutCss('dark', typography)).toContain('font-size: 24px !important')
    expect(buildReaderLayoutCss('dark', typography)).toContain('line-height: 2.05 !important')
  })

  it('主题 !important 规则豁免 M2 页边旗标（否则 fixed 定位被压成 static 全宽条）', () => {
    const typography = { fontSize: 18 as const, lineHeight: 1.85 as const }
    const css = buildReaderLayoutCss('dark', typography)
    expect(css).toContain(':not([data-montree-flag])')
  })
})
