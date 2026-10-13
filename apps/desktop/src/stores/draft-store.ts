import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getDraftKey, type DocumentDraft } from '@/lib/editor/draft-utils'

interface DraftStore {
  drafts: Record<string, DocumentDraft>
  upsertDraft: (draft: DocumentDraft) => void
  removeDraft: (key: string) => void
  clearDrafts: () => void
}

export const useDraftStore = create<DraftStore>()(
  persist(
    (set) => ({
      drafts: {},

      upsertDraft: (draft) =>
        set((state) => ({
          drafts: {
            ...state.drafts,
            [getDraftKey(draft.filePath, draft.workspaceId)]: draft,
          },
        })),

      removeDraft: (key) =>
        set((state) => {
          const next = { ...state.drafts }
          delete next[key]
          return { drafts: next }
        }),

      clearDrafts: () => set({ drafts: {} }),
    }),
    {
      name: 'markdown-editor-drafts',
      partialize: (state) => ({ drafts: state.drafts }),
    },
  ),
)
