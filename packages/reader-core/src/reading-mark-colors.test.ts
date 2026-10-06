import { describe, expect, it } from 'vitest'
import {
  DARK_UNIFORM_MARK_SWATCH,
  DEFAULT_HIGHLIGHT_COLOR,
  highlightFill,
  highlightSwatch,
  MARK_CATEGORY_SWATCH_FALLBACK,
  normalizeHighlightColor,
  resolveMarkCategorySwatch,
} from '@montree/reader-core'

describe('reading-mark-colors', () => {
  it('默认与未知值都回落到黄色', () => {
    expect(normalizeHighlightColor()).toBe(DEFAULT_HIGHLIGHT_COLOR)
    expect(normalizeHighlightColor('yellow')).toBe('yellow')
    expect(normalizeHighlightColor('#ff0')).toBe('yellow')
    expect(highlightSwatch()).toBe('#facc15')
  })

  it('暗色/亮色都使用半透明填充，避免盖住文字', () => {
    for (const theme of ['light', 'dark'] as const) {
      const fill = highlightFill('yellow', theme)
      expect(fill).toMatch(/^rgba\(/)
      const alpha = Number(fill.slice(fill.lastIndexOf(',') + 1, -1).trim())
      expect(alpha).toBeGreaterThan(0)
      expect(alpha).toBeLessThanOrEqual(0.4)
    }
  })

  it('分类色：主题变量优先、缺失回落字面值（EPUB/PDF 同口径）', () => {
    expect(resolveMarkCategorySwatch('concept')).toBe(MARK_CATEGORY_SWATCH_FALLBACK.concept)
    expect(resolveMarkCategorySwatch('unknown-cat')).toBe(MARK_CATEGORY_SWATCH_FALLBACK.quote)
    expect(resolveMarkCategorySwatch(undefined)).toBe(MARK_CATEGORY_SWATCH_FALLBACK.quote)
    expect(
      resolveMarkCategorySwatch('method', (name) =>
        name === '--card-method-text' ? '  #123456  ' : undefined,
      ),
    ).toBe('#123456')
    expect(resolveMarkCategorySwatch('method', () => undefined)).toBe(
      MARK_CATEGORY_SWATCH_FALLBACK.method,
    )
  })

  it('Q4 决议：深色主题统一荧光黄，不分分类', () => {
    expect(resolveMarkCategorySwatch('concept', undefined, 'dark')).toBe(DARK_UNIFORM_MARK_SWATCH)
    expect(resolveMarkCategorySwatch('method', undefined, 'dark')).toBe(DARK_UNIFORM_MARK_SWATCH)
    expect(resolveMarkCategorySwatch('concept', undefined, 'light')).toBe(
      MARK_CATEGORY_SWATCH_FALLBACK.concept,
    )
    expect(resolveMarkCategorySwatch('concept', undefined, 'sepia')).toBe(
      MARK_CATEGORY_SWATCH_FALLBACK.concept,
    )
  })
})
