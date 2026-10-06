import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import {
  DEFAULT_READING_MARK_KIND_FILTERS,
  type ReadingMarkKindFilters,
} from '@montree/reader-core'

interface ReadingMarkPanelStore extends ReadingMarkKindFilters {
  setHighlights: (value: boolean) => void
  setNotes: (value: boolean) => void
  setBookmarks: (value: boolean) => void
}

export const useReadingMarkPanelStore = create<ReadingMarkPanelStore>()(
  persist(
    (set) => ({
      ...DEFAULT_READING_MARK_KIND_FILTERS,
      setHighlights: (highlights) => set({ highlights }),
      setNotes: (notes) => set({ notes }),
      setBookmarks: (bookmarks) => set({ bookmarks }),
    }),
    {
      name: 'reading-mark-panel',
      partialize: (state) => ({
        highlights: state.highlights,
        notes: state.notes,
        bookmarks: state.bookmarks,
      }),
    },
  ),
)

export function useReadingMarkKindFilters() {
  return useReadingMarkPanelStore(
    useShallow((state) => ({
      highlights: state.highlights,
      notes: state.notes,
      bookmarks: state.bookmarks,
      setHighlights: state.setHighlights,
      setNotes: state.setNotes,
      setBookmarks: state.setBookmarks,
    })),
  )
}
