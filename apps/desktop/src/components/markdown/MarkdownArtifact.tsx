import { useMemo, useState } from 'react'
import { collectEvidenceRefs, validateComponentUiSpec, type ComponentUiSpec, type PresentComponentUi } from '@montree/contracts'
import { buildDiagramHtml } from '@/lib/agent/context/present-diagram'
import { HtmlArtifactCard } from '@/components/agent/tools/HtmlArtifactCard'
import { ComponentUiCard } from '@/components/agent/generative/ComponentUiCard'
import { Button } from '@/components/ui/button'

/** Documents have local interactions, never a hidden ACP session or automatic host actions. */
export function MarkdownArtifact({ kind, source, fallback = '' }: { kind: string; source: string; fallback?: string }) {
  const [selection, setSelection] = useState({ source: '', text: '' })
  const prepared = useMemo(() => {
    try {
      if (new TextEncoder().encode(source).length > 64 * 1024) throw new Error('声明超过 64KiB')
      const data = JSON.parse(source) as Record<string, unknown>
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('声明须为 JSON 对象')
      if (data.schemaVersion !== 1) throw new Error('需要 schemaVersion: 1')
      if (typeof data.title !== 'string' || !data.title.trim() || data.title.length > 200) throw new Error('title 须为 1–200 字文本')
      if (kind === 'montree-diagram') {
        const allowed = ['schemaVersion', 'title', 'diagramType', 'nodes', 'edges', 'lanes']
        if (Object.keys(data).some((key) => !allowed.includes(key))) throw new Error('图解包含未支持的属性')
        return { title: data.title, html: buildDiagramHtml(data) }
      }
      if (kind !== 'montree-ui') throw new Error('不支持此组件类型')
      if (Object.keys(data).some((key) => !['schemaVersion', 'title', 'ui'].includes(key))) throw new Error('组件包含未支持的属性')
      const error = validateComponentUiSpec(data.ui)
      if (error) throw new Error(error)
      const ui = data.ui as ComponentUiSpec
      if (collectEvidenceRefs(ui.root).length) throw new Error('文档组件暂不支持 Evidence 或 locate；请用普通 Markdown 链接')
      return { title: data.title, ui }
    } catch (error) { return { error: error instanceof Error ? error.message : '声明无法解析' } }
  }, [kind, source])
  if ('error' in prepared) return <div><p role="alert" className="rounded border border-destructive/40 p-3 text-sm">文档组件无法显示：{prepared.error}。可切回源码修正。</p><div dangerouslySetInnerHTML={{ __html: fallback }} /></div>
  if ('html' in prepared) return <div>
    <HtmlArtifactCard result={{ schemaVersion: 1, kind: 'html-artifact', id: 'document-diagram', title: prepared.title, html: prepared.html!, inline: true }} />
    <Button size="sm" variant="outline" className="mt-2" onClick={() => {
      const doc = new DOMParser().parseFromString(prepared.html!, 'text/html')
      const svg = doc.querySelector('svg')!
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      const [, , width, height] = svg.getAttribute('viewBox')!.split(/\s+/)
      svg.setAttribute('width', width)
      svg.setAttribute('height', height)
      const style = doc.createElementNS('http://www.w3.org/2000/svg', 'style')
      style.textContent = (doc.querySelector('style')?.textContent ?? '') + 'svg{font:14px system-ui,"Microsoft YaHei",sans-serif}'
      svg.prepend(style)
      const url = URL.createObjectURL(new Blob([svg.outerHTML], { type: 'image/svg+xml;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url; link.download = 'diagram.svg'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }}>导出静态 SVG</Button>
  </div>
  const result: PresentComponentUi = { schemaVersion: 1, kind: 'component-ui', id: 'document-ui', title: prepared.title, chapters: [], ui: prepared.ui! }
  return <div data-testid="markdown-component-ui">
    <p className="mb-2 text-xs text-muted-foreground">文档内交互，仅在本地汇总选择，不会发送给 AI；重新打开后重置。</p>
    <ComponentUiCard key={source} result={result} threadId="document-local" onSubmit={(payload) => { setSelection({ source, text: payload.displayText }) }} />
    {selection.source === source ? <p role="status" className="mt-2 text-sm">{selection.text}</p> : null}
  </div>
}
