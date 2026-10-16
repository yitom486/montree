import {
  createChatSessionStore,
  type ChatSessionSnapshot,
  type ChatSessionStore,
  type ChatStoragePort,
} from '@montree/chat-session'
import { appApi } from '@/api/app-api'
import { windowStorageKey } from '@/stores/acp/window-storage'

/**
 * P4c 正式持有单例：包会话 store 的 Electron 应用侧持有者。
 *
 * 宿主 store = 应用脑（认证/滚动/批注/prompting）；包 store = 可移植会话态；
 * 本模块以 localStorage 持久化持有包 store，mirror 只保对齐（parity 测试锁死）。
 */
export const OWNED_CHAT_SESSION_STORAGE_KEY = 'montree-chat-session/v1'
export const OWNED_CHAT_SESSION_STORAGE_VERSION = 1

interface OwnedStorageEnvelope {
  version: number
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
  return {
    load(): ChatSessionSnapshot | null {
      try {
        const raw = readRaw(key)
        if (!raw) return null
        const parsed: unknown = JSON.parse(raw)
        if (!isRecord(parsed)) return null
        if (parsed.version !== OWNED_CHAT_SESSION_STORAGE_VERSION) return null
        return isSnapshot(parsed.snapshot) ? parsed.snapshot : null
      } catch {
        return null
      }
    },
    save(snapshot: ChatSessionSnapshot): void {
      try {
        const envelope: OwnedStorageEnvelope = {
          version: OWNED_CHAT_SESSION_STORAGE_VERSION,
          snapshot,
        }
        writeRaw(key, JSON.stringify(envelope))
      } catch {
        // 落盘失败不影响内存态
      }
    },
  }
}

const ownedStores = new Map<string, ChatSessionStore>()
const hostSnapshotProviders = new Map<string, (store: ChatSessionStore) => void>()

/** 宿主在其 store 初始化后注册，重建包单例时以同窗口宿主历史补齐持久关联。 */
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
