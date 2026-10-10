import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { MarkdownContent } from './MarkdownContent'
import { useMarkdownPreview } from '@/hooks/editor/useMarkdownPreview'
import { useCodeBlockCopy } from '@/hooks/preview/useCodeBlockCopy'
import { useHighlightTheme } from '@/hooks/preview/useHighlightTheme'
import { useEditorUiStore } from '@/stores/editor-ui-store'
import type { PreviewRenderEnv } from '@/lib/preview/render-preview'
import '@/styles/markdown-preview.css'

interface LivePreviewBlockProps {
  source: string
  filePath?: string
  env?: PreviewRenderEnv
  editLabel?: string
  renderedHtml?: string
  onFootnoteJump?: (id: string) => void
  onEdit: () => void
  onCell: (row: number, column: number) => void
}

/** A thin adapter: reading preview supplies the parser, sanitizer and media components. */
export function LivePreviewBlock({ source, filePath, env, renderedHtml, onFootnoteJump, editLabel = '编辑源码', onEdit, onCell }: LivePreviewBlockProps) {
  const theme = useEditorUiStore((state) => state.theme)
  const html = useMarkdownPreview(source, filePath, 0, env, renderedHtml)
  const container = useRef<HTMLDivElement>(null)
  useCodeBlockCopy(container, html)
  useHighlightTheme(theme)

  return (
    <div className="cm-live-block-content" ref={container}>
      <div className="cm-live-block-actions">
        <Button size="xs" variant="ghost" onClick={onEdit}>{editLabel}</Button>
      </div>
      <div onClick={(event) => {
        const target = event.target
        if (!(target instanceof Element)) return
        const anchor = target.closest<HTMLAnchorElement>('.footnote-ref a, a.footnote-backref')
        const href = anchor?.getAttribute('href')
        if (!href?.startsWith('#') || !onFootnoteJump) return
        event.preventDefault()
        onFootnoteJump(href.slice(1))
      }} onDoubleClick={(event) => {
        const target = event.target
        if (!(target instanceof Element)) return
        if (target.closest('button, a, summary, input')) return
        const cell = target.closest<HTMLTableCellElement>('td, th')
        if (cell) {
          const row = cell.closest('tr')!
          const table = cell.closest('table')!
          onCell(Array.from(table.rows).indexOf(row), cell.cellIndex)
        } else onEdit()
      }}>
        {html ? <MarkdownContent html={html} /> : <div className="cm-live-block-loading">正在预览…</div>}
      </div>
    </div>
  )
}
