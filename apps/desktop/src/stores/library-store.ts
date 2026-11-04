import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import type { FeedSourceId } from '../../contracts/feed'
import { DEFAULT_FEED_SOURCE, findFeedSource } from '../../contracts/feed'

export type LibraryPrimaryTab = 'discover' | 'shelf' | 'later' | 'recent'
export type ShelfFilter = 'all' | 'book' | 'doc' | 'article'

/** 资讯条目的跨来源唯一键：`hacker-news:420101` / `lobsters:abc` */
export function feedItemKey(source: FeedSourceId, id: string | number): string {
  return `${source}:${id}`
}

export interface ShelfEntry {
  id: string
  kind: 'book' | 'doc' | 'article'
  title: string
  subtitle?: string
  authorOrSource: string
  domain?: string
  format?: string
  versionOrYear?: string
  target: string // filePath or URL
  progress?: number // 0 ~ 100
  addedAt: number
  lastOpenedAt?: number
  /** 资讯来源（文章类条目） */
  sourceId?: FeedSourceId
  hnId?: number
  commentUrl?: string
  points?: number
  commentsCount?: number
  /** 原文发布时间（Unix 秒）；本地文件为空 */
  createdAt?: number
}

export interface ReadLaterEntry {
  id: string
  /** 资讯来源；本地/手工条目为空 */
  sourceId?: FeedSourceId
  hnId?: number
  title: string
  url: string
  commentUrl?: string
  domain: string
  author: string
  points?: number
  commentsCount?: number
  /** 原文发布时间（Unix 秒） */
  createdAt?: number
  addedAt: number
  isRead?: boolean
}

export interface LibraryStoreState {
  /** 主导航 Tab：发现 / 我的书架 / 稍后阅读 / 最近阅读 */
  activeTab: LibraryPrimaryTab
  /** 当前资讯来源 */
  feedSource: FeedSourceId
  /** 当前来源下的频道（HN: top/new/ask/show；Lobsters: hottest/newest；RSS: 订阅 id） */
  feedChannel: string
  /** 书架分类筛选 */
  shelfFilter: ShelfFilter
  /** 搜索词（作用于当前视图列表） */
  searchQuery: string
  /** 是否只看未读（发现页） */
  unreadOnly: boolean
  /** 发现页列表滚动位置记忆（从原文返回时恢复） */
  scrollOffsets: Record<string, number>
  /** 当前从阅读馆进入阅读的上下文（用于在阅读器顶部展示「返回阅读馆」导航条） */
  returnContext: {
    fromLibrary: boolean
    tab: LibraryPrimaryTab
    itemTitle: string
    itemId?: string
    /** 跨来源唯一键（source:id） */
    itemKey?: string
    sourceId?: FeedSourceId
    feedChannel?: string
    hnId?: number
    /** 讨论页 URL（HN/Reddit/Lobsters 等，由来源决定） */
    discussionUrl?: string
    /** 讨论来源展示名 */
    discussionSource?: string
    /** 讨论条目数（未知时省略） */
    discussionCount?: number
    originalUrl?: string
  } | null
  /** 已读资讯条目 key 集合 */
  readItemKeys: string[]
  /** 稍后阅读列表 */
  readLaterItems: ReadLaterEntry[]
  /** 我的书架正式馆藏列表（不与最近记录混同） */
  shelfItems: ShelfEntry[]

  // Actions
  setActiveTab: (tab: LibraryPrimaryTab) => void
  setFeedSource: (source: FeedSourceId) => void
  setFeedChannel: (channel: string) => void
  setShelfFilter: (filter: ShelfFilter) => void
  setSearchQuery: (query: string) => void
  setUnreadOnly: (unreadOnly: boolean) => void
  saveScrollOffset: (key: string, offset: number) => void
  setReturnContext: (ctx: LibraryStoreState['returnContext']) => void
  clearReturnContext: () => void
  markItemRead: (key: string) => void
  toggleItemRead: (key: string) => void
  toggleReadLater: (entry: Omit<ReadLaterEntry, 'addedAt'>) => boolean
  removeReadLater: (id: string) => void
  toggleShelfItem: (entry: Omit<ShelfEntry, 'addedAt'>) => boolean
  removeShelfItem: (id: string) => void
}

