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
import { PptxElementInspector } from './PptxElementInspector'
import { PresentationSlideshow } from './PresentationSlideshow'

export function PptxViewer({ filePath, className }: { filePath: string; className?: string }) {
  const model = useRef<PresentationDocument | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const presentButton = useRef<HTMLButtonElement>(null)
  const wasFullscreen = useRef(false)
  const restoreAfterPresentation = useRef(false)
  const hash = useRef('')
  const [, refresh] = useState(0)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [single, setSingle] = useState(false)
  const [zoom, setZoom] = useState(100)
  const [showInspector, setShowInspector] = useState(false)
  const [presenting, setPresenting] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const finishPresentation = useCallback(() => {
    setPresenting(false)
    restoreAfterPresentation.current = true
  }, [])
  const exitPresentation = useCallback(() => {
    if (document.fullscreenElement === root.current) {
      void document.exitFullscreen().then(finishPresentation).catch(() => toast.error('无法退出全屏，请按 Esc'))
    } else finishPresentation()
  }, [finishPresentation])
  useEffect(() => {
    const syncFullscreen = (): void => {
      const active = document.fullscreenElement === root.current
      setFullscreen(active)
      if (wasFullscreen.current && !active) finishPresentation()
      wasFullscreen.current = active
    }
    document.addEventListener('fullscreenchange', syncFullscreen)
    return () => { document.removeEventListener('fullscreenchange', syncFullscreen) }
  }, [finishPresentation])
  const update = useCallback(() => {
    const doc = model.current
    if (doc?.selection) commitDocumentSelection(doc.selection, `幻灯片 ${doc.selection.slide} 元素 ${doc.selection.elementIds.join(', ')}\n${doc.allElements(doc.selection.slide).filter((item) => doc.selection!.elementIds.includes(item.id)).map((item) => item.text).join('\n')}`)
    else clearReaderSelection()
    refresh((n) => n + 1); notifyDocumentTools()
  }, [])
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
    model.current = null; setError(''); setShowInspector(false); setPresenting(false)
    restoreAfterPresentation.current = false
    if (document.fullscreenElement === root.current) void document.exitFullscreen().catch(() => {})
    void (async () => {
      try {
        const result = await fileApi.readBinaryFile(filePath)
        if (!isOk(result)) throw new Error(result.error.message)
        if (cancelled) return
        hash.current = result.value.hash ?? ''
        model.current = new PresentationDocument(filePath, result.value.data)
        dispose = registerDocumentTools({ filePath, kind: 'slide', isDirty: () => Boolean(model.current?.dirty), read: (args) => model.current!.read(args), edit, save,
          undo: () => { model.current!.undo(); update() }, getSlideView: () => model.current!.context() })
        update()
      } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) }
    })()
    const host = root.current
    return () => {
      cancelled = true; dispose?.(); clearReaderSelection()
      if (document.fullscreenElement === host) void document.exitFullscreen().catch(() => {})
    }
  }, [filePath, edit, save, update])
  const unitText = (slide: number): string => {
    const doc = model.current!
    return `幻灯片 ${slide}；revision=${doc.revision}\n${doc.allElements(slide).map((element) => `[${element.id} ${element.type} ${element.name}] ${element.text}`).join('\n')}\n[元素、图表、母版和动画属性请用 montree_ppt_read 查询能力范围。]`
  }
  useDocumentReader({ filePath, root: () => model.current ? root.current : null, selectionManaged: true,
    text: () => { if (!model.current) throw new Error('PPT 正在加载'); return unitText(model.current.activeSlide) },
    units: () => model.current?.slidePaths.map((_, i) => ({ label: `幻灯片 ${i + 1}`, text: unitText(i + 1) })) ?? [], currentIndex: () => (model.current?.activeSlide ?? 1) - 1 })
  const doc = model.current
  useEffect(() => {
    const host = viewport.current
    if (!host || !doc || presenting) return
    let frame = 0
    const sync = (): void => {
      frame = 0
      const bounds = host.getBoundingClientRect()
      const visible = Array.from(host.querySelectorAll<HTMLElement>('[data-slide]')).map((node) => {
        const rect = node.querySelector('[data-slide-canvas]')!.getBoundingClientRect()
        return { slide: Number(node.dataset.slide), area: Math.max(0, Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top)) * Math.max(0, Math.min(rect.right, bounds.right) - Math.max(rect.left, bounds.left)) }
      }).filter((item) => item.area > 0)
      if (!visible.length) return
      const primary = [...visible].sort((a, b) => b.area - a.area)[0].slide
      const slides = visible.map((item) => item.slide)
      if (doc.activeSlide !== primary || doc.visibleSlides.join(',') !== slides.join(',')) { doc.activeSlide = primary; doc.visibleSlides = slides; refresh((n) => n + 1) }
    }
    const schedule = (): void => { if (!frame) frame = requestAnimationFrame(sync) }
    const resize = new ResizeObserver(schedule); resize.observe(host)
    host.addEventListener('scroll', schedule); schedule()
    return () => { host.removeEventListener('scroll', schedule); resize.disconnect(); cancelAnimationFrame(frame) }
  }, [doc, doc?.revision, single, zoom, showInspector, presenting])
  useEffect(() => {
    if (presenting || !restoreAfterPresentation.current || !doc) return
    restoreAfterPresentation.current = false
    viewport.current?.querySelector(`[data-slide="${doc.activeSlide}"]`)?.scrollIntoView({ block: 'start' })
    presentButton.current?.focus()
  }, [presenting, doc])
  const navigateTo = (slide: number): void => {
    if (!doc) return
    doc.navigationSlide = slide; doc.selection = null; clearReaderSelection()
    if (single || presenting) { doc.activeSlide = slide; doc.visibleSlides = [slide] }
    refresh((n) => n + 1)
    viewport.current?.querySelector(`[data-slide="${slide}"]`)?.scrollIntoView({ block: 'start' })
  }
  const startPresentation = (): void => {
    if (!doc || !root.current) return
    doc.navigationSlide = doc.activeSlide; doc.visibleSlides = [doc.activeSlide]
    doc.selection = null; clearReaderSelection(); setPresenting(true)
    void root.current.requestFullscreen().catch(() => toast.error('无法进入系统全屏，已切换为窗口内放映'))
  }
  const run = (action: () => void): void => { try { action() } catch (reason) { toast.error(reason instanceof Error ? reason.message : String(reason)) } }
  const select = (slide: number, id: string, additive: boolean, focus?: { paragraphId?: string; runId?: string }): void => {
    if (!doc) return
    const ids = additive && doc.selection?.slide === slide ? Array.from(new Set([...doc.selection.elementIds, id])) : [id]
    const target = doc.select(slide, ids, ids.length === 1 ? focus : undefined)
    commitDocumentSelection(target, `幻灯片 ${slide} 元素 ${ids.join(', ')}\n${doc.allElements(slide).filter((element) => ids.includes(element.id)).map((element) => element.text).join('\n')}`)
    refresh((n) => n + 1)
  }
  const selectedElement = doc?.selection && doc.allElements(doc.selection.slide).find((element) => element.id === doc.selection!.elementIds[0])
  return <div ref={root} data-reader-viewport className={cn('flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background', className)}>
    {presenting && doc ? <PresentationSlideshow doc={doc} fullscreen={fullscreen} navigate={navigateTo} exit={exitPresentation} /> : <>
    <div className="flex flex-wrap items-center gap-2 border-b p-2 text-xs">
      <span>{filePath.split(/[/\\]/).pop()}{doc?.dirty ? ' · 未保存' : ''}</span>
      <Button size="xs" onClick={() => setSingle(!single)}>{single ? '连续浏览' : '单页阅读'}</Button>
      <Button ref={presentButton} size="xs" disabled={!doc} onClick={startPresentation}>全屏放映</Button>
      <Button size="xs" disabled={!doc || doc.activeSlide <= 1} onClick={() => navigateTo(doc!.activeSlide - 1)}>上一页</Button>
      <Button size="xs" disabled={!doc || doc.activeSlide >= doc.slidePaths.length} onClick={() => navigateTo(doc!.activeSlide + 1)}>下一页</Button>
      <Button size="xs" onClick={() => setZoom(Math.max(30, zoom - 10))}>缩小</Button><Button size="xs" onClick={() => setZoom(Math.min(200, zoom + 10))}>放大</Button>
      <Button size="xs" disabled={!doc} onClick={() => run(() => { doc!.undo(); update() })}>撤销</Button>
      <Button size="xs" disabled={!doc?.dirty || saving} onClick={() => void save().then(() => toast.success('PPT 已保存')).catch((reason: Error) => toast.error(reason.message))}>{saving ? '保存中…' : '保存'}</Button>
      <Button size="xs" disabled={!doc?.selection} onClick={() => run(() => { edit({ revision: doc!.revision, slide: doc!.selection!.slide, selectionId: doc!.selection!.selectionId, expectedCount: doc!.selection!.elementIds.length, operation: 'delete' }); doc!.selection = null; clearReaderSelection() })}>删除选中元素</Button>
      <Button size="xs" disabled={!doc?.selection} onClick={() => setShowInspector(!showInspector)}>{showInspector ? '收起元素详情' : '元素详情'}</Button>
      <Button size="xs" onClick={() => void navigator.clipboard.writeText(doc?.slidePaths.map((_, i) => unitText(i + 1)).join('\n\n') ?? '')}>复制大纲</Button>
    </div>
    {error ? <p className="p-4 text-destructive">{error}</p> : !doc ? <p className="p-4">正在读取幻灯片…</p> : <div className="flex min-h-0 flex-1">
      <aside className="w-40 shrink-0 overflow-auto border-r p-2">{doc.slidePaths.map((_, i) => <Button key={i} size="xs" variant={doc.activeSlide === i + 1 ? 'secondary' : 'ghost'} className="mb-1 w-full justify-start" onClick={() => navigateTo(i + 1)}>第 {i + 1} 页</Button>)}</aside>
      <div ref={viewport} data-ppt-viewport className="min-w-0 flex-1 overflow-auto bg-muted/30 p-4">
        <p className="mb-3 text-xs text-muted-foreground">点击元素可加入 AI 选区，Ctrl 多选。支持组合与基础图表预览，基础动画在放映时播放；复杂效果暂未完整呈现。</p>
        {doc.slidePaths.map((_, i) => i + 1).filter((number) => !single || number === doc.activeSlide).map((number) => <section key={`${number}:${doc.revision}`} data-slide={number} className="mb-5">
          <h3 className="mb-2 text-sm">幻灯片 {number}</h3>
          <PresentationSlide doc={doc} slide={number} zoom={zoom} select={select} />
        </section>)}
      </div>
      {showInspector && selectedElement && doc.selection && <PptxElementInspector key={`${doc.selection.slide}:${selectedElement.id}:${doc.revision}`} doc={doc} element={selectedElement} edit={(args) => run(() => { edit(args) })} close={() => setShowInspector(false)} />}
    </div>}
    </>}
  </div>
}
