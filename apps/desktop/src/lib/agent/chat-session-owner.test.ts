import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createChatSessionStore } from '@montree/chat-session'
import {
  createOwnedChatSessionStorage,
  getOwnedChatSessionStore,
  OWNED_CHAT_SESSION_STORAGE_KEY,
  OWNED_CHAT_SESSION_STORAGE_VERSION,
  resetOwnedChatSessionStoreForTests,
} from './chat-session-owner'

/**
 * P4c 持有口：单例同一性 + 持久化 round-trip + 缺失回落 + 坏 JSON 丢弃。
 * 只新增文件，既有 `chat-store-mirror*.test.ts` 一行不动。
 */

function memoryLocalStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
    clear: () => map.clear(),
    _map: map,
  }
}

beforeEach(() => {
  resetOwnedChatSessionStoreForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetOwnedChatSessionStoreForTests()
})

describe('chat-session-owner 持有单例', () => {
  it('单例同一性：同进程同实例', () => {
    expect(getOwnedChatSessionStore()).toBe(getOwnedChatSessionStore())
  })

  it('save→新实例 load 恢复线程/active/modelConfig', () => {
    const mocked = memoryLocalStorage()
    vi.stubGlobal('localStorage', mocked)
    resetOwnedChatSessionStoreForTests()

    const storage = createOwnedChatSessionStorage()
    const a = createChatSessionStore({ storage })
    a.appendUser('记住我')
    a.selectModel('m-owner-1')
    const active = a.getState().activeThreadId
    expect(mocked._map.get(OWNED_CHAT_SESSION_STORAGE_KEY)).toContain(
      `"version":${OWNED_CHAT_SESSION_STORAGE_VERSION}`,
    )

    const b = createChatSessionStore({ storage })
    const sb = b.getState()
    expect(sb.activeThreadId).toBe(active)
    expect(
      sb.threads.find((t) => t.id === sb.activeThreadId)!.feed.messages[0]!.text,
    ).toBe('记住我')
    expect(sb.modelConfig.modelId).toBe('m-owner-1')
  })

  it('localStorage 缺失回落内存不抛', () => {
    vi.stubGlobal('localStorage', undefined)
    resetOwnedChatSessionStoreForTests()
    expect(() => {
      const s = getOwnedChatSessionStore()
      s.appendUser('内存回落')
      s.selectModel('m-mem')
      s.beginReply()
      s.ingestTextChunk('chunk')
      s.finishTurn()
    }).not.toThrow()
    expect(
      getOwnedChatSessionStore()
        .getState()
        .threads.flatMap((t) => t.feed.messages.map((m) => m.text))
        .join(''),
    ).toContain('内存回落')
  })

  it('坏 JSON 丢弃：解析失败与版本不对均回落空白态', () => {
    const badJson = memoryLocalStorage({
      [OWNED_CHAT_SESSION_STORAGE_KEY]: 'not-json{{{',
    })
    vi.stubGlobal('localStorage', badJson)
    resetOwnedChatSessionStoreForTests()
    const s1 = createChatSessionStore({ storage: createOwnedChatSessionStorage() })
    expect(s1.getState().threads).toHaveLength(1)
    expect(s1.getState().threads[0]!.feed.messages).toEqual([])

    const badVersion = memoryLocalStorage({
      [OWNED_CHAT_SESSION_STORAGE_KEY]: JSON.stringify({
        version: OWNED_CHAT_SESSION_STORAGE_VERSION + 99,
        snapshot: {
          threads: [{ id: 'ghost', runtimeId: 'x', title: 'ghost', feed: { messages: [], turnSettled: false } }],
          activeThreadId: 'ghost',
          modelConfig: { runtimeId: 'x' },
        },
      }),
    })
    vi.stubGlobal('localStorage', badVersion)
    const s2 = createChatSessionStore({ storage: createOwnedChatSessionStorage() })
    expect(s2.getState().threads.some((t) => t.id === 'ghost')).toBe(false)
  })
})
