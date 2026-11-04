import { WorkspaceDocumentArea } from '@/components/layout/WorkspaceDocumentArea'
import { Suspense, forwardRef, lazy, useImperativeHandle, useRef } from 'react'
import { ArrowLeft, Loader2, MessageSquare } from 'lucide-react'
import type { WebDocViewerHandle } from '@/components/reader/WebDocViewer'
import { WebDocAddressBar } from '@/components/layout/web-doc/WebDocAddressBar'
import type { EditorOutlineState } from '@/components/layout/main/EditorWorkspaceMain'
import type { MarkdownHeading } from '@/lib/editor/markdown-headings'
import { Button } from '@/components/ui/button'
import { useReaderHudUiStore } from '@/stores/acp/reader-hud-store'
import { useLibraryStore, useLibraryUi } from '@/stores/library-store'
import { useWebDocPage } from '@/hooks/reader/useWebDocPage'
import { useHnDiscussionLookup } from '@/hooks/reader/useHnDiscussionLookup'
import { identifyDiscussionProvider } from '@/lib/reader/web-doc/discussion-link'

import type { AppTheme } from '@/stores/editor-ui-store'

export interface WebDocWorkspaceMainHandle {
  selectHeading: (heading: MarkdownHeading) => void
}

interface WebDocWorkspaceMainProps {
  pageUrl: string
  theme: AppTheme
  recentUrls?: string[]
  onNavigateUrl: (url: string) => void
  onOutlineChange?: (state: EditorOutlineState) => void
  /** 透传给内框 docked 侧栏，供 Agent 会话 cwd */
  workspaceRoot?: string
}

// 在线文档 Viewer 按需加载：katex/阅读抽取链只在打开 URL 时进 chunk，首屏不付成本。
// 底盒 forwardRef 能力由 lazy 包裹保留，ref 透传给内部 selectHeading。
const WebDocViewer = lazy(() =>
  import('@/components/reader/WebDocViewer').then((m) => ({ default: m.WebDocViewer })),
)

