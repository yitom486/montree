import MarkdownIt from 'markdown-it'
import markdownItKatexImport from '@vscode/markdown-it-katex'
import markdownItTaskLists from 'markdown-it-task-lists'
import markdownItFootnote from 'markdown-it-footnote'
// @ts-expect-error cjs import
import markdownItSub from 'markdown-it-sub'
// @ts-expect-error cjs import
import markdownItSup from 'markdown-it-sup'
// @ts-expect-error cjs import
import markdownItMark from 'markdown-it-mark'

import { highlightCode } from '@/lib/editor/code-highlight'
import { wrapHighlightedCodeBlock } from '@/lib/editor/code-block-lines'
import { normalizeLatexDelimiters } from '@/lib/editor/latex-delimiters'
import { slugifyHeading } from '@/lib/editor/markdown-headings'
import { buildCodeBlockCopyButtonHtml, escapeCodeBlockLangLabel } from '@/lib/preview/code-block-chrome'

import { markdownItWikilinks } from '@/lib/editor/markdown-it-wikilinks'
import { markdownItPageMarker } from '@/lib/editor/markdown-it-page-marker'
import { markdownItAlerts } from '@/lib/editor/markdown-it-alerts'

// CJS 包在 Vite ESM 下可能导出为 { default: fn }，需兼容处理
function resolvePlugin(imported: unknown) {
  if (typeof imported === 'function') return imported
  if (imported && typeof imported === 'object' && 'default' in imported && typeof (imported as { default: unknown }).default === 'function') {
    return (imported as { default: unknown }).default
  }
  return imported
}

const markdownItKatex = resolvePlugin(markdownItKatexImport) as any
const pluginFootnote = resolvePlugin(markdownItFootnote) as any
const pluginSub = resolvePlugin(markdownItSub) as any
const pluginSup = resolvePlugin(markdownItSup) as any
const pluginMark = resolvePlugin(markdownItMark) as any

function footnotesWithSourceMaps(parser: InstanceType<typeof MarkdownIt>): void {
  const previousRules = new Set(parser.block.ruler.getRules(''))
  const previousInlineRules = new Set(parser.inline.ruler.getRules(''))
  parser.use(pluginFootnote)
  const inlineNoteRule = parser.inline.ruler.getRules('').find((rule) => !previousInlineRules.has(rule))!
  // ^[note] must win over ^superscript^ when both community plugins are enabled.
  parser.inline.ruler.before('sup', 'footnote_inline_priority', inlineNoteRule)
  parser.inline.ruler.disable(['footnote_inline'])
  const renderOpen = parser.renderer.rules.footnote_open!
  parser.renderer.rules.footnote_open = (tokens, index, options, env, renderer) =>
    renderOpen(tokens, index, options, env, renderer).replace('<li ', `<li value="${Number(tokens[index].meta?.id) + 1}" `)
  const definitionRule = parser.block.ruler.getRules('').find((rule) => !previousRules.has(rule))!
  // The community plugin owns the grammar; capture its consumed lines for editing only.
  parser.block.ruler.at('footnote_def', (state, start, end, silent) => {
    const index = state.tokens.length
    const matched = definitionRule(state, start, end, silent)
    if (matched && !silent) state.tokens[index].map = [start, state.line]
    return matched
  }, { alt: ['paragraph', 'reference'] })
  parser.core.ruler.before('footnote_tail', 'footnote_source_maps', (state) => {
    state.env.footnoteDefinitions = state.tokens
      .filter((token) => token.type === 'footnote_reference_open' && token.map)
      .map((token) => ({ label: token.meta?.label as string, map: token.map! }))
  })
}

/**
 * 边界兼容：处理形如 ![alt](data:image/svg+xml;utf8,<svg...> "title") 的裸 SVG 标签语法
 * CommonMark 规范禁止 URL 内含未转义尖括号，通过规范化转为标准带编码的 <img> 标签避免解析器截断
 */
export function normalizeRawSvgDataUriImages(source: string): string {
  return source.replace(
    /!\[([^\]]*)\]\((data:image\/svg\+xml;utf8,<svg[\s\S]*?<\/svg>)(?:\s+["']([^"']*)["'])?\)/gi,
    (_match, alt, rawUri, title) => {
      const prefix = 'data:image/svg+xml;utf8,'
      const svgContent = rawUri.slice(prefix.length)
      const encoded = `${prefix}${encodeURIComponent(svgContent)}`
      const titleAttr = title ? ` title="${title.replace(/"/g, '&quot;')}"` : ''
      const altAttr = alt ? ` alt="${alt.replace(/"/g, '&quot;')}"` : ' alt=""'
      return `<img src="${encoded}"${altAttr}${titleAttr} />`
    },
  )
}

