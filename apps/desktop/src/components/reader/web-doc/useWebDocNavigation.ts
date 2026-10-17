import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWebDocPage } from '@/hooks/reader/useWebDocPage'
import { useWebDocToc } from '@/hooks/reader/useWebDocToc'
import { useReaderNavigationStore } from '@/stores/reader-navigation-store'
import { useReadingProgressStore } from '@/stores/reading-progress-store'
import { useWebDocStore } from '@/stores/web-doc-store'
import { appApi } from '@/api/app-api'
import {
  buildWebDocFileFingerprint,
  formatWebDocTitle,
  resolveWebDocDocumentId,
  resolveWebDocSiteId,
  resolveWebDocTocDiscoveryUrl,
  stripWebDocFragment,
} from '@montree/web-doc'
import {
  resolveWebDocClickHref,
  resolveWebDocFragment,
  shouldNavigateWebDocInApp,
} from '@/lib/reader/web-doc/web-doc-link'
import {
  findWebDocFlatIndex,
  normalizeWebDocNavUrl,
  webDocTocEntriesToReaderUnits,
} from '@yitom/reader-core'
import { extractWebDocHeadings } from '@/lib/reader/web-doc/web-doc-outline'
import {
  collectPreviewHeadingPositions,
  findActiveHeadingByPositions,
  type MarkdownHeading,
} from '@/lib/editor/markdown-headings'
import { logWebDoc } from '@/lib/reader/web-doc/web-doc-debug'
import type { EditorOutlineState } from '@/components/layout/main/EditorWorkspaceMain'

export interface UseWebDocNavigationOptions {
  pageUrl: string
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  onOutlineChange?: (state: EditorOutlineState) => void
}

