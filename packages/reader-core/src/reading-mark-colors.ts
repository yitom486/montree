export const HIGHLIGHT_COLORS = [
  {
    id: 'yellow',
    label: '黄',
    swatch: '#facc15',
    light: 'rgba(250, 204, 21, 0.38)',
    dark: 'rgba(253, 224, 71, 0.26)',
  },
  {
    id: 'green',
    label: '绿',
    swatch: '#4ade80',
    light: 'rgba(74, 222, 128, 0.34)',
    dark: 'rgba(74, 222, 128, 0.24)',
  },
  {
    id: 'blue',
    label: '蓝',
    swatch: '#60a5fa',
    light: 'rgba(96, 165, 250, 0.32)',
    dark: 'rgba(147, 197, 253, 0.24)',
  },
  {
    id: 'pink',
    label: '粉',
    swatch: '#f472b6',
    light: 'rgba(244, 114, 182, 0.32)',
    dark: 'rgba(244, 114, 182, 0.24)',
  },
  {
    id: 'orange',
    label: '橙',
    swatch: '#fb923c',
    light: 'rgba(251, 146, 60, 0.34)',
    dark: 'rgba(253, 186, 116, 0.24)',
  },
  {
    id: 'purple',
    label: '紫',
    swatch: '#c084fc',
    light: 'rgba(192, 132, 252, 0.32)',
    dark: 'rgba(216, 180, 254, 0.24)',
  },
] as const

export type HighlightColorId = (typeof HIGHLIGHT_COLORS)[number]['id']

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColorId = 'yellow'

/** 划选时的系统选区底色：半透明黄，不改文字色 */
export const LIVE_SELECTION_BACKGROUND = 'rgba(250, 204, 21, 0.32)'

const COLOR_IDS = new Set<string>(HIGHLIGHT_COLORS.map((item) => item.id))

export function isHighlightColorId(value: string | undefined): value is HighlightColorId {
  return Boolean(value && COLOR_IDS.has(value))
}

export function normalizeHighlightColor(color?: string): HighlightColorId {
  return isHighlightColorId(color) ? color : DEFAULT_HIGHLIGHT_COLOR
}

export function highlightSwatch(color?: string): string {
  const id = normalizeHighlightColor(color)
  return HIGHLIGHT_COLORS.find((item) => item.id === id)!.swatch
}

export function highlightFill(color: string | undefined, theme: 'dark' | 'light' | 'sepia'): string {
  const id = normalizeHighlightColor(color)
  const entry = HIGHLIGHT_COLORS.find((item) => item.id === id)!
  return theme === 'dark' ? entry.dark : entry.light
}

export function applyHighlightSurface(
  element: HTMLElement,
  color: string | undefined,
  theme: 'dark' | 'light' | 'sepia',
): void {
  const id = normalizeHighlightColor(color)
  element.dataset.color = id
  element.style.setProperty('background', highlightFill(id, theme), 'important')
}

export function liveSelectionCss(): string {
  return `
    ::selection {
      background-color: ${LIVE_SELECTION_BACKGROUND} !important;
      color: inherit !important;
    }
    ::-moz-selection {
      background-color: ${LIVE_SELECTION_BACKGROUND} !important;
      color: inherit !important;
    }
  `
}

/**
 * 卡片分类色（M2 页边旗标 / M1 行内标记共用口径）。
 * 运行时优先读主题 CSS 变量 `--card-<category>-text`，取不到时回落字面值，
 * 保证 EPUB（iframe 内）与 PDF（主文档）两端颜色同源。
 */
export const MARK_CATEGORY_SWATCH_FALLBACK: Record<string, string> = {
  concept: '#7c6aed',
  quote: '#b07d2b',
  method: '#2f9e6e',
  diagram: '#8a6bbf',
  question: '#c2703d',
}

/** 深色主题标记统一色（荧光黄，深底对比；Q4 决议） */
export const DARK_UNIFORM_MARK_SWATCH = '#fde047'

export function resolveMarkCategorySwatch(
  category: string | undefined,
  getVar?: (name: string) => string | undefined,
  theme?: string,
): string {
  // Q4 决议：深色主题标记统一荧光黄（分类色在深底对比不足），light/sepia 沿用分类色
  if (theme === 'dark') return DARK_UNIFORM_MARK_SWATCH
  const key = (category ?? '').trim() || 'quote'
  const fallback = MARK_CATEGORY_SWATCH_FALLBACK[key] ?? MARK_CATEGORY_SWATCH_FALLBACK.quote!
  if (!getVar) return fallback
  try {
    return getVar(`--card-${key}-text`)?.trim() || fallback
  } catch {
    return fallback
  }
}
