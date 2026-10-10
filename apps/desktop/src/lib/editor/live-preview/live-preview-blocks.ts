import { Facet, StateEffect, StateField, type EditorState } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { Table, parser as markdownLezerParser } from '@lezer/markdown'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LivePreviewBlock } from '@/components/markdown/LivePreviewBlock'
import { Button } from '@/components/ui/button'
import { markdownParser } from '@/lib/editor/markdown'
import type { PreviewRenderEnv } from '@/lib/preview/render-preview'
type Token = ReturnType<typeof markdownParser.parse>[number]
type FootnoteMeta = { id: number; subId?: number; label?: string }
function footnoteMeta(token: Token): FootnoteMeta { return token.meta as FootnoteMeta }

export const livePreviewConfig = Facet.define<{ filePath?: string }, { filePath?: string }>({
  combine: (values) => values[0] ?? {},
})

export interface PreviewBlock {
  from: number; to: number; source: string; kind: string
  env?: PreviewRenderEnv; referenceKey?: string; renderedHtml?: string; footnoteTargets?: string[]
}
export const showBlockPreview = StateEffect.define<number>()

function blockEnd(tokens: Token[], index: number): number {
  let depth = tokens[index].nesting
  let end = index + 1
  while (depth > 0 && end < tokens.length) depth += tokens[end++].nesting
  return end
}

function footnoteRefs(tokens: Token[]): Token[] {
  return tokens.flatMap((token) => token.type === 'footnote_ref' ? [token] : footnoteRefs(token.children ?? []))
}

function footnoteId(token: Token, env: PreviewRenderEnv): string {
  return markdownParser.renderer.rules.footnote_anchor_name!([token], 0, markdownParser.options, env, markdownParser.renderer)
}

function referenceId(token: Token, env: PreviewRenderEnv): string {
  const subId = footnoteMeta(token).subId ?? 0
  return `fnref${footnoteId(token, env)}${subId > 0 ? `:${subId}` : ''}`
}

