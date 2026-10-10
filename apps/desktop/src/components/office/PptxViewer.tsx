import { useCallback, useEffect, useRef, useState } from 'react'
import { isOk } from '@montree/contracts'
import { fileApi } from '@/api/file-api'
import { PresentationDocument } from '@/lib/data/presentation-document'
import { notifyDocumentTools, registerDocumentTools } from '@/lib/agent/context/document-tool-registry'
import { clearReaderSelection, commitDocumentSelection } from '@/lib/agent/context/reader-selection-registry'
import { useDocumentReader } from '@/hooks/agent/useDocumentReader'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { PresentationSlide } from './PresentationSlide'

export function PptxViewer({ filePath, className }: { filePath: string; className?: string }) {
  const model = useRef<PresentationDocument | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const hash = useRef('')
  const [, refresh] = useState(0)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [single, setSingle] = useState(false)
  const [zoom, setZoom] = useState(100)
  useEffect(() => {
    const navigate = (event: KeyboardEvent): void => {
      if (document.fullscreenElement !== root.current || !model.current) return
      if (event.key === 'ArrowRight' || event.key === ' ' || event.key === 'ArrowLeft') {
        event.preventDefault()
        model.current.activeSlide = Math.max(1, Math.min(model.current.slidePaths.length, model.current.activeSlide + (event.key === 'ArrowLeft' ? -1 : 1)))
        refresh((n) => n + 1)
      }
    }
    window.addEventListener('keydown', navigate)
    return () => window.removeEventListener('keydown', navigate)
  }, [])
  const update = useCallback(() => { refresh((n) => n + 1); notifyDocumentTools() }, [])
  const edit = useCallback((args: Record<string, unknown>) => { const result = model.current!.edit(args); update(); return result }, [update])
  const save = useCallback(async () => {
    const doc = model.current
    if (!doc) throw new Error('PPT 正在加载')
    const bytes = doc.serialize()
    setSaving(true)
    try {
      const result = await fileApi.saveBinaryDocument({ filePath, data: bytes, expectedHash: hash.current })
      if (!isOk(result)) throw new Error(result.error.message)
      hash.current = result.value.hash; doc.markSaved(bytes); update()
    } finally { setSaving(false) }
  }, [filePath, update])
  useEffect(() => {
    let cancelled = false
    let dispose: (() => void) | undefined
    model.current = null; setError('')
    void (async () => {
      try {
        const result = await fileApi.readBinaryFile(filePath)
        if (!isOk(result)) throw new Error(result.error.message)
        if (cancelled) return
        hash.current = result.value.hash ?? ''
        model.current = new PresentationDocument(filePath, result.value.data)
        dispose = registerDocumentTools({ filePath, kind: 'slide', isDirty: () => Boolean(model.current?.dirty), read: (args) => model.current!.read(args), edit, save,
          undo: () => { model.current!.undo(); update() } })
        update()
      } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) }
    })()
    return () => { cancelled = true; dispose?.(); clearReaderSelection() }
  }, [filePath, edit, save, update])
  const unitText = (slide: number): string => {
    const doc = model.current!
    return `幻灯片 ${slide}；revision=${doc.revision}\n${doc.elements(slide).map((element) => `[${element.id} ${element.type} ${element.name}] ${element.text}`).join('\n')}\n[元素位置和属性请用 montree_ppt_read 查询。预览未完整呈现母版、图表、组合和动画。]`
  }
  useDocumentReader({ filePath, root: () => model.current ? root.current : null, selectionManaged: true,
    text: () => { if (!model.current) throw new Error('PPT 正在加载'); return unitText(model.current.activeSlide) },
    units: () => model.current?.slidePaths.map((_, i) => ({ label: `幻灯片 ${i + 1}`, text: unitText(i + 1) })) ?? [], currentIndex: () => (model.current?.activeSlide ?? 1) - 1 })
  const doc = model.current
  const run = (action: () => void): void => { try { action() } catch (reason) { toast.error(reason instanceof Error ? reason.message : String(reason)) } }
  const select = (slide: number, id: string, additive: boolean): void => {
    if (!doc) return
    const ids = additive && doc.selection?.slide === slide ? Array.from(new Set([...doc.selection.elementIds, id])) : [id]
    const target = doc.select(slide, ids)
    commitDocumentSelection(target, `幻灯片 ${slide} 元素 ${ids.join(', ')}\n${doc.elements(slide).filter((element) => ids.includes(element.id)).map((element) => element.text).join('\n')}`)
    refresh((n) => n + 1)
  }
  const selectedElement = doc?.selection && doc.elements(doc.selection.slide).find((element) => element.id === doc.selection!.elementIds[0])
  return <div ref={root} data-reader-viewport className={cn('flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background', className)}>
    <div className="flex flex-wrap items-center gap-2 border-b p-2 text-xs">
      <span>{filePath.split(/[/\\]/).pop()}{doc?.dirty ? ' · 未保存' : ''}</span>
      <Button size="xs" onClick={() => setSingle(!single)}>{single ? '连续浏览' : '单页阅读'}</Button>
      <Button size="xs" disabled={!doc} onClick={() => { setSingle(true); void root.current?.requestFullscreen().catch(() => toast.error('无法进入全屏')) }}>全屏放映</Button>
      <Button size="xs" disabled={!doc || doc.activeSlide <= 1} onClick={() => { if (doc) { doc.activeSlide--; refresh((n) => n + 1) } }}>上一页</Button>
      <Button size="xs" disabled={!doc || doc.activeSlide >= doc.slidePaths.length} onClick={() => { if (doc) { doc.activeSlide++; refresh((n) => n + 1) } }}>下一页</Button>
      <Button size="xs" onClick={() => setZoom(Math.max(30, zoom - 10))}>缩小</Button><Button size="xs" onClick={() => setZoom(Math.min(200, zoom + 10))}>放大</Button>
      <Button size="xs" disabled={!doc} onClick={() => run(() => { doc!.undo(); update() })}>撤销</Button>
      <Button size="xs" disabled={!doc?.dirty || saving} onClick={() => void save().then(() => toast.success('PPT 已保存')).catch((reason: Error) => toast.error(reason.message))}>{saving ? '保存中…' : '保存'}</Button>
      <Button size="xs" disabled={!doc?.selection} onClick={() => run(() => { edit({ revision: doc!.revision, slide: doc!.selection!.slide, selectionId: doc!.selection!.selectionId, expectedCount: doc!.selection!.elementIds.length, operation: 'delete' }); doc!.selection = null; clearReaderSelection() })}>删除选中元素</Button>
      <Button size="xs" onClick={() => void navigator.clipboard.writeText(doc?.slidePaths.map((_, i) => unitText(i + 1)).join('\n\n') ?? '')}>复制大纲</Button>
    </div>
    {error ? <p className="p-4 text-destructive">{error}</p> : !doc ? <p className="p-4">正在读取幻灯片…</p> : <div className="flex min-h-0 flex-1">
      <aside className="w-40 shrink-0 overflow-auto border-r p-2">{doc.slidePaths.map((_, i) => <Button key={i} size="xs" variant={doc.activeSlide === i + 1 ? 'secondary' : 'ghost'} className="mb-1 w-full justify-start" onClick={() => { doc.activeSlide = i + 1; doc.selection = null; clearReaderSelection(); refresh((n) => n + 1); root.current?.querySelector(`[data-slide="${i + 1}"]`)?.scrollIntoView({ block: 'start' }) }}>第 {i + 1} 页</Button>)}</aside>
      <div className="min-w-0 flex-1 overflow-auto bg-muted/30 p-4">
        <p className="mb-3 text-xs text-muted-foreground">点击元素可加入 AI 选区，Ctrl 多选。当前为静态预览；母版、图表、组合和动画未完整呈现。</p>
        {doc.slidePaths.map((_, i) => i + 1).filter((number) => !single || number === doc.activeSlide).map((number) => <section key={`${number}:${doc.revision}`} data-slide={number} className="mb-5">
          <h3 className="mb-2 text-sm">幻灯片 {number}</h3>
          <PresentationSlide doc={doc} slide={number} zoom={zoom} select={select} />
        </section>)}
      </div>
      {selectedElement?.capabilities.includes('text') && doc.selection && <aside className="w-56 shrink-0 border-l p-2 text-xs"><p>元素 {selectedElement.id} · {selectedElement.name}</p><textarea key={`${doc.revision}:${selectedElement.id}`} aria-label="元素文字" defaultValue={selectedElement.text} className="mt-2 h-40 w-full rounded border bg-background p-2" onBlur={(e) => { if (e.target.value !== selectedElement.text) run(() => edit({ revision: doc.revision, slide: doc.selection!.slide, elementIds: [selectedElement.id], expectedCount: 1, operation: 'update', patch: { text: e.target.value } })) }} /></aside>}
    </div>}
  </div>
}
