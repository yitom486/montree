import {
  createChatSessionStore,
  type ChatSessionSnapshot,
  type ChatSessionStore,
  type ChatStoragePort,
} from '@yitom/chat-session'
import { appApi } from '@/api/app-api'
import { DEFAULT_ACP_RUNTIME_ID } from '@yitom/contracts'
import { windowChatStorageKey, windowStorageKey } from '@/stores/acp/window-storage'

/**
 * Package owns feed history. The host persists only product metadata in a separate key.
 * authorityVersion marks the one-time transition from legacy dual-write snapshots.
 */
export const OWNED_CHAT_SESSION_STORAGE_KEY = 'montree-chat-session/v1'
export const OWNED_CHAT_SESSION_STORAGE_VERSION = 1

interface OwnedStorageEnvelope {
  version: number
  authorityVersion?: number
  snapshot: ChatSessionSnapshot
}

/** localStorage 缺失（node 单测环境）时的进程内回落，保证不抛且同进程可 round-trip。 */
const memoryRaw = new Map<string, string>()

function readRaw(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return memoryRaw.get(key) ?? null
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeRaw(key: string, raw: string): void {
  try {
    if (typeof localStorage === 'undefined') {
      memoryRaw.set(key, raw)
      return
    }
    localStorage.setItem(key, raw)
  } catch {
    // 落盘失败不影响内存态
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 存储内容来自旧版本或外部修改；至少保证恢复后的线程与正文可安全读取。 */
function isSnapshot(value: unknown): value is ChatSessionSnapshot {
  if (!isRecord(value) || !Array.isArray(value.threads) || value.threads.length === 0) return false
  if (value.activeThreadId !== null && typeof value.activeThreadId !== 'string') return false
  if (!isRecord(value.modelConfig) || typeof value.modelConfig.runtimeId !== 'string') return false
  if (value.modelConfig.modelId !== undefined && typeof value.modelConfig.modelId !== 'string') return false
  if (value.modelConfig.thinkingLevel !== undefined && typeof value.modelConfig.thinkingLevel !== 'string') return false
  const ids = new Set<string>()
  return value.threads.every((thread: unknown) => {
    if (!isRecord(thread) || typeof thread.id !== 'string' || !thread.id || ids.has(thread.id)) return false
    ids.add(thread.id)
    if (typeof thread.runtimeId !== 'string' || typeof thread.title !== 'string') return false
    if (thread.hostThreadId !== undefined && typeof thread.hostThreadId !== 'string') return false
    if (!isRecord(thread.feed) || typeof thread.feed.turnSettled !== 'boolean' || !Array.isArray(thread.feed.messages)) return false
    return thread.feed.messages.every((message: unknown) =>
      isRecord(message) && typeof message.id === 'string' && typeof message.text === 'string' &&
      typeof message.role === 'string' && ['user', 'agent', 'thought', 'tool', 'plan', 'system'].includes(message.role) &&
      typeof message.createdAt === 'number' && Number.isFinite(message.createdAt) &&
      (message.attachments === undefined || Array.isArray(message.attachments)),
    )
  })
}

/** main 保留旧键兼容历史；其它窗口只读写自己的分区，绝不回退主窗口历史。 */
export function createOwnedChatSessionStorage(scopeId = appApi.getWindowScopeId()): ChatStoragePort {
  const key = windowStorageKey(OWNED_CHAT_SESSION_STORAGE_KEY, scopeId)
  const parse = (raw: string | null): OwnedStorageEnvelope | null => {
    try {
      const value: unknown = raw ? JSON.parse(raw) : null
      return isRecord(value) && value.version === OWNED_CHAT_SESSION_STORAGE_VERSION && isSnapshot(value.snapshot)
        ? value as unknown as OwnedStorageEnvelope : null
    } catch { return null }
  }
  return {
    load(): ChatSessionSnapshot | null {
      try {
        const raw = readRaw(key)
        const parsed = parse(raw)
        if (parsed?.authorityVersion === 1) return parsed.snapshot
        const lastGood = parse(readRaw(`${key}:last-good`))
        if (!parsed && lastGood) return lastGood.snapshot
        // Old host key is an immutable migration backup: metadata now uses a new key.
        // Only this window's legacy key is consulted, never the main-window fallback.
        const legacyRaw = readRaw(windowChatStorageKey(scopeId))
        const legacy: unknown = legacyRaw ? JSON.parse(legacyRaw) : null
        if (isRecord(legacy) && isRecord(legacy.state) && Array.isArray(legacy.state.threads)) {
          const legacyState = legacy.state
          const legacyThreads = legacy.state.threads
          // An explicitly empty legacy history is authoritative too; never resurrect
          // an old nonempty mirror after the user cleared the host's thread list.
          if (legacyThreads.length === 0) return null
          const threads = legacyThreads.filter(isRecord).map(thread => ({
            id: thread.id, hostThreadId: thread.id,
            runtimeId: thread.runtimeId || DEFAULT_ACP_RUNTIME_ID, title: thread.title,
            feed: { messages: Array.isArray(thread.messages) ? thread.messages.map(message =>
              isRecord(message) ? { ...message, streaming: false } : message,
            ) : thread.messages, turnSettled: false },
          }))
          const snapshot = {
            threads,
            activeThreadId: threads.some(thread => thread.id === legacyState.activeThreadId)
              ? legacyState.activeThreadId : threads[0]?.id,
            modelConfig: { runtimeId: legacyState.selectedRuntimeId || DEFAULT_ACP_RUNTIME_ID },
          }
          if (isSnapshot(snapshot)) {
            const migrated = { version: OWNED_CHAT_SESSION_STORAGE_VERSION, authorityVersion: 1, snapshot }
            const encoded = JSON.stringify(migrated)
            if (raw && !parsed && !readRaw(`${key}:corrupt-backup`)) writeRaw(`${key}:corrupt-backup`, raw)
            writeRaw(key, encoded)
            writeRaw(`${key}:last-good`, encoded)
            return snapshot
          }
        }
        return parsed?.snapshot ?? null
      } catch {
        return parse(readRaw(key))?.snapshot ?? parse(readRaw(`${key}:last-good`))?.snapshot ?? null
      }
    },
    save(snapshot: ChatSessionSnapshot): void {
      try {
        const envelope: OwnedStorageEnvelope = {
          version: OWNED_CHAT_SESSION_STORAGE_VERSION,
          authorityVersion: 1,
          snapshot: {
            ...snapshot,
            threads: snapshot.threads.map(thread => ({ ...thread, feed: {
              ...thread.feed,
              messages: thread.feed.messages.slice(-300).map(message => ({ ...message,
                streaming: false,
                ...(message.attachments ? { attachments: message.attachments.map(attachment =>
                  attachment.previewUrl?.startsWith('blob:') ? { ...attachment, previewUrl: undefined } : attachment,
                ) } : {}),
              })),
            } })),
          },
        }
        const previous = readRaw(key)
        if (previous && !parse(previous) && !readRaw(`${key}:corrupt-backup`)) writeRaw(`${key}:corrupt-backup`, previous)
        const next = JSON.stringify(envelope)
        writeRaw(key, next)
        // Redundant last-good snapshot protects history from a corrupt primary envelope.
        writeRaw(`${key}:last-good`, next)
      } catch {
        // 落盘失败不影响内存态
      }
    },
  }
}

const ownedStores = new Map<string, ChatSessionStore>()
const hostSnapshotProviders = new Map<string, (store: ChatSessionStore) => void>()

/** Host registers its read-only projection after initialization, for the current window only. */
export function registerOwnedChatHostSnapshotProvider(provider: (store: ChatSessionStore) => void): () => void {
  const scopeId = appApi.getWindowScopeId()
  hostSnapshotProviders.set(scopeId, provider)
  const store = ownedStores.get(scopeId)
  if (store) provider(store)
  return () => {
    if (hostSnapshotProviders.get(scopeId) === provider) hostSnapshotProviders.delete(scopeId)
  }
}

/** 正式持有单例：包芯挂载前的唯一持有口（替代 P4a `getPackageMirrorStore` 临时单例）。 */
export function getOwnedChatSessionStore(): ChatSessionStore {
  // preload 同步注入 windowScopeId，首次访问时确定分区，不能在模块导入时缓存 main。
  const scopeId = appApi.getWindowScopeId()
  let ownedStore = ownedStores.get(scopeId)
  if (!ownedStore) {
    ownedStore = createChatSessionStore({ storage: createOwnedChatSessionStorage(scopeId) })
    ownedStores.set(scopeId, ownedStore)
    hostSnapshotProviders.get(scopeId)?.(ownedStore)
  }
  return ownedStore
}

/** 仅单测用：清单例 + 内存回落（localStorage 内容由调用方自行清理）。 */
export function resetOwnedChatSessionStoreForTests(): void {
  ownedStores.clear()
  memoryRaw.clear()
}
