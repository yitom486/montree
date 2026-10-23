import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { Eye } from 'lucide-react'
import { MarkdownContent } from '@/components/markdown/MarkdownContent'
import { useCodeBlockCopy } from '@/hooks/preview/useCodeBlockCopy'
import { useHighlightTheme } from '@/hooks/preview/useHighlightTheme'
import { applyScrollRatio, collectPreviewHeadingPositions, scrollRatio } from '@/lib/editor/markdown-headings'
import type { AppTheme } from '@/stores/editor-ui-store'
import { clearLocalAnchor, peekLocalAnchor, resolveLocalLink } from '@/lib/workspace/resolve-local-link'
import '@/styles/markdown-preview.css'

export interface PreviewPaneHandle {
  scrollToHeading: (id: string) => void
  getActiveHeadingId: () => string | undefined
  getScrollRatio: () => number
  setScrollRatio: (ratio: number) => void
  getScrollElement: () => HTMLElement | null
}

interface PreviewPaneProps {
  html: string
  filePath?: string
  theme?: AppTheme
  onScroll?: () => void
  onHeadingActivate?: (headingId: string) => void
  onOpenWikilink?: (target: string) => void
  onOpenDeepLink?: (url: string) => void
  /** Markdown 内的相对文档链接（other.md / ../x.md） */
  onOpenLocalFile?: (path: string, anchor?: string) => void
}

export const PreviewPane = forwardRef<PreviewPaneHandle, PreviewPaneProps>(
  function PreviewPane(
    { html, filePath, theme = 'dark', onScroll, onHeadingActivate, onOpenWikilink, onOpenDeepLink, onOpenLocalFile },
    ref,
  ) {
    const previewRef = useRef<HTMLDivElement>(null)
    const onScrollRef = useRef(onScroll)
    const onHeadingActivateRef = useRef(onHeadingActivate)
    const onOpenWikilinkRef = useRef(onOpenWikilink)
    const onOpenDeepLinkRef = useRef(onOpenDeepLink)
    const onOpenLocalFileRef = useRef(onOpenLocalFile)
    const filePathRef = useRef(filePath)
    const hasPreview = Boolean(html)

    useHighlightTheme(theme)

    onScrollRef.current = onScroll
    onHeadingActivateRef.current = onHeadingActivate
    onOpenWikilinkRef.current = onOpenWikilink
    onOpenDeepLinkRef.current = onOpenDeepLink
    onOpenLocalFileRef.current = onOpenLocalFile
    filePathRef.current = filePath

    const scrollToHeadingIfPresent = (id: string) => {
      const container = previewRef.current
      if (!container) return false

      const heading = container.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
      if (!heading) return false

      const top =
        heading.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop -
        16
      container.scrollTop = Math.max(0, top)
      return true
    }

    const scrollToHeading = (id: string) => {
      scrollToHeadingIfPresent(id)
    }

    useEffect(() => {
      if (!filePath || !hasPreview) return
      const anchor = peekLocalAnchor(filePath)
      if (!anchor) return
      const frame = requestAnimationFrame(() => {
        try {
          // 预览内容有 debounce；旧内容先到时保留 pending，等目标 HTML 到达再消费。
          if (scrollToHeadingIfPresent(decodeURIComponent(anchor))) clearLocalAnchor(filePath)
        } catch {
          // 非法锚点保持顶部
        }
      })
      return () => cancelAnimationFrame(frame)
    }, [filePath, hasPreview, html])

    useImperativeHandle(ref, () => ({
      scrollToHeading,
      getActiveHeadingId: () => {
        const container = previewRef.current
        if (!container) return undefined

        const positions = collectPreviewHeadingPositions(container)
        if (positions.length === 0) return undefined

        const threshold = container.scrollTop + 32
        let activeId: string | undefined

        for (const position of positions) {
          if (position.top <= threshold) {
            activeId = position.id
          } else {
            break
          }
        }

        return activeId
      },
      getScrollRatio: () => {
        const container = previewRef.current
        return container ? scrollRatio(container) : 0
      },
      setScrollRatio: (ratio) => {
        const container = previewRef.current
        if (container) applyScrollRatio(container, ratio)
      },
      getScrollElement: () => previewRef.current,
    }))

    useEffect(() => {
      const container = previewRef.current
      if (!container) return

      const handleScroll = () => onScrollRef.current?.()
      container.addEventListener('scroll', handleScroll, { passive: true })
      return () => container.removeEventListener('scroll', handleScroll)
    }, [hasPreview])

    useEffect(() => {
      const container = previewRef.current
      if (!container) return

      const handleClick = (event: MouseEvent) => {
        const target = event.target
        if (!(target instanceof Element)) return

        const copyButton = target.closest<HTMLButtonElement>('.code-block-copy')
        if (copyButton) return

        const wikilinkAnchor = target.closest<HTMLAnchorElement>('a.montree-wikilink')
        if (wikilinkAnchor) {
          event.preventDefault()
          const wikilinkTarget = wikilinkAnchor.getAttribute('data-wikilink-target')
          if (wikilinkTarget) {
            onOpenWikilinkRef.current?.(wikilinkTarget)
          }
          return
        }

        const deepLinkAnchor = target.closest<HTMLAnchorElement>('a[href^="montree://"]')
        if (deepLinkAnchor) {
          event.preventDefault()
          const href = deepLinkAnchor.getAttribute('href')
          if (href) {
            onOpenDeepLinkRef.current?.(href)
          }
          return
        }

        const anchor = target.closest<HTMLAnchorElement>('a[href]')
        if (anchor) {
          const rawHref = anchor.getAttribute('href')
          if (!rawHref || rawHref === '#') return

          if (rawHref.startsWith('#')) {
            event.preventDefault()
            const headingId = decodeURIComponent(rawHref.slice(1))
            scrollToHeading(headingId)
            onHeadingActivateRef.current?.(headingId)
            return
          }

          const currentFile = filePathRef.current
          const localTarget = currentFile ? resolveLocalLink(currentFile, rawHref) : null
          if (localTarget) {
            event.preventDefault()
            if (localTarget === currentFile) {
              const rawHash = rawHref.includes('#') ? rawHref.slice(rawHref.indexOf('#') + 1) : ''
              if (rawHash) {
                try {
                  scrollToHeading(decodeURIComponent(rawHash))
                } catch {
                  // 非法锚点保持页面不动
                }
              }
            } else {
              const rawHash = rawHref.includes('#') ? rawHref.slice(rawHref.indexOf('#') + 1) : ''
              onOpenLocalFileRef.current?.(localTarget, rawHash || undefined)
            }
          }
          return
        }

        const heading = target.closest<HTMLElement>('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]')
        if (heading?.id) {
          onHeadingActivateRef.current?.(heading.id)
        }
      }

      container.addEventListener('click', handleClick)
      return () => {
        container.removeEventListener('click', handleClick)
      }
    }, [hasPreview])

    useCodeBlockCopy(previewRef, hasPreview)

    if (!html) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-preview p-6 text-center">
          <Eye className="size-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">在此预览 Markdown 渲染效果</p>
        </div>
      )
    }

    return (
      <div
        ref={previewRef}
        data-theme={theme}
        className="markdown-preview h-full overflow-auto bg-preview p-6"
      >
        <MarkdownContent html={html} />
      </div>
    )
  },
)