export const useLibraryStore = create<LibraryStoreState>()(
  persist(
    (set, get) => ({
      activeTab: 'discover',
      feedSource: DEFAULT_FEED_SOURCE,
      feedChannel: findFeedSource(DEFAULT_FEED_SOURCE).channels[0]!.id,
      shelfFilter: 'all',
      searchQuery: '',
      unreadOnly: false,
      scrollOffsets: {},
      returnContext: null,
      readItemKeys: [],
      readLaterItems: [],
      shelfItems: [],

      setActiveTab: (activeTab) => set({ activeTab }),
      setFeedSource: (source) =>
        set({
          feedSource: source,
          feedChannel: findFeedSource(source).channels[0]!.id,
          unreadOnly: false,
        }),
      setFeedChannel: (feedChannel) => set({ feedChannel }),
      setShelfFilter: (shelfFilter) => set({ shelfFilter }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setUnreadOnly: (unreadOnly) => set({ unreadOnly }),

      saveScrollOffset: (key, offset) =>
        set((state) => {
          if (Math.abs((state.scrollOffsets[key] ?? 0) - offset) < 4) return state
          return {
            scrollOffsets: {
              ...state.scrollOffsets,
              [key]: offset,
            },
          }
        }),

      setReturnContext: (returnContext) => set({ returnContext }),
      clearReturnContext: () => set({ returnContext: null }),

      markItemRead: (key) =>
        set((state) => {
          if (state.readItemKeys.includes(key)) return state
          return { readItemKeys: [...state.readItemKeys, key] }
        }),

      toggleItemRead: (key) =>
        set((state) => ({
          readItemKeys: state.readItemKeys.includes(key)
            ? state.readItemKeys.filter((item) => item !== key)
            : [...state.readItemKeys, key],
        })),

      toggleReadLater: (entry) => {
        const exists = get().readLaterItems.some(
          (item) => item.id === entry.id || (entry.hnId && item.hnId === entry.hnId) || item.url === entry.url,
        )
        if (exists) {
          set((state) => ({
            readLaterItems: state.readLaterItems.filter(
              (item) => item.id !== entry.id && (!entry.hnId || item.hnId !== entry.hnId) && item.url !== entry.url,
            ),
          }))
          return false
        }
        set((state) => ({
          readLaterItems: [{ ...entry, addedAt: Date.now() }, ...state.readLaterItems],
        }))
        return true
      },

      removeReadLater: (id) =>
        set((state) => ({
          readLaterItems: state.readLaterItems.filter((item) => item.id !== id),
        })),

      toggleShelfItem: (entry) => {
        const exists = get().shelfItems.some(
          (item) =>
            item.id === entry.id ||
            (entry.hnId && item.hnId === entry.hnId) ||
            item.target === entry.target,
        )
        if (exists) {
          set((state) => ({
            shelfItems: state.shelfItems.filter(
              (item) =>
                item.id !== entry.id &&
                (!entry.hnId || item.hnId !== entry.hnId) &&
                item.target !== entry.target,
            ),
          }))
          return false
        }
        set((state) => ({
          shelfItems: [{ ...entry, addedAt: Date.now() }, ...state.shelfItems],
        }))
        return true
      },

      removeShelfItem: (id) =>
        set((state) => ({
          shelfItems: state.shelfItems.filter((item) => item.id !== id),
        })),
    }),
    {
      name: 'montree-reading-library-v3',
      partialize: (state) => ({
        activeTab: state.activeTab,
        feedSource: state.feedSource,
        feedChannel: state.feedChannel,
        shelfFilter: state.shelfFilter,
        unreadOnly: state.unreadOnly,
        readItemKeys: state.readItemKeys,
        readLaterItems: state.readLaterItems,
        shelfItems: state.shelfItems,
      }),
    },
  ),
)

export function useLibraryUi<T>(selector: (state: LibraryStoreState) => T): T {
  return useLibraryStore(useShallow(selector))
}
