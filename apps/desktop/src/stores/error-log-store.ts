import { create } from 'zustand'
import type { RendererErrorPayload } from '@montree/contracts'

const MAX_ENTRIES = 100

interface ErrorLogStore {
  entries: RendererErrorPayload[]
  addEntry: (entry: RendererErrorPayload) => void
  clear: () => void
}

export const useErrorLogStore = create<ErrorLogStore>((set) => ({
  entries: [],

  addEntry: (entry) =>
    set((state) => ({
      entries: [entry, ...state.entries].slice(0, MAX_ENTRIES),
    })),

  clear: () => set({ entries: [] }),
}))
