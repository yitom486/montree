import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { PaneErrorBoundary } from '@/components/shared/PaneErrorBoundary'
import { AnnotationNoteDialog } from '@/components/reader/AnnotationNoteDialog'
import { EpubMarkTooltip } from '@/components/reader/EpubMarkTooltip'
import { ReaderContentShell } from '@/components/reader/ReaderContentShell'
import { PdfBookSearch } from '@/components/reader/PdfBookSearch'
import { ReaderFooterNav } from '@/components/reader/ReaderFooterNav'
import { ReaderToolbarShell } from '@/components/reader/ReaderToolbarShell'
import { useIsDockedAgentVisible } from '@/components/agent/AgentPanel'
import { DockedAgentPane } from '@/components/agent/DockedAgentPane'
import { ReaderTypographyControls } from '@/components/reader/ReaderTypographyControls'
import { ReadingProgressRing } from '@/components/reader/ReadingProgressRing'
import { ReadingMarkPopover } from '@/components/reader/ReadingMarkPopover'
import { SelectionToolbar } from '@/components/reader/SelectionToolbar'
import { DeepAnswerDialog } from '@/components/reader/DeepAnswerDialog'
import { useReaderBinary } from '@/hooks/reader/useReaderBinary'
import { useReaderSidePanels } from '@/hooks/reader/useReaderSidePanels'
import { useReadingMarkInspector } from '@/hooks/reader/useReadingMarkInspector'
import { useReaderSelectionActions } from '@/hooks/reader/useReaderSelectionActions'
import { useReaderExportMenu } from '@/hooks/reader/useReaderExportMenu'
import { useReadingMarks } from '@/hooks/reader/useReadingMarks'
import { extractDocumentText, extractViewportText } from '@/lib/agent/context/extract-dom-text'
import { registerReaderContent } from '@/lib/agent/context/reader-content-registry'
import { registerReaderMarks } from '@/lib/agent/context/reader-marks-registry'
import { registerSelectionProvider, commitReaderSelection, clearReaderSelection } from '@/lib/agent/context/reader-selection-registry'
import { focusAgentComposerOnReaderSelection } from '@/lib/agent/context/focus-agent-composer'
import { DEFAULT_HIGHLIGHT_COLOR } from '@montree/reader-core'
import { emitRailFollow, emitRailFocus } from '@/lib/reader/rail-follow'
import { findMarkForSelection, isClickNotDrag } from '@montree/reader-core'
import { useReadingProgressStore } from '@/stores/reading-progress-store'
import { useAppSettingsStore } from '@/stores/app-settings-store'
import { useReaderNavigationStore, useReaderNavTitles, isNavIntentLocked } from '@/stores/reader-navigation-store'
import { cn } from '@/lib/utils'
import type { AppError } from '@montree/contracts'
import type { ReadingMark } from '@montree/contracts'
import { isOk } from '@montree/contracts'
import { toast } from 'sonner'
import { appApi } from '@/api/app-api'
import { openFoliateBook, type FoliateBookAdapter } from '@/lib/reader/adapter/foliate-book-adapter'
import { parseNoteToCardMeta, resolveCardMeta } from '@/lib/reader/marks/resolve-card-meta'
import {
  buildChapterSectionMap,
  buildMarkFlag,
  isExcerptDrawAllowed,
  resolveMarkRangeDetailed,
  type CfiResolverView,
} from '@/lib/reader/marks/epub-mark-overlay'
import {
  findMarkByOverlayerKey,
  locateExcerptInDocuments,
  overlayerKeyForMark,
  runRevealPlan,
  subscribeRevealMark,
  type RevealAdapter,
} from '@/lib/reader/marks/mark-linkage'
import { toCanonicalChapter } from '@montree/reader-core'
import { parse as parseFoliateCfi, toRange as foliateCfiToRange } from '@foliate/epubcfi.js'
import type { FoliateViewElement } from '@foliate/view.js'
import type { OverlayerDrawFn } from '@foliate/overlayer.js'
import {
  flattenEpubToc,
  pickInitialChapter,
  type EpubChapter,
} from '@montree/reader-core'
import { normalizeLoadKey } from '@montree/reader-core'
import {
  isSameSpineBase,
  MARK_CATEGORY_SWATCH_FALLBACK,
  resolveMarkCategorySwatch,
  scrollFoliateSectionToFragment,
  splitChapterFragment,
} from '@montree/reader-core'
import { getEpubThemeRules, applyEpubReadingLayout } from '@montree/reader-core'
import {
  buildEpubSnapshotFromRange,
  readEpubSelection,
} from '@montree/reader-core'
import { findTextRangeInRoot } from '@/lib/reader/marks/excerpt-text-match'
import { waitForDom } from '@/lib/reader/wait-for-dom'
import type { CreateMarkAtParams } from '@/lib/agent/context/reader-marks-registry'
import {
  bindDocumentSelectionCollapse,
  bindOutsideReaderPointerDismiss,
} from '@montree/reader-core'
import { buildReadingFileFingerprint } from '@/lib/reader/adapter/reading-file-fingerprint'
import {
  findCurrentChapterRef,
  resolveEpubChapter,
  resolveMobiChapter,
  tocFromEpubUnits,
} from '@montree/reader-core'
import { reportAppError } from '@/lib/workspace/report-error'
import { reportRuntimeError } from '@/lib/workspace/error-reporter'

declare global {
  interface Window {
    /** E2E 专用钩子（仅 E2E_FOLIATE_READER 门控开启时挂载） */
    __montreeE2eReader?: {
      selectText: (excerpt: string) => Promise<boolean>
      clickMark: (markId: string) => Promise<boolean>
      listMarks: () => Array<{ id: string; kind: string; excerpt?: string }>
    }
  }
}

import type { AppTheme } from '@/stores/editor-ui-store'

interface FoliateReaderViewerProps {
  filePath: string
  documentKind: 'epub' | 'mobi'
  theme: AppTheme
  /** 透传给内框 docked 侧栏，供 Agent 会话 cwd */
  workspaceRoot?: string
}

const READING_PROGRESS_SAVE_MS = 400
const FOLIATE_READER_STYLE_ID = 'foliate-reader-theme'

/** M2 页边旗标：每渲染文档上限（与 M1 行内着色同 cap，不乱标） */
const EPUB_MARK_FLAGS_PER_DOC_CAP = 40

/** epub.js themes 规则（selector→props）转可注入 CSS 文本 */
function themeRulesToCss(rules: Record<string, Record<string, string>>): string {
  return Object.entries(rules)
    .map(([selector, props]) => {
      const body = Object.entries(props)
        .map(([prop, value]) => `${prop}:${value};`)
        .join('')
      return `${selector}{${body}}`
    })
    .join('\n')
}

