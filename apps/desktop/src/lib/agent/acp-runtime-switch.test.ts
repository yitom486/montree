// @vitest-environment happy-dom
/**
 * ACP 运行时切换语义测试（跨 store 集成）。
 *
 * 目标：把「换 Agent（acp runtime）时，Agent 相关状态必须整体联动/隔离」的契约
 * 巩固成测试，防止后续实现回退：
 * 1. 断开/出错 → 瞬态状态清空（configOptions、promptCapabilities、待审批权限、prompting）
 * 2. sessionId 按运行时分桶 → 换 Agent 不串线、旧 Agent 恢复能力不丢
 * 3. 模型偏好按运行时隔离
 * 4. 本地聊天记录（threads/messages）跨运行时保留
 * 5. 旧版持久化（单值 agentSessionId）自动迁移到 codex 桶
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  BUILTIN_ACP_RUNTIMES,
  DEFAULT_ACP_RUNTIME_ID,
} from '@montree/contracts'
import {
  selectActiveThreadAgentSessionId,
  selectThreadsForRuntime,
  useAcpUiStore,
} from '@/stores/acp-ui-store'
import {
  annotationFileKey,
  annotationOwnsSessionId,
  useAnnotationAgentStore,
} from '@/stores/annotation-agent-store'

const CODEX = DEFAULT_ACP_RUNTIME_ID
// 第二运行时（隔离语义的通用占位；Antigravity 已淘汰，不再引用真实运行时 id）
const ALT = 'alt-acp'

function freshMainThread(): void {
  const threadId = useAcpUiStore.getState().createThread(undefined, CODEX)
  useAcpUiStore.setState({
    prompting: false,
    sessionId: null,
    status: 'disconnected',
    selectedRuntimeId: CODEX,
    pendingMarkProposalSnapshotContents: [],
  })
  const thread = useAcpUiStore.getState().threads.find((t) => t.id === threadId)
  useAcpUiStore.setState({
    threads: thread ? [thread] : useAcpUiStore.getState().threads,
    activeThreadId: threadId,
  })
}

describe('ACP 运行时切换：状态联动语义', () => {
  beforeEach(() => {
    localStorage.clear()
    freshMainThread()
    useAnnotationAgentStore.setState({
      byFileKey: {},
      activeFileKey: null,
      sessionsStale: false,
      capturing: false,
      prompting: false,
    })
  })

  it('断开/出错时瞬态状态全部清空，切运行时后依然干净', () => {
    useAcpUiStore.setState({
      status: 'connected',
      sessionId: 'sess-live',
      configOptions: [
        { configId: 'model', name: '模型', type: 'select', currentValue: 'gpt-5' },
      ],
      promptCapabilities: { image: true },
      prompting: true,
    })
    useAcpUiStore.getState().setPendingPermission({
      requestId: 1,
      summary: 'delete',
      options: [],
    })

    // 断开即清瞬态（真实流程：hook 收到 status 事件后先 setSession(null)）
    useAcpUiStore.getState().setStatus('disconnected')
    useAcpUiStore.getState().setSession(null)
    let state = useAcpUiStore.getState()
    expect(state.configOptions).toEqual([])
    expect(state.promptCapabilities).toEqual({})
    expect(state.pendingPermission).toBeNull()
    expect(state.prompting).toBe(false)
    expect(state.sessionId).toBeNull()

    // 换 Agent 后仍干净（不会被旧 Agent 残留污染）
    useAcpUiStore.getState().setSelectedRuntimeId(ALT)
    state = useAcpUiStore.getState()
    expect(state.configOptions).toEqual([])
    expect(state.promptCapabilities).toEqual({})
    expect(state.pendingPermission).toBeNull()
  })

  it('错误状态同样清空模型列表与权限', () => {
    useAcpUiStore.setState({
      status: 'connected',
      configOptions: [{ configId: 'model', name: '模型', type: 'select' }],
    })
    useAcpUiStore.getState().setStatus('error', 'spawn failed')
    expect(useAcpUiStore.getState().configOptions).toEqual([])
    expect(useAcpUiStore.getState().pendingPermission).toBeNull()
  })

  it('sessionId 按运行时分桶：切 Agent 不串线，旧 Agent 恢复能力不丢', () => {
    // codex 连接 → 记入 codex 桶
    useAcpUiStore.getState().setSession('sess-codex-1', [])
    expect(selectActiveThreadAgentSessionId(useAcpUiStore.getState())).toBe('sess-codex-1')

    // 切到第二运行时：新运行时无旧会话 → resume 取不到 codex 的 id（不跨 Agent 串线）
    useAcpUiStore.getState().setSelectedRuntimeId(ALT)
    useAcpUiStore.getState().setSession(null)
    expect(selectActiveThreadAgentSessionId(useAcpUiStore.getState())).toBeUndefined()

    // 第二运行时连接 → 记入自己的桶（活动线程为其专属线程）
    useAcpUiStore.getState().setSession('sess-alt-1', [])
    const threadId = useAcpUiStore.getState().activeThreadId
    let thread = useAcpUiStore.getState().threads.find((t) => t.id === threadId)
    expect(thread?.agentSessionIds?.[ALT]).toBe('sess-alt-1')

    // codex 桶仍由 codex 专属线程持有，互不覆盖
    const codexThread = useAcpUiStore
      .getState()
      .threads.find((t) => (t.runtimeId || DEFAULT_ACP_RUNTIME_ID) === CODEX)
    expect(codexThread?.agentSessionIds?.[CODEX]).toBe('sess-codex-1')

    // 切回 codex：回到 codex 线程，原会话仍可恢复
    useAcpUiStore.getState().setSelectedRuntimeId(CODEX)
    expect(useAcpUiStore.getState().activeThreadId).toBe(codexThread!.id)
    expect(selectActiveThreadAgentSessionId(useAcpUiStore.getState())).toBe('sess-codex-1')

    // 断开保留两侧恢复能力
    useAcpUiStore.getState().setSession(null)
    thread = useAcpUiStore
      .getState()
      .threads.find((t) => t.id === useAcpUiStore.getState().activeThreadId)
    expect(thread?.agentSessionIds?.[CODEX]).toBe('sess-codex-1')
    const altThread = useAcpUiStore
      .getState()
      .threads.find((t) => (t.runtimeId || DEFAULT_ACP_RUNTIME_ID) === ALT)
    expect(altThread?.agentSessionIds?.[ALT]).toBe('sess-alt-1')
  })

  it('模型偏好按运行时隔离，互不污染', () => {
    useAcpUiStore.getState().rememberConfigPreference(CODEX, 'model', 'gpt-5')
    useAcpUiStore.getState().setSelectedRuntimeId(ALT)
    useAcpUiStore.getState().rememberConfigPreference(ALT, 'model', 'alt-model-x')
    const prefs = useAcpUiStore.getState().preferredConfigByRuntime
    expect(prefs[CODEX]?.model).toBe('gpt-5')
    expect(prefs[ALT]?.model).toBe('alt-model-x')
    expect(prefs[ALT]?.mode).toBeUndefined()
  })

  it('聊天记录按运行时各线程隔离：换 Agent 不清旧历史，新 Agent 从空白开始', () => {
    useAcpUiStore.getState().appendUserMessage('在 codex 下问的问题')
    useAcpUiStore.getState().setSelectedRuntimeId(ALT)
    // 第二运行时使用自己的专属线程，从空白开始
    const altMessages =
      useAcpUiStore
        .getState()
        .threads.find((t) => t.id === useAcpUiStore.getState().activeThreadId)?.messages ??
      []
    expect(altMessages.some((m) => m.role === 'user')).toBe(false)

    // 切回 codex：旧对话记录仍在
    useAcpUiStore.getState().setSelectedRuntimeId(CODEX)
    const codexMessages =
      useAcpUiStore
        .getState()
        .threads.find((t) => t.id === useAcpUiStore.getState().activeThreadId)?.messages ?? []
    expect(codexMessages.some((m) => m.text === '在 codex 下问的问题')).toBe(true)
  })

  it('旧版持久化自动迁移：单值 agentSessionId 归入 codex 桶', async () => {
    const threadId = 'thread_legacy'
    localStorage.setItem(
      'montree-acp-ui',
      JSON.stringify({
        state: {
          selectedRuntimeId: CODEX,
          activeThreadId: threadId,
          threads: [
            {
              id: threadId,
              title: '旧会话',
              createdAt: 1,
              updatedAt: 2,
              agentSessionId: 'sess-legacy-codex',
              messages: [
                { id: 'u1', role: 'user', text: '历史消息', createdAt: 3 },
              ],
            },
          ],
        },
        version: 0,
      }),
    )
    await useAcpUiStore.persist.rehydrate()
    const state = useAcpUiStore.getState()
    const thread = state.threads.find((t) => t.id === threadId)
    expect(thread?.agentSessionIds?.[CODEX]).toBe('sess-legacy-codex')
    expect((thread as unknown as Record<string, unknown>)['agentSessionId']).toBeUndefined()
    expect(selectActiveThreadAgentSessionId(state)).toBe('sess-legacy-codex')
  })

  it('批注会话同样按运行时分桶：换 Agent 后旧桶保留、新桶独立', async () => {
    const key = annotationFileKey('fp-switch', '/book.epub')
    useAnnotationAgentStore.getState().ensureFile(key)
    useAnnotationAgentStore.getState().bindSessionId('ann-codex-1', CODEX)
    expect(
      annotationOwnsSessionId(useAnnotationAgentStore.getState(), 'ann-codex-1'),
    ).toBe(true)

    // 换运行时后新建的批注会话记入新桶，旧桶不动
    useAcpUiStore.getState().setSelectedRuntimeId(ALT)
    useAnnotationAgentStore.getState().bindSessionId('ann-alt-1', ALT)
    const thread =
      useAnnotationAgentStore.getState().byFileKey[key]!.threads[0]!
    expect(thread.agentSessionIds?.[CODEX]).toBe('ann-codex-1')
    expect(thread.agentSessionIds?.[ALT]).toBe('ann-alt-1')
  })

  it('多运行时连续切换：A→B→C 各自建专属线程，隔离且回切恢复', () => {
    // 真实模板 id（与 BUILTIN_ACP_RUNTIMES / findBuiltinAcpRuntime 一致）
    const RUNTIME_B = 'claude'
    const RUNTIME_C = 'gemini'
    // codex 起点已由 freshMainThread 建好
    const codexThreadId = useAcpUiStore.getState().activeThreadId
    useAcpUiStore.getState().setSession('sess-codex-multi', [])

    // 切 B：无历史则自动建专属空白线程（session-slice.setSelectedRuntimeId 语义）
    useAcpUiStore.getState().setSelectedRuntimeId(RUNTIME_B)
    const bThreadId = useAcpUiStore.getState().activeThreadId
    expect(bThreadId).not.toBe(codexThreadId)
    expect(selectActiveThreadAgentSessionId(useAcpUiStore.getState())).toBeUndefined()
    useAcpUiStore.getState().setSession('sess-b-1', [])
    expect(selectActiveThreadAgentSessionId(useAcpUiStore.getState())).toBe('sess-b-1')

    // 切 C：同样专属线程，与 A/B 均隔离
    useAcpUiStore.getState().setSelectedRuntimeId(RUNTIME_C)
    const cThreadId = useAcpUiStore.getState().activeThreadId
    expect(cThreadId).not.toBe(codexThreadId)
    expect(cThreadId).not.toBe(bThreadId)
    expect(selectActiveThreadAgentSessionId(useAcpUiStore.getState())).toBeUndefined()
    useAcpUiStore.getState().setSession('sess-c-1', [])

    // 回切 B：回到 B 专属线程，原会话可恢复
    useAcpUiStore.getState().setSelectedRuntimeId(RUNTIME_B)
    expect(useAcpUiStore.getState().activeThreadId).toBe(bThreadId)
    expect(selectActiveThreadAgentSessionId(useAcpUiStore.getState())).toBe('sess-b-1')

    // 回切 codex：同样恢复
    useAcpUiStore.getState().setSelectedRuntimeId(CODEX)
    expect(useAcpUiStore.getState().activeThreadId).toBe(codexThreadId)
    expect(selectActiveThreadAgentSessionId(useAcpUiStore.getState())).toBe('sess-codex-multi')

    // 历史菜单过滤：各 runtime 只见自己的线程
    const state = useAcpUiStore.getState()
    expect(selectThreadsForRuntime(state.threads, CODEX).every((t) => (t.runtimeId || CODEX) === CODEX)).toBe(true)
    expect(selectThreadsForRuntime(state.threads, RUNTIME_B).map((t) => t.id)).toContain(bThreadId)
    expect(selectThreadsForRuntime(state.threads, RUNTIME_C).map((t) => t.id)).toContain(cThreadId)
    expect(selectThreadsForRuntime(state.threads, RUNTIME_B).map((t) => t.id)).not.toContain(cThreadId)
  })

  it('切换运行时自动建专属线程：同 runtime 二次切换复用，不重复建', () => {
    const NEXT = 'copilot'
    useAcpUiStore.getState().setSelectedRuntimeId(NEXT)
    const first = useAcpUiStore.getState().activeThreadId
    const countAfterFirst = useAcpUiStore.getState().threads.length
    // 切走再回来：应回到同一专属线程，不新增
    useAcpUiStore.getState().setSelectedRuntimeId(CODEX)
    useAcpUiStore.getState().setSelectedRuntimeId(NEXT)
    expect(useAcpUiStore.getState().activeThreadId).toBe(first)
    expect(useAcpUiStore.getState().threads.length).toBe(countAfterFirst)
  })

  it('BUILTIN 运行时模板契约：8 项可 spawn 的 command/args（含 codex 默认）', () => {
    // 下游 contracts 已落地 8 模板；接线层按此断言，防回退。
    expect(BUILTIN_ACP_RUNTIMES.map((rt) => rt.id)).toEqual([
      'codex-acp',
      'claude',
      'gemini',
      'copilot',
      'opencode',
      'cursor-cli',
      'deepseek',
      'agy',
    ])
    const codex = BUILTIN_ACP_RUNTIMES.find((rt) => rt.id === DEFAULT_ACP_RUNTIME_ID)
    expect(codex).toBeDefined()
    for (const rt of BUILTIN_ACP_RUNTIMES) {
      expect(rt.id.trim()).not.toBe('')
      expect(rt.command.trim()).not.toBe('')
      expect(Array.isArray(rt.args)).toBe(true)
    }
  })

  it('批注旧版持久化自动迁移：单值 agentSessionId 归入 codex 桶', async () => {
    const key = annotationFileKey('fp-legacy', '/book.epub')
    localStorage.setItem(
      'montree-annotation-agent',
      JSON.stringify({
        state: {
          byFileKey: {
            [key]: {
              activeThreadId: 'ann-thread-legacy',
              threads: [
                {
                  id: 'ann-thread-legacy',
                  title: '批注助手',
                  createdAt: 1,
                  updatedAt: 2,
                  agentSessionId: 'ann-legacy-codex',
                  messages: [],
                },
              ],
            },
          },
        },
        version: 0,
      }),
    )
    await useAnnotationAgentStore.persist.rehydrate()
    const thread =
      useAnnotationAgentStore.getState().byFileKey[key]!.threads[0]!
    expect(thread.agentSessionIds?.[CODEX]).toBe('ann-legacy-codex')
    expect((thread as unknown as Record<string, unknown>)['agentSessionId']).toBeUndefined()
    expect(
      annotationOwnsSessionId(useAnnotationAgentStore.getState(), 'ann-legacy-codex'),
    ).toBe(true)
  })
})

