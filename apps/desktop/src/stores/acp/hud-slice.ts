import type { StateCreator } from 'zustand'
import { pruneBlankThreads } from '@/lib/agent/acp-thread-prune'
import type { AcpHudDisplayMode, AcpUiStore } from './acp-types'
import { ensureThreadList, openPanelPreservingThread } from './chat-helpers'
import { reconcileOwnedChatThreadMetadata } from '@/lib/agent/chat-session-authority'
import { getOwnedChatSessionStore } from '@/lib/agent/chat-session-owner'

export interface HudSlice {
  panelOpen: boolean
  hudDisplayMode: AcpHudDisplayMode
  composerFocusNonce: number
  composerInsertNonce: number

  setHudDisplayMode: (mode: AcpHudDisplayMode) => void
  setPanelOpen: (open: boolean) => void
  togglePanel: () => void
  requestComposerFocus: () => void
  openPanelAndFocusComposer: () => void
  insertComposerSelectionMarker: () => void
}

export const createHudSlice: StateCreator<
  AcpUiStore,
  [],
  [],
  HudSlice
> = (set, get) => ({
  panelOpen: false,
  hudDisplayMode: 'floating',
  composerFocusNonce: 0,
  composerInsertNonce: 0,

  setHudDisplayMode: (mode) => set({ hudDisplayMode: mode }),

  setPanelOpen: (open) => {
    set((s) => {
      if (!open) {
        const workspaceRoot = s.threads.find(
          (t) => t.id === s.activeThreadId,
        )?.workspaceRoot
        const next = ensureThreadList(pruneBlankThreads(s.threads), workspaceRoot)
        const activeThreadId = next.threads.some((t) => t.id === s.activeThreadId)
          ? s.activeThreadId
          : next.activeThreadId
        return {
          panelOpen: false,
          historyOpen: false,
          threads: next.threads,
          activeThreadId,
        }
      }
      return {
        panelOpen: true,
        ...openPanelPreservingThread(s),
      }
    })
    reconcileOwnedChatThreadMetadata(getOwnedChatSessionStore(), get())
  },

  togglePanel: () => {
    const open = !get().panelOpen
    get().setPanelOpen(open)
  },

  requestComposerFocus: () => {
    const { panelOpen, composerFocusNonce } = get()
    if (!panelOpen) return
    set({ composerFocusNonce: composerFocusNonce + 1 })
  },

  openPanelAndFocusComposer: () => {
    set((s) => ({
      ...(s.panelOpen
        ? { panelOpen: true }
        : { panelOpen: true, ...openPanelPreservingThread(s) }),
      hudDisplayMode: s.hudDisplayMode === 'capsule' ? 'floating' : s.hudDisplayMode,
      composerFocusNonce: s.composerFocusNonce + 1,
    }))
    reconcileOwnedChatThreadMetadata(getOwnedChatSessionStore(), get())
  },

  insertComposerSelectionMarker: () => {
    set((s) => ({
      ...(s.panelOpen
        ? { panelOpen: true }
        : { panelOpen: true, ...openPanelPreservingThread(s) }),
      hudDisplayMode: s.hudDisplayMode === 'capsule' ? 'floating' : s.hudDisplayMode,
      composerFocusNonce: s.composerFocusNonce + 1,
      composerInsertNonce: s.composerInsertNonce + 1,
    }))
    reconcileOwnedChatThreadMetadata(getOwnedChatSessionStore(), get())
  },
})
