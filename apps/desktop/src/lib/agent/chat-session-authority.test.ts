// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ACP_RUNTIME_ID, MONTREE_SETTLE_COMPLETE_KIND } from '@yitom/contracts'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { getOwnedChatSessionStore, resetOwnedChatSessionStoreForTests } from './chat-session-owner'
import { MONTREE_TURN_CONTEXT_OPEN_TAG, MONTREE_TURN_CONTEXT_CLOSE_TAG } from './context/turn-context'

// 窗口身份和 localStorage 均为测试环境内存实现，不访问桌面用户数据。
vi.mock('@/api/app-api', () => ({ appApi: { getWindowScopeId: () => 'mirror-host-tests' } }))

function hostActive() {
  const host = useAcpUiStore.getState()
  return host.threads.find((t) => t.id === host.activeThreadId)!
}

function packageActive() {
  const pkg = getOwnedChatSessionStore().getState()
  return pkg.threads.find((t) => t.id === pkg.activeThreadId)!
}

function replay(text: string): void {
  useAcpUiStore.getState().applySessionUpdate({ sessionUpdate: 'user_message_chunk', content: [{ type: 'text', text }] })
}

beforeEach(() => {
  localStorage.clear()
  useAcpUiStore.setState({ prompting: false, pendingReplayUserText: null, turnSettled: false, selectedRuntimeId: DEFAULT_ACP_RUNTIME_ID, pendingPermission: null })
  useAcpUiStore.getState().createThread(null, DEFAULT_ACP_RUNTIME_ID)
  useAcpUiStore.setState({ threads: [hostActive()] })
  resetOwnedChatSessionStoreForTests()
})

