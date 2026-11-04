import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'

export type LibraryPrimaryTab = 'discover' | 'shelf' | 'later' | 'recent'
export type HnChannel = 'top' | 'new' | 'ask' | 'show'
export type ShelfFilter = 'all' | 'book' | 'doc' | 'article'

export interface ShelfEntry {
  id: string
  kind: 'book' | 'doc' | 'article'
  title: string
  subtitle?: string
  authorOrSource: string
  domain?: string
  format?: string
  versionOrYear?: string
  /** 旧版编目演示字段；新数据不再依赖 */
  catalogCode?: string
  target: string // filePath or URL
  progress?: number
  addedAt: number
  lastOpenedAt?: number
  hnId?: number
  commentUrl?: string
  points?: number
  commentsCount?: number
  /** 原文发布时间（Unix 秒）；本地文件为空 */
  createdAt?: number
  spineTone?: 'forest' | 'bronze' | 'slate' | 'plum'
}

export interface ReadLaterEntry {
  id: string
  hnId?: number
  title: string
  url: string
  commentUrl?: string
  domain: string
  author: string
  points?: number
  commentsCount?: number
  /** 旧版相对时间文案；新数据用 createdAt 现算 */
  timeAgo?: string
  /** 原文发布时间（Unix 秒） */
  createdAt?: number
  addedAt: number
}

export interface LibraryStoreState {
  activeTab: LibraryPrimaryTab
  hnChannel: HnChannel
  shelfFilter: ShelfFilter
  searchQuery: string
  unreadOnly: boolean
  scrollOffsets: Record<string, number>
  returnContext: {
    fromLibrary: boolean
    tab: LibraryPrimaryTab
    hnChannel: HnChannel
    itemTitle: string
    itemId?: string
    hnId?: number
    /** 讨论页 URL（HN/Reddit/Lobsters 等，由来源决定） */
    discussionUrl?: string
    /** 讨论来源展示名 */
    discussionSource?: string
    /** 讨论条目数（未知时省略） */
    discussionCount?: number
    originalUrl?: string
  } | null
  readHnIds: number[]
  readLaterItems: ReadLaterEntry[]
  shelfItems: ShelfEntry[]

  // Actions
  setActiveTab: (tab: LibraryPrimaryTab) => void
  setHnChannel: (channel: HnChannel) => void
  setShelfFilter: (filter: ShelfFilter) => void
  setSearchQuery: (query: string) => void
  setUnreadOnly: (unreadOnly: boolean) => void
  saveScrollOffset: (key: string, offset: number) => void
  setReturnContext: (ctx: LibraryStoreState['returnContext']) => void
  clearReturnContext: () => void
  markHnRead: (hnId: number) => void
  toggleHnRead: (hnId: number) => void
  toggleReadLater: (entry: Omit<ReadLaterEntry, 'addedAt'>) => boolean
  removeReadLater: (id: string) => void
  toggleShelfItem: (entry: Omit<ShelfEntry, 'addedAt'>) => boolean
  removeShelfItem: (id: string) => void
}

export const useLibraryStore = create<LibraryStoreState>()(
  persist(
    (set, get) => ({
      activeTab: 'discover',
      hnChannel: 'top',
      shelfFilter: 'all',
      searchQuery: '',
      unreadOnly: false,
      scrollOffsets: {},
      returnContext: null,
      readHnIds: [],
      readLaterItems: [],
      shelfItems: [],

      setActiveTab: (activeTab) => set({ activeTab }),
      setHnChannel: (hnChannel) => set({ hnChannel }),
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

      markHnRead: (hnId) =>
        set((state) => {
          if (state.readHnIds.includes(hnId)) return state
          return { readHnIds: [...state.readHnIds, hnId] }
        }),

      toggleHnRead: (hnId) =>
        set((state) => ({
          readHnIds: state.readHnIds.includes(hnId)
            ? state.readHnIds.filter((id) => id !== hnId)
            : [...state.readHnIds, hnId],
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
            item.target === entry.target,
        )
        if (exists) {
          set((state) => ({
            shelfItems: state.shelfItems.filter(
              (item) =>
                item.id !== entry.id &&
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
      name: 'montree-reading-library-v2',
      partialize: (state) => ({
        activeTab: state.activeTab,
        hnChannel: state.hnChannel,
        shelfFilter: state.shelfFilter,
        unreadOnly: state.unreadOnly,
        readHnIds: state.readHnIds,
        readLaterItems: state.readLaterItems,
        shelfItems: state.shelfItems,
      }),
    },
  ),
)

export function useLibraryUi<T>(selector: (state: LibraryStoreState) => T): T {
  return useLibraryStore(useShallow(selector))
}
