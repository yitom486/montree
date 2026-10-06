// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_ACP_RUNTIME_ID } from '@montree/contracts'
import { useAcpUiStore } from '@/stores/acp-ui-store'

const CODEX = DEFAULT_ACP_RUNTIME_ID
const OPENCODE = 'opencode'

function resetToCodexThread(): string {
  const threadId = useAcpUiStore.getState().createThread(undefined, CODEX)
  useAcpUiStore.setState({
    prompting: false,
    sessionId: null,
    status: 'disconnected',
    selectedRuntimeId: CODEX,
    pendingMarkProposalSnapshotContents: [],
    pendingPermission: null,
    configOptions: [],
    promptCapabilities: {},
  })
  const thread = useAcpUiStore.getState().threads.find((t) => t.id === threadId)
  useAcpUiStore.setState({
    threads: thread ? [thread] : useAcpUiStore.getState().threads,
    activeThreadId: threadId,
  })
  return threadId
}

function seedCodexHistory(): string {
  useAcpUiStore.getState().appendSystemMessage('正在连接 codex-acp…')
  useAcpUiStore.getState().setSession('sess-codex-01a0c404', [])
  useAcpUiStore.getState().appendSystemMessage('已恢复会话 01a0c404…')
  useAcpUiStore.getState().appendUserMessage('codex 时代的问题')
  return useAcpUiStore.getState().activeThreadId
}

describe('thread↔runtime 绑定（串线回归）', () => {
  beforeEach(() => {
    localStorage.clear()
    resetToCodexThread()
  })

  it('switchThread 到异 runtime 线程时自动对齐 selectedRuntimeId', () => {
    const codexThreadId = seedCodexHistory()
    useAcpUiStore.getState().setSelectedRuntimeId(OPENCODE)
    const opencodeThreadId = useAcpUiStore.getState().activeThreadId
    expect(opencodeThreadId).not.toBe(codexThreadId)

    // 经历史菜单回切旧 codex 线程：selected 必须跟随线程归属回到 codex
    useAcpUiStore.getState().switchThread(codexThreadId)
    expect(useAcpUiStore.getState().activeThreadId).toBe(codexThreadId)
    expect(useAcpUiStore.getState().selectedRuntimeId).toBe(CODEX)
  })

  it('切 opencode 发消息不污染 codex 时间线；回切 codex 历史完整', () => {
    const codexThreadId = seedCodexHistory()
    const codexBefore =
      useAcpUiStore.getState().threads.find((t) => t.id === codexThreadId)?.messages.length ?? 0

    // 切到 opencode 专属线程并模拟 opencode 发送链
    useAcpUiStore.getState().setSelectedRuntimeId(OPENCODE)
    useAcpUiStore.getState().setSession('ses_f37opencode', [])
    useAcpUiStore.getState().appendUserMessage('opencode 下的新问题')
    useAcpUiStore.getState().appendSystemMessage('已连接 OpenCode ses_f37…')
    const opencodeThreadId = useAcpUiStore.getState().activeThreadId

    // codex 线程零污染：时间线与跨桶均干净
    const codexThread = useAcpUiStore.getState().threads.find((t) => t.id === codexThreadId)!
    const texts = codexThread.messages.map((m) => m.text)
    expect(texts.some((t) => t.includes('opencode 下的新问题'))).toBe(false)
    expect(texts.some((t) => t.includes('已连接 OpenCode'))).toBe(false)
    expect(codexThread.messages.length).toBe(codexBefore)
    expect(codexThread.agentSessionIds?.[OPENCODE]).toBeUndefined()
    // opencode 写入落在 opencode 专属线程
    const opencodeThread = useAcpUiStore.getState().threads.find((t) => t.id === opencodeThreadId)!
    expect(opencodeThread.runtimeId).toBe(OPENCODE)
    expect(opencodeThread.messages.some((m) => m.text.includes('opencode 下的新问题'))).toBe(true)
    expect(opencodeThread.agentSessionIds?.[OPENCODE]).toBe('ses_f37opencode')

    // 回切 codex：回到原线程，历史完整
    useAcpUiStore.getState().setSelectedRuntimeId(CODEX)
    expect(useAcpUiStore.getState().activeThreadId).toBe(codexThreadId)
    const back = useAcpUiStore.getState().threads.find(
      (t) => t.id === useAcpUiStore.getState().activeThreadId,
    )!
    expect(back.messages.some((m) => m.text.includes('codex 时代的问题'))).toBe(true)
    expect(back.messages.some((m) => m.text.includes('已恢复会话 01a0c404'))).toBe(true)
  })

  it('错位态（旧持久化/旁路 setState）下写入自动纠偏，绝不污染异 runtime 线程', () => {
    const codexThreadId = seedCodexHistory()
    useAcpUiStore.getState().setSelectedRuntimeId(OPENCODE)
    const opencodeThreadId = useAcpUiStore.getState().activeThreadId
    const codexBefore =
      useAcpUiStore.getState().threads.find((t) => t.id === codexThreadId)?.messages.length ?? 0

    // 旁路强制构造错位：active=codex 线程但 selected=opencode（旧脏数据形态）
    useAcpUiStore.setState({ activeThreadId: codexThreadId, selectedRuntimeId: OPENCODE })

    // 任何写消息/会话入口都必须纠偏到 opencode 线程，而非污染 codex 线程
    useAcpUiStore.getState().appendUserMessage('错位态下的 opencode 提问')
    useAcpUiStore.getState().appendSystemMessage('已连接 OpenCode ses_stale…')
    useAcpUiStore.getState().setSession('ses_stale_opencode', [])

    const codexThread = useAcpUiStore.getState().threads.find((t) => t.id === codexThreadId)!
    expect(codexThread.messages.length).toBe(codexBefore)
    expect(codexThread.agentSessionIds?.[OPENCODE]).toBeUndefined()

    const state = useAcpUiStore.getState()
    expect(state.activeThreadId).toBe(opencodeThreadId)
    const opencodeThread = state.threads.find((t) => t.id === opencodeThreadId)!
    expect(opencodeThread.messages.some((m) => m.text.includes('错位态下的 opencode 提问'))).toBe(
      true,
    )
  })
})