/** markdown-it's source maps determine block boundaries; never serialize rendered HTML back. */
export function parsePreviewBlocks(state: EditorState): PreviewBlock[] {
  const blocks: PreviewBlock[] = []
  const env: PreviewRenderEnv = {}
  const tokens = markdownParser.parse(state.doc.toString(), env)
  const referenceKey = JSON.stringify(env.references ?? {})
  const blockEnv: PreviewRenderEnv = { references: env.references }
  const notes = tokens.flatMap((token, index) => token.type === 'footnote_open' ? [tokens.slice(index, blockEnd(tokens, index))] : [])
  const noteHtml = (parts: Token[][]) => {
    if (!parts.length) return ''
    return markdownParser.renderer.render([
      tokens.find((token) => token.type === 'footnote_block_open')!,
      ...parts.flat(), tokens.find((token) => token.type === 'footnote_block_close')!,
    ], markdownParser.options, env)
  }
  const lastDefinitions = new Map(env.footnoteDefinitions?.map((definition) => [definition.label, definition]))
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token.level !== 0 || !token.map) continue
    const blockTokens = tokens.slice(index, blockEnd(tokens, index))
    const refs = footnoteRefs(blockTokens)
    let kind = token.type
    if (kind === 'paragraph_open') {
      const children = tokens[index + 1]?.children ?? []
      if (!refs.length && !children.some((child) => ['image', 'html_inline', 'math_inline', 'math_inline_double'].includes(child.type))) continue
      kind = 'rich-paragraph'
    } else if (!refs.length && !['table_open', 'fence', 'code_block', 'html_block', 'math_block'].includes(kind)) continue
    const [start, end] = token.map
    if (start >= state.doc.lines || end <= start) continue
    const from = state.doc.line(start + 1).from
    const to = state.doc.line(Math.min(end, state.doc.lines)).to
    if ((blocks.at(-1)?.to ?? -1) > from) continue
    const source = state.sliceDoc(from, to)
    // Comments should remain handled by inline syntax decorations.
    if (kind === 'html_block' && /^\s*<!--[\s\S]*-->\s*$/.test(source)) continue
    const attachedNotes = notes.filter((part) => {
      const note = part[0]
      const meta = footnoteMeta(note)
      if (!meta.label) return refs.some((ref) => footnoteMeta(ref).id === meta.id)
      const definition = lastDefinitions.get(meta.label)
      return definition && definition.map[0] >= start && definition.map[1] <= end
    })
    const renderedHtml = refs.length ? markdownParser.renderer.render(blockTokens, markdownParser.options, env) + noteHtml(attachedNotes) : undefined
    const footnoteTargets = refs.map((ref) => referenceId(ref, env))
    footnoteTargets.push(...attachedNotes.map((part) => `fn${footnoteId(part[0], env)}`))
    blocks.push({ from, to, source, kind, env: blockEnv, referenceKey, renderedHtml, footnoteTargets })
  }
  for (const definition of env.footnoteDefinitions ?? []) {
    const from = state.doc.line(definition.map[0] + 1).from
    const to = state.doc.line(Math.min(definition.map[1], state.doc.lines)).to
    if (blocks.some((block) => from < block.to && to > block.from)) continue
    const parts = lastDefinitions.get(definition.label) === definition ? notes.filter((part) => footnoteMeta(part[0]).label === definition.label) : []
    blocks.push({ from, to, source: state.sliceDoc(from, to), kind: 'footnote-definition', env: blockEnv,
      referenceKey, renderedHtml: noteHtml(parts), footnoteTargets: [
        ...parts.map((part) => `fn${footnoteId(part[0], env)}`), ...footnoteRefs(parts.flat()).map((ref) => referenceId(ref, env)),
      ] })
  }
  // Definitions have no rendered body, but retain an explicit route back to their source.
  for (const node of tableParser.parse(state.doc.toString()).topNode.getChildren('LinkReference')) {
    const from = state.doc.lineAt(node.from).from
    const to = state.doc.lineAt(node.to).to
    if (blocks.some((block) => from < block.to && to > block.from)) continue
    const source = state.sliceDoc(from, to)
    const definitionEnv: PreviewRenderEnv = {}
    markdownParser.parse(source, definitionEnv)
    if (!Object.keys(definitionEnv.references ?? {}).length) continue
    blocks.push({ from, to, source, kind: 'reference-definition', env: blockEnv, referenceKey })
  }
  return blocks.sort((a, b) => a.from - b.from)
}

const tableParser = markdownLezerParser.configure([Table])

/** Lezer provides exact cell offsets, including escaped pipes and inline code. */
export function tableCellRange(block: PreviewBlock, row: number, column: number): { from: number; to: number } | undefined {
  const tree = tableParser.parse(block.source)
  const table = tree.topNode.getChild('Table')
  const rows = table?.getChildren('TableHeader').concat(table.getChildren('TableRow')) ?? []
  const cell = rows[row]?.getChildren('TableCell')[column]
  return cell ? { from: block.from + cell.from, to: block.from + cell.to } : undefined
}

class PreviewBlockWidget extends WidgetType {
  private root?: Root
  private observer?: ResizeObserver
  private alive = true

