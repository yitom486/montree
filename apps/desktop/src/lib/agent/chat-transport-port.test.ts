// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ACP_RUNTIME_ID, err, ok } from '@montree/contracts'
import { toast } from 'sonner'

vi.mock('@/api/acp-api', () => ({
  acpApi: {
    prompt: vi.fn(),
    cancel: vi.fn(),
    respondPermission: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

import { acpApi } from '@/api/acp-api'
import type { AcpContentBlock } from '@montree/contracts'
import { createChatTransportPort } from './chat-transport-port'
import { resetSessionBootstrap } from '@/lib/agent/context/session-bootstrap'
import {
  MONTREE_STATIC_SKILL,
  MONTREE_TOOL_OVERVIEW,
} from '@/lib/agent/context/montree-static-skill'
import { useAcpUiStore } from '@/stores/acp-ui-store'

const RUNTIME = DEFAULT_ACP_RUNTIME_ID
const mockedPrompt = vi.mocked(acpApi.prompt)
const mockedCancel = vi.mocked(acpApi.cancel)
const mockedRespondPermission = vi.mocked(acpApi.respondPermission)
const mockedToastError = vi.mocked(toast.error)

function promptBlocks(): AcpContentBlock[] {
  const call = mockedPrompt.mock.calls[0]?.[0]
  if (!call) throw new Error('acpApi.prompt 未被调用')
  return call.prompt
}

function joinedText(blocks: AcpContentBlock[]): string {
  return blocks
    .map((b) => (b.type === 'text' ? (b.text ?? '') : ''))
    .join('\n')
}

/** 新建隔离线程并回到连接基线，返回 threadId（仿 acp-thread-runtime-bind 的重置套路） */
function seedThread(): string {
  const threadId = useAcpUiStore.getState().createThread(undefined, RUNTIME)
  useAcpUiStore.setState({
    prompting: false,
    sessionId: null,
    status: 'disconnected',
    selectedRuntimeId: RUNTIME,
    sessionPromptMode: 'compatibility',
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

function messageCount(threadId: string): number {
  return (
    useAcpUiStore.getState().threads.find((t) => t.id === threadId)?.messages.length ?? -1
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  resetSessionBootstrap()
  mockedPrompt.mockResolvedValue(ok({ stopReason: 'end_turn' }))
  mockedCancel.mockResolvedValue(ok(undefined))
})

describe('chat-transport-port sendText', () => {
  it('前缀包含静态 Skill/工具概览 + 正文兜底 + 附件透传，且不写时间线', async () => {
    const threadId = seedThread()
    useAcpUiStore.getState().setSession('sid-send-1', [])
    useAcpUiStore.setState({ promptCapabilities: { image: true } })
    const transport = createChatTransportPort()

    await transport.sendText(threadId, '你好', {
      attachments: [
        {
          id: 'img-1',
          kind: 'image',
          name: 'a.png',
          mimeType: 'image/png',
          base64: 'aGk=',
        },
        {
          id: 'file-1',
          kind: 'file',
          name: 'doc.md',
          mimeType: 'text/markdown',
          absolutePath: '/ws/doc.md',
        },
      ],
    })

    expect(mockedPrompt).toHaveBeenCalledTimes(1)
    expect(mockedPrompt).toHaveBeenCalledWith({
      sessionId: 'sid-send-1',
      prompt: expect.any(Array),
    })
    const blocks = promptBlocks()
    const head = joinedText(blocks)
    expect(head).toContain(MONTREE_STATIC_SKILL.slice(0, 60))
    expect(head).toContain(MONTREE_TOOL_OVERVIEW.slice(0, 60))
    expect(blocks).toContainEqual({ type: 'text', text: '你好' })
    const textIdx = blocks.findIndex(
      (b) => b.type === 'text' && (b as { text?: string }).text === '你好',
    )
    const imageIdx = blocks.findIndex((b) => b.type === 'image')
    const linkIdx = blocks.findIndex((b) => b.type === 'resource_link')
    // 正文在前、附件在后（与 buildAcpPromptBlocks 组装顺序一致）
    expect(textIdx).toBeGreaterThanOrEqual(0)
    expect(imageIdx).toBeGreaterThan(textIdx)
    expect(linkIdx).toBeGreaterThan(textIdx)
    expect(
      blocks.some(
        (b) =>
          b.type === 'resource_link' &&
          (b as { uri?: string }).uri === 'file:///ws/doc.md',
      ),
    ).toBe(true)
    // 传输层不写时间线：调用方经 store ingest 完成
    expect(messageCount(threadId)).toBe(0)
  })

  it('同 session 第二轮不再带 bootstrap 首轮 Skill，但保留每轮工具概览', async () => {
    const threadId = seedThread()
    useAcpUiStore.getState().setSession('sid-send-2', [])
    const transport = createChatTransportPort()

    await transport.sendText(threadId, '第一轮')
    await transport.sendText(threadId, '第二轮')

    expect(mockedPrompt).toHaveBeenCalledTimes(2)
    const second = mockedPrompt.mock.calls[1]?.[0]?.prompt ?? []
    const text = joinedText(second)
    expect(text).not.toContain(MONTREE_STATIC_SKILL.slice(0, 60))
    expect(text).toContain(MONTREE_TOOL_OVERVIEW.slice(0, 60))
  })

  it('优先用线程归属 session，无归属时回退 live session', async () => {
    const threadId = seedThread()
    useAcpUiStore.getState().setSession('sid-bound', [])
    useAcpUiStore.setState({ sessionId: 'sid-live' })
    const transport = createChatTransportPort()

    await transport.sendText(threadId, '归属优先')
    expect(mockedPrompt).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionId: 'sid-bound' }),
    )

    useAcpUiStore.setState((s) => ({
      threads: s.threads.map((t) =>
        t.id === threadId ? { ...t, agentSessionIds: {} } : t,
      ),
    }))
    await transport.sendText(threadId, '回退 live')
    expect(mockedPrompt).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionId: 'sid-live' }),
    )
  })

  it('失败时 reject + 上报错误，不写时间线不弹传输层 toast', async () => {
    const threadId = seedThread()
    useAcpUiStore.getState().setSession('sid-send-3', [])
    mockedPrompt.mockResolvedValueOnce(
      err({ code: 'ACP_TIMEOUT', message: '请求超时: session/prompt' }),
    )
    const transport = createChatTransportPort()

    await expect(transport.sendText(threadId, '会失败')).rejects.toThrow(
      '请求超时: session/prompt',
    )
    expect(mockedToastError).toHaveBeenCalledWith('操作失败', {
      description: '请求超时: session/prompt',
    })
    expect(messageCount(threadId)).toBe(0)
  })

  it('无可用 session 时直接 reject（P0 无连接驱动，不静默吞）', async () => {
    const threadId = seedThread()
    const transport = createChatTransportPort()

    await expect(transport.sendText(threadId, '发不出去')).rejects.toThrow('未连接')
    expect(mockedPrompt).not.toHaveBeenCalled()
  })

  it('空正文无附件时 reject，不调 prompt', async () => {
    const threadId = seedThread()
    useAcpUiStore.getState().setSession('sid-send-4', [])
    const transport = createChatTransportPort()

    await expect(transport.sendText(threadId, '   ')).rejects.toThrow('发送内容为空')
    expect(mockedPrompt).not.toHaveBeenCalled()
  })
})

describe('chat-transport-port cancel', () => {
  it('成功时调 acpApi.cancel，不碰 store 收尾（pending/prompting/时间线原样）', async () => {
    const threadId = seedThread()
    useAcpUiStore.getState().setSession('sid-cancel-1', [])
    useAcpUiStore.getState().setPendingPermission({
      requestId: 9,
      sessionId: 'sid-cancel-1',
      summary: '读文件',
      options: [{ optionId: 'allow', name: '允许', kind: 'allow_once' }],
    })
    const transport = createChatTransportPort()

    await transport.cancel(threadId)

    expect(mockedCancel).toHaveBeenCalledTimes(1)
    expect(mockedCancel).toHaveBeenCalledWith({ sessionId: 'sid-cancel-1' })
    expect(useAcpUiStore.getState().pendingPermission?.requestId).toBe(9)
    expect(useAcpUiStore.getState().prompting).toBe(false)
    expect(messageCount(threadId)).toBe(0)
  })

  it('无可用 session 时静默 resolve（同宿主 cancel 语义）', async () => {
    const threadId = seedThread()
    const transport = createChatTransportPort()

    await expect(transport.cancel(threadId)).resolves.toBeUndefined()
    expect(mockedCancel).not.toHaveBeenCalled()
  })

  it('失败时 reject + 上报', async () => {
    const threadId = seedThread()
    useAcpUiStore.getState().setSession('sid-cancel-2', [])
    mockedCancel.mockResolvedValueOnce(
      err({ code: 'ACP_PROTOCOL_ERROR', message: '取消失败' }),
    )
    const transport = createChatTransportPort()

    await expect(transport.cancel(threadId)).rejects.toThrow('取消失败')
    expect(mockedToastError).toHaveBeenCalledWith('操作失败', {
      description: '取消失败',
    })
  })
})

describe('chat-transport-port respondPermission', () => {
  function seedPending() {
    useAcpUiStore.getState().setPendingPermission({
      requestId: 7,
      sessionId: 'sid-perm-1',
      summary: '运行命令',
      options: [
        { optionId: 'allow-once', name: '允许一次', kind: 'allow_once' },
        { optionId: 'reject-once', name: '拒绝', kind: 'reject_once' },
      ],
    })
  }

  it('选中选项：透传 selected outcome（与 permission-respond 一致）', async () => {
    seedThread()
    seedPending()
    const transport = createChatTransportPort()

    await transport.respondPermission(7, 'allow-once')

    expect(mockedRespondPermission).toHaveBeenCalledTimes(1)
    expect(mockedRespondPermission).toHaveBeenCalledWith({
      requestId: 7,
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    })
    expect(useAcpUiStore.getState().pendingPermission).toBeNull()
  })

  it('optionId 为 null：透传 cancelled outcome', async () => {
    seedThread()
    seedPending()
    const transport = createChatTransportPort()

    await transport.respondPermission(7, null)

    expect(mockedRespondPermission).toHaveBeenCalledWith({
      requestId: 7,
      outcome: { outcome: 'cancelled' },
    })
  })

  it('requestId 不一致：no-op，不发送', async () => {
    seedThread()
    seedPending()
    const transport = createChatTransportPort()

    await expect(
      transport.respondPermission(999, 'allow-once'),
    ).resolves.toBeUndefined()
    expect(mockedRespondPermission).not.toHaveBeenCalled()
    expect(useAcpUiStore.getState().pendingPermission?.requestId).toBe(7)
  })
})

describe('chat-transport-port setModelOption (P3 追加)', () => {
  function mockedSetConfigOption(): ReturnType<typeof vi.fn> {
    const api = acpApi as unknown as Record<string, unknown>
    if (typeof api.setConfigOption !== 'function') {
      api.setConfigOption = vi.fn(async () => ok({ configOptions: [] }))
    }
    return api.setConfigOption as ReturnType<typeof vi.fn>
  }

  it('成功：调 setConfigOption + 记住偏好 + 同步 options，返回 true，不写时间线不弹 toast', async () => {
    const threadId = seedThread()
    useAcpUiStore.getState().setSession('sid-model-ok', [])
    const m = mockedSetConfigOption()
    m.mockResolvedValueOnce(
      ok({ configOptions: [{ configId: 'model-p3-ok', currentValue: 'm-new' }] }),
    )
    const transport = createChatTransportPort()

    await expect(transport.setModelOption?.('model-p3-ok', 'm-new')).resolves.toBe(true)

    expect(m).toHaveBeenCalledTimes(1)
    expect(m).toHaveBeenCalledWith({
      sessionId: 'sid-model-ok',
      configId: 'model-p3-ok',
      value: 'm-new',
    })
    expect(useAcpUiStore.getState().preferredConfigByRuntime[RUNTIME]?.['model-p3-ok']).toBe(
      'm-new',
    )
    expect(useAcpUiStore.getState().configOptions).toEqual([
      { configId: 'model-p3-ok', currentValue: 'm-new' },
    ])
    expect(messageCount(threadId)).toBe(0)
    expect(mockedToastError).not.toHaveBeenCalled()
  })

  it('失败：返回 false，不记偏好不同步，不写时间线不弹传输层 toast', async () => {
    const threadId = seedThread()
    useAcpUiStore.getState().setSession('sid-model-fail', [])
    const m = mockedSetConfigOption()
    m.mockResolvedValueOnce(
      err({ code: 'ACP_PROTOCOL_ERROR', message: '下发失败' }),
    )
    const transport = createChatTransportPort()

    await expect(transport.setModelOption?.('model-p3-fail', 'm-x')).resolves.toBe(false)

    expect(m).toHaveBeenCalledTimes(1)
    expect(useAcpUiStore.getState().preferredConfigByRuntime[RUNTIME]?.['model-p3-fail']).toBeUndefined()
    expect(useAcpUiStore.getState().configOptions).toEqual([])
    expect(messageCount(threadId)).toBe(0)
    expect(mockedToastError).not.toHaveBeenCalled()
  })

  it('无可用 session：返回 false，不调用 setConfigOption', async () => {
    seedThread()
    const m = mockedSetConfigOption()
    m.mockClear()
    const transport = createChatTransportPort()

    await expect(transport.setModelOption?.('model-p3-none', true)).resolves.toBe(false)

    expect(m).not.toHaveBeenCalled()
    expect(mockedToastError).not.toHaveBeenCalled()
  })
})