export const WebDocWorkspaceMain = forwardRef<WebDocWorkspaceMainHandle, WebDocWorkspaceMainProps>(
  function WebDocWorkspaceMain(
    { pageUrl, theme, recentUrls = [], onNavigateUrl, onOutlineChange, workspaceRoot },
    ref,
  ) {
    const viewerRef = useRef<WebDocViewerHandle>(null)
    const setIsLibraryOpen = useReaderHudUiStore((s) => s.setIsLibraryOpen)
    const returnContext = useLibraryUi((s) => s.returnContext)
    const clearReturnContext = useLibraryStore((s) => s.clearReturnContext)

    useImperativeHandle(
      ref,
      () => ({
        selectHeading: (heading) => viewerRef.current?.selectHeading(heading),
      }),
      [],
    )

    const { data: pageData } = useWebDocPage(pageUrl)
    const setReturnContext = useLibraryStore((s) => s.setReturnContext)
    const pageUrlWithoutFragment = pageUrl.split('#')[0]

    const contextualDiscussion = returnContext?.discussionUrl
      ? {
          source: returnContext.discussionSource ?? '讨论',
          url: returnContext.discussionUrl,
          count: returnContext.discussionCount,
          originalUrl: returnContext.originalUrl,
          title: returnContext.itemTitle,
        }
      : null
    const contextualApplies =
      contextualDiscussion &&
      (pageUrlWithoutFragment === contextualDiscussion.url ||
        pageUrlWithoutFragment === contextualDiscussion.originalUrl)

    // 文章页里常见的 “Discuss on HN / Reddit” 链接；当前页本身是讨论页时不再检测，
    // 否则 HN 评论里的 item 链接会被误判成另一条讨论。
    const currentPageIsDiscussion = Boolean(identifyDiscussionProvider(pageUrlWithoutFragment))
    const detectedDiscussion =
      !currentPageIsDiscussion && pageData?.content.discussion
        ? {
            ...pageData.content.discussion,
            originalUrl: pageUrlWithoutFragment,
            title: pageData.content.title,
          }
        : null

    // 低成本兜底：手动粘贴文章 URL 时，按 URL 去 HN 反查一次（24 小时缓存）
    const needsHnLookup =
      !contextualApplies &&
      !currentPageIsDiscussion &&
      !detectedDiscussion &&
      /^https?:/i.test(pageUrlWithoutFragment)
    const { data: hnDiscussionRef } = useHnDiscussionLookup(pageUrlWithoutFragment, needsHnLookup)
    const lookedUpDiscussion = hnDiscussionRef
      ? {
          source: 'Hacker News',
          url: hnDiscussionRef.url,
          count: hnDiscussionRef.comments,
          originalUrl: pageUrlWithoutFragment,
          title: hnDiscussionRef.title,
        }
      : null

    const activeDiscussion = contextualApplies
      ? contextualDiscussion
      : (detectedDiscussion ?? lookedUpDiscussion)
    const isViewingDiscussion =
      Boolean(activeDiscussion) && pageUrlWithoutFragment === activeDiscussion!.url
    const discussionTarget = activeDiscussion
      ? isViewingDiscussion
        ? activeDiscussion.originalUrl
        : activeDiscussion.url
      : null

    /** 自动发现的讨论没有来源上下文，点进讨论页时补一份，才能再切回原文 */
    const recordDiscussionContext = (link: NonNullable<typeof activeDiscussion>) => {
      if (contextualDiscussion) return
      setReturnContext({
        fromLibrary: false,
        tab: 'discover',
        feedChannel: useLibraryStore.getState().feedChannel,
        itemTitle: link.title || link.source,
        discussionUrl: link.url,
        discussionSource: link.source,
        discussionCount: link.count,
        originalUrl: link.originalUrl ?? pageUrlWithoutFragment,
      })
    }
    const openDiscussion = (link: NonNullable<typeof activeDiscussion>) => {
      recordDiscussionContext(link)
      onNavigateUrl(link.url)
    }
    const openDiscussionOriginal = (link: NonNullable<typeof activeDiscussion>) => {
      if (link.originalUrl) onNavigateUrl(link.originalUrl)
    }
    const cleanContextOnNavigate = (nextUrl: string) => {
      if (
        returnContext &&
        nextUrl !== returnContext.originalUrl &&
        nextUrl !== returnContext.discussionUrl
      ) {
        clearReturnContext()
      }
    }

    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2.5 border-b border-border/60 bg-background/80 px-3 backdrop-blur-sm">
          <div className="flex shrink-0 items-center gap-1.5">
            {returnContext?.fromLibrary && (
              <Button
                type="button"
                variant="secondary"
                size="xs"
                className="h-7 gap-1 px-2 text-xs font-medium text-primary"
                onClick={() => setIsLibraryOpen(true)}
                title="返回阅读馆并恢复原频道、筛选与滚动位置"
              >
                <ArrowLeft className="size-3.5" />
                <span>返回阅读馆</span>
              </Button>
            )}
            {discussionTarget && activeDiscussion && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  if (!activeDiscussion) return
                  if (isViewingDiscussion) openDiscussionOriginal(activeDiscussion)
                  else openDiscussion(activeDiscussion)
                }}
                title={
                  isViewingDiscussion
                    ? '切换回文章原文阅读'
                    : `在阅读器中打开 ${activeDiscussion.source} 讨论`
                }
              >
                <MessageSquare className="size-3" />
                <span>
                  {isViewingDiscussion
                    ? '查看原文'
                    : `${activeDiscussion.source} 讨论${
                        activeDiscussion.count ? ` · ${activeDiscussion.count}` : ''
                      }`}
                </span>
              </Button>
            )}
            {!returnContext?.fromLibrary && !discussionTarget && (
              <span className="shrink-0 text-xs text-muted-foreground">在线文档</span>
            )}
          </div>
          <WebDocAddressBar
            pageUrl={pageUrl}
            recentUrls={recentUrls}
            onNavigate={(nextUrl) => {
              cleanContextOnNavigate(nextUrl)
              onNavigateUrl(nextUrl)
            }}
          />
        </div>
        <WorkspaceDocumentArea>
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                正在加载在线文档阅读器…
              </div>
            }
          >
            <WebDocViewer
              ref={viewerRef}
              pageUrl={pageUrl}
              theme={theme}
              onOutlineChange={onOutlineChange}
              workspaceRoot={workspaceRoot}
            />
          </Suspense>
        </WorkspaceDocumentArea>
        {activeDiscussion && !isViewingDiscussion && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-muted/30 px-3 py-2">
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              来自 {activeDiscussion.source}
              {activeDiscussion.title ? ` · ${activeDiscussion.title}` : ''}
            </span>
            <Button
              type="button"
              size="sm"
              className="h-8 shrink-0 gap-1.5 px-3 text-xs"
              onClick={() => openDiscussion(activeDiscussion)}
              title={`在阅读器中打开 ${activeDiscussion.source} 讨论`}
            >
              <MessageSquare className="size-3.5" />
              {activeDiscussion.count ? `查看 ${activeDiscussion.count} 条评论` : '查看讨论'}
            </Button>
          </div>
        )}
      </div>
    )
  },
)
