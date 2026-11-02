import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReadingMark, WebReadingAnchor, TextSelection } from '@yitom/contracts'
import { isOk, toChapterKey } from '@yitom/contracts'
import { DEFAULT_HIGHLIGHT_COLOR, HIGHLIGHT_COLORS } from '@yitom/reader-core'
import type { HighlightColorId } from '@yitom/reader-core'
import { toast } from 'sonner'
import { useReadingMarks } from './useReadingMarks'
import { useReaderSelectionActions } from './useReaderSelectionActions'
import { captureMarkdownReference, resolveMarkdownReference, markdownHeadingAt } from '@/lib/reader/marks/markdown-preview-reference'
import { parseNoteToCardMeta } from '@/lib/reader/marks/resolve-card-meta'
import { registerReaderMarks, type CreateMarkAtParams } from '@/lib/agent/context/reader-marks-registry'
import { clearReaderSelection, commitReaderSelection, getStickyReaderSelection, registerSelectionProvider } from '@/lib/agent/context/reader-selection-registry'
import { waitForDom } from '@/lib/reader/wait-for-dom'
import { useReaderHudUiStore } from '@/stores/acp/reader-hud-store'
import type { MarkdownHeading } from '@/lib/editor/markdown-headings'
import type { AppTheme } from '@/stores/editor-ui-store'

interface Options {
  filePath: string
  source: string
  html: string
  visible: boolean
  surfaceKey: string
  theme: AppTheme
  headings: MarkdownHeading[]
  getRoot: () => HTMLElement | null
  openPreview: () => void
  getSourceSelection: () => TextSelection | null
  onHeadingChange: (id: string | undefined) => void
}
interface Snapshot { text: string; anchor: WebReadingAnchor; source: string; range: Range }
export type MarkdownReferenceStatus = 'matched' | 'missing' | 'ambiguous'

