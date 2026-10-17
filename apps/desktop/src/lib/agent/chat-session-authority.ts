import type { ChatFeedEvent, ChatFeedState, ChatMessage } from '@yitom/chat-core'
import type { ChatSessionStore, ChatThread } from '@yitom/chat-session'
import { DEFAULT_ACP_RUNTIME_ID } from '@yitom/contracts'
import { getOwnedChatSessionStore } from './chat-session-owner'

export interface OwnedHostThread {
  id: string
  runtimeId?: string
  title: string
}

let metadataRoutingDepth = 0

/** Do not project a partially provisioned thread table back over fresh product metadata. */
export function isOwnedChatMetadataRouting(): boolean {
  return metadataRoutingDepth > 0
}

export function findOwnedChatThread(pkg: ChatSessionStore, hostId: string): ChatThread | undefined {
  return pkg.getState().threads.find(t => t.id === hostId || t.hostThreadId === hostId)
}

/** Only provisions identity. Existing feeds are never replaced by a host projection. */
export function ensureOwnedChatThread(thread: OwnedHostThread): ChatThread {
  const pkg = getOwnedChatSessionStore()
  let owned = findOwnedChatThread(pkg, thread.id)
  if (!owned) {
    pkg.syncHostThread({
      id: thread.id, hostThreadId: thread.id,
      runtimeId: thread.runtimeId || DEFAULT_ACP_RUNTIME_ID,
      title: thread.title,
      feed: { messages: [], turnSettled: false },
    })
    owned = findOwnedChatThread(pkg, thread.id)!
  }
  return owned
}

export function dispatchOwnedChatEvent(thread: OwnedHostThread, event: ChatFeedEvent): ChatFeedState {
  const pkg = getOwnedChatSessionStore()
  const owned = ensureOwnedChatThread(thread)
  pkg.dispatchFeedEvent(owned.id, event)
  return findOwnedChatThread(pkg, thread.id)!.feed
}

/** Explicit product transformation (replay cleaning / proposals), never a second generic reducer. */
export function updateOwnedChatThreadMessages(
  thread: OwnedHostThread,
  messages: ChatMessage[],
  turnSettled?: boolean,
): void {
  const pkg = getOwnedChatSessionStore()
  const owned = ensureOwnedChatThread(thread)
  const settled = turnSettled ?? owned.feed.turnSettled
  if (owned.title !== thread.title) pkg.renameThread(owned.id, thread.title)
  if (owned.feed.messages === messages && owned.feed.turnSettled === settled) return
  pkg.syncHostThread({ ...findOwnedChatThread(pkg, thread.id)!, feed: { messages, turnSettled: settled } })
}

/** Thread-table routing may change identity/order/title, but always takes feeds from the owner. */
export function reconcileOwnedChatThreadMetadata(
  pkg: ChatSessionStore,
  host: { threads: OwnedHostThread[]; activeThreadId: string },
): void {
  let threads: ChatThread[]
  metadataRoutingDepth++
  try {
    const state = pkg.getState()
    const previous = state.threads.find(thread => thread.id === state.activeThreadId)
    const previousHostId = previous?.hostThreadId ?? previous?.id
    if (previous && previousHostId !== host.activeThreadId && host.threads.some(thread => thread.id === previousHostId)) {
      pkg.freezeLight(previous.id)
    }
    threads = host.threads.map(thread => {
      const owned = ensureOwnedChatThread(thread)
      return { ...owned, title: thread.title, runtimeId: thread.runtimeId || DEFAULT_ACP_RUNTIME_ID }
    })
  } finally {
    metadataRoutingDepth--
  }
  if (threads.length) pkg.reconcileHostThreads(threads, host.activeThreadId)
}
