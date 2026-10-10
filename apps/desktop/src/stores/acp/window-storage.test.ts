// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createWindowChatStorage, windowChatStorageKey, LEGACY_CHAT_KEY } from './window-storage'

beforeEach(() => localStorage.clear())
describe('window chat persistence', () => {
  it('preserves primary history and only copies preferences into a new window', () => {
    const legacy = { state: { panelOpen: true, selectedRuntimeId: 'opencode', preferredConfigByRuntime: { opencode: { model: 'a' } }, activeThreadId: 'old', threads: [{ id: 'old', agentSessionIds: { opencode: 'old-session' } }], sessionId: 'old-session' }, version: 0 }
    localStorage.setItem(LEGACY_CHAT_KEY, JSON.stringify(legacy))
    expect(JSON.parse(createWindowChatStorage(localStorage, 'main').getItem(LEGACY_CHAT_KEY) as string)).toEqual(legacy)
    const key = windowChatStorageKey('second')
    const storage = createWindowChatStorage(localStorage, 'second')
    const inherited = JSON.parse(storage.getItem(key) as string).state
    expect(inherited.selectedRuntimeId).toBe('opencode')
    expect(inherited.activeThreadId).toBeUndefined()
    expect(inherited.threads).toBeUndefined()
    expect(inherited.sessionId).toBeUndefined()
    storage.setItem(key, JSON.stringify({ state: { activeThreadId: 'second-only' } }))
    expect(JSON.parse(storage.getItem(key) as string).state.activeThreadId).toBe('second-only')
    expect(localStorage.getItem(LEGACY_CHAT_KEY)).toBe(JSON.stringify(legacy))
    expect(windowChatStorageKey('third')).not.toBe(key)
  })
})