export function FoliateReaderViewer({ filePath, documentKind, theme, workspaceRoot }: FoliateReaderViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<FoliateViewElement | null>(null)
  const adapterRef = useRef<FoliateBookAdapter | null>(null)
  const chaptersRef = useRef<EpubChapter[]>([])
  const chapterSectionsRef = useRef<Array<number | null>>([])
  const [chapters, setChapters] = useState<EpubChapter[]>([])
  const nav = useReaderNavigationStore((state) => state.nav)
  // docked 侧栏挂载于内框行（工具栏之下、底导航之上），与正文同属左大块
  const dockedAgentVisible = useIsDockedAgentVisible()
  const { tocOpen, marksOpen, toggleToc, toggleMarks, closeToc, closeMarks } = useReaderSidePanels()
  const [ready, setReady] = useState(false)
  const [globalProgress, setGlobalProgress] = useState(0)
  const [selectionSnapshot, setSelectionSnapshot] = useState<{
    text: string
    cfiRange: string
    rect: DOMRect
  } | null>(null)
  const [selectionToolbarPos, setSelectionToolbarPos] = useState<{ x: number; y: number } | null>(
    null,
  )
  const [noteDialogOpen, setNoteDialogOpen] = useState(false)
  const [editingNoteMark, setEditingNoteMark] = useState<ReadingMark | null>(null)
  const [hoveredMark, setHoveredMark] = useState<ReadingMark | null>(null)
  const [markTooltipPos, setMarkTooltipPos] = useState<{ x: number; y: number } | null>(null)
  const hoveredMarkIdRef = useRef<string | null>(null)
  /** 写批注时的临时高亮键（即选区 CFI），对话框关闭即撤 */
  const pendingAnnotateKeyRef = useRef<string | null>(null)
  const pointerOriginRef = useRef<{ x: number; y: number } | null>(null)
  const selectionSnapshotRef = useRef<typeof selectionSnapshot>(null)
  selectionSnapshotRef.current = selectionSnapshot
  const lastLocationRef = useRef<{ cfi?: string; sectionIndex: number; fraction: number } | null>(
    null,
  )
  /** 已绘制常驻标记的节序号，避免节内滚动重复重算 */
  const lastMarkSectionRef = useRef<number>(-1)
  const readerFontSize = useAppSettingsStore((state) => state.readerFontSize)
  const readerLineHeight = useAppSettingsStore((state) => state.readerLineHeight)
  const typography = useMemo(
    () => ({ fontSize: readerFontSize, lineHeight: readerLineHeight }),
    [readerFontSize, readerLineHeight],
  )
  const themeRef = useRef(theme)
  themeRef.current = theme
  const typographyRef = useRef(typography)
  typographyRef.current = typography
  const filePathRef = useRef(filePath)
  filePathRef.current = filePath
  const kindRef = useRef(documentKind)
  kindRef.current = documentKind

  const { data, isLoading, error } = useReaderBinary(filePath)
  const { marks, createMark, updateMark, deleteMark } = useReadingMarks(filePath)
  const inspector = useReadingMarkInspector(marks)
  const inspectorRef = useRef(inspector)
  inspectorRef.current = inspector
  const marksRef = useRef<ReadingMark[]>([])
  marksRef.current = marks
  const saveProgressTimerRef = useRef<number | null>(null)
  const fileFingerprint = data
    ? buildReadingFileFingerprint(filePath, data.data.byteLength)
    : ''

  const isEpub = documentKind === 'epub'

  // 统一后端下 EPUB/MOBI 均用 EpubChapter[] 单元，导航会话一律走 epub 分支
  //（store 的 mobi 分支已随旧双 Viewer 删除）。
  useEffect(() => {
    useReaderNavigationStore.getState().beginSession(filePath, 'epub')
    return () => {
      useReaderNavigationStore.getState().beginSession('', 'epub')
    }
  }, [filePath])

  const clearTextSelection = useCallback(() => {
    setSelectionSnapshot(null)
    setSelectionToolbarPos(null)
    clearReaderSelection()
    try {
      viewRef.current?.renderer?.getContents().forEach((item) => {
        item.doc.defaultView?.getSelection()?.removeAllRanges()
      })
    } catch {
      // 视图已销毁时忽略
    }
  }, [])

  /** 收起高亮、工具栏与标记浮层，保留 sticky 供 Agent 读取 */
  const dimTextSelection = useCallback(() => {
    if (noteDialogOpen) return
    setSelectionToolbarPos(null)
    inspectorRef.current.close()
  }, [noteDialogOpen])

  const resolveGlobalProgress = useCallback((fraction: number): number => {
    return Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  }, [])

  const persistReadingProgress = useCallback(
    (sectionIndex: number, fraction: number, cfi?: string) => {
      const percentage = resolveGlobalProgress(fraction)
      setGlobalProgress(percentage)
      const sectionId = adapterRef.current?.sections[sectionIndex]?.id
      if (kindRef.current === 'epub') {
        if (!cfi) return
        useReadingProgressStore.getState().saveEpubProgress(filePathRef.current, {
          cfi,
          href: sectionId,
          percentage,
        })
        return
      }
      if (sectionId) {
        useReadingProgressStore.getState().saveMobiProgress(filePathRef.current, {
          chapterId: sectionId,
        })
      }
    },
    [resolveGlobalProgress],
  )

  const schedulePersistReadingProgress = useCallback(
    (sectionIndex: number, fraction: number, cfi?: string) => {
      if (saveProgressTimerRef.current !== null) {
        window.clearTimeout(saveProgressTimerRef.current)
      }
      saveProgressTimerRef.current = window.setTimeout(() => {
        saveProgressTimerRef.current = null
        persistReadingProgress(sectionIndex, fraction, cfi)
      }, READING_PROGRESS_SAVE_MS)
    },
    [persistReadingProgress],
  )

  const syncChapterNav = useCallback((sectionIndex: number, cfi?: string) => {
    const units = chaptersRef.current
    if (units.length === 0) return
    // 用户显式导航（点目录/底栏）后短暂锁内不降级为章节首条目，
    // 否则分片跳转会被随后到达的 section 级 relocate 覆盖回“第一部”
    if (isNavIntentLocked(useReaderNavigationStore.getState().navIntent)) return
    const href = adapterRef.current?.sections[sectionIndex]?.id
    // E2E 可观测性先行：门控开启时把当前节纯文本挂到容器（独立于下方同步决策）
    if (
      typeof window !== 'undefined' &&
      appApi.isE2EFoliateReader() &&
      containerRef.current
    ) {
      const host = containerRef.current
      void adapterRef.current
        ?.loadSectionText(sectionIndex)
        .then((text) => {
          host.dataset.e2eSectionText = text.slice(0, 500)
        })
        .catch(() => undefined)
    }
    const flatIndex = units.findIndex((unit) =>
      href ? isSameSpineBase(unit.href, href, normalizeLoadKey) : false,
    )
    if (flatIndex >= 0) {
      // 该 spine 挂了多个带分片目录项时不做章节级同步（无法判定小节），
      // 交给滚动驱动的节内细化；单一条目、或尚未选中任何章节时才同步
      const ambiguous =
        units.filter((unit) => href && isSameSpineBase(unit.href, href, normalizeLoadKey)).length >
        1
      if (!ambiguous || useReaderNavigationStore.getState().nav.flatIndex < 0) {
        useReaderNavigationStore.getState().syncFlatIndex(flatIndex)
        return
      }
    } else {
      useReaderNavigationStore.getState().syncEpub(units, { href, cfi })
    }
  }, [])

  const goToChapter = useCallback((chapter: EpubChapter | null, flatIndex?: number) => {
    const view = viewRef.current
    if (!chapter || !view) return
    let sectionIndex: number | null = null
    if (typeof flatIndex === 'number' && flatIndex >= 0) {
      sectionIndex = chapterSectionsRef.current[flatIndex] ?? null
    }
    if (sectionIndex === null || sectionIndex < 0) {
      sectionIndex = adapterRef.current?.resolveHref(chapter.href) ?? null
    }
    if (sectionIndex === null || sectionIndex < 0) return
    const targetSection = sectionIndex
    const resolvedFlat =
      typeof flatIndex === 'number' && flatIndex >= 0
        ? flatIndex
        : chaptersRef.current.findIndex((item) => item.href === chapter.href)
    useReaderNavigationStore.getState().syncFlatIndex(resolvedFlat)
    // 分片优先：完整 href（含 #分片 / filepos:）让 foliate 内部定位锚点；
    // 纯数字 MOBI spine id 直接按序号跳，避免 resolveHref 抛错刷屏。
    const { fragment } = splitChapterFragment(chapter.href)
    const needsFullHref =
      fragment !== null ||
      chapter.href.includes('filepos:') ||
      kindRef.current === 'epub'
    void (async () => {
      if (needsFullHref) {
        try {
          await view.goTo(chapter.href)
        } catch {
          // 继续走下面的单次兜底
        }
      } else {
        try {
          await view.goTo(targetSection)
        } catch {
          return
        }
      }
      if (!fragment) return
      // 单次兜底：只滚动一次（轮询反复滚会与内部滚动打架导致永不定居）。
      // 等一帧让 foliate 先落位，仍偏离才手动纠正一次。
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
      const target = viewRef.current?.renderer
        ?.getContents()
        .find((item) => item.index === targetSection)
      if (!target) return
      scrollFoliateSectionToFragment(target.doc, fragment)
    })().catch(() => undefined)
  }, [])

  /**
   * 手动搜索跳章：按章节 label 精确找第一处；找不到不乱跳。
   * 同名章节跳第一处（接受，不做模糊匹配）。
   */
  const handleJumpToLabel = useCallback(
    (label: string) => {
      const index = chaptersRef.current.findIndex((chapter) => chapter.label === label)
      if (index < 0) return
      const chapter = chaptersRef.current[index]
      if (chapter) goToChapter(chapter, index)
    },
    [goToChapter],
  )

  const applyDocTheme = useCallback((doc: Document) => {
    try {
      applyEpubReadingLayout(doc, themeRef.current, typographyRef.current)
      const css = themeRulesToCss(getEpubThemeRules(themeRef.current, typographyRef.current))
      let style = doc.getElementById(FOLIATE_READER_STYLE_ID) as HTMLStyleElement | null
      if (!style) {
        style = doc.createElement('style')
        style.id = FOLIATE_READER_STYLE_ID
        doc.head.appendChild(style)
      }
      style.textContent = css
      // 正文 iframe 内部滚动条隐藏：单滚动条观感只留卡片轨右边那根，
      // 正文进度由卡片轨滚动条经等比跟随反映（滚正文时轨跟着走）。
      style.textContent +=
        '\nhtml,body{scrollbar-width:none;}\nhtml::-webkit-scrollbar,body::-webkit-scrollbar{width:0 !important;height:0 !important;display:none !important;}'
    } catch {
      // 章节文档不可写时忽略
    }
  }, [])

  // 卡片常驻标记：CSS Custom Highlight 自绘层（颜色完全可控，不依赖 overlayer 私有 API）。
  // 每渲染文档注入 5 条分类规则（主文档解析 CSS 变量后写字面值，主题切换重注），
  // 按统一 Range 口径（resolveMarkRange：CFI 优先 excerpt 兜底，与 M2 旗标同源）着色；
  // 切章/翻页不同步（由调用方在 relocation 节点触发）。
  const markHighlightStyleSigRef = useRef<WeakMap<Document, string>>(new WeakMap())
  const syncMarkHighlights = useCallback(() => {
    const view = viewRef.current
    const cfiView = (view ?? null) as unknown as CfiResolverView | null
    // 章节门输入：固化章节 key → spine section 集合（excerpt 兜底跨章漏画到此为止）
    const chapterSections = buildChapterSectionMap(
      chaptersRef.current,
      chapterSectionsRef.current,
    )
    let docs: Array<{ doc: Document; index: number }> = []
    try {
      const renderer = viewRef.current?.renderer as unknown as {
        getContents: () => Array<{ doc: Document; index: number }>
      } | null
      docs = renderer?.getContents() ?? []
    } catch {
      return
    }
    if (docs.length === 0) return
    const rootCS = document.defaultView?.getComputedStyle(document.documentElement)
    const getVar = (name: string) => rootCS?.getPropertyValue(name).trim() || undefined
    const palette: Record<string, string> = {}
    for (const cat of Object.keys(MARK_CATEGORY_SWATCH_FALLBACK)) {
      palette[cat] = resolveMarkCategorySwatch(cat, getVar, themeRef.current)
    }
    const sig = Object.values(palette).join('|')
    const buckets = new Map<string, Range[]>()
    for (const { doc, index } of docs) {
      try {
        const viewWindow = doc.defaultView as unknown as {
          CSS?: { highlights?: { set: (name: string, h: object) => void; delete: (n: string) => void } }
          Highlight?: new (...ranges: AbstractRange[]) => object
        } | null
        const registry = viewWindow?.CSS?.highlights
        const HighlightCtor = viewWindow?.Highlight
        if (!registry || !HighlightCtor) continue
        if (markHighlightStyleSigRef.current.get(doc) !== sig) {
          let style = doc.querySelector('style[data-montree-marks]') as HTMLStyleElement | null
          if (!style) {
            style = doc.createElement('style')
            style.setAttribute('data-montree-marks', '')
            ;(doc.head ?? doc.documentElement)?.appendChild(style)
          }
          style.textContent = Object.entries(palette)
            .map(
              ([cat, color]) =>
                `::highlight(montree-mark-${cat}){text-decoration:underline dotted;text-underline-offset:3px;text-decoration-color:${color};}`,
            )
            .join('\n')
          markHighlightStyleSigRef.current.set(doc, sig)
        }
        for (const cat of Object.keys(palette)) {
          registry.delete(`montree-mark-${cat}`)
          buckets.set(cat, [])
        }
        for (const mark of marksRef.current) {
          // 与 M2 旗标同源：CFI 优先 excerpt 兜底（此前只按 excerpt 首匹配，
          // 同一卡片下划线与圆点可能落在两处）。
          // 章节门：只有 excerpt 兜底才受限（跨章漏画到此为止）；
          // CFI 精确命中是真位置，永远画。
          const resolved = resolveMarkRangeDetailed(doc, index, mark, cfiView)
          if (!resolved) continue
          if (
            resolved.via === 'excerpt' &&
            !isExcerptDrawAllowed(mark.chapter?.key, index, chapterSections)
          ) {
            continue
          }
          const range = resolved.range
          const cat = (mark.category ?? resolveCardMeta(mark).category) as string
          if (!palette[cat]) continue
          const bucket = buckets.get(cat)
          if (bucket && bucket.length < 40) bucket.push(range)
        }
        for (const [cat, ranges] of buckets) {
          if (ranges.length === 0) continue
          try {
            registry.set(`montree-mark-${cat}`, new HighlightCtor(...ranges))
          } catch {
            // 单个失败不影响其余分类
          }
        }
      } catch {
        // 单文档失败不影响其余文档
      }
    }
  }, [])

  // M2 页边旗标：每渲染文档内 absolute 圆点（文档内坐标，随内容滚动天然跟随，
  // 只在 relocation/载入/标记变更/主题字号变化时重算）。定位与 M1 同源
  //（共用 resolveMarkRange：CFI 优先、excerpt 兜底，无合法坐标不画）；
  // 点击直达卡片（rail-follow 通道）。
  const syncMarkFlags = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    const cfiView = view as unknown as CfiResolverView
    let contents: Array<{ doc: Document; index: number }> = []
    try {
      const renderer = view.renderer as unknown as {
        getContents: () => Array<{ doc: Document; index: number }>
      } | null
      contents = renderer?.getContents() ?? []
    } catch {
      return
    }
    if (contents.length === 0) return
    const rootCS = document.defaultView?.getComputedStyle(document.documentElement)
    const getVar = (name: string) => rootCS?.getPropertyValue(name).trim() || undefined
    // 章节门输入：固化章节 key → spine section 集合（excerpt 兜底跨章漏画到此为止）
    const flagChapterSections = buildChapterSectionMap(
      chaptersRef.current,
      chapterSectionsRef.current,
    )
    for (const { doc, index } of contents) {
      try {
        doc.querySelectorAll('[data-montree-flag]').forEach((el) => el.remove())
        // 旗标挂 documentElement 而非 body：主题 CSS 所有全宽 static 规则
        // 全是 `body ...` 作用域，挂根元素天然免疫，新旧版本通吃；
        // 行内 !important 再保一层，双保险。
        const host = doc.documentElement
        if (!host) continue
        let placed = 0
        for (const mark of marksRef.current) {
          if (placed >= EPUB_MARK_FLAGS_PER_DOC_CAP) break
          if (mark.kind === 'bookmark') continue
          const resolved = resolveMarkRangeDetailed(doc, index, mark, cfiView)
          if (!resolved) continue
          if (
            resolved.via === 'excerpt' &&
            !isExcerptDrawAllowed(mark.chapter?.key, index, flagChapterSections)
          ) {
            continue
          }
          const range = resolved.range
          const cat = (mark.category ?? resolveCardMeta(mark).category) as string
          const flag = buildMarkFlag(doc, mark.id, range, {
            background: resolveMarkCategorySwatch(cat, getVar, themeRef.current),
          })
          if (!flag) continue
          host.appendChild(flag)
          placed += 1
        }
      } catch {
        // 单文档失败不影响其余文档
      }
    }
  }, [])

  const syncVisualMarks = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    for (const mark of marksRef.current) {
      const key = overlayerKeyForMark(mark)
      if (!key) continue
      void view.addAnnotation({ value: key }).catch(() => undefined)
    }
  }, [])

  const removePendingAnnotateHighlight = useCallback(() => {    const key = pendingAnnotateKeyRef.current
    pendingAnnotateKeyRef.current = null
    if (!key) return
    void viewRef.current?.deleteAnnotation({ value: key }).catch(() => undefined)
  }, [])

  /** 写批注时把选区按高亮色重绘（旧链路 showPendingSelectionHighlight 对等行为） */
  const showPendingAnnotateHighlight = useCallback(() => {
    const snapshot = selectionSnapshotRef.current
    const view = viewRef.current
    if (!snapshot?.cfiRange || !view || editingNoteMark) return
    const existing = findMarkForSelection(marksRef.current, {
      format: kindRef.current,
      text: snapshot.text,
      cfiRange: snapshot.cfiRange,
    })
    // 已有标记：真身绘制已存在，不加临时层，避免取消时误删
    if (existing) return
    pendingAnnotateKeyRef.current = snapshot.cfiRange
    void view.addAnnotation({ value: snapshot.cfiRange }).catch(() => undefined)
  }, [editingNoteMark])

  // 卡片悬停→正文高亮：CSS Custom Highlight API，无 DOM 改动，移出即清除。
  // 与 BracketConnector 的卡片侧高亮呼应，完成悬停方向的双向联动。
  const hoverStyleInjectedRef = useRef<WeakSet<Document>>(new WeakSet())
  const handleHoverExcerpt = useCallback((excerpt: string | undefined) => {
    let docs: Array<{ doc: Document }> = []
    try {
      const renderer = viewRef.current?.renderer as unknown as {
        getContents: () => Array<{ doc: Document }>
      } | null
      docs = renderer?.getContents() ?? []
    } catch {
      return
    }
    for (const { doc } of docs) {
      try {
        const viewWindow = doc.defaultView as unknown as {
          CSS?: { highlights?: { set: (name: string, highlight: object) => void; delete: (name: string) => void } }
          Highlight?: new (...ranges: AbstractRange[]) => object
        } | null
        const registry = viewWindow?.CSS?.highlights
        const HighlightCtor = viewWindow?.Highlight
        if (!registry || !HighlightCtor) continue
        if (!excerpt?.trim()) {
          registry.delete('montree-hover')
          continue
        }
        if (!hoverStyleInjectedRef.current.has(doc)) {
          const style = doc.createElement('style')
          style.setAttribute('data-montree-hover', '')
          style.textContent =
            '::highlight(montree-hover){background:rgba(139,92,246,.32);border-radius:2px;}'
          ;(doc.head ?? doc.documentElement)?.appendChild(style)
          hoverStyleInjectedRef.current.add(doc)
        }
        const body = doc.body
        if (!body) continue
        const range = findTextRangeInRoot(body, excerpt.trim())
        registry.delete('montree-hover')
        if (range) {
          registry.set('montree-hover', new HighlightCtor(range))
        }
      } catch {
        // 高亮失败时静默忽略，不干扰阅读
      }
    }
  }, [])

  // 跳转落定的方框闪现：与悬停同款叠层，2.5s 后自动清除
  const jumpFlashTokenRef = useRef(0)
  const flashJumpRange = useCallback((cfiKey: string) => {
    const token = ++jumpFlashTokenRef.current
    window.setTimeout(() => {
      if (jumpFlashTokenRef.current !== token) return
      let resolved: { index: number; anchor: (doc: Document) => Range } | null = null
      try {
        resolved = viewRef.current?.resolveCFI(cfiKey) ?? null
      } catch {
        resolved = null
      }
      if (!resolved) return
      let renderer: { getContents: () => Array<{ doc: Document; index: number }> } | null = null
      try {
        renderer = viewRef.current?.renderer as unknown as {
          getContents: () => Array<{ doc: Document; index: number }>
        } | null
      } catch {
        return
      }
      const target = renderer?.getContents().find((item) => item.index === resolved.index)
      if (!target) return
      let range: Range | null = null
      try {
        range = resolved.anchor(target.doc)
      } catch {
        return
      }
      if (!range) return
      try {
        const viewWindow = target.doc.defaultView as unknown as {
          CSS?: { highlights?: { set: (name: string, h: object) => void; delete: (n: string) => void } }
          Highlight?: new (...ranges: AbstractRange[]) => object
        } | null
        const registry = viewWindow?.CSS?.highlights
        const HighlightCtor = viewWindow?.Highlight
        if (!registry || !HighlightCtor) return
        if (!target.doc.querySelector('style[data-montree-hover]')) {
          const style = target.doc.createElement('style')
          style.setAttribute('data-montree-hover', '')
          style.textContent =
            '::highlight(montree-hover){background:rgba(139,92,246,.32);border-radius:2px;}'
          ;(target.doc.head ?? target.doc.documentElement)?.appendChild(style)
        }
        registry.set('montree-hover', new HighlightCtor(range))
        window.setTimeout(() => {
          if (jumpFlashTokenRef.current !== token) return
          try {
            registry.delete('montree-hover')
          } catch {
            // 忽略
          }
        }, 2500)
      } catch {
        // 忽略
      }
    }, 180)
  }, [])

  // 卡片轨逐帧跟随：文档滚动直驱书级分数（章节映射），rAF 节流 + 0.002 阈值，
  // 经 window 事件直达卡片轨 DOM，不经过 React state（滚动过程零重渲染）。
  const railFollowStateRef = useRef({ scheduled: false, last: -1 })
  const bindRailFollow = useCallback((doc: Document, index: number) => {
    const onScroll = () => {
      const st = railFollowStateRef.current
      if (st.scheduled) return
      st.scheduled = true
      requestAnimationFrame(() => {
        st.scheduled = false
        try {
          const el = doc.documentElement
          const max = el.scrollHeight - el.clientHeight
          const local = max > 0 ? el.scrollTop / max : 0
          let start = 0
          let end = 1
          try {
            const fractions = viewRef.current?.getSectionFractions?.() ?? []
            if (fractions.length > index) {
              start = fractions[index] ?? 0
              end = fractions[index + 1] ?? 1
            }
          } catch {
            // 取不到节映射时回落全文档等比
          }
          const f = start + Math.min(1, Math.max(0, local)) * (end - start)
          if (Math.abs(f - st.last) < 0.002) return
          st.last = f
          emitRailFollow(f)
        } catch {
          // 忽略
        }
      })
    }
    doc.addEventListener('scroll', onScroll, { passive: true, capture: true })
    return () => {
      doc.removeEventListener('scroll', onScroll, { capture: true })
    }
  }, [])

  // 卡片→正文摘录兜底：在已渲染节文档中定位并选中（与统一联动 excerpt 步同语义）。
  const revealExcerptInFoliateDocs = useCallback((text: string): boolean => {
    let docs: Array<{ doc: Document }> = []
    try {
      const renderer = viewRef.current?.renderer as unknown as {
        getContents: () => Array<{ doc: Document }>
      } | null
      docs = renderer?.getContents() ?? []
    } catch {
      docs = []
    }
    const hit = locateExcerptInDocuments(docs, text)
    if (!hit) return false
    try {
      const host =
        hit.range.startContainer instanceof Element
          ? hit.range.startContainer
          : hit.range.startContainer.parentElement
      host?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const selection = hit.doc.defaultView?.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(hit.range.cloneRange())
    } catch {
      return false
    }
    return true
  }, [])

  const handleSelectMark = useCallback(
    (mark: ReadingMark) => {
      const adapter: RevealAdapter = {
        tryStep: async (step): Promise<boolean> => {
          const view = viewRef.current
          if (!view) return false
          switch (step.type) {
            case 'cfi': {
              try {
                await view.goTo(step.cfi)
              } catch {
                return false
              }
              flashJumpRange(step.cfi)
              return true
            }
            case 'mobi-chapter': {
              const index =
                adapterRef.current?.sections.findIndex((s) => s.id === step.chapterId) ?? -1
              if (index < 0) return false
              try {
                await view.goTo(index)
              } catch {
                return false
              }
              return true
            }
            case 'excerpt':
              return revealExcerptInFoliateDocs(step.text)
            default:
              return false
          }
        },
      }
      void runRevealPlan(mark, adapter).then((result) => {
        if (!result.ok) {
          reportRuntimeError(new Error(`reveal miss (${result.miss.reason})`), {
            source: 'mark-linkage',
            op: 'reveal',
            silentToast: true,
            filePath,
            data: { markId: mark.id, reason: result.miss.reason },
          })
        }
      })
    },
    [filePath, flashJumpRange, revealExcerptInFoliateDocs],
  )

  // 悬浮窗卡片 reveal 请求：同文件 mark 才执行（跨文件请求忽略）。
  useEffect(() => {
    return subscribeRevealMark((id) => {
      const mark = marksRef.current.find((item) => item.id === id)
      if (mark) handleSelectMark(mark)
    })
  }, [handleSelectMark])

  const handleDeleteMark = useCallback(
    async (mark: ReadingMark) => {
      const key = overlayerKeyForMark(mark)
      if (key) {
        try {
          await viewRef.current?.deleteAnnotation({ value: key })
        } catch {
          // overlay 缺失不影响删除本体
        }
      }
      await deleteMark(mark.id)
      toast.success('已删除')
    },
    [deleteMark],
  )

  const addBookmarkAtCurrent = useCallback(async () => {
    const current = lastLocationRef.current
    if (!current?.cfi || !fileFingerprint) {
      toast.error('无法获取当前阅读位置')
      throw new Error('无法获取当前阅读位置')
    }
    const sectionId = adapterRef.current?.sections[current.sectionIndex]?.id
    const bookmarkAnchor =
      kindRef.current === 'epub'
        ? { format: 'epub' as const, cfi: current.cfi, href: sectionId }
        : { format: 'mobi' as const, chapterId: sectionId ?? '', cfi: current.cfi }
    const result = await createMark({
      filePath,
      fileFingerprint,
      kind: 'bookmark',
      anchor: bookmarkAnchor,
      label: nav.current?.label ?? '书签',
      // 写入时固化章节归属（单入口 toCanonicalChapter）
      chapter: toCanonicalChapter(bookmarkAnchor, tocFromEpubUnits(chaptersRef.current)) ?? undefined,
    })
    if (!isOk(result)) {
      throw new Error(result.error.message || '创建书签失败')
    }
    toast.success('已添加书签')
    return result.value
  }, [createMark, fileFingerprint, filePath, nav])

  const handleSaveAnnotation = useCallback(
    async (note: string, color = DEFAULT_HIGHLIGHT_COLOR) => {
      const snapshot = selectionSnapshotRef.current
      if (!snapshot || !fileFingerprint) {
        throw new Error('当前没有可用选区，请先划选文本')
      }
      const sectionIndex = lastLocationRef.current?.sectionIndex
      const sectionId =
        typeof sectionIndex === 'number'
          ? (adapterRef.current?.sections[sectionIndex]?.id ?? '')
          : ''
      const anchor =
        kindRef.current === 'epub'
          ? {
              format: 'epub' as const,
              cfi: snapshot.cfiRange,
              cfiRange: snapshot.cfiRange,
              href: sectionId,
              selectedText: snapshot.text,
            }
          : {
              format: 'mobi' as const,
              chapterId: sectionId,
              cfi: snapshot.cfiRange,
              cfiRange: snapshot.cfiRange,
              selectedText: snapshot.text,
            }

      const existing = findMarkForSelection(marks, {
        format: kindRef.current,
        text: snapshot.text,
        cfiRange: snapshot.cfiRange,
      })
      // 写入时固化章节归属；老卡重存时顺手补上（触达即升级）
      const anchorChapter =
        toCanonicalChapter(anchor, tocFromEpubUnits(chaptersRef.current)) ?? undefined
      const meta = parseNoteToCardMeta(note)
      if (existing) {
        const trimmed = meta.note?.trim()
        const result = await updateMark({
          id: existing.id,
          color,
          chapter: anchorChapter,
          ...(trimmed
            ? {
                note: trimmed,
                kind: existing.kind === 'highlight' ? ('highlight' as const) : ('note' as const),
              }
            : {}),
          ...(meta.category ? { category: meta.category } : {}),
          ...(meta.title ? { title: meta.title } : {}),
          ...(meta.aiSummary ? { aiSummary: meta.aiSummary } : {}),
          ...(meta.keyPoints ? { keyPoints: meta.keyPoints } : {}),
          ...(meta.diagramId ? { diagramId: meta.diagramId } : {}),
        })
        if (!isOk(result)) {
          throw new Error(result.error.message || '更新标记失败')
        }
        removePendingAnnotateHighlight()
        syncVisualMarks()
        toast.success(trimmed ? '已保存批注' : '已更新高亮')
        clearTextSelection()
        return result.value
      }

      const result = await createMark({
        filePath,
        fileFingerprint,
        kind: note ? 'note' : 'highlight',
        anchor,
        excerpt: snapshot.text,
        note: meta.note,
        category: meta.category,
        title: meta.title,
        aiSummary: meta.aiSummary,
        keyPoints: meta.keyPoints,
        diagramId: meta.diagramId,
        color,
        chapter: anchorChapter,
      })
      if (!isOk(result)) {
        throw new Error(result.error.message || '创建批注失败')
      }
      removePendingAnnotateHighlight()
      syncVisualMarks()
      toast.success(note ? '已保存批注' : '已添加高亮')
      clearTextSelection()
      return result.value
    },
    [
      clearTextSelection,
      createMark,
      fileFingerprint,
      filePath,
      marks,
      removePendingAnnotateHighlight,
      syncVisualMarks,
      updateMark,
    ],
  )

  const selectionActions = useReaderSelectionActions({
    snapshotText: selectionSnapshot?.text,
    dimTextSelection,
    clearTextSelection,
    openAnnotateDialog: () => {
      setEditingNoteMark(null)
      setNoteDialogOpen(true)
      setSelectionToolbarPos(null)
    },
    showPendingHighlight: showPendingAnnotateHighlight,
    saveHighlight: handleSaveAnnotation,
    sessionKey: fileFingerprint ?? filePath,
  })

  const getRenderedDocs = useCallback((): Array<{ doc: Document; index: number }> => {
    try {
      const renderer = viewRef.current?.renderer as unknown as {
        getContents: () => Array<{ doc: Document; index: number }>
      } | null
      return renderer?.getContents() ?? []
    } catch {
      return []
    }
  }, [])

  const markHoverHandlers = useCallback(
    () => ({
      onEnter: (mark: ReadingMark, anchor: { left: number; top: number; width: number }) => {
        setHoveredMark(mark)
        setMarkTooltipPos({
          x: anchor.left + anchor.width / 2,
          y: anchor.top,
        })
      },
      onLeave: () => {
        setHoveredMark(null)
        setMarkTooltipPos(null)
      },
    }),
    [],
  )

  /** 同一 range 的检查器开启逻辑（overlay 点击与测试钩子共用） */
  const openInspectorAtRange = useCallback((mark: ReadingMark, range: Range) => {
    const doc = range.startContainer.ownerDocument
    if (!doc) return false
    const frame = doc.defaultView?.frameElement as HTMLElement | null
    const frameRect = frame?.getBoundingClientRect()
    const rect = range.getBoundingClientRect()
    inspectorRef.current.openAt(
      [mark],
      (frameRect?.left ?? 0) + rect.left + rect.width / 2,
      (frameRect?.top ?? 0) + rect.top,
    )
    return true
  }, [])

  const handleCreateMarkAt = useCallback(
    async ({ excerpt, note, flatIndex }: CreateMarkAtParams) => {
      const navState = useReaderNavigationStore.getState().nav
      if (typeof flatIndex === 'number' && flatIndex >= 0 && flatIndex !== navState.flatIndex) {
        const chapter = chaptersRef.current[flatIndex]
        if (!chapter) throw new Error('章节索引无效')
        goToChapter(chapter, flatIndex)
      }
      const snapshot = await waitForDom(() => {
        for (const { doc, index } of getRenderedDocs()) {
          const body = doc.body
          if (!body) continue
          const range = findTextRangeInRoot(body, excerpt)
          if (!range) continue
          const text = range.toString().trim()
          if (!text) continue
          let cfiRange = ''
          try {
            cfiRange = viewRef.current?.getCFI(index, range) ?? ''
          } catch {
            cfiRange = ''
          }
          if (!cfiRange) continue
          const built = buildEpubSnapshotFromRange(
            {
              window: doc.defaultView as Window,
              cfiFromRange: (target) => viewRef.current?.getCFI(index, target) ?? '',
            },
            range,
            text,
          )
          if (built) return built
        }
        return null
      })
      if (!snapshot) {
        throw new Error('未在当前章节找到该摘录，请打开对应章节后重试')
      }
      selectionSnapshotRef.current = snapshot
      setSelectionSnapshot(snapshot)
      return handleSaveAnnotation(note)
    },
    [getRenderedDocs, goToChapter, handleSaveAnnotation],
  )

  const bindSectionDocInteractions = useCallback(
    (doc: Document, index: number) => {
      const cleanupFns: Array<() => void> = []
      const onMouseDown = (event: MouseEvent) => {
        pointerOriginRef.current = { x: event.clientX, y: event.clientY }
      }
      const handleDocPointerUp = (isClick: boolean): void => {
        const frame = doc.defaultView?.frameElement as HTMLElement | null
        const frameRect = frame?.getBoundingClientRect()
        const view = viewRef.current
        if (!view) return
        const contents = {
          window: doc.defaultView as Window,
          cfiFromRange: (range: Range) => view.getCFI(index, range),
        }
        const snapshot = readEpubSelection(contents)
        if (!snapshot) {
          if (isClick) {
            inspectorRef.current.close()
          }
          return
        }
        inspectorRef.current.close()
        setSelectionSnapshot(snapshot)
        selectionSnapshotRef.current = snapshot
        commitReaderSelection(filePathRef.current, snapshot.text)
        focusAgentComposerOnReaderSelection()
        setSelectionToolbarPos({
          x: (frameRect?.left ?? 0) + snapshot.rect.left + snapshot.rect.width / 2,
          y: (frameRect?.top ?? 0) + snapshot.rect.top,
        })
        void origin
      }
      const onMouseUp = (event: MouseEvent) => {
        const origin = pointerOriginRef.current
        const isClick = isClickNotDrag(origin, {
          clientX: event.clientX,
          clientY: event.clientY,
        } as MouseEvent)
        window.setTimeout(() => {
          handleDocPointerUp(isClick)
        }, 10)
      }
      doc.addEventListener('mousedown', onMouseDown)
      doc.addEventListener('mouseup', onMouseUp)
      // 点击正文标记 → 卡片轨滚动到对应卡并闪现（反向联动；拖选走正常选区流程）
      const onMarkClick = (event: MouseEvent) => {
        const origin = pointerOriginRef.current
        if (
          !isClickNotDrag(origin, {
            clientX: event.clientX,
            clientY: event.clientY,
          } as MouseEvent)
        ) {
          return
        }
        const overlayer = viewRef.current?.renderer
          ?.getContents()
          .find((item) => item.doc === doc)?.overlayer
        if (!overlayer) return
        const [key] = overlayer.hitTest({ x: event.clientX, y: event.clientY })
        const mark =
          typeof key === 'string' ? findMarkByOverlayerKey(marksRef.current, key) : undefined
        if (!mark) return
        emitRailFocus(mark.id)
      }
      doc.addEventListener('click', onMarkClick)
      const unbindCollapse = bindDocumentSelectionCollapse(doc, doc.defaultView as Window, () => {
        setSelectionToolbarPos(null)
      })
      cleanupFns.push(() => {
        doc.removeEventListener('mousedown', onMouseDown)
        doc.removeEventListener('mouseup', onMouseUp)
        doc.removeEventListener('click', onMarkClick)
        unbindCollapse()
      })

      // 批注 hover：经本节 overlayer 命中，仅有正文的批注才浮层
      let hoverRaf = 0
      const onMouseMove = (event: MouseEvent) => {
        if (hoverRaf !== 0) return
        hoverRaf = window.requestAnimationFrame(() => {
          hoverRaf = 0
          const overlayer = viewRef.current?.renderer
            ?.getContents()
            .find((item) => item.doc === doc)?.overlayer
          if (!overlayer) return
          const [key] = overlayer.hitTest({ x: event.clientX, y: event.clientY })
          const mark =
            typeof key === 'string' ? findMarkByOverlayerKey(marksRef.current, key) : undefined
          if (!mark?.note?.trim()) {
            if (hoveredMarkIdRef.current !== null) {
              hoveredMarkIdRef.current = null
              markHoverHandlers().onLeave()
            }
            return
          }
          if (hoveredMarkIdRef.current === mark.id) return
          hoveredMarkIdRef.current = mark.id
          const frame = doc.defaultView?.frameElement as HTMLElement | null
          const frameRect = frame?.getBoundingClientRect()
          // 以事件点为锚显示浮层（overlay 内坐标即 iframe 视口坐标）
          markHoverHandlers().onEnter(mark, {
            left: (frameRect?.left ?? 0) + event.clientX,
            top: (frameRect?.top ?? 0) + event.clientY,
            width: 0,
          })
        })
      }
      const onMouseLeave = () => {
        hoveredMarkIdRef.current = null
        markHoverHandlers().onLeave()
      }
      doc.addEventListener('mousemove', onMouseMove, { passive: true })
      doc.addEventListener('mouseleave', onMouseLeave)
      cleanupFns.push(() => {
        doc.removeEventListener('mousemove', onMouseMove)
        doc.removeEventListener('mouseleave', onMouseLeave)
        if (hoverRaf !== 0) {
          window.cancelAnimationFrame(hoverRaf)
          hoverRaf = 0
        }
      })
      return () => {
        cleanupFns.forEach((fn) => {
          try {
            fn()
          } catch {
            // 文档已销毁时忽略
          }
        })
      }
    },
    [markHoverHandlers],
  )

  useEffect(() => {
    return bindOutsideReaderPointerDismiss(
      (target) => {
        const container = containerRef.current
        if (!container) return false
        return container.contains(target)
      },
      () => {
        if (noteDialogOpen) return
        dimTextSelection()
      },
    )
  }, [dimTextSelection, noteDialogOpen])

  useEffect(() => {
    return () => {
      clearReaderSelection()
    }
  }, [filePath])

  useEffect(() => {
    if (!ready) return
    syncVisualMarks()
    syncMarkHighlights()
    syncMarkFlags()
  }, [marks, ready, readerFontSize, readerLineHeight, syncVisualMarks, syncMarkHighlights, syncMarkFlags, theme])

  useEffect(() => {
    if (error && typeof error === 'object' && error !== null && 'code' in error) {
      reportAppError(error as AppError)
    }
  }, [error])

  useEffect(() => {
    const container = containerRef.current
    if (!data || !container) return

    container.innerHTML = ''
    setReady(false)
    setChapters([])
    setGlobalProgress(0)
    setSelectionSnapshot(null)
    setSelectionToolbarPos(null)
    selectionSnapshotRef.current = null
    lastLocationRef.current = null
    chaptersRef.current = []
    chapterSectionsRef.current = []
    viewRef.current = null
    adapterRef.current = null

    let cancelled = false
    let view: FoliateViewElement | null = null
    const docCleanups = new Map<Document, () => void>()

    // view 级 relocate 明细：{ fraction（全书）, section: { current }, cfi, tocItem }，
    // 与 paginator 级 { index } 形状不同，此处只认 view 级。
    const onRelocate = (event: CustomEvent) => {
      const detail = event.detail as {
        section?: { current?: number }
        fraction?: number
        cfi?: string
        tocItem?: { label?: string; href?: string } | null
      }
      if (cancelled) return
      const sectionIndex = detail.section?.current ?? 0
      const fraction = detail.fraction ?? 0
      lastLocationRef.current = {
        cfi: detail.cfi,
        sectionIndex,
        fraction,
      }
      setGlobalProgress(resolveGlobalProgress(fraction))
      syncChapterNav(sectionIndex, detail.cfi)
      schedulePersistReadingProgress(sectionIndex, fraction, detail.cfi)
      // 切节时重绘卡片常驻标记与旗标（节内滚动文档集合不变，无需重算）
      if (lastMarkSectionRef.current !== sectionIndex) {
        lastMarkSectionRef.current = sectionIndex
        syncMarkHighlights()
        syncMarkFlags()
      }
      // 节内分片细化：用 foliate 自带的可见 TOC 项（与其渲染一致），而非自测矩形
      const tocHref = detail.tocItem?.href
      if (tocHref) {
        const flat = chaptersRef.current.findIndex(
          (unit) => unit.href.toLowerCase() === tocHref.toLowerCase(),
        )
          if (
            typeof window !== 'undefined' &&
            appApi.isE2EFoliateReader() &&
            containerRef.current
          ) {
          containerRef.current.dataset.e2eFlatIndex = String(flat)
        }
        if (flat >= 0 && !isNavIntentLocked(useReaderNavigationStore.getState().navIntent)) {
          useReaderNavigationStore.getState().syncFlatIndex(flat)
        }
      }
    }

    const onLoad = (event: CustomEvent) => {
      const detail = event.detail as { doc: Document; index: number }
      if (cancelled) return
      applyDocTheme(detail.doc)
      docCleanups.get(detail.doc)?.()
      const unbindInteractions = bindSectionDocInteractions(detail.doc, detail.index)
      const unbindRailFollow = bindRailFollow(detail.doc, detail.index)
      docCleanups.set(detail.doc, () => {
        unbindInteractions()
        unbindRailFollow()
      })
      syncVisualMarks()
      lastMarkSectionRef.current = -1
      syncMarkHighlights()
      syncMarkFlags()
    }

    const onLink = (event: CustomEvent) => {
      const detail = event.detail as { href?: string }
      if (!detail.href) return
      event.preventDefault()
      const sectionIndex = adapterRef.current?.resolveHref(detail.href) ?? null
      if (sectionIndex === null || sectionIndex < 0 || !viewRef.current) return
      const flatIndex = chaptersRef.current.findIndex(
        (_, flat) => chapterSectionsRef.current[flat] === sectionIndex,
      )
      if (flatIndex >= 0) {
        useReaderNavigationStore.getState().syncFlatIndex(flatIndex)
      }
      void viewRef.current.goTo(sectionIndex).catch(() => undefined)
    }

    const onExternalLink = (event: CustomEvent) => {
      const detail = event.detail as { href?: string; href_?: string }
      event.preventDefault()
      const href = detail.href ?? detail.href_
      if (href) void appApi.openExternal(href)
    }

    const onShowAnnotation = (event: CustomEvent) => {
      const detail = event.detail as { value: string; index: number; range: Range }
      if (cancelled) return
      const mark = findMarkByOverlayerKey(marksRef.current, detail.value)
      if (!mark) return
      openInspectorAtRange(mark, detail.range)
    }

    const onDrawAnnotation = (event: CustomEvent) => {
      const detail = event.detail as {
        draw: (drawFunc: unknown, drawOptions?: unknown) => void
        annotation: { value: string }
      }
      const mark = findMarkByOverlayerKey(marksRef.current, detail.annotation.value)
      const draw = async () => {
        const { Overlayer } = await import('@foliate/overlayer.js')
        detail.draw(Overlayer.highlight satisfies OverlayerDrawFn, {
          color: mark?.color ?? DEFAULT_HIGHLIGHT_COLOR,
        })
      }
      void draw().catch(() => undefined)
    }

    void (async () => {
      try {
        const bytes = new Uint8Array(
          data.data.buffer.slice(data.data.byteOffset, data.data.byteOffset + data.data.byteLength),
        )
        const adapter = await openFoliateBook(bytes, filePath)
        if (cancelled) return
        adapterRef.current = adapter

        const flatChapters: EpubChapter[] = []
        const sectionIndices: Array<number | null> = []
        const walk = (items: typeof adapter.toc, level: number) => {
          for (const item of items) {
            flatChapters.push({
              label: item.label.trim() || '未命名章节',
              href: item.href ?? `section:${item.sectionIndex ?? -1}`,
              level,
            })
            sectionIndices.push(item.sectionIndex)
            if (item.children.length > 0) walk(item.children, level + 1)
          }
        }
        walk(adapter.toc, 0)
        // 无目录的书：按 spine 兜底，保证底栏/导出可用
        if (flatChapters.length === 0) {
          adapter.sections.forEach((section, index) => {
            flatChapters.push({ label: `第 ${index + 1} 节`, href: section.id, level: 0 })
            sectionIndices.push(index)
          })
        }
        chaptersRef.current = flatChapters
        chapterSectionsRef.current = sectionIndices
        setChapters(flatChapters)
        useReaderNavigationStore.getState().setUnits(flatChapters)

        // view.js 模块副作用完成自定义元素注册，直接按标签实例化
        await import('@foliate/view.js')
        if (cancelled) return
        const element = document.createElement('foliate-view') as unknown as FoliateViewElement
        element.style.width = '100%'
        element.style.height = '100%'
        element.style.display = 'block'
        container.appendChild(element)
        view = element
        viewRef.current = element

        element.addEventListener('relocate', onRelocate as EventListener)
        element.addEventListener('load', onLoad as EventListener)
        element.addEventListener('link', onLink as EventListener)
        element.addEventListener('external-link', onExternalLink as EventListener)
        element.addEventListener('show-annotation', onShowAnnotation as EventListener)
        element.addEventListener('draw-annotation', onDrawAnnotation as EventListener)

        await element.open(adapter.engineBook)
        if (cancelled) return
        try {
          element.renderer?.setAttribute('flow', 'scrolled')
          element.renderer?.setAttribute('max-inline-size', '1040px')
        } catch {
          // paginated 回退：保持默认分页
        }

        // 恢复进度：epub 用 CFI，mobi 用章节；都不命中则首个正文章节
        let restored = false
        if (kindRef.current === 'epub') {
          const saved = useReadingProgressStore.getState().getEpubProgress(filePath)
          if (saved?.percentage != null) setGlobalProgress(saved.percentage)
          if (saved?.cfi) {
            try {
              await element.goTo(saved.cfi)
              restored = true
            } catch {
              restored = false
            }
          }
        } else {
          const saved = useReadingProgressStore.getState().getMobiProgress(filePath)
          if (saved?.chapterId) {
            const index = adapter.sections.findIndex((s) => s.id === saved.chapterId)
            if (index >= 0) {
              try {
                await element.goTo(index)
                restored = true
              } catch {
                restored = false
              }
            }
          }
        }
        if (!restored) {
          const initial = pickInitialChapter(flatChapters)
          const initialFlat = initial
            ? flatChapters.findIndex(
                (item) => item.href === initial.href && item.label === initial.label,
              )
            : -1
          const initialSection =
            initialFlat >= 0 ? (sectionIndices[initialFlat] ?? null) : null
          if (initialSection !== null && initialSection >= 0) {
            try {
              await element.goTo(initialSection)
            } catch {
              // 回退首节由 init 兜底
            }
            if (initialFlat >= 0) {
              useReaderNavigationStore.getState().syncFlatIndex(initialFlat)
            }
          } else {
            await element.init({ showTextStart: true })
          }
        }

        if (!cancelled) {
          setReady(true)
          useReaderNavigationStore.getState().setReady(true)
        }
      } catch (cause) {
        if (!cancelled) {
          reportAppError({
            code: 'FILE_READ_ERROR',
            message: cause instanceof Error ? cause.message : '电子书加载失败',
          })
        }
      }
    })()

    return () => {
      cancelled = true
      if (saveProgressTimerRef.current !== null) {
        window.clearTimeout(saveProgressTimerRef.current)
        saveProgressTimerRef.current = null
      }
      try {
        const current = lastLocationRef.current
        if (current) {
          persistReadingProgress(current.sectionIndex, current.fraction, current.cfi)
        }
      } catch {
        // 视图已销毁时忽略
      }
      docCleanups.forEach((cleanup) => {
        try {
          cleanup()
        } catch {
          // 文档已销毁时忽略
        }
      })
      docCleanups.clear()
      try {
        if (view) {
          view.removeEventListener('relocate', onRelocate as EventListener)
          view.removeEventListener('load', onLoad as EventListener)
          view.removeEventListener('link', onLink as EventListener)
          view.removeEventListener('external-link', onExternalLink as EventListener)
          view.removeEventListener('show-annotation', onShowAnnotation as EventListener)
          view.removeEventListener('draw-annotation', onDrawAnnotation as EventListener)
          view.close()
          view.remove()
        }
      } catch {
        // 销毁期异常忽略
      }
      try {
        adapterRef.current?.destroy()
      } catch {
        // 忽略
      }
      viewRef.current = null
      adapterRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, filePath])

  // 主题/排版变化只重刷已渲染章节文档，不重建 book
  useEffect(() => {
    if (!ready) return
    for (const { doc } of getRenderedDocs()) {
      applyDocTheme(doc)
    }
    syncVisualMarks()
  }, [applyDocTheme, getRenderedDocs, ready, readerFontSize, readerLineHeight, syncVisualMarks, syncMarkHighlights, theme])

  useEffect(() => {
    return registerReaderContent({
      filePath,
      getCurrentText: () => {
        return getRenderedDocs()
          .map((item) => extractDocumentText(item.doc))
          .join('\n\n')
      },
      getViewportText: () => {
        return getRenderedDocs()
          .map((item) => extractViewportText(item.doc))
          .join('\n\n')
      },
      iterateUnits: async function* () {
        const adapter = adapterRef.current
        if (!adapter) return
        for (const section of adapter.sections) {
          const text = await adapter.loadSectionText(section.index)
          const chapter = chaptersRef.current.find(
            (_, flat) => chapterSectionsRef.current[flat] === section.index,
          )
          if (text) yield { label: chapter?.label ?? `第 ${section.index + 1} 节`, text }
        }
      },
      getUnitByIndex: async (flatIndex) => {
        const adapter = adapterRef.current
        const chapter = chaptersRef.current[flatIndex]
        if (!adapter || !chapter) return null
        const sectionIndex = chapterSectionsRef.current[flatIndex]
        if (sectionIndex === null || sectionIndex === undefined || sectionIndex < 0) return null
        const text = await adapter.loadSectionText(sectionIndex)
        if (!text.trim()) return null
        return { label: chapter.label, text }
      },
    })
  }, [filePath, getRenderedDocs])

  useEffect(() => {
    return registerSelectionProvider({
      filePath,
      getSelectionText: () => selectionSnapshotRef.current?.text?.trim() || null,
    })
  }, [filePath])

  useEffect(() => {
    return registerReaderMarks({
      filePath,
      createBookmark: () => addBookmarkAtCurrent(),
      createNoteFromSelection: (note) => handleSaveAnnotation(note),
      createMarkAt: (params) => handleCreateMarkAt(params),
      navigateToFlatIndex: (index) => {
        const chapter = chaptersRef.current[index]
        if (chapter) goToChapter(chapter, index)
      },
    })
  }, [addBookmarkAtCurrent, filePath, goToChapter, handleCreateMarkAt, handleSaveAnnotation])

  // E2E 专用：closed shadow DOM 无法做 DOM 级选区/点击，钩子走同一管线
  //（findTextRangeInRoot → snapshot → toolbar；toRange → inspector）。
  useEffect(() => {
    if (typeof window === 'undefined' || !appApi.isE2EFoliateReader()) return
    window.__montreeE2eReader = {
      listMarks: () =>
        marksRef.current.map((mark) => ({ id: mark.id, kind: mark.kind, excerpt: mark.excerpt })),
      selectText: async (excerpt: string) => {
        const view = viewRef.current
        if (!view) return false
        // 章节文档异步渲染，最长等 ~6s（与 handleCreateMarkAt 同策略）
        const found = await waitForDom(() => {
          for (const { doc, index } of getRenderedDocs()) {
            const body = doc.body
            if (!body) continue
            const range = findTextRangeInRoot(body, excerpt)
            if (range) return { doc, index, range }
          }
          return null
        }, { attempts: 120, delayMs: 50 })
        if (!found) return false
        const { doc, index, range } = found
        const selection = doc.defaultView?.getSelection()
        if (!selection) return false
        selection.removeAllRanges()
        try {
          selection.addRange(range.cloneRange())
        } catch {
          return false
        }
          const snapshot = buildEpubSnapshotFromRange(
            {
              window: doc.defaultView as Window,
              cfiFromRange: (target) => view.getCFI(index, target),
            },
            range,
            range.toString(),
          )
          if (!snapshot) return false
          inspectorRef.current.close()
          setSelectionSnapshot(snapshot)
          selectionSnapshotRef.current = snapshot
          commitReaderSelection(filePathRef.current, snapshot.text)
          const frame = doc.defaultView?.frameElement as HTMLElement | null
          const frameRect = frame?.getBoundingClientRect()
          const rect = range.getBoundingClientRect()
          setSelectionToolbarPos({
            x: (frameRect?.left ?? 0) + rect.left + rect.width / 2,
            y: (frameRect?.top ?? 0) + rect.top,
          })
          return true
        },
      clickMark: async (markId: string) => {
        const mark = marksRef.current.find((item) => item.id === markId)
        const key = mark ? overlayerKeyForMark(mark) : null
        const view = viewRef.current
        if (!mark || !key || !view) return false
        // 经 view 自身逆过程定位（与 getCFI 配对；直接 toRange 会误解 spine 前缀）
        let resolved: { index: number; anchor: (doc: Document) => Range }
        try {
          resolved = view.resolveCFI(key)
        } catch {
          return false
        }
        const target = getRenderedDocs().find((item) => item.index === resolved.index)
        if (!target) return false
        let range: Range
        try {
          range = resolved.anchor(target.doc)
        } catch {
          return false
        }
        return openInspectorAtRange(mark, range)
      },
    }
    return () => {
      delete window.__montreeE2eReader
    }
  }, [filePath, getRenderedDocs, openInspectorAtRange])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!ready) return
      if (!(event.altKey || event.metaKey)) return
      const { nav: currentNav } = useReaderNavigationStore.getState()
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        const chapter = currentNav.previous
        if (chapter) goToChapter(chapter, currentNav.previousIndex)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        const chapter = currentNav.next
        if (chapter) goToChapter(chapter, currentNav.nextIndex)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [goToChapter, ready])

  const { currentUnitId } = useReaderNavTitles()
  const resolveChapter = kindRef.current === 'epub' ? resolveEpubChapter : resolveMobiChapter

  const { handleExportNotes, handleExportAnkiCards } = useReaderExportMenu({
    marks,
    filePath,
    getToc: () => tocFromEpubUnits(chapters),
    getCurrentChapter: (toc) =>
      findCurrentChapterRef(toc, currentUnitId ? normalizeLoadKey(currentUnitId) : ''),
    resolveChapter,
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ReaderToolbarShell
        ready={ready}
        tocDisabled={chapters.length === 0}
        onTocToggle={toggleToc}
        onMarksToggle={toggleMarks}
        onAddBookmark={() => void addBookmarkAtCurrent()}
        trailing={
          <>
            <PdfBookSearch
              fingerprint={filePath}
              backend="memory"
              docKey={filePath}
              onJumpToLabel={handleJumpToLabel}
            />
            <ReaderTypographyControls disabled={!ready} />
            {ready ? (
              <div className="relative text-muted-foreground">
                <ReadingProgressRing progress={globalProgress} />
              </div>
            ) : null}
            {isLoading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
          </>
        }
      />

      {/* 内框行：正文（含卡轨）与 AI 侧栏并列，同属左大块；底导航收进正文列 */}
      <div className="flex min-h-0 flex-1">
        <ReaderContentShell
          filePath={filePath}
        marksOpen={marksOpen}
        marks={marks}
        onSelectMark={handleSelectMark}
        onDeleteMark={(mark) => void handleDeleteMark(mark)}
        onCloseMarks={closeMarks}
        onExportNotes={handleExportNotes}
        onExportAnkiCards={handleExportAnkiCards}
        marksToc={tocFromEpubUnits(chapters)}
        marksCurrentChapterKey={currentUnitId ? normalizeLoadKey(currentUnitId) : undefined}
        marksResolveChapter={resolveChapter}
        tocOpen={tocOpen}
        units={chapters}
        currentUnitId={currentUnitId}
        onCloseToc={closeToc}
        onSelectUnit={(unit) => {
          const index = chapters.findIndex(
            (item) => item.href === unit.href && item.label === unit.label,
          )
          goToChapter(unit, index >= 0 ? index : undefined)
        }}
        onHoverExcerpt={handleHoverExcerpt}
        readingFraction={globalProgress}
        footerNav={
          <ReaderFooterNav
            ready={ready}
            onPrevious={() => goToChapter(nav.previous, nav.previousIndex)}
            onNext={() => goToChapter(nav.next, nav.nextIndex)}
          />
        }
      >
        <PaneErrorBoundary name={isEpub ? 'EPUB 阅读' : 'MOBI 阅读'} filePath={filePath}>
          <div
            ref={containerRef}
            className="foliate-reader-host relative h-full min-h-0 overflow-hidden bg-[var(--color-bg-base)]"
            data-theme={theme}
          >
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                正在加载{isEpub ? ' EPUB' : ' MOBI'}…
              </div>
            )}
          </div>
        </PaneErrorBoundary>
        </ReaderContentShell>
        {dockedAgentVisible ? (
          <DockedAgentPane workspaceRoot={workspaceRoot} />
        ) : null}
      </div>

      {markTooltipPos && hoveredMark && !inspector.active ? (
        <EpubMarkTooltip mark={hoveredMark} x={markTooltipPos.x} y={markTooltipPos.y} />
      ) : null}

      {inspector.pos && inspector.active ? (
        <ReadingMarkPopover
          mark={inspector.active}
          stack={inspector.stack}
          x={inspector.pos.x}
          y={inspector.pos.y}
          onSelect={inspector.select}
          onChangeColor={(color) => {
            void updateMark({ id: inspector.active!.id, color }).then(() => syncVisualMarks())
          }}
          onEditNote={() => {
            setEditingNoteMark(inspector.active)
            setNoteDialogOpen(true)
            inspector.close()
          }}
          onDelete={() => {
            void handleDeleteMark(inspector.active!).then(() => inspector.close())
          }}
        />
      ) : null}

      {selectionToolbarPos && selectionSnapshot ? (
        <SelectionToolbar
          x={selectionToolbarPos.x}
          y={selectionToolbarPos.y}
          readOnly
          onCopy={selectionActions.handleCopy}
          hasSelectionForCopy={Boolean(selectionSnapshot?.text?.trim())}
          keyEventDocs={getRenderedDocs().map((item) => item.doc)}
          onAnnotate={selectionActions.handleAnnotate}
          onHighlight={selectionActions.handleHighlight}
          onAddToChat={selectionActions.handleAddToChat}
          onAskAgent={selectionActions.handleAskAgent}
          onAskDeepAnswer={selectionActions.askDeepAnswer}
          deepAnswerPending={selectionActions.deepAnswerPending}
          onGenerateCardPreset={selectionActions.generateAiCard}
          cardPresetPending={selectionActions.aiCardPending}
          onDismiss={selectionActions.handleDismiss}
        />
      ) : null}

      <DeepAnswerDialog
        data={selectionActions.deepAnswer}
        pending={selectionActions.deepAnswerPending}
        onClose={selectionActions.dismissDeepAnswer}
        onRetry={selectionActions.retryDeepAnswer}
        onSaveAsNote={selectionActions.saveDeepAnswerAsNote}
      />

      <AnnotationNoteDialog
        open={noteDialogOpen}
        filePath={filePath}
        fileFingerprint={fileFingerprint}
        aiAssist
        excerpt={editingNoteMark?.excerpt ?? selectionSnapshot?.text}
        initialNote={editingNoteMark?.note ?? ''}
        title={editingNoteMark ? '编辑批注' : '添加批注'}
        onOpenChange={(open) => {
          setNoteDialogOpen(open)
          if (!open) {
            const wasEditing = Boolean(editingNoteMark)
            setEditingNoteMark(null)
            removePendingAnnotateHighlight()
            if (!wasEditing) clearTextSelection()
          }
        }}
        onSave={(note) => {
          if (editingNoteMark) {
            void updateMark({
              id: editingNoteMark.id,
              note,
              kind: editingNoteMark.kind === 'highlight' ? 'highlight' : 'note',
            }).then((result) => {
              if (isOk(result)) {
                toast.success(note.trim() ? '已保存批注' : '已清除批注')
                syncVisualMarks()
              }
            })
            return
          }
          void handleSaveAnnotation(note)
        }}
      />
    </div>
  )
}
