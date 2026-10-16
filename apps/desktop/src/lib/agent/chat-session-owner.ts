import {
  createChatSessionStore,
  type ChatSessionSnapshot,
  type ChatSessionStore,
  type ChatStoragePort,
} from '@montree/chat-session'

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
let memoryRaw: string | null = null

function readRaw(): string | null {
  if (typeof localStorage === 'undefined') return memoryRaw
  try {
    return localStorage.getItem(OWNED_CHAT_SESSION_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeRaw(raw: string): void {
  if (typeof localStorage === 'undefined') {
    memoryRaw = raw
    return
  }
  try {
    localStorage.setItem(OWNED_CHAT_SESSION_STORAGE_KEY, raw)
  } catch {
    // 落盘失败不影响内存态
  }
}

/** JSON 快照整体读写 + 版本字段校验（不对则丢弃，由 store 回落空白态）。 */
export function createOwnedChatSessionStorage(): ChatStoragePort {
  return {
    load(): ChatSessionSnapshot | null {
      try {
        const raw = readRaw()
        if (!raw) return null
        const parsed = JSON.parse(raw) as Partial<OwnedStorageEnvelope>
        if (parsed.version !== OWNED_CHAT_SESSION_STORAGE_VERSION) return null
        if (!parsed.snapshot) return null
        return parsed.snapshot as ChatSessionSnapshot
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
        writeRaw(JSON.stringify(envelope))
      } catch {
        // 落盘失败不影响内存态
      }
    },
  }
}

let ownedStore: ChatSessionStore | null = null

/** 正式持有单例：包芯挂载前的唯一持有口（替代 P4a `getPackageMirrorStore` 临时单例）。 */
export function getOwnedChatSessionStore(): ChatSessionStore {
  if (!ownedStore) {
    ownedStore = createChatSessionStore({ storage: createOwnedChatSessionStorage() })
  }
  return ownedStore
}

/** 仅单测用：清单例 + 内存回落（localStorage 内容由调用方自行清理）。 */
export function resetOwnedChatSessionStoreForTests(): void {
  ownedStore = null
  memoryRaw = null
}
