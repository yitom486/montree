import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createChatSessionStore } from '@yitom/chat-session'
import { appApi } from '@/api/app-api'
import {
  createOwnedChatSessionStorage,
  getOwnedChatSessionStore,
  OWNED_CHAT_SESSION_STORAGE_KEY,
  OWNED_CHAT_SESSION_STORAGE_VERSION,
  registerOwnedChatHostSnapshotProvider,
  resetOwnedChatSessionStoreForTests,
} from './chat-session-owner'

/**
 * 持有口：真实包 store + 共享底层存储的双窗口恢复，旧键兼容与坏数据回落。
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
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  resetOwnedChatSessionStoreForTests()
})

describe('chat-session-owner 持有单例', () => {
  it('首次迁移以旧宿主真实历史替换影子快照，后续只恢复包权威且不修改旧键', () => {
    const legacy = JSON.stringify({ state: {
      activeThreadId: 'legacy-thread', selectedRuntimeId: 'codex-acp',
      threads: [{ id: 'legacy-thread', title: '真实历史', runtimeId: 'codex-acp',
        messages: [{ id: 'stable-message', role: 'user', text: '完整正文', createdAt: 1,
          attachments: [{ id: 'image', kind: 'image', previewUrl: 'data:image/png;base64,test' }] }],
      }],
    }, version: 0 })
    const mocked = memoryLocalStorage({ 'montree-acp-ui': legacy })
    vi.stubGlobal('localStorage', mocked)
    // Simulates the previously persisted mirror, whose ids/content are not authoritative.
    mocked.setItem(OWNED_CHAT_SESSION_STORAGE_KEY, JSON.stringify({ version: 1, snapshot: {
      activeThreadId: 'shadow', modelConfig: { runtimeId: 'codex-acp' }, threads: [{
        id: 'shadow', hostThreadId: 'legacy-thread', runtimeId: 'codex-acp', title: '影子',
        feed: { turnSettled: false, messages: [] },
      }],
    } }))
    const first = createChatSessionStore({ storage: createOwnedChatSessionStorage('main') })
    expect(first.getState().threads[0]!.id).toBe('legacy-thread')
    expect(first.getState().threads[0]!.feed.messages[0]).toMatchObject({ id: 'stable-message', text: '完整正文', attachments: [{ id: 'image' }] })
    first.appendUser('迁移后新增')
    const restarted = createChatSessionStore({ storage: createOwnedChatSessionStorage('main') })
    expect(restarted.getState().threads[0]!.feed.messages.map(m => m.text)).toEqual(['完整正文', '迁移后新增'])
    expect(mocked.getItem('montree-acp-ui')).toBe(legacy)
  })

  it('包主快照损坏时优先使用最近成功副本，保留损坏原文，绝不倒退旧宿主历史', () => {
    const mocked = memoryLocalStorage()
    vi.stubGlobal('localStorage', mocked)
    const first = createChatSessionStore({ storage: createOwnedChatSessionStorage('main') })
    first.appendUser('最新历史')
    const id = first.getState().threads[0]!.feed.messages[0]!.id
    mocked.setItem(OWNED_CHAT_SESSION_STORAGE_KEY, '{broken-primary')
    const restored = createChatSessionStore({ storage: createOwnedChatSessionStorage('main') })
    expect(restored.getState().threads[0]!.feed.messages[0]).toMatchObject({ id, text: '最新历史' })
    restored.appendSystem('恢复成功')
    expect(mocked.getItem(`${OWNED_CHAT_SESSION_STORAGE_KEY}:corrupt-backup`)).toBe('{broken-primary')
  })

  it('首次迁移按窗口选旧键，副窗口绝不迁入主窗历史', () => {
    const mocked = memoryLocalStorage({ 'montree-acp-ui': JSON.stringify({ state: {
      activeThreadId: 'main-thread', selectedRuntimeId: 'codex-acp', threads: [{
        id: 'main-thread', title: '主窗', runtimeId: 'codex-acp', messages: [{ id: 'm', role: 'user', text: '主窗私有历史', createdAt: 1 }],
      }],
    } }) })
    vi.stubGlobal('localStorage', mocked)
    const second = createChatSessionStore({ storage: createOwnedChatSessionStorage('second') })
    expect(second.getState().threads[0]!.feed.messages).toEqual([])
    expect(mocked.getItem(`${OWNED_CHAT_SESSION_STORAGE_KEY}:second`)).toBeNull()
  })

  it('旧宿主显式空历史不会复活旧双写影子的消息', () => {
    const mocked = memoryLocalStorage()
    vi.stubGlobal('localStorage', mocked)
    const shadow = createChatSessionStore({ storage: createOwnedChatSessionStorage('main') })
    shadow.appendUser('已被用户删除的影子内容')
    const envelope = JSON.parse(mocked.getItem(OWNED_CHAT_SESSION_STORAGE_KEY)!)
    delete envelope.authorityVersion
    mocked.setItem(OWNED_CHAT_SESSION_STORAGE_KEY, JSON.stringify(envelope))
    mocked.removeItem(`${OWNED_CHAT_SESSION_STORAGE_KEY}:last-good`)
    mocked.setItem('montree-acp-ui', JSON.stringify({ state: { threads: [] } }))
    const migrated = createChatSessionStore({ storage: createOwnedChatSessionStorage('main') })
    expect(migrated.getState().threads[0]!.feed.messages).toEqual([])
  })

  it('单例同一性：同进程同实例', () => {
    expect(getOwnedChatSessionStore()).toBe(getOwnedChatSessionStore())
  })

  it('在首次访问时读取 preload 已注入的 scope，按窗口持有稳定单例', () => {
    const scope = vi.spyOn(appApi, 'getWindowScopeId').mockReturnValue('second')
    const second = getOwnedChatSessionStore()
    second.appendUser('副窗口')
    scope.mockReturnValue('main')
    const main = getOwnedChatSessionStore()
    expect(main).not.toBe(second)
    expect(main.getState().threads[0]!.feed.messages).toEqual([])
    scope.mockReturnValue('second')
    expect(getOwnedChatSessionStore()).toBe(second)
  })

  it('新建或已存在的单例都接入同窗口宿主快照，重建时保留 provider', () => {
    const scope = vi.spyOn(appApi, 'getWindowScopeId').mockReturnValue('second')
    const reconcileSecond = vi.fn()
    const unregisterSecond = registerOwnedChatHostSnapshotProvider(reconcileSecond)
    const second = getOwnedChatSessionStore()
    expect(reconcileSecond).toHaveBeenCalledExactlyOnceWith(second)
    scope.mockReturnValue('main')
    const main = getOwnedChatSessionStore()
    expect(reconcileSecond).toHaveBeenCalledTimes(1)
    const reconcileMain = vi.fn()
    const unregisterMain = registerOwnedChatHostSnapshotProvider(reconcileMain)
    expect(reconcileMain).toHaveBeenCalledExactlyOnceWith(main)
    resetOwnedChatSessionStoreForTests()
    const restarted = getOwnedChatSessionStore()
    expect(reconcileMain).toHaveBeenLastCalledWith(restarted)
    expect(reconcileMain).toHaveBeenCalledTimes(2)
    unregisterMain()
    unregisterSecond()
  })

  it('两个窗口共享 localStorage，交错写入和重启后只恢复自己的线程与模型', () => {
    const mocked = memoryLocalStorage()
    vi.stubGlobal('localStorage', mocked)
    const main = createChatSessionStore({ storage: createOwnedChatSessionStorage('main') })
    main.appendUser('主窗口历史')
    main.selectModel('model-main')
    const second = createChatSessionStore({ storage: createOwnedChatSessionStorage('second') })
    expect(second.getState().threads[0]!.feed.messages).toEqual([])
    second.appendUser('副窗口历史')
    second.selectModel('model-second')
    main.beginReply()
    main.ingestTextChunk('主窗口回复')
    second.beginReply()
    second.ingestTextChunk('副窗口回复')
    main.finishTurn()
    second.finishTurn()
    const mainId = main.getState().activeThreadId
    const secondId = second.getState().activeThreadId
    const restoredMain = createChatSessionStore({ storage: createOwnedChatSessionStorage('main') })
    const restoredSecond = createChatSessionStore({ storage: createOwnedChatSessionStorage('second') })
    expect(restoredMain.getState().activeThreadId).toBe(mainId)
    expect(restoredSecond.getState().activeThreadId).toBe(secondId)
    expect(restoredMain.getState().modelConfig.modelId).toBe('model-main')
    expect(restoredSecond.getState().modelConfig.modelId).toBe('model-second')
    expect(restoredMain.getState().threads[0]!.feed.messages.map((message) => message.text))
      .toEqual(['主窗口历史', '主窗口回复'])
    expect(restoredSecond.getState().threads[0]!.feed.messages.map((message) => message.text))
      .toEqual(['副窗口历史', '副窗口回复'])
    expect([...mocked._map.keys()].sort()).toEqual([
      OWNED_CHAT_SESSION_STORAGE_KEY,
      `${OWNED_CHAT_SESSION_STORAGE_KEY}:last-good`,
      `${OWNED_CHAT_SESSION_STORAGE_KEY}:second`,
      `${OWNED_CHAT_SESSION_STORAGE_KEY}:second:last-good`,
    ])
  })

  it('主窗口旧键保持兼容，副窗口缺失或损坏的数据不回退主窗口历史', () => {
    const mocked = memoryLocalStorage()
    vi.stubGlobal('localStorage', mocked)
    const legacy = createChatSessionStore({ storage: createOwnedChatSessionStorage('main') })
    legacy.appendUser('升级前的历史')
    const main = createChatSessionStore({ storage: createOwnedChatSessionStorage('main') })
    expect(main.getState().threads[0]!.feed.messages[0]!.text).toBe('升级前的历史')
    expect(createOwnedChatSessionStorage('new-window').load()).toBeNull()
    mocked.setItem(`${OWNED_CHAT_SESSION_STORAGE_KEY}:new-window`, '{broken')
    expect(createOwnedChatSessionStorage('new-window').load()).toBeNull()
    expect(createOwnedChatSessionStorage('main').load()!.threads[0]!.feed.messages[0]!.text)
      .toBe('升级前的历史')
  })

  it('无 localStorage 时内存回落仍按窗口隔离，独立实例可恢复自己的历史', () => {
    vi.stubGlobal('localStorage', undefined)
    const main = createChatSessionStore({ storage: createOwnedChatSessionStorage('main') })
    main.appendUser('main-memory')
    const second = createChatSessionStore({ storage: createOwnedChatSessionStorage('second') })
    expect(second.getState().threads[0]!.feed.messages).toEqual([])
    second.appendUser('second-memory')
    expect(createOwnedChatSessionStorage('main').load()!.threads[0]!.feed.messages[0]!.text).toBe('main-memory')
    expect(createOwnedChatSessionStorage('second').load()!.threads[0]!.feed.messages[0]!.text).toBe('second-memory')
  })

  it.each([
    null,
    [],
    { threads: [null], activeThreadId: null, modelConfig: { runtimeId: 'x' } },
    { threads: [{ id: 'broken', runtimeId: 'x', title: 'broken', feed: { messages: [null], turnSettled: false } }], activeThreadId: 'broken', modelConfig: { runtimeId: 'x' } },
    { threads: [{ id: 'broken', runtimeId: 'x', title: 'broken', feed: { messages: {}, turnSettled: false } }], activeThreadId: 'broken', modelConfig: { runtimeId: 'x' } },
  ])('合法 JSON 中的损坏 snapshot 被丢弃：%j', (snapshot) => {
    vi.stubGlobal('localStorage', memoryLocalStorage({
      [OWNED_CHAT_SESSION_STORAGE_KEY]: JSON.stringify({ version: OWNED_CHAT_SESSION_STORAGE_VERSION, snapshot }),
    }))
    expect(createOwnedChatSessionStorage().load()).toBeNull()
    const store = createChatSessionStore({ storage: createOwnedChatSessionStorage() })
    expect(() => store.appendUser('恢复后可继续聊天')).not.toThrow()
    expect(store.getState().threads[0]!.feed.messages[0]!.text).toBe('恢复后可继续聊天')
  })

  it('storage 访问或写入抛错不影响聊天内存态', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('quota exceeded') },
    })
    const store = createChatSessionStore({ storage: createOwnedChatSessionStorage('second') })
    expect(() => store.appendUser('仍可聊天')).not.toThrow()
    expect(store.getState().threads[0]!.feed.messages[0]!.text).toBe('仍可聊天')
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
