// @vitest-environment happy-dom
/**
 * ACP 工作区绑定会话全生命周期集成测试。
 *
 * 验证核心契约：
 * 1. 跨工作区会话隔离：打开新目录自动创建专属空白会话，切回老目录精准恢复历史会话（resume）；
 * 2. 离线工作区切换：离线时不发网络请求，活跃线程状态与目标工作区对齐，后续连接严格使用目标工作区参数；
 * 3. 历史记录分桶隔离：对话历史仅展示当前工作区 + 当前运行时的会话，新建对话自动打上当前工作区戳记；
 * 4. WSL UNC 路径等价性：//wsl$ 与 //wsl.localhost 路径别名自动识别为同一工作区，不产生冗余空会话；
 * 5. 工作区内切换运行时：保持工作区亲和性，不串入其他工作区的运行时会话。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_ACP_RUNTIME_ID,
  isSameWorkspace,
  ok,
} from '@montree/contracts'

const connectCalls: Array<{
  runtimeId: string
  cwd?: string
  resumeSessionId?: string
}> = []
const disconnectCalls: Array<string | undefined> = []

let nextSessionIdCounter = 1

vi.mock('@/api/acp-api', () => ({
  acpApi: {
    connect: vi.fn(async (payload) => {
      connectCalls.push(payload)
      const sid = payload.resumeSessionId || `sess-auto-${nextSessionIdCounter++}`
      return ok({
        phase: 'ready',
        sessionId: sid,
        runtimeId: payload.runtimeId,
        configOptions: [],
        promptCapabilities: {},
      })
    }),
    disconnect: vi.fn(async (reason) => {
      disconnectCalls.push(reason)
      return ok(undefined)
    }),
    prompt: vi.fn(async () => ok({ stopReason: 'end_turn' })),
    cancel: vi.fn(async () => ok(undefined)),
    setConfigOption: vi.fn(async () => ok({ configOptions: [] })),
    onSessionUpdate: vi.fn(() => () => {}),
  },
}))

import { acpApi } from '@/api/acp-api'
import {
  selectActiveThreadAgentSessionId,
  selectThreadsForWorkspaceAndRuntime,
  useAcpUiStore,
} from '@/stores/acp-ui-store'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useAcpSession } from '@/hooks/agent/useAcpSession'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function renderHook<P, R>(hook: (props: P) => R, initialProps: P) {
  let latestResult: R
  let currentProps = initialProps

  function Harness({ props }: { props: P }) {
    latestResult = hook(props)
    return null
  }

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(createElement(Harness, { props: currentProps }))
  })

  return {
    get result() {
      return { current: latestResult }
    },
    rerender: (newProps?: P) => {
      if (newProps !== undefined) currentProps = newProps
      act(() => {
        root.render(createElement(Harness, { props: currentProps }))
      })
    },
    unmount: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}


const CODEX = DEFAULT_ACP_RUNTIME_ID
const OPENCODE = 'opencode'
const WS_A = 'D:/projects/blog-a'
const WS_B = '\\\\wsl.localhost\\Ubuntu\\home\\user\\blog-b'
const WS_B_ALIAS = '\\\\wsl$\\Ubuntu\\home\\user\\blog-b\\'

function resetStore(initialWorkspace?: string): string {
  const store = useAcpUiStore.getState()
  const fresh = store.createThread(initialWorkspace, CODEX)
  useAcpUiStore.setState({
    selectedRuntimeId: CODEX,
    currentWorkspaceRoot: initialWorkspace,
    status: 'disconnected',
    sessionId: null,
    prompting: false,
    threads: store.threads.filter((t) => t.id === fresh),
    activeThreadId: fresh,
  })
  return fresh
}

describe('ACP 工作区绑定会话集成测试', () => {
  beforeEach(() => {
    localStorage.clear()
    connectCalls.length = 0
    disconnectCalls.length = 0
    nextSessionIdCounter = 1
    resetStore(WS_A)
    vi.clearAllMocks()
  })

  it('跨工作区切换：连接态下自动断开、切到新目录新建会话，切回原目录精准 Resume', async () => {
    let currentWorkspace = WS_A
    const hook = renderHook((ws: string) => useAcpSession(ws), currentWorkspace)

    // 1. 在工作区 A 下连接
    await act(async () => {
      await hook.result.current.connect()
    })

    expect(useAcpUiStore.getState().status).toBe('connected')
    const threadA1Id = useAcpUiStore.getState().activeThreadId
    const threadA1SessionId = useAcpUiStore.getState().sessionId
    expect(threadA1SessionId).toBe('sess-auto-1')
    expect(connectCalls).toHaveLength(1)
    expect(connectCalls[0]).toEqual({
      runtimeId: CODEX,
      cwd: WS_A,
      resumeSessionId: undefined,
      hasLocalHistory: false,
      recoverToolCallIds: [],
    })

    // 在工作区 A 发送消息
    act(() => {
      useAcpUiStore.getState().appendUserMessage('在工作区 A 的提问')
    })

    // 在工作区 A 新建第二个会话，并连接
    let threadA2Id = ''
    act(() => {
      threadA2Id = useAcpUiStore.getState().createThread(WS_A)
    })
    await act(async () => {
      await hook.result.current.syncAgentSessionToActiveThread(true)
    })
    const threadA2SessionId = useAcpUiStore.getState().sessionId
    expect(threadA2SessionId).toBe('sess-auto-2')
    act(() => {
      useAcpUiStore.getState().appendUserMessage('工作区 A 的第二条会话消息')
    })

    // 2. 切换到全新工作区 B（WSL 目录）
    currentWorkspace = WS_B
    await act(async () => {
      hook.rerender(WS_B)
    })

    // 验证：
    // - 旧会话被断开
    expect(disconnectCalls.length).toBeGreaterThanOrEqual(1)
    // - 活跃线程自动切换为工作区 B 的新空白线程
    const threadBId = useAcpUiStore.getState().activeThreadId
    expect(threadBId).not.toBe(threadA1Id)
    expect(threadBId).not.toBe(threadA2Id)
    const threadB = useAcpUiStore.getState().threads.find((t) => t.id === threadBId)
    // - 线程内没有任何工作区 A 的消息
    expect(threadB?.messages.some((m) => m.role === 'user')).toBe(false)
    expect(threadB?.messages.some((m) => m.text.includes('工作区 A'))).toBe(false)


    // - 自动对齐重连参数为工作区 B，且 resumeSessionId 为空（全新工作区）
    const lastConnectCall = connectCalls[connectCalls.length - 1]
    expect(lastConnectCall?.cwd).toBe(WS_B)
    expect(lastConnectCall?.resumeSessionId).toBeUndefined()
    const threadBSessionId = useAcpUiStore.getState().sessionId
    expect(threadBSessionId).toBe('sess-auto-3')

    // 3. 再次切回工作区 A
    currentWorkspace = WS_A
    await act(async () => {
      hook.rerender(WS_A)
    })

    // 验证：
    // - 自动命中工作区 A 最近活跃的第二个线程（threadA2）
    expect(useAcpUiStore.getState().activeThreadId).toBe(threadA2Id)
    const activeThreadNow = useAcpUiStore
      .getState()
      .threads.find((t) => t.id === threadA2Id)
    expect(activeThreadNow?.messages.some((m) => m.text.includes('工作区 A 的第二条会话消息'))).toBe(
      true,
    )

    // - 自动发起的连接请求带上了工作区 A 的 resumeSessionId ('sess-auto-2')！
    const restoreCall = connectCalls[connectCalls.length - 1]
    expect(restoreCall?.cwd).toBe(WS_A)
    expect(restoreCall?.resumeSessionId).toBe('sess-auto-2')
    expect(useAcpUiStore.getState().sessionId).toBe('sess-auto-2')

    hook.unmount()
  })

  it('离线状态下切换工作区：零网络开销，本地活跃线程正确切换，后续连接精确使用目标工作区', async () => {
    let currentWorkspace = WS_A
    const hook = renderHook((ws: string) => useAcpSession(ws), currentWorkspace)

    expect(useAcpUiStore.getState().status).toBe('disconnected')
    connectCalls.length = 0
    disconnectCalls.length = 0

    // 离线切换工作区 A -> B
    currentWorkspace = WS_B
    await act(async () => {
      hook.rerender(WS_B)
    })

    // 验证：完全不发送任何 connect / disconnect 网络请求
    expect(connectCalls).toHaveLength(0)
    expect(disconnectCalls).toHaveLength(0)

    // 验证：活跃线程已对齐为工作区 B
    const activeThread = useAcpUiStore
      .getState()
      .threads.find((t) => t.id === useAcpUiStore.getState().activeThreadId)
    expect(isSameWorkspace(activeThread?.workspaceRoot, WS_B)).toBe(true)

    // 用户随后点击连接
    await act(async () => {
      await hook.result.current.connect()
    })

    // 验证：连接准确指向工作区 B
    expect(connectCalls).toHaveLength(1)
    expect(connectCalls[0]?.cwd).toBe(WS_B)

    hook.unmount()
  })

  it('工作区历史菜单隔离：只展示当前工作区对话，新建对话自动打上当前工作区戳记', () => {
    const store = useAcpUiStore.getState()

    // 工作区 A 建立 2 个对话
    const tA1 = store.createThread(WS_A, CODEX)
    store.appendUserMessage('Msg A1')
    const tA2 = store.createThread(WS_A, CODEX)
    store.appendUserMessage('Msg A2')

    // 工作区 B 建立 1 个对话
    const tB1 = store.createThread(WS_B, CODEX)
    store.appendUserMessage('Msg B1')

    // 全局独立建立 1 个对话（显式传入 null 表示无工作区）
    const tGlobal = store.createThread(null, CODEX)
    store.appendUserMessage('Msg Global')

    const allThreads = useAcpUiStore.getState().threads

    // 过滤工作区 A
    const threadsInA = selectThreadsForWorkspaceAndRuntime(allThreads, WS_A, CODEX)
    expect(threadsInA.map((t) => t.id)).toContain(tA1)
    expect(threadsInA.map((t) => t.id)).toContain(tA2)
    expect(threadsInA.map((t) => t.id)).not.toContain(tB1)
    expect(threadsInA.map((t) => t.id)).not.toContain(tGlobal)

    // 过滤工作区 B
    const threadsInB = selectThreadsForWorkspaceAndRuntime(allThreads, WS_B, CODEX)
    expect(threadsInB.map((t) => t.id)).toContain(tB1)
    expect(threadsInB.map((t) => t.id)).not.toContain(tA1)
    expect(threadsInB.map((t) => t.id)).not.toContain(tA2)

    // 过滤全局独立对话
    const threadsGlobal = selectThreadsForWorkspaceAndRuntime(allThreads, undefined, CODEX)
    expect(threadsGlobal.map((t) => t.id)).toContain(tGlobal)
    expect(threadsGlobal.map((t) => t.id)).not.toContain(tA1)

    // 切换到工作区 A 后直接调用 createThread()，默认自动打上工作区 A 标记
    useAcpUiStore.getState().switchWorkspace(WS_A)
    const newThreadInAId = useAcpUiStore.getState().createThread()
    const newThreadInA = useAcpUiStore.getState().threads.find((t) => t.id === newThreadInAId)
    expect(isSameWorkspace(newThreadInA?.workspaceRoot, WS_A)).toBe(true)
  })

  it('WSL UNC 别名识别：//wsl$ 与 //wsl.localhost 路径互认，不创建冗余空会话', () => {
    // 1. 在 WS_B 下创建会话
    useAcpUiStore.getState().switchWorkspace(WS_B)
    const thread1Id = useAcpUiStore.getState().activeThreadId
    useAcpUiStore.getState().appendUserMessage('WSL 博客草稿')

    // 2. 重新以 WS_B_ALIAS（即 \\wsl$\Ubuntu\home\user\blog-b\）切换
    const thread2Id = useAcpUiStore.getState().switchWorkspace(WS_B_ALIAS)

    // 验证：直接识别为同一工作区并复用现有线程，不产生冗余新线程
    expect(thread2Id).toBe(thread1Id)
    expect(useAcpUiStore.getState().activeThreadId).toBe(thread1Id)
  })

  it('工作区内切换 Agent 运行时：保持工作区亲和性，隔离不同工作区的会话', () => {
    // 工作区 A 下从 CODEX 切到 OPENCODE
    useAcpUiStore.getState().switchWorkspace(WS_A)
    const codexThreadId = useAcpUiStore.getState().activeThreadId

    useAcpUiStore.getState().setSelectedRuntimeId(OPENCODE)
    const opencodeThreadId = useAcpUiStore.getState().activeThreadId

    // 验证：切换后创建的是工作区 A 下的 opencode 线程
    expect(opencodeThreadId).not.toBe(codexThreadId)
    const opencodeThread = useAcpUiStore.getState().threads.find((t) => t.id === opencodeThreadId)
    expect(opencodeThread?.runtimeId).toBe(OPENCODE)
    expect(isSameWorkspace(opencodeThread?.workspaceRoot, WS_A)).toBe(true)

    // 切回 CODEX
    useAcpUiStore.getState().setSelectedRuntimeId(CODEX)
    expect(useAcpUiStore.getState().activeThreadId).toBe(codexThreadId)
  })
})
