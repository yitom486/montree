import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { normalizeWebDocInputUrl } from '@montree/web-doc'

const MAX_RECENT = 12

interface WebDocStore {
  pageUrl: string | null
  recentUrls: string[]
  openPage: (rawUrl: string) => string | null
  closePage: () => void
}

export const useWebDocStore = create<WebDocStore>()(
  persist(
    (set, get) => ({
      pageUrl: null,
      recentUrls: [],

      openPage: (rawUrl) => {
        const normalized = normalizeWebDocInputUrl(rawUrl)
        if (!normalized) return null

        set((state) => {
          const recentUrls = [
            normalized,
            ...state.recentUrls.filter((item) => item !== normalized),
          ].slice(0, MAX_RECENT)
          return { pageUrl: normalized, recentUrls }
        })
        return normalized
      },

      closePage: () => {
        set({ pageUrl: null })
      },
    }),
    {
      name: 'montree-web-doc',
      partialize: (state) => ({
        recentUrls: state.recentUrls,
      }),
    },
  ),
)