export function useWebDocNavigation({
  pageUrl,
  iframeRef,
  onOutlineChange,
}: UseWebDocNavigationOptions) {
  const pageUrlRef = useRef(pageUrl)
  pageUrlRef.current = pageUrl

  const openPage = useWebDocStore((state) => state.openPage)
  const nav = useReaderNavigationStore((state) => state.nav)

  const { data, isLoading, isFetching, error, refetch } = useWebDocPage(pageUrl)

  const siteId = useMemo(() => resolveWebDocSiteId(pageUrl), [pageUrl])
  const documentId = useMemo(() => resolveWebDocDocumentId(pageUrl, siteId), [pageUrl, siteId])
  const documentUrl = useMemo(() => stripWebDocFragment(pageUrl), [pageUrl])
  const normalizedPageUrl = useMemo(() => normalizeWebDocNavUrl(pageUrl), [pageUrl])
  const fileFingerprint = useMemo(() => buildWebDocFileFingerprint(documentId), [documentId])

  const [activeSectionUrl, setActiveSectionUrl] = useState<string>(documentUrl)

  // 当跨站点或书级 documentId 切换时，重置当前板块发现入口
  useEffect(() => {
    setActiveSectionUrl(documentUrl)
  }, [documentId])

  const tocDiscoveryUrl = useMemo(() => {
    if (siteId === 'people-daily-paper') {
      return resolveWebDocTocDiscoveryUrl(pageUrl, siteId)
    }
    return activeSectionUrl
  }, [activeSectionUrl, pageUrl, siteId])

  const { data: tocData } = useWebDocToc(tocDiscoveryUrl)
  const [tocMode, setTocMode] = useState<'section' | 'site'>('section')

  useEffect(() => {
    setTocMode('section')
  }, [documentId])

  const sectionUnits = useMemo(
    () => webDocTocEntriesToReaderUnits(tocData?.sectionEntries ?? tocData?.entries ?? []),
    [tocData?.entries, tocData?.sectionEntries],
  )
  const siteUnits = useMemo(
    () => (tocData?.siteEntries ? webDocTocEntriesToReaderUnits(tocData.siteEntries) : []),
    [tocData?.siteEntries],
  )

  // 跨板块检测：若当前页面不在当前板块大纲中，自动切换发现入口拉取新板块；
  // 若当前页面已经在当前板块中，则保持现状避免同板块内翻页抖动或重复拉取
  useEffect(() => {
    if (siteId === 'people-daily-paper') return
    if (sectionUnits.length === 0) {
      if (activeSectionUrl !== documentUrl) {
        setActiveSectionUrl(documentUrl)
      }
      return
    }
    const existsInCurrentSection = findWebDocFlatIndex(sectionUnits, pageUrl) >= 0
    if (!existsInCurrentSection && activeSectionUrl !== documentUrl) {
      setActiveSectionUrl(documentUrl)
    }
  }, [pageUrl, documentUrl, sectionUnits, siteId, activeSectionUrl])

  const hasDualTracks = Boolean(
    tocData?.sectionEntries &&
      tocData?.siteEntries &&
      tocData.sectionEntries.length > 0 &&
      tocData.siteEntries.length > 0,
  )

  const units = useMemo(() => {
    if (hasDualTracks && tocMode === 'site') {
      return siteUnits
    }
    return sectionUnits
  }, [hasDualTracks, siteUnits, sectionUnits, tocMode])

  const tocViews = useMemo(() => {
    if (!hasDualTracks) return undefined
    return [
      { id: 'section', label: '当前板块', count: sectionUnits.length },
      { id: 'site', label: '全站大纲', count: siteUnits.length },
    ]
  }, [hasDualTracks, sectionUnits.length, siteUnits.length])

  const unitsRef = useRef(units)
  unitsRef.current = units

  const displayTitle = useMemo(
    () => formatWebDocTitle(pageUrl, data?.content.title),
    [data?.content.title, pageUrl],
  )

  const pageHeadings = useMemo(
    () => (data?.content.bodyHtml ? extractWebDocHeadings(data.content.bodyHtml) : []),
    [data?.content.bodyHtml],
  )
  const pageHeadingsRef = useRef(pageHeadings)
  pageHeadingsRef.current = pageHeadings
  const [activeHeadingId, setActiveHeadingId] = useState<string>()

  useEffect(() => {
    setActiveHeadingId(undefined)
  }, [pageUrl])

  useEffect(() => {
    onOutlineChange?.({ headings: pageHeadings, activeHeadingId })
  }, [activeHeadingId, onOutlineChange, pageHeadings])

  const syncActiveHeadingFromScroll = useCallback(() => {
    const doc = iframeRef.current?.contentDocument
    const root = doc?.scrollingElement ?? doc?.documentElement
    if (!root || !(root instanceof HTMLElement)) return
    const headings = pageHeadingsRef.current
    if (headings.length === 0) {
      setActiveHeadingId(undefined)
      return
    }
    const positions = collectPreviewHeadingPositions(root)
    const active = findActiveHeadingByPositions(headings, positions, root.scrollTop)
    setActiveHeadingId(active?.id)
  }, [iframeRef])

  const selectHeading = useCallback(
    (heading: MarkdownHeading) => {
      const doc = iframeRef.current?.contentDocument
      const el = doc?.getElementById(heading.id)
      if (!el) return
      el.scrollIntoView({ block: 'start', behavior: 'smooth' })
      setActiveHeadingId(heading.id)
    },
    [iframeRef],
  )

  // 1. 建立导航会话
  useEffect(() => {
    useReaderNavigationStore.getState().beginSession(documentId, 'web')
    return () => {
      useReaderNavigationStore.getState().beginSession('', 'web')
    }
  }, [documentId])

  useEffect(() => {
    if (units.length === 0) return
    useReaderNavigationStore.getState().setUnits(units)
  }, [units])

  useEffect(() => {
    if (!data || units.length === 0) return
    useReaderNavigationStore.getState().syncWeb(units, pageUrl)
    useReaderNavigationStore.getState().setReady(true)
  }, [data, pageUrl, units])

  // 2. 页面路由与跳转
  const navigateToUrl = useCallback(
    (targetUrl: string, flatIndex?: number) => {
      logWebDoc('navigate', { from: pageUrlRef.current, to: targetUrl, flatIndex })

      const currentUnits = unitsRef.current
      const resolvedIndex =
        typeof flatIndex === 'number' ? flatIndex : findWebDocFlatIndex(currentUnits, targetUrl)
      if (resolvedIndex >= 0) {
        useReaderNavigationStore.getState().syncWeb(currentUnits, targetUrl, resolvedIndex)
      }
      openPage(targetUrl)
    },
    [openPage],
  )

  const scrollToWebDocFragment = useCallback(
    (fragment: string): boolean => {
      const doc = iframeRef.current?.contentDocument
      if (!doc) return false

      const target = doc.getElementById(fragment) ?? doc.getElementsByName(fragment)[0]
      if (!target) return false

      target.scrollIntoView({ block: 'start', behavior: 'auto' })
      setActiveHeadingId(target.id || undefined)
      return true
    },
    [iframeRef],
  )

  const handleWebDocLink = useCallback(
    (href: string) => {
      logWebDoc('link-click', { href, pageUrl: pageUrlRef.current })
      if (shouldNavigateWebDocInApp(href, pageUrlRef.current)) {
        navigateToUrl(href)
        return
      }
      void appApi.openExternal(href)
    },
    [navigateToUrl],
  )

  const goPrevious = useCallback(() => {
    const previous = useReaderNavigationStore.getState().nav.previous
    if (!previous) return
    navigateToUrl(previous.href, useReaderNavigationStore.getState().nav.previousIndex)
  }, [navigateToUrl])

  const goNext = useCallback(() => {
    const next = useReaderNavigationStore.getState().nav.next
    if (!next) return
    navigateToUrl(next.href, useReaderNavigationStore.getState().nav.nextIndex)
  }, [navigateToUrl])

  const persistScrollProgress = useCallback(() => {
    const doc = iframeRef.current?.contentDocument
    const root = doc?.documentElement
    if (!root) return

    const scrollHeight = root.scrollHeight - root.clientHeight
    if (scrollHeight <= 0) return

    const scrollRatio = root.scrollTop / scrollHeight
    useReadingProgressStore.getState().saveWebProgress(normalizedPageUrl, { scrollRatio })
  }, [iframeRef, normalizedPageUrl])

  const restoreScrollProgress = useCallback(() => {
    const doc = iframeRef.current?.contentDocument
    const root = doc?.documentElement
    if (!root) return

    const saved = useReadingProgressStore.getState().getWebProgress(normalizedPageUrl)
    if (!saved) return

    const scrollHeight = root.scrollHeight - root.clientHeight
    if (scrollHeight <= 0) return

    root.scrollTop = scrollHeight * saved.scrollRatio
  }, [iframeRef, normalizedPageUrl])

  return {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
    siteId,
    documentId,
    documentUrl,
    normalizedPageUrl,
    fileFingerprint,
    units,
    unitsRef,
    displayTitle,
    pageHeadings,
    activeHeadingId,
    nav,
    selectHeading,
    syncActiveHeadingFromScroll,
    navigateToUrl,
    scrollToWebDocFragment,
    handleWebDocLink,
    goPrevious,
    goNext,
    persistScrollProgress,
    restoreScrollProgress,
    tocViews,
    activeTocView: tocMode,
    onSelectTocView: (mode: string) => setTocMode(mode === 'site' ? 'site' : 'section'),
  }
}
