import React, { useEffect, useMemo, useRef } from 'react'
import { BookOpen, Compass, Clock, FolderOpen, History, Library, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { appApi } from '@/api/app-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { HnStory } from '../../../contracts/hn'
import {
  useLibraryStore,
  useLibraryUi,
  type LibraryPrimaryTab,
  type ReadLaterEntry,
  type ShelfEntry,
} from '@/stores/library-store'
import { HnFeed } from './library/HnFeed'
import { RecentView } from './library/RecentView'
import { ReadLaterView } from './library/ReadLaterView'
import { ShelfView } from './library/ShelfView'
import { extractDomain, getFileExt, getFileName } from './library/format'

export interface LibraryWorkspaceMainProps {
  /** 当前底层保持打开的本地文档路径（未卸载） */
  activeFilePath?: string
  /** 当前底层文件是否有未保存草稿 */
  isDirty?: boolean
  /** 当前底层打开的在线阅读器 URL */
  webPageUrl?: string | null
  /** 最近打开的本地文件路径（仅归入「最近阅读」，不伪装为已收藏） */
  recentFiles: string[]
  /** 最近访问的在线 URL（仅归入「最近阅读」，不伪装为已收藏） */
  recentWebUrls?: string[]
  /** 关闭阅读馆，直接回到刚才的文档/阅读现场 */
  onResumeActiveSession: () => void
  /** 在 Montree 在线阅读器中打开指定 URL */
  onOpenWebDoc?: (url: string) => void
  /** 打开指定本地文件 */
  onSelectFile: (path: string) => void
  /** 系统文件对话框导入新书 */
  onOpenFile?: () => void
}

const TABS: Array<{ id: LibraryPrimaryTab; label: string; icon: React.ReactNode }> = [
  { id: 'discover', label: '发现', icon: <Compass className="size-3.5" /> },
  { id: 'shelf', label: '书架', icon: <Library className="size-3.5" /> },
  { id: 'later', label: '稍后阅读', icon: <Clock className="size-3.5" /> },
  { id: 'recent', label: '最近', icon: <History className="size-3.5" /> },
]

export const LibraryWorkspaceMain: React.FC<LibraryWorkspaceMainProps> = ({
  activeFilePath,
  isDirty = false,
  webPageUrl,
  recentFiles,
  recentWebUrls = [],
  onResumeActiveSession,
  onOpenWebDoc,
  onSelectFile,
  onOpenFile,
}) => {
  const { activeTab, shelfFilter, searchQuery, readLaterItems, shelfItems } = useLibraryUi(
    (s) => ({
      activeTab: s.activeTab,
      shelfFilter: s.shelfFilter,
      searchQuery: s.searchQuery,
      readLaterItems: s.readLaterItems,
      shelfItems: s.shelfItems,
    }),
  )
  const setActiveTab = useLibraryStore((s) => s.setActiveTab)
  const setShelfFilter = useLibraryStore((s) => s.setShelfFilter)
  const setSearchQuery = useLibraryStore((s) => s.setSearchQuery)
  const saveScrollOffset = useLibraryStore((s) => s.saveScrollOffset)
  const setReturnContext = useLibraryStore((s) => s.setReturnContext)
  const toggleShelfItem = useLibraryStore((s) => s.toggleShelfItem)
  const removeShelfItem = useLibraryStore((s) => s.removeShelfItem)
  const removeReadLater = useLibraryStore((s) => s.removeReadLater)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollKey = `${activeTab}:${shelfFilter}`

  useEffect(() => {
    const element = scrollContainerRef.current
    if (!element) return
    element.scrollTop = useLibraryStore.getState().scrollOffsets[scrollKey] ?? 0
  }, [scrollKey])

  const activeSessionSummary = useMemo(() => {
    if (activeFilePath) {
      const name = getFileName(activeFilePath)
      const ext = getFileExt(name)
      const isBook = /\.(epub|pdf|mobi|azw3)$/i.test(name)
      return {
        label: name,
        badge: isDirty ? `${ext} · 未保存` : isBook ? `${ext} · 阅读中` : `${ext} · 编辑中`,
      }
    }
    if (webPageUrl) return { label: extractDomain(webPageUrl), badge: '在线文档 · 已保留位置' }
    return null
  }, [activeFilePath, isDirty, webPageUrl])

  const openStory = (story: HnStory) => {
    const target = story.url ?? story.commentUrl
    setReturnContext({
      fromLibrary: true,
      tab: 'discover',
      hnChannel: useLibraryStore.getState().hnChannel,
      itemTitle: story.title,
      hnId: story.id,
      discussionUrl: story.commentUrl,
      discussionSource: 'Hacker News',
      discussionCount: story.comments,
      originalUrl: target,
    })
    onOpenWebDoc?.(target)
    onResumeActiveSession()
  }

  const openDiscussion = (story: HnStory) => {
    setReturnContext({
      fromLibrary: true,
      tab: 'discover',
      hnChannel: useLibraryStore.getState().hnChannel,
      itemTitle: `讨论 · ${story.title}`,
      hnId: story.id,
      discussionUrl: story.commentUrl,
      discussionSource: 'Hacker News',
      discussionCount: story.comments,
      originalUrl: story.url ?? story.commentUrl,
    })
    onOpenWebDoc?.(story.commentUrl)
    onResumeActiveSession()
  }

  const openShelfEntry = (item: ShelfEntry) => {
    setReturnContext({
      fromLibrary: true,
      tab: 'shelf',
      hnChannel: useLibraryStore.getState().hnChannel,
      itemTitle: item.title,
      hnId: item.hnId,
      discussionUrl: item.commentUrl,
      discussionSource: item.hnId ? 'Hacker News' : undefined,
      discussionCount: item.commentsCount,
      originalUrl: item.target,
    })
    if (/^https?:\/\//i.test(item.target)) onOpenWebDoc?.(item.target)
    else onSelectFile(item.target)
    onResumeActiveSession()
  }

  const openReadLater = (item: ReadLaterEntry) => {
    setReturnContext({
      fromLibrary: true,
      tab: 'later',
      hnChannel: useLibraryStore.getState().hnChannel,
      itemTitle: item.title,
      hnId: item.hnId,
      discussionUrl: item.commentUrl,
      discussionSource: item.hnId ? 'Hacker News' : undefined,
      discussionCount: item.commentsCount,
      originalUrl: item.url,
    })
    onOpenWebDoc?.(item.url)
    onResumeActiveSession()
  }

  const moveReadLaterToShelf = (item: ReadLaterEntry) => {
    toggleShelfItem({
      id: `hn-${item.hnId ?? item.id}`,
      kind: 'article',
      hnId: item.hnId,
      title: item.title,
      authorOrSource: item.domain,
      domain: item.domain,
      format: 'Hacker News',
      versionOrYear: `${item.points ?? 0} 分`,
      target: item.url,
      commentUrl: item.commentUrl,
      points: item.points,
      commentsCount: item.commentsCount,
      createdAt: item.createdAt,
    })
    removeReadLater(item.id)
    toast.success('已收藏到书架')
  }

  const toggleRecentShelf = (entry: Omit<ShelfEntry, 'addedAt'>) => {
    const added = toggleShelfItem(entry)
    toast.success(added ? '已收入书架' : '已从书架移除')
  }

  const searchPlaceholder =
    activeTab === 'discover'
      ? '搜索当前 Hacker News 列表…'
      : activeTab === 'shelf'
        ? '搜索书架…'
        : activeTab === 'later'
          ? '搜索稍后阅读…'
          : '搜索最近阅读…'

  return (
    <div
      data-testid="library-workspace-main"
      className="flex h-full min-h-0 w-full flex-col bg-background text-foreground"
    >
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border/60 px-4">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as LibraryPrimaryTab)}>
          <TabsList variant="line" className="h-9 gap-1">
            {TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="h-8 gap-1.5 px-2.5 text-[13px]">
                {tab.icon}
                {tab.label}
                {tab.id === 'later' && readLaterItems.length > 0 && (
                  <span className="rounded bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">
                    {readLaterItems.length}
                  </span>
                )}
                {tab.id === 'shelf' && shelfItems.length > 0 && (
                  <span className="rounded bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">
                    {shelfItems.length}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="ml-auto flex min-w-0 items-center gap-2">
          <div className="relative hidden w-56 md:block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-8 bg-muted/50 pl-8 pr-7 text-[13px]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                title="清空搜索"
                aria-label="清空搜索"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {onOpenFile && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
              onClick={onOpenFile}
            >
              <FolderOpen className="size-3.5" />
              <span className="hidden sm:inline">导入</span>
            </Button>
          )}

          <Button
            variant={activeSessionSummary ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 max-w-56 gap-1.5 px-2 text-xs"
            onClick={onResumeActiveSession}
            title="保留阅读位置与未保存草稿，返回工作区"
          >
            <BookOpen className="size-3.5 shrink-0" />
            <span className="truncate">
              {activeSessionSummary ? `继续：${activeSessionSummary.label}` : '返回工作区'}
            </span>
          </Button>
        </div>
      </header>

      <div
        ref={scrollContainerRef}
        onScroll={(event) => saveScrollOffset(scrollKey, event.currentTarget.scrollTop)}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-5xl px-4 py-3">
          {activeTab === 'discover' && (
            <HnFeed
              searchQuery={searchQuery}
              activeSessionSummary={activeSessionSummary}
              onResumeActiveSession={onResumeActiveSession}
              onOpenStory={openStory}
              onOpenDiscussion={openDiscussion}
              onOpenExternal={(url) => {
                void appApi.openExternal(url)
              }}
            />
          )}

          {activeTab === 'shelf' && (
            <ShelfView
              items={shelfItems}
              filter={shelfFilter}
              searchQuery={searchQuery}
              onFilterChange={setShelfFilter}
              onOpen={openShelfEntry}
              onRemove={(item) => {
                removeShelfItem(item.id)
                toast.info('已从书架移除')
              }}
              onImport={onOpenFile}
            />
          )}

          {activeTab === 'later' && (
            <ReadLaterView
              items={readLaterItems}
              searchQuery={searchQuery}
              onOpen={openReadLater}
              onMoveToShelf={moveReadLaterToShelf}
              onRemove={(item) => {
                removeReadLater(item.id)
                toast.info('已从稍后阅读移除')
              }}
              onBrowse={() => setActiveTab('discover')}
            />
          )}

          {activeTab === 'recent' && (
            <RecentView
              recentFiles={recentFiles}
              recentWebUrls={recentWebUrls}
              activeFilePath={activeFilePath}
              webPageUrl={webPageUrl}
              searchQuery={searchQuery}
              shelfItems={shelfItems}
              onSelectFile={onSelectFile}
              onOpenWebDoc={(url) => onOpenWebDoc?.(url)}
              onResumeActiveSession={onResumeActiveSession}
              onToggleShelf={toggleRecentShelf}
            />
          )}
        </div>
      </div>

    </div>
  )
}
