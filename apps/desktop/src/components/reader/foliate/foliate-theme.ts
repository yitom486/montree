import { applyEpubReadingLayout, getEpubThemeRules, type ReaderTypography } from '@montree/reader-core'
import type { AppTheme } from '@/stores/editor-ui-store'

export const READING_PROGRESS_SAVE_MS = 400
export const FOLIATE_READER_STYLE_ID = 'foliate-reader-theme'
export const EPUB_MARK_FLAGS_PER_DOC_CAP = 40

export type FoliateTypography = ReaderTypography

/** epub.js themes 规则（selector→props）转可注入 CSS 文本 */
export function themeRulesToCss(rules: Record<string, Record<string, string>>): string {
  return Object.entries(rules)
    .map(([selector, props]) => {
      const body = Object.entries(props)
        .map(([prop, value]) => `${prop}:${value};`)
        .join('')
      return `${selector}{${body}}`
    })
    .join('\n')
}

/** 对 Foliate 渲染节文档注入主题排版与隐藏滚动条样式 */
export function applyDocTheme(doc: Document, theme: AppTheme, typography: FoliateTypography): void {
  try {
    applyEpubReadingLayout(doc, theme, typography)
    const css = themeRulesToCss(getEpubThemeRules(theme, typography))
    let style = doc.getElementById(FOLIATE_READER_STYLE_ID) as HTMLStyleElement | null
    if (!style) {
      style = doc.createElement('style')
      style.id = FOLIATE_READER_STYLE_ID
      doc.head.appendChild(style)
    }
    style.textContent = css
    // 正文 iframe 内部滚动条隐藏：单滚动条观感只留卡片轨右边那根，
    // 正文进度由卡片轨滚动条经等比跟随反映（滚正文时轨跟着走）。
    style.textContent +=
      '\nhtml,body{scrollbar-width:none;}\nhtml::-webkit-scrollbar,body::-webkit-scrollbar{width:0 !important;height:0 !important;display:none !important;}'
  } catch {
    // 章节文档不可写时忽略
  }
}
