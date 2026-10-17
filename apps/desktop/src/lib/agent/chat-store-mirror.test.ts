import { beforeEach, describe, expect, it } from 'vitest'
import { MONTREE_SETTLE_COMPLETE_KIND } from '@yitom/contracts'
import type { ChatMessage } from '@yitom/chat-core'
import {
  createChatSessionStore,
  type ChatSessionStore,
} from '@yitom/chat-session'
import {
  parsePermissionOptions,
  permissionSummaryFromToolCall,
  toolCallIdFromPermission,
} from '@/lib/agent/acp-permission'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import {
  mirrorConnectionStatusToPackageStore,
  mirrorPermissionRequestToPackageStore,
  mirrorSessionUpdateToPackageStore,
} from './chat-store-mirror'

/**
 * P4a 双写对账：同一事件序列分别走宿主 `applySessionUpdate` 与镜像函数，
 * 对比双方线程 messages 在共享字段上 deep-equal（id/时间戳忽略）。
 * 一致即证明双写等价；任一回归（映射漂移/归约分叉）都会在此变红。
 */

interface MessageShape {
  role: ChatMessage['role']
  text: string
  streaming: boolean
  toolCallId: string | null
  toolStatus: string | null
  planEntries: ChatMessage['planEntries'] | null
  turnEnded: boolean
}

function shapeOf(message: ChatMessage): MessageShape {
  return {
    role: message.role,
    text: message.text,
    streaming: message.streaming ?? false,
    toolCallId: message.toolCallId ?? null,
    toolStatus: message.toolStatus != null ? String(message.toolStatus) : null,
    planEntries: message.planEntries ?? null,
    turnEnded: message.turnEnded ?? false,
  }
}

function hostMessageShapes(): MessageShape[] {
  const s = useAcpUiStore.getState()
  const thread = s.threads.find((t) => t.id === s.activeThreadId)
  return (thread?.messages ?? []).map(shapeOf)
}

function packageMessageShapes(): MessageShape[] {
  const s = pkg.getState()
  const thread = s.threads.find((t) => t.id === s.activeThreadId)
  return (thread?.feed.messages ?? []).map(shapeOf)
}

interface PendingShape {
  requestId: number
  sessionId?: string
  toolCallId?: string
  summary: string
  options: Array<{ optionId: string; name: string; kind: string }>
}

function pendingShape(
  pending: {
    requestId: number
    sessionId?: string
    toolCallId?: string
    summary: string
    options: Array<{ optionId: string; name: string; kind: string }>
  } | null,
): PendingShape | null {
  if (!pending) return null
  return {
    requestId: pending.requestId,
    sessionId: pending.sessionId,
    toolCallId: pending.toolCallId,
    summary: pending.summary,
    options: pending.options.map((o) => ({
      optionId: o.optionId,
      name: o.name,
      kind: o.kind,
    })),
  }
}

/** 覆盖 agent 文本 / tool 全周期 / plan / 噪声；permission/finish/disconnect 由用例分步驱动 */
const SESSION_SCRIPT: Record<string, unknown>[] = [
  { sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: '第一段' }] },
  { sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: '第二段' }] },
  { sessionUpdate: 'agent_thought_chunk', content: [{ type: 'text', text: '先想一下' }] },
  {
    sessionUpdate: 'tool_call',
    toolCallId: 'tool-1',
    title: '读取文件',
    kind: 'read',
    status: 'in_progress',
    content: [{ type: 'text', text: 'reading a.md' }],
  },
  {
    sessionUpdate: 'tool_call_content_chunk',
    toolCallId: 'tool-1',
    content: [{ type: 'text', text: ' +more' }],
  },
  {
    sessionUpdate: 'tool_call_update',
    toolCallId: 'tool-1',
    title: '读取文件',
    kind: 'read',
    status: 'completed',
    content: [{ type: 'text', text: '读完 a.md' }],
  },
  {
    sessionUpdate: 'plan',
    entries: [
      { content: '先读', status: 'completed' },
      { content: '后写', status: 'in_progress', priority: 'high' },
    ],
  },
  { sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: '工具跑完了' }] },
  { sessionUpdate: 'config_option_update', configId: 'model', value: 'x' },
  { sessionUpdate: 'something_new', content: [{ type: 'text', text: '未知种类回落' }] },
]

const PERMISSION_REQ = {
  requestId: 7,
  sessionId: 'sid-x',
  toolCall: { toolCallId: 'tool-1', title: '删除文件', kind: 'delete', status: 'pending' },
  options: [
    { optionId: 'allow', name: '允许', kind: 'allow' },
    { optionId: 'deny', name: '拒绝', kind: 'deny' },
  ],
  summary: '删除文件',
}