  constructor(readonly block: PreviewBlock, readonly filePath: string | undefined) { super() }
  eq(other: PreviewBlockWidget): boolean {
    return this.block.from === other.block.from && this.block.to === other.block.to && this.block.source === other.block.source && this.block.referenceKey === other.block.referenceKey && this.block.renderedHtml === other.block.renderedHtml && this.filePath === other.filePath
  }
  toDOM(view: EditorView): HTMLElement {
    this.alive = true
    const dom = document.createElement('div')
    dom.className = 'cm-live-block markdown-preview'
    dom.dataset.previewKind = this.block.kind
    dom.contentEditable = 'false'
    const edit = (range = { from: this.block.from, to: this.block.from }) => {
      if (!this.alive) return
      view.dispatch({ selection: { anchor: range.from, head: range.to }, effects: EditorView.scrollIntoView(range.from, { y: 'nearest' }) })
      view.focus()
    }
    this.root = createRoot(dom)
    this.root.render(createElement(LivePreviewBlock, {
      source: this.block.source, filePath: this.filePath, env: this.block.env,
      renderedHtml: this.block.renderedHtml,
      editLabel: this.block.kind === 'reference-definition' ? '编辑引用定义' : this.block.kind === 'footnote-definition' ? '编辑脚注' : '编辑源码',
      onFootnoteJump: (id) => {
        const target = view.state.field(livePreviewBlocks).blocks.find((block) => block.footnoteTargets?.includes(id))
        if (!target) return
        view.dispatch({ effects: [showBlockPreview.of(target.from), EditorView.scrollIntoView(target.from, { y: 'center' })] })
      },
      onEdit: () => edit(),
      onCell: (row, column) => edit(tableCellRange(this.block, row, column)),
    }))
    this.observer = new ResizeObserver(() => { if (this.alive) view.requestMeasure() })
    this.observer.observe(dom)
    return dom
  }
  ignoreEvent(): boolean { return true }
  destroy(): void {
    this.alive = false
    this.observer?.disconnect()
    const root = this.root
    this.root = undefined
    // The owning React editor may itself be unmounting during this call.
    queueMicrotask(() => root?.unmount())
  }
}

class SourceToolbarWidget extends WidgetType {
  private root?: Root
  constructor(readonly from: number) { super() }
  eq(other: SourceToolbarWidget): boolean { return this.from === other.from }
  toDOM(view: EditorView): HTMLElement {
    const dom = document.createElement('div')
    dom.className = 'cm-live-block-actions cm-live-source-toolbar'
    dom.contentEditable = 'false'
    this.root = createRoot(dom)
    this.root.render(createElement(Button, {
      size: 'xs', variant: 'ghost', onClick: () => {
        view.dispatch({ effects: showBlockPreview.of(this.from) })
        view.contentDOM.blur()
      },
    }, '完成编辑并预览'))
    return dom
  }
  ignoreEvent(): boolean { return true }
  destroy(): void { const root = this.root; this.root = undefined; queueMicrotask(() => root?.unmount()) }
}

function decorations(state: EditorState, blocks: PreviewBlock[], previewAt?: number): DecorationSet {
  const config = state.facet(livePreviewConfig)
  return Decoration.set(blocks.flatMap((block) => {
    const active = state.selection.ranges.some((range) => range.from <= block.to && range.to >= block.from)
    if (active && block.from !== previewAt) {
      const lines = [Decoration.widget({ block: true, side: -1, widget: new SourceToolbarWidget(block.from) }).range(block.from)]
      for (let line = state.doc.lineAt(block.from).number; line <= state.doc.lineAt(block.to).number; line++) {
        lines.push(Decoration.line({ class: 'cm-live-source-block' }).range(state.doc.line(line).from))
      }
      return lines
    }
    return [Decoration.replace({ block: true, widget: new PreviewBlockWidget(block, config.filePath) }).range(block.from, block.to)]
  }), true)
}

/** Direct state decorations are required for replacements spanning line breaks (CM6 API). */
export const livePreviewBlocks = StateField.define<{ blocks: PreviewBlock[]; decorations: DecorationSet; previewAt?: number }>({
  create(state) {
    const blocks = parsePreviewBlocks(state)
    return { blocks, decorations: decorations(state, blocks) }
  },
  update(value, transaction) {
    const blocks = transaction.docChanged ? parsePreviewBlocks(transaction.state) : value.blocks
    let previewAt = transaction.docChanged || transaction.selection ? undefined : value.previewAt
    for (const effect of transaction.effects) if (effect.is(showBlockPreview)) previewAt = effect.value
    if (transaction.docChanged || transaction.selection || transaction.reconfigured || previewAt !== value.previewAt) return { blocks, decorations: decorations(transaction.state, blocks, previewAt), previewAt }
    return value
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
})
