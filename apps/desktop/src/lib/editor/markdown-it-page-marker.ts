import type { StateCore, Token } from 'markdown-it'
import type { MarkdownItInstance } from './markdown-it-wikilinks'

/** 独立成行的 OCR 页标记：`<!-- Page 19 -->`（Page 大小写与多余空格容忍） */
const PAGE_MARKER_PATTERN = /^<!--\s*[Pp][Aa][Gg][Ee]\s+(\d+)\s*-->$/

/** 整段文本是页标记时返回 1-indexed 页码，否则返回 null */
export function parsePageMarker(text: string): number | null {
  const match = PAGE_MARKER_PATTERN.exec(text.trim())
  if (!match) return null
  const page = Number.parseInt(match[1] ?? '', 10)
  return Number.isSafeInteger(page) && page > 0 ? page : null
}

/**
 * markdown-it 页标记插件：独立成行的 `<!-- Page N -->` 转成分页 chip，
 * 不再以转义文本裸奔。`data-page` 预留给后续“跳到扫描原图对应页”。
 * 围栏内与行内混排的标记一律不动（保守，避免误伤正文注释）。
 */
export function markdownItPageMarker(md: MarkdownItInstance): void {
  md.core.ruler.after('block', 'page_marker', (state) => {
    const tokens = state.tokens
    for (let index = 0; index < tokens.length; index += 1) {
      const current = tokens[index]
      if (current?.type === 'html_block') {
        const page = parsePageMarker(current.content)
        if (page !== null) tokens.splice(index, 1, makePageMarkerToken(state, page))
        continue
      }
      const inline = tokens[index + 1]
      const close = tokens[index + 2]
      if (
        current?.type !== 'paragraph_open' ||
        inline?.type !== 'inline' ||
        close?.type !== 'paragraph_close'
      ) {
        continue
      }
      const page = parsePageMarker(inline.content)
      if (page === null) continue
      tokens.splice(index, 3, makePageMarkerToken(state, page))
    }
    return false
  })

  md.renderer.rules.page_marker = (tokens: Token[], index: number) => {
    const token = tokens[index]
    const page = (token?.meta as { page?: unknown } | undefined)?.page
    if (typeof page !== 'number') return ''
    return `<div class="montree-page-marker" data-page="${page}"><span class="montree-page-marker-label">第 ${page} 页</span></div>`
  }
}

function makePageMarkerToken(state: StateCore, page: number): Token {
  const token = new state.Token('page_marker', 'div', 0)
  token.meta = { page }
  return token
}