function ingestHostPermission(raw: typeof PERMISSION_REQ): void {
  const toolCall = raw.toolCall as Record<string, unknown>
  useAcpUiStore.getState().ingestPermissionRequest({
    requestId: raw.requestId,
    sessionId: raw.sessionId,
    toolCallId: toolCallIdFromPermission(toolCall),
    summary: raw.summary ?? permissionSummaryFromToolCall(toolCall, 'Agent 请求执行工具'),
    options: parsePermissionOptions(raw.options),
    toolCall,
  })
}

let pkg: ChatSessionStore

beforeEach(() => {
  const fresh = useAcpUiStore.getState().createThread()
  useAcpUiStore.setState({
    prompting: false,
    sessionId: null,
    status: 'disconnected',
    pendingPermission: null,
    pendingMarkProposalSnapshotContents: [],
  })
  const thread = useAcpUiStore.getState().threads.find((t) => t.id === fresh)
  useAcpUiStore.setState({
    threads: thread ? [thread] : useAcpUiStore.getState().threads.slice(0, 1),
    activeThreadId: fresh,
  })
  pkg = createChatSessionStore()
})

describe('chat-store-mirror 双写对账', () => {
  it('同一事件序列双写等价：agent 文本/tool 全周期/plan/permission/finish/disconnect', () => {
    for (const update of SESSION_SCRIPT) {
      useAcpUiStore.getState().applySessionUpdate(update)
      mirrorSessionUpdateToPackageStore(pkg, update)
    }
    expect(hostMessageShapes().length).toBeGreaterThan(0)
    expect(packageMessageShapes()).toEqual(hostMessageShapes())
    const roles = new Set(hostMessageShapes().map((m) => m.role))
    expect(roles.has('agent')).toBe(true)
    expect(roles.has('thought')).toBe(true)
    expect(roles.has('tool')).toBe(true)
    expect(roles.has('plan')).toBe(true)

    ingestHostPermission(PERMISSION_REQ)
    mirrorPermissionRequestToPackageStore(pkg, PERMISSION_REQ)
    expect(pkg.getState().pendingPermission).not.toBeNull()
    expect(pendingShape(pkg.getState().pendingPermission)).toEqual(
      pendingShape(useAcpUiStore.getState().pendingPermission),
    )
    expect(packageMessageShapes()).toEqual(hostMessageShapes())

    const settle = { sessionUpdate: MONTREE_SETTLE_COMPLETE_KIND }
    useAcpUiStore.getState().applySessionUpdate(settle)
    mirrorSessionUpdateToPackageStore(pkg, settle)
    expect(packageMessageShapes()).toEqual(hostMessageShapes())

    useAcpUiStore.getState().clearPendingPermission()
    mirrorConnectionStatusToPackageStore(pkg, 'disconnected')
    expect(pkg.getState().pendingPermission).toBeNull()
    expect(useAcpUiStore.getState().pendingPermission).toBeNull()
    expect(packageMessageShapes()).toEqual(hostMessageShapes())

    ingestHostPermission({ ...PERMISSION_REQ, requestId: 8 })
    mirrorPermissionRequestToPackageStore(pkg, { ...PERMISSION_REQ, requestId: 8 })
    useAcpUiStore.getState().clearPendingPermission()
    mirrorConnectionStatusToPackageStore(pkg, 'error')
    expect(pkg.getState().pendingPermission).toBeNull()
    expect(useAcpUiStore.getState().pendingPermission).toBeNull()
    expect(packageMessageShapes()).toEqual(hostMessageShapes())
  })

  it('未知线程 no-op：不写不抛', () => {
    for (const update of SESSION_SCRIPT) {
      useAcpUiStore.getState().applySessionUpdate(update)
      mirrorSessionUpdateToPackageStore(pkg, update)
    }
    const before = packageMessageShapes()
    mirrorSessionUpdateToPackageStore(
      pkg,
      { sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: '幽灵' }] },
      'no-such-thread',
    )
    expect(packageMessageShapes()).toEqual(before)
  })

  it('映射抛错永不阻断主链路', () => {
    const bomb = new Proxy({}, { get(): never { throw new Error('boom') } })
    expect(() =>
      mirrorSessionUpdateToPackageStore(pkg, bomb as Record<string, unknown>),
    ).not.toThrow()
    expect(() => mirrorPermissionRequestToPackageStore(pkg, bomb)).not.toThrow()
    expect(() => mirrorConnectionStatusToPackageStore(pkg, 12345)).not.toThrow()
    expect(packageMessageShapes()).toEqual([])
  })
})