function createConfiguredParser(options: { html: boolean }): InstanceType<typeof MarkdownIt> {
  const parser = new MarkdownIt({
    html: options.html,
    linkify: true,
    breaks: true,
  })
    .use(markdownItKatex, { throwOnError: false })
    .use(markdownItTaskLists, { enabled: true, label: true, labelAfter: true })
    .use(markdownItWikilinks)
    .use(markdownItPageMarker)
    .use(markdownItAlerts)
    .use(pluginSub)
    .use(pluginSup)
    .use(pluginMark)
    .use(footnotesWithSourceMaps)

  parser.renderer.rules.fence = (tokens, index, _options, _environment, _self) => {
    const token = tokens[index]
    const rawLang = token.info?.trim().split(/\s+/)[0]?.toLowerCase() ?? ''

    const isMermaid =
      rawLang === 'mermaid' ||
      rawLang === 'flowchart' ||
      rawLang === 'sequencediagram' ||
      rawLang === 'mindmap' ||
      rawLang === 'classdiagram' ||
      rawLang === 'statediagram' ||
      rawLang === 'erdiagram' ||
      (rawLang === 'graph' && /^\s*(?:TD|TB|BT|RL|LR)\b/i.test(token.content)) ||
      (!rawLang &&
        /^\s*(?:flowchart\s+(?:TD|TB|BT|RL|LR)|graph\s+(?:TD|TB|BT|RL|LR)|sequenceDiagram|mindmap|classDiagram|erDiagram|stateDiagram)\b/i.test(
          token.content,
        ))

    if (isMermaid) {
      let content = token.content.trim()
      if (!content && token.info.trim().length > rawLang.length) {
        content = token.info.trim().slice(rawLang.length).trim()
      }
      return `<pre class="mermaid">${parser.utils.escapeHtml(content)}</pre>`
    }

    const langLabel = rawLang || 'text'
    const highlighted = highlightCode(token.content, langLabel)
    const codeHtml = wrapHighlightedCodeBlock(token.content, highlighted, langLabel)

    return [
      '<div class="code-block">',
      '<div class="code-block-toolbar">',
      `<span class="code-block-lang">${escapeCodeBlockLangLabel(langLabel)}</span>`,
      buildCodeBlockCopyButtonHtml(),
      '</div>',
      codeHtml,
      '</div>',
    ].join('')
  }

  parser.renderer.rules.heading_open = (tokens, index, opts, env, self) => {
    const token = tokens[index]
    const inlineToken = tokens[index + 1]
    const text = inlineToken?.content ?? ''

    const slugEnv = env ?? {}
    if (!slugEnv.headingSlugCounts || !(slugEnv.headingSlugCounts instanceof Map)) {
      slugEnv.headingSlugCounts = new Map<string, number>()
    }

    const counts = slugEnv.headingSlugCounts as Map<string, number>
    const base = slugifyHeading(text)
    const count = counts.get(base) ?? 0
    counts.set(base, count + 1)
    const id = count === 0 ? base : `${base}-${count}`

    token.attrSet('id', id)
    return self.renderToken(tokens, index, opts)
  }

  return parser
}

/** 主文档与导出使用的 Markdown 渲染器（支持原生 HTML 块、details/summary 与全部插件） */
export const markdownParser = createConfiguredParser({ html: true })

/** 严格安全模式解析器（关闭裸 HTML，供聊天面板抵御 XSS 载荷注入） */
export const strictMarkdownParser = createConfiguredParser({ html: false })

export type MarkdownRenderEnv = {
  headingSlugCounts?: Map<string, number>
  footnoteDefinitions?: Array<{ label: string; map: [number, number] }>
}

export interface MarkdownRenderOptions {
  /** 是否开启严格安全模式（禁止裸 HTML 解析，聊天气泡专用） */
  strictSafe?: boolean
}

/** 预览 / Agent / 导出共用的 Markdown 渲染入口（含 LaTeX 与裸 SVG 定界符规范化）。 */
export function renderMarkdown(
  source: string,
  env?: MarkdownRenderEnv,
  options?: MarkdownRenderOptions,
): string {
  const normalized = normalizeLatexDelimiters(normalizeRawSvgDataUriImages(source))
  const parser = options?.strictSafe ? strictMarkdownParser : markdownParser
  return parser.render(normalized, env)
}
