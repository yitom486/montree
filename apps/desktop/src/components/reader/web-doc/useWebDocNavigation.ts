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
} from '@montree/reader-core'
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

  const tocDiscoveryUrl = useMemo(
    () => resolveWebDocTocDiscoveryUrl(pageUrl, siteId),
    [pageUrl, siteId],
  )
  const { data: tocData } = useWebDocToc(tocDiscoveryUrl)
  const units = useMemo(
    () => webDocTocEntriesToReaderUnits(tocData?.entries ?? []),
    [tocData?.entries],
  )
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
  }
}
