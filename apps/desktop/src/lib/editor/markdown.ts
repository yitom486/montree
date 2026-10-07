import MarkdownIt from 'markdown-it'
import markdownItKatexImport from '@vscode/markdown-it-katex'
import markdownItTaskLists from 'markdown-it-task-lists'
import { highlightCode } from '@/lib/editor/code-highlight'
import { wrapHighlightedCodeBlock } from '@/lib/editor/code-block-lines'
import { normalizeLatexDelimiters } from '@/lib/editor/latex-delimiters'
import { slugifyHeading } from '@/lib/editor/markdown-headings'
import { buildCodeBlockCopyButtonHtml, escapeCodeBlockLangLabel } from '@/lib/preview/code-block-chrome'

import { markdownItWikilinks } from '@/lib/editor/markdown-it-wikilinks'
import { markdownItPageMarker } from '@/lib/editor/markdown-it-page-marker'

// CJS 包在 Vite ESM 下可能导出为 { default: fn }，需兼容处理
const markdownItKatex =
  typeof markdownItKatexImport === 'function'
    ? markdownItKatexImport
    : (markdownItKatexImport as { default: typeof markdownItKatexImport }).default

export const markdownParser = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})
  .use(markdownItKatex, { throwOnError: false })
  .use(markdownItTaskLists, { enabled: true, label: true, labelAfter: true })
  .use(markdownItWikilinks)
  .use(markdownItPageMarker)

export type MarkdownRenderEnv = { headingSlugCounts?: Map<string, number> }

/** 预览 / Agent / 导出共用的 Markdown 渲染入口（含 LaTeX 定界符规范化）。 */
export function renderMarkdown(source: string, env?: MarkdownRenderEnv): string {
  return markdownParser.render(normalizeLatexDelimiters(source), env)
}

markdownParser.renderer.rules.fence = (tokens, index, _options, _environment, _self) => {
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
    return `<pre class="mermaid">${markdownParser.utils.escapeHtml(content)}</pre>`
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

markdownParser.renderer.rules.heading_open = (tokens, index, options, env, self) => {
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
  return self.renderToken(tokens, index, options)
}
