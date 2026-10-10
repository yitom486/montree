import type { StateStorage } from 'zustand/middleware'

export const LEGACY_CHAT_KEY = 'montree-acp-ui'

export function windowChatStorageKey(scopeId: string): string {
  return windowStorageKey(LEGACY_CHAT_KEY, scopeId)
}

export function windowStorageKey(key: string, scopeId: string): string {
  return scopeId === 'main' ? key : `${key}:${scopeId}`
}

/** 新窗口只继承界面/运行时偏好，历史与会话标识永远从自己的分区读取。 */
export function createWindowChatStorage(storage: Storage, scopeId: string): StateStorage {
  return {
    getItem(key) {
      const own = storage.getItem(key)
      if (own !== null || scopeId === 'main') return own
      try {
        const legacy = JSON.parse(storage.getItem(LEGACY_CHAT_KEY) ?? 'null')
        if (!legacy?.state) return null
        const { panelOpen, hudDisplayMode, selectedRuntimeId, preferredConfigByRuntime } = legacy.state
        return JSON.stringify({ state: { panelOpen, hudDisplayMode, selectedRuntimeId, preferredConfigByRuntime }, version: legacy.version })
      } catch { return null }
    },
    setItem: (key, value) => storage.setItem(key, value),
    removeItem: (key) => storage.removeItem(key),
  }
}