describe('聊天包单权威与宿主业务投影', () => {
  it('消息写入时线程元数据已落盘，立即重载不丢工作区或恢复会话绑定', () => {
    const host = useAcpUiStore.getState()
    host.createThread('D:/durable-workspace', DEFAULT_ACP_RUNTIME_ID)
    useAcpUiStore.getState().setSession('durable-session')
    useAcpUiStore.getState().appendUserMessage('立即重载的历史')
    const key = 'montree-acp-metadata/v2:mirror-host-tests'
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}').state
    expect(saved?.activeThreadId).toBe(hostActive().id)
    expect(saved?.threads.find((t: { id: string }) => t.id === hostActive().id)).toMatchObject({
      workspaceRoot: 'D:/durable-workspace',
      agentSessionIds: { [DEFAULT_ACP_RUNTIME_ID]: 'durable-session' },
    })
  })

  it('副窗口首次重载优先自己的旧历史元数据，保留工作区/会话/usage/滚动且不读主窗历史', async () => {
    localStorage.clear()
    localStorage.setItem('montree-acp-ui', JSON.stringify({ version: 0, state: {
      panelOpen: true, selectedRuntimeId: DEFAULT_ACP_RUNTIME_ID,
      activeThreadId: 'private-main', threads: [{ id: 'private-main', title: '主窗', runtimeId: DEFAULT_ACP_RUNTIME_ID,
        messages: [{ id: 'main-only', role: 'user', text: '主窗私有', createdAt: 1 }],
      }],
    } }))
    const legacy = JSON.stringify({ version: 0, state: {
      selectedRuntimeId: DEFAULT_ACP_RUNTIME_ID, activeThreadId: 'own-legacy', panelOpen: false,
      chatScrollByThread: { 'own-legacy': { scrollTop: 123, pinned: false } },
      threads: [{ id: 'own-legacy', title: '副窗旧历史', runtimeId: DEFAULT_ACP_RUNTIME_ID,
        workspaceRoot: 'D:/own-workspace', agentSessionIds: { [DEFAULT_ACP_RUNTIME_ID]: 'own-session' },
        createdAt: 10, updatedAt: 20, usage: { used: 12, size: 100 },
        messages: [{ id: 'own-message', role: 'user', text: '副窗历史', createdAt: 11 }],
      }],
    } })
    localStorage.setItem('montree-acp-ui:mirror-host-tests', legacy)
    resetOwnedChatSessionStoreForTests()
    await useAcpUiStore.persist.rehydrate()
    expect(hostActive()).toMatchObject({ id: 'own-legacy', workspaceRoot: 'D:/own-workspace',
      agentSessionIds: { [DEFAULT_ACP_RUNTIME_ID]: 'own-session' }, usage: { used: 12, size: 100 },
      messages: [{ id: 'own-message', text: '副窗历史' }],
    })
    expect(useAcpUiStore.getState().chatScrollByThread['own-legacy']).toEqual({ scrollTop: 123, pinned: false })
    expect(packageActive().feed.messages).toBe(hostActive().messages)
    expect(localStorage.getItem('montree-acp-ui:mirror-host-tests')).toBe(legacy)
  })

  it('生产文本入口仅归约一次，不反灌宿主快照，兼容投影引用就是包feed', () => {
    const pkg = getOwnedChatSessionStore()
    const dispatch = vi.spyOn(pkg, 'dispatchFeedEvent')
    const sync = vi.spyOn(pkg, 'syncHostThread')
    try {
      useAcpUiStore.getState().applySessionUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '只归约一次' } })
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(sync).not.toHaveBeenCalled()
      expect(hostActive().messages).toBe(packageActive().feed.messages)
      expect(hostActive().messages.map(m => m.text)).toEqual(['只归约一次'])
    } finally { dispatch.mockRestore(); sync.mockRestore() }
  })

  it('清空仅写一次业务feed，且投影引用与回合状态和包保持一致', () => {
    useAcpUiStore.getState().appendUserMessage('清空之前')
    useAcpUiStore.getState().finishStreaming()
    const pkg = getOwnedChatSessionStore()
    const sync = vi.spyOn(pkg, 'syncHostThread')
    try {
      useAcpUiStore.getState().clearMessages()
      expect(sync).toHaveBeenCalledTimes(1)
      expect(hostActive().messages).toBe(packageActive().feed.messages)
      expect(hostActive().messages).toEqual([])
      expect(useAcpUiStore.getState().turnSettled).toBe(packageActive().feed.turnSettled)
      expect(packageActive().feed.turnSettled).toBe(false)
    } finally { sync.mockRestore() }
  })

  it('修改宿主投影不会成为第二写入源，下一真实事件继续消费包历史', () => {
    useAcpUiStore.getState().appendUserMessage('包权威历史')
    const real = packageActive().feed.messages
    useAcpUiStore.setState(s => ({ threads: s.threads.map(t => t.id === s.activeThreadId
      ? { ...t, messages: [{ id: 'projection-only', role: 'user', text: '不应反灌', createdAt: 1 }] } : t) }))
    useAcpUiStore.getState().applySessionUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '新回复' } })
    expect(hostActive().messages[0]).toBe(real[0])
    expect(hostActive().messages.map(m => m.text)).toEqual(['包权威历史', '新回复'])
    expect(hostActive().messages).toBe(packageActive().feed.messages)
  })

  it('新建和工作区切换会同步裁剪空白草稿，切回历史保持身份且不重复消息', () => {
    useAcpUiStore.getState().appendUserMessage('保留的历史')
    const historyId = hostActive().id
    const historyPackageId = packageActive().id
    for (let i = 0; i < 5; i++) useAcpUiStore.getState().createThread()
    expect(useAcpUiStore.getState().threads).toHaveLength(2)
    expect(getOwnedChatSessionStore().getState().threads).toHaveLength(2)
    useAcpUiStore.getState().switchThread(historyId)
    expect(getOwnedChatSessionStore().getState().threads).toHaveLength(1)
    expect(packageActive().id).toBe(historyPackageId)
    expect(packageActive().feed.messages.map((m) => m.text)).toEqual(['保留的历史'])
    useAcpUiStore.getState().switchWorkspace('D:/another-workspace')
    useAcpUiStore.getState().switchWorkspace(undefined)
    expect(packageActive().hostThreadId).toBe(historyId)
    expect(packageActive().feed.messages.map((m) => m.text)).toEqual(['保留的历史'])
    expect(getOwnedChatSessionStore().getState().threads).toHaveLength(1)
  })

  it('历史达到 40 条时包线程表顺序、裁剪结果及 active 与宿主一致', () => {
    for (let i = 0; i < 45; i++) {
      useAcpUiStore.getState().createThread()
      useAcpUiStore.getState().appendUserMessage(`历史 ${i}`)
    }
    const host = useAcpUiStore.getState()
    const pkg = getOwnedChatSessionStore().getState()
    expect(host.threads).toHaveLength(40)
    expect(pkg.threads.map((t) => t.hostThreadId)).toEqual(host.threads.map((t) => t.id))
    expect(packageActive().hostThreadId).toBe(host.activeThreadId)
    expect(packageActive().feed.messages.map((m) => m.text)).toEqual(['历史 44'])
  })

  it('首次新建 owned 实例后发送只追加一次，附件完整且侧栏 active 指向宿主', () => {
    const attachments = [{ id: 'image', kind: 'image' as const, name: 'cover.png', mimeType: 'image/png', previewUrl: 'data:image/png;base64,test' }]
    useAcpUiStore.getState().appendUserMessage('首条消息', attachments)
    expect(packageActive().hostThreadId).toBe(hostActive().id)
    expect(packageActive().feed.messages).toHaveLength(1)
    expect(packageActive().feed.messages[0]?.attachments).toEqual(attachments)
  })

  it('切换运行时会同步新建和历史选择，来回发送保持隔离', () => {
    useAcpUiStore.getState().appendUserMessage('Codex 历史')
    const codexId = hostActive().id
    useAcpUiStore.getState().setSelectedRuntimeId('opencode')
    const openCodeId = hostActive().id
    expect(packageActive().hostThreadId).toBe(openCodeId)
    expect(packageActive().runtimeId).toBe('opencode')
    useAcpUiStore.getState().appendUserMessage('OpenCode 首问')
    expect(packageActive().feed.messages.map((m) => m.text)).toEqual(['OpenCode 首问'])
    useAcpUiStore.getState().setSelectedRuntimeId(DEFAULT_ACP_RUNTIME_ID)
    expect(packageActive().hostThreadId).toBe(codexId)
    expect(packageActive().feed.messages.map((m) => m.text)).toEqual(['Codex 历史'])
    expect(getOwnedChatSessionStore().getState().modelConfig.runtimeId).toBe(DEFAULT_ACP_RUNTIME_ID)
  })

  it('删除最后一条线程后宿主新草稿与包保持关联，继续发言显示在新会话', () => {
    useAcpUiStore.getState().appendUserMessage('旧消息')
    const deleted = hostActive().id
    useAcpUiStore.getState().deleteThread(deleted)
    expect(hostActive().id).not.toBe(deleted)
    expect(packageActive().hostThreadId).toBe(hostActive().id)
    expect(getOwnedChatSessionStore().getState().threads).toHaveLength(1)
    useAcpUiStore.getState().appendUserMessage('新消息')
    expect(packageActive().feed.messages.map((m) => m.text)).toEqual(['新消息'])
    expect(getOwnedChatSessionStore().getState().threads).toHaveLength(1)
  })

  it('回放仅同步清洗后的用户消息，纯脚手架和撕裂中间态不进入包', () => {
    const context = `${MONTREE_TURN_CONTEXT_OPEN_TAG}\n{"private":"context"}\n${MONTREE_TURN_CONTEXT_CLOSE_TAG}`
    replay(context)
    expect(packageActive().feed.messages).toEqual([])
    replay(`${context}\n完整用户问`)
    expect(packageActive().feed.messages.map((m) => m.text)).toEqual(['完整用户问'])
    useAcpUiStore.getState().clearMessages()
    const cut = Math.floor(context.length / 2)
    replay(`撕裂前文\n${context.slice(0, cut)}`)
    expect(packageActive().feed.messages).toEqual([])
    replay(`${context.slice(cut)}\n撕裂后文`)
    expect(packageActive().feed.messages.map((m) => m.text)).toEqual(['撕裂前文\n\n撕裂后文'])
    expect(packageActive().feed.messages).toEqual(hostActive().messages)
  })

  it('回复到达或定居收尾会落定悬垂用户前文，包侧保持顺序且不泄漏标记', () => {
    replay(`用户前文\n${MONTREE_TURN_CONTEXT_OPEN_TAG}\n未完的脚手架`)
    const pkg = getOwnedChatSessionStore()
    const update = { sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: '模型回复' }] }
    useAcpUiStore.getState().applySessionUpdate(update)
    expect(packageActive().feed.messages.map((m) => m.text)).toEqual(['用户前文', '模型回复'])
    useAcpUiStore.getState().clearMessages()
    replay(`定居前文\n${MONTREE_TURN_CONTEXT_OPEN_TAG}\n未完的脚手架`)
    useAcpUiStore.getState().applySessionUpdate({ sessionUpdate: MONTREE_SETTLE_COMPLETE_KIND })
    expect(packageActive().feed.messages.map((m) => m.text)).toEqual(['定居前文'])
    expect(packageActive().feed.messages[0]?.streaming).toBe(false)
  })
})