export function useMarkdownPreviewMarks(options: Options) {
  const { filePath, source, html, visible, surfaceKey, theme, getRoot, openPreview } = options
  const latest = useRef(options)
  latest.current = options
  const focusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const { marks, createMark, updateMark, deleteMark } = useReadingMarks(filePath)
  const marksRef = useRef(marks)
  marksRef.current = marks
  const fingerprint = `markdown:${filePath}`
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const snapshotRef = useRef<Snapshot | null>(null)
  const [toolbar, setToolbar] = useState<{ x: number; y: number } | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [statuses, setStatuses] = useState<Record<string, MarkdownReferenceStatus>>({})

  const clearSelection = useCallback(() => {
    const root = getRoot()
    const selection = document.getSelection()
    if (root && selection?.anchorNode && root.contains(selection.anchorNode)) selection.removeAllRanges()
    const sticky = getStickyReaderSelection()
    if (sticky?.filePath === filePath && !sticky.target) clearReaderSelection()
    snapshotRef.current = null
    setSnapshot(null)
    setToolbar(null)
  }, [filePath, getRoot])

  useEffect(() => { clearSelection() }, [source, surfaceKey, clearSelection])

  useEffect(() => {
    if (!visible) return
    const capture = (event: MouseEvent | KeyboardEvent) => {
      const root = getRoot(), selection = document.getSelection()
      if (!root) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('[role="dialog"], [role="toolbar"], [data-selection-toolbar-menu], [data-keep-reader-selection], #marginalia-notes-stream')) return
      if (!selection || selection.isCollapsed || !selection.rangeCount || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) {
        clearSelection()
        return
      }
      const range = selection.getRangeAt(0).cloneRange()
      const text = range.toString().trim()
      if (!text || target?.closest('button, input, textarea, .cm-editor')) return
      const next = { text, range, anchor: captureMarkdownReference(root, range, filePath), source: latest.current.source }
      latest.current.onHeadingChange(next.anchor.headingId)
      snapshotRef.current = next
      setSnapshot(next)
      const rect = range.getBoundingClientRect()
      setToolbar({ x: Math.max(150, Math.min(window.innerWidth - 150, (rect.left + rect.right) / 2)), y: rect.top })
      commitReaderSelection(filePath, text)
    }
    document.addEventListener('mouseup', capture)
    document.addEventListener('keyup', capture)
    return () => { document.removeEventListener('mouseup', capture); document.removeEventListener('keyup', capture) }
  }, [visible, filePath, getRoot, clearSelection])

  // 源码双栏与预览共用文档选区入口，保留源码的精确编辑坐标。
  useEffect(() => registerSelectionProvider({ filePath,
    getSelectionText: () => {
      const root = getRoot(), selection = document.getSelection()
      if (root && selection && root.contains(selection.anchorNode) && root.contains(selection.focusNode)) return selection.toString()
      return latest.current.surfaceKey !== 'preview' ? latest.current.getSourceSelection()?.ranges.map((range) => range.text).join('\n') ?? null : null
    },
    getSelectionTarget: () => {
      const sticky = getStickyReaderSelection()
      if (sticky?.filePath === filePath) return sticky.target ?? null
      return latest.current.surfaceKey !== 'preview' ? latest.current.getSourceSelection() : null
    },
  }), [filePath, surfaceKey, getRoot])

  const saveAnnotation = useCallback(async (note: string, color: HighlightColorId = DEFAULT_HIGHLIGHT_COLOR, override?: Pick<CreateMarkAtParams, 'category' | 'title'>): Promise<ReadingMark> => {
    const selected = snapshotRef.current
    if (!alive.current || !selected || selected.source !== latest.current.source) throw new Error('原文或选区已变化，请重新选择要保存的段落')
    const meta = parseNoteToCardMeta(note)
    const heading = latest.current.headings.find((item) => item.id === selected.anchor.headingId)
    const chapter = { key: toChapterKey(heading?.id || 'document'), label: heading?.text || '正文', index: heading ? latest.current.headings.indexOf(heading) : -1 }
    const existing = marksRef.current.find((mark) => mark.anchor.format === 'web' && mark.anchor.url === selected.anchor.url &&
      mark.anchor.headingId === selected.anchor.headingId && mark.anchor.selectedText === selected.text)
    const fields = {
      note: meta.note, color, chapter, category: override?.category ?? meta.category,
      title: override?.title ?? meta.title, aiSummary: meta.aiSummary, keyPoints: meta.keyPoints, diagramId: meta.diagramId,
    }
    const result = existing
      ? await updateMark({ id: existing.id, ...fields, ...(note.trim() ? { kind: 'note' as const } : {}) })
      : await createMark({ filePath, fileFingerprint: fingerprint, kind: note.trim() ? 'note' : 'highlight',
          anchor: selected.anchor, excerpt: selected.text, ...fields })
    if (!isOk(result)) throw new Error(result.error.message)
    marksRef.current = [...marksRef.current.filter((mark) => mark.id !== result.value.id), result.value]
    useReaderHudUiStore.getState().setIsCardRailOpen(true)
    clearSelection()
    toast.success(note.trim() ? '已保存批注' : '已添加高亮')
    return result.value
  }, [filePath, fingerprint, createMark, updateMark, clearSelection])

  const actions = useReaderSelectionActions({
    snapshotText: snapshot?.text, sessionKey: fingerprint,
    dimTextSelection: () => setToolbar(null), clearTextSelection: clearSelection,
    openAnnotateDialog: () => { setToolbar(null); setNoteOpen(true) },
    hasSelection: () => Boolean(snapshotRef.current && snapshotRef.current.source === latest.current.source),
    saveHighlight: saveAnnotation,
    onHighlightError: (error) => toast.error(error instanceof Error ? error.message : '保存卡片失败'),
  })

  useEffect(() => {
    if (!visible || !getRoot()) return
    const root = getRoot()!
    const references: Record<string, MarkdownReferenceStatus> = {}
    const groups = new Map<string, Range[]>()
    for (const mark of marks) {
      if (mark.anchor.format !== 'web') continue
      const result = resolveMarkdownReference(root, mark.anchor)
      references[mark.id] = result.status
      if (result.status !== 'matched') continue
      const color = HIGHLIGHT_COLORS.find((item) => item.id === mark.color)?.id ?? DEFAULT_HIGHLIGHT_COLOR
      groups.set(color, [...(groups.get(color) ?? []), result.range])
    }
    setStatuses((previous) => JSON.stringify(previous) === JSON.stringify(references) ? previous : references)
    if (typeof Highlight === 'undefined' || !CSS.highlights) return
    for (const color of HIGHLIGHT_COLORS) {
      root.style.setProperty(`--markdown-highlight-${color.id}`, theme === 'dark' ? color.dark : color.light)
      CSS.highlights.set(`montree-md-${color.id}`, new Highlight(...(groups.get(color.id) ?? [])))
    }
    return () => { for (const color of HIGHLIGHT_COLORS) CSS.highlights.delete(`montree-md-${color.id}`) }
  }, [visible, surfaceKey, html, marks, theme, getRoot])

  const revealMark = useCallback(async (mark: ReadingMark) => {
    openPreview()
    const path = filePath
    const root = await waitForDom(() => alive.current && latest.current.filePath === path && latest.current.surfaceKey === 'preview' ? getRoot() : null)
    if (!root || mark.anchor.format !== 'web') return
    const result = resolveMarkdownReference(root, mark.anchor)
    if (result.status !== 'matched') {
      toast.info(result.status === 'ambiguous' ? '原文有多处相同内容，无法确定引用位置' : '原文已变化或被删除，卡片与摘录仍保留')
      return
    }
    latest.current.onHeadingChange(markdownHeadingAt(root, result.range))
    const rect = result.range.getBoundingClientRect(), host = root.getBoundingClientRect()
    root.scrollTop += rect.top - host.top - Math.min(100, host.height / 3)
    if (typeof Highlight !== 'undefined' && CSS.highlights) {
      CSS.highlights.set('montree-md-focus', new Highlight(result.range))
      clearTimeout(focusTimer.current)
      focusTimer.current = setTimeout(() => CSS.highlights.delete('montree-md-focus'), 1800)
    }
  }, [filePath, getRoot, openPreview])

  useEffect(() => registerReaderMarks({
    filePath,
    createMarkAt: async (params) => {
      openPreview()
      const root = await waitForDom(() => alive.current && latest.current.surfaceKey === 'preview' ? getRoot() : null)
      if (!root) throw new Error('Markdown 预览尚未就绪')
      const result = resolveMarkdownReference(root, { format: 'web', url: '', selectedText: params.excerpt })
      if (result.status !== 'matched') throw new Error('摘录无法唯一定位，请在 Markdown 预览中重新选中该段')
      snapshotRef.current = { text: result.range.toString().trim(), range: result.range, source: latest.current.source, anchor: captureMarkdownReference(root, result.range, filePath) }
      return saveAnnotation(params.note, DEFAULT_HIGHLIGHT_COLOR, params)
    },
    createNoteFromSelection: (note) => saveAnnotation(note),
    createBookmark: async () => {
      openPreview()
      const root = await waitForDom(() => alive.current && latest.current.surfaceKey === 'preview' ? getRoot() : null)
      const target = root?.querySelector('h1[id],h2[id],h3[id],p')
      if (!root || !target) throw new Error('当前 Markdown 暂无可定位正文')
      const range = document.createRange()
      range.selectNodeContents(target)
      const anchor = captureMarkdownReference(root, range, filePath)
      const result = await createMark({ filePath, fileFingerprint: fingerprint, kind: 'bookmark', anchor, label: target.textContent?.trim() || '阅读位置' })
      if (!isOk(result)) throw new Error(result.error.message)
      useReaderHudUiStore.getState().setIsCardRailOpen(true)
      return result.value
    },
  }), [filePath, fingerprint, createMark, getRoot, openPreview, saveAnnotation])

  useEffect(() => () => { clearTimeout(focusTimer.current); if (typeof CSS !== 'undefined' && CSS.highlights) CSS.highlights.delete('montree-md-focus') }, [])
  return { marks, fingerprint, statuses, snapshot, toolbar, noteOpen, setNoteOpen, actions, saveAnnotation,
    clearSelection, revealMark, deleteMark }
}
