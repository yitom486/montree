import type MarkdownIt from 'markdown-it'

/** Data declarations only; JSON is validated again by the mounted component. */
export const MARKDOWN_ARTIFACT_MAX_BYTES = 64 * 1024
export const MARKDOWN_ARTIFACT_KINDS = ['montree-diagram', 'montree-ui'] as const

export function markdownArtifactPlaceholder(parser: InstanceType<typeof MarkdownIt>, kind: string, source: string, fallback = ''): string {
  if (new TextEncoder().encode(source).length > MARKDOWN_ARTIFACT_MAX_BYTES) return `<p>交互组件声明超过 64KiB，已跳过。</p>${fallback}`
  return `<div data-montree-artifact="${kind}" data-montree-spec="${parser.utils.escapeHtml(source)}">${fallback}</div>`
}

/** A normal image followed by hidden metadata remains readable elsewhere. */
export function markdownItArtifacts(parser: InstanceType<typeof MarkdownIt>): void {
  parser.core.ruler.after('inline', 'montree_artifacts', (state) => {
    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i]
      if (token.type !== 'html_block') continue
      const match = /^<!--\s*(montree-diagram|montree-ui)\s*\n([\s\S]*?)\n-->\s*$/.exec(token.content)
      if (!match) continue
      let fallback = ''
      const previous = state.tokens.slice(Math.max(0, i - 3), i)
      if (previous.length === 3 && previous[0].type === 'paragraph_open' && previous[1].type === 'inline' && previous[1].children?.length === 1 && previous[1].children[0].type === 'image' && previous[2].type === 'paragraph_close' && previous[0].level === token.level) {
        fallback = parser.renderer.render(previous, parser.options, state.env)
        if (token.map && previous[0].map) token.map[0] = previous[0].map[0]
        state.tokens.splice(i - 3, 3)
        i -= 3
      }
      token.type = 'montree_artifact'
      token.meta = { kind: match[1], source: match[2], fallback }
    }
  })
  parser.renderer.rules.montree_artifact = (tokens, index) => {
    const { kind, source, fallback } = tokens[index].meta as { kind: string; source: string; fallback: string }
    return markdownArtifactPlaceholder(parser, kind, source, fallback)
  }
}
