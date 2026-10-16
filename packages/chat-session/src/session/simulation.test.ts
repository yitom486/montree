// @vitest-environment happy-dom
/**
 * S3 深模拟套件：模拟 acp-client 全事件脚本，端到端验证包内承接能力。
 *
 * 链路：ACP 原始载荷 → `mapSessionUpdate/mapPermissionRequest/mapConnectionStatus`
 * → store ingest → `ChatPanel` 渲染 → 审批回调（transport mock 录调用）。
 * 只从 `@montree/chat-session` barrel 进值、`@montree/chat-core` 进类型，
 * 不碰产品代码、不直连 acp-client/contracts 深路径。
 */
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ChatPanel,
  createChatSessionStore,
  mapConnectionStatus,
  mapPermissionRequest,
  mapSessionUpdate,
  type ChatSessionStore,
  type ChatStoragePort,
  type ChatTransportPort,
} from '@montree/chat-session'
import type { ChatMessage } from '@montree/chat-core'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// 与 chat-panel.test.ts 同款：happy-dom 无布局只给 observer；mermaid 走确定性桩。
vi.stubGlobal('IntersectionObserver', class {
  constructor(private callback: IntersectionObserverCallback) {}
  observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver) }
  disconnect() {}
  unobserve() {}
  takeRecords() { return [] }
})
vi.mock('@streamdown/mermaid', () => ({ createMermaidPlugin: () => ({
  name: 'mermaid', type: 'diagram', language: 'mermaid',
  getMermaid: () => ({ initialize() {}, render: async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>A to B</text></svg>' }) }),
}) }))

function harness(opts?: { transport?: ChatTransportPort; storage?: ChatStoragePort }) {
  let n = 0
  let t = 1000
  return {
    createId: (role: string) => `${role}-${n++}`,
    now: () => t++,
    ...(opts?.transport ? { transport: opts.transport } : {}),
    ...(opts?.storage ? { storage: opts.storage } : {}),
  }
}

function mockTransport() {
  return {
    sendText: vi.fn(async (_threadId: string, _text: string) => {}),
    cancel: vi.fn(async (_threadId: string) => {}),
    respondPermission: vi.fn(async (_requestId: number, _optionId: string | null) => {}),
  }
}

function mockStorage(): ChatStoragePort & { saved: unknown[] } {
  let data: Parameters<ChatStoragePort['save']>[0] | null = null
  const saved: unknown[] = []
  return {
    saved,
    load: () => data,
    save: (snapshot) => {
      data = snapshot
      saved.push(snapshot)
    },
  }
}

let mounted: Array<{ container: HTMLDivElement; root: Root }>

beforeEach(() => {
  mounted = []
})

afterEach(() => {
  for (const m of mounted.splice(0)) {
    act(() => {
      m.root.unmount()
    })
    m.container.remove()
  }
})

function mountPanel(props: Parameters<typeof ChatPanel>[0]): HTMLDivElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ container, root })
  act(() => {
    root.render(h(ChatPanel, props))
  })
  return container
}

const RUNTIMES = [{ id: 'codex-acp', name: 'Codex' }]

/**
 * ACP sessionUpdate 原始载荷 → map → store ingest（对齐宿主接线顺序）。
 * user 角色 chunk 包内无专有 ingest（store 只有 agent/thought 流式口），
 * 按 user-append 落子绕行（缺小 API 不补产品代码，见 S1-步骤1 直接 appendUser）。
 */
function ingestUpdate(store: ChatSessionStore, raw: unknown, threadId?: string): number {
  const events = mapSessionUpdate(raw)
  for (const ev of events) {
    switch (ev.type) {
      case 'text-chunk':
        if (ev.role === 'thought') store.ingestThoughtChunk(ev.text, threadId)
        else if (ev.role === 'agent') store.ingestTextChunk(ev.text, threadId)
        else store.appendUser(ev.text, { threadId })
        break
      case 'tool-call':
        store.ingestToolCall(ev.call, threadId)
        break
      case 'tool-chunk':
        store.ingestToolChunk(ev.toolCallId, ev.text, threadId)
        break
      case 'plan':
        store.ingestPlan(ev.entries, ev.active, threadId)
        break
      case 'finish-turn':
        store.finishTurn(threadId)
        break
      default:
        break
    }
  }
  return events.length
}

function activeMsgs(store: ChatSessionStore): ChatMessage[] {
  const s = store.getState()
  const t = s.threads.find((x) => x.id === s.activeThreadId)
  if (!t) throw new Error('S?: active thread 缺失')
  return t.feed.messages
}

function threadMsgs(store: ChatSessionStore, id: string): ChatMessage[] {
  const t = store.getState().threads.find((x) => x.id === id)
  if (!t) throw new Error(`S?: thread 缺失: ${id}`)
  return t.feed.messages
}

function msgByTool(msgs: ChatMessage[], toolCallId: string): ChatMessage {
  const m = msgs.find((x) => x.toolCallId === toolCallId)
  if (!m) throw new Error(`S?: 工具消息缺失: ${toolCallId}`)
  return m
}

/** 合法 component-ui present 结果 JSON（字段形状对照 contracts component-ui.test.ts 的 base）。 */
function componentUiJson(): string {
  return JSON.stringify({
    schemaVersion: 1,
    kind: 'component-ui',
    id: 'present-component-ui-sim01',
    title: '两章对比选择',
    documentFingerprint: '/books/a.epub',
    documentLabel: 'a.epub',
    chapters: [
      { key: 'c1', label: '第一章', flatIndex: 0 },
      { key: 'c2', label: '第二章', flatIndex: 1 },
    ],
    ui: {
      root: {
        component: 'Column',
        children: [
          { component: 'Text', props: { text: '请选择对比维度', variant: 'title' } },
          {
            component: 'Select',
            props: {
              id: 'dim',
              label: '对比维度',
              options: [
                { value: 'method', label: '论证方法' },
                { value: 'evidence', label: '证据运用' },
              ],
            },
          },
          { component: 'Button', props: { label: '继续分析', action: 'submit-selection' } },
        ],
      },
    },
  })
}

const agentChunk = (text: string) => ({ sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text }] })

describe('S3-1 完整会话剧本（单线程全链路）', () => {
  it('user→reply→chunks→thought→tool→plan→present→审批通过→finish', () => {
    const transport = mockTransport()
    const store = createChatSessionStore({ ...harness(), transport })

    // S1-步骤1 userAppend：首条 user 文本定标题
    store.appendUser('查一下两章差异')
    expect(activeMsgs(store)[0]!.text, 'S1-步骤1 user 正文').toBe('查一下两章差异')
    expect(store.getState().threads[0]!.title, 'S1-步骤1 标题由首条 user 定').toBe('查一下两章差异')

    // S1-步骤2 beginReply：空 agent 占位 streaming
    store.beginReply()
    expect(activeMsgs(store)[1]!.streaming, 'S1-步骤2 reply 占位 streaming').toBe(true)

    // S1-步骤3 agent 文本 chunks 合并
    expect(ingestUpdate(store, agentChunk('正在查阅')), 'S1-步骤3 chunk1 事件数').toBe(1)
    expect(ingestUpdate(store, agentChunk('文档')), 'S1-步骤3 chunk2 事件数').toBe(1)
    expect(activeMsgs(store)[1]!.text, 'S1-步骤3 agent 合并正文').toBe('正在查阅文档')

    // S1-步骤4 空文本 chunk 丢弃（map → []，不进 store）
    const countBeforeEmpty = activeMsgs(store).length
    expect(ingestUpdate(store, agentChunk('')), 'S1-步骤4 空 chunk 事件数').toBe(0)
    expect(activeMsgs(store).length, 'S1-步骤4 空 chunk 不增消息').toBe(countBeforeEmpty)
    expect(activeMsgs(store)[1]!.text, 'S1-步骤4 空 chunk 不改正文').toBe('正在查阅文档')

    // S1-步骤5 thought chunk 独立气泡
    expect(ingestUpdate(store, { sessionUpdate: 'agent_thought_chunk', content: '先想一下范围' }), 'S1-步骤5 thought 事件数').toBe(1)
    expect(activeMsgs(store).map((m) => m.role), 'S1-步骤5 user/agent/thought 顺序').toEqual(['user', 'agent', 'thought'])
    expect(activeMsgs(store)[2]!.text, 'S1-步骤5 thought 正文').toBe('先想一下范围')

    // S1-步骤6 tool_call（tool_call_id 下划线拼写）
    expect(
      ingestUpdate(store, { sessionUpdate: 'tool_call', tool_call_id: 't-exec-1', title: '读取文件', kind: 'read', status: 'in_progress' }),
      'S1-步骤6 tool_call 事件数',
    ).toBe(1)
    expect(msgByTool(activeMsgs(store), 't-exec-1').toolTitle, 'S1-步骤6 工具标题').toBe('读取文件')

    // S1-步骤7 tool 内容 chunks 合并 + 空 content 丢弃
    expect(ingestUpdate(store, { sessionUpdate: 'tool_call_content_chunk', toolCallId: 't-exec-1', content: { type: 'text', text: '第一章正文…' } }), 'S1-步骤7 tool chunk1').toBe(1)
    expect(ingestUpdate(store, { sessionUpdate: 'tool_call_content_chunk', toolCallId: 't-exec-1', content: { type: 'text', text: '第二章正文…' } }), 'S1-步骤7 tool chunk2').toBe(1)
    expect(msgByTool(activeMsgs(store), 't-exec-1').toolContentText, 'S1-步骤7 tool 内容合并').toBe('第一章正文…第二章正文…')
    expect(ingestUpdate(store, { sessionUpdate: 'tool_call_content_chunk', toolCallId: 't-exec-1', content: { type: 'text', text: '' } }), 'S1-步骤7 空 tool chunk 丢弃').toBe(0)
    expect(msgByTool(activeMsgs(store), 't-exec-1').toolContentText, 'S1-步骤7 空 chunk 不改工具内容').toBe('第一章正文…第二章正文…')

    // S1-步骤8 tool_call_update completed（无 content 时沿用已合并内容）
    expect(ingestUpdate(store, { sessionUpdate: 'tool_call_update', toolCallId: 't-exec-1', status: 'completed' }), 'S1-步骤8 完成事件数').toBe(1)
    expect(msgByTool(activeMsgs(store), 't-exec-1').toolStatus, 'S1-步骤8 工具 completed').toBe('completed')
    expect(msgByTool(activeMsgs(store), 't-exec-1').streaming, 'S1-步骤8 完成即不流式').toBe(false)
    expect(msgByTool(activeMsgs(store), 't-exec-1').toolContentText, 'S1-步骤8 完成保留合并内容').toBe('第一章正文…第二章正文…')

    // S1-步骤9 plan（entries + active）
    expect(
      ingestUpdate(store, { sessionUpdate: 'plan', entries: [{ content: '读两章', status: 'completed' }, { content: '写对比', status: 'in_progress' }] }),
      'S1-步骤9 plan 事件数',
    ).toBe(1)
    const planMsg = activeMsgs(store).find((m) => m.role === 'plan')!
    expect(planMsg.planEntries, 'S1-步骤9 plan 条目数').toHaveLength(2)
    expect(planMsg.streaming, 'S1-步骤9 plan 进行中 streaming').toBe(true)

    // S1-步骤10 component-ui present 工具结果（真实挂载链路：completed + JSON 内容 → enrich 挂 presentResult）
    expect(
      ingestUpdate(store, {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'present-1',
        title: 'montree_present',
        kind: 'other',
        status: 'completed',
        content: [{ type: 'text', text: componentUiJson() }],
      }),
      'S1-步骤10 present 事件数',
    ).toBe(1)
    const presentMsg = msgByTool(activeMsgs(store), 'present-1')
    expect(presentMsg.presentResult?.kind, 'S1-步骤10 presentResult 挂载 kind').toBe('component-ui')
    expect(presentMsg.presentResult?.id, 'S1-步骤10 presentResult 稳定 id').toBe('present-component-ui-sim01')

    // S1-步骤11 permission request（含 toolCall 内嵌）
    const { permission } = mapPermissionRequest({
      requestId: 41,
      sessionId: 'sess-1',
      summary: '允许删除文件？',
      toolCall: { tool_call_id: 't-perm-1', title: '删除文件', kind: 'delete', status: 'pending' },
      options: [
        { optionId: 'allow', name: '允许', kind: 'allow_once' },
        { optionId: 'reject', name: '拒绝', kind: 'reject_once' },
      ],
    })
    store.requestPermission(permission)
    expect(store.getState().pendingPermission?.requestId, 'S1-步骤11 pending requestId').toBe(41)
    expect(store.getState().pendingPermission?.toolCallId, 'S1-步骤11 pending toolCallId 三兼容').toBe('t-perm-1')
    expect(msgByTool(activeMsgs(store), 't-perm-1').toolTitle, 'S1-步骤11 审批工具落时间线').toBe('删除文件')

    // S1-步骤12 渲染：user/工具/present 结果入口/审批卡同步可见
    const container = mountPanel({ store, runtimes: RUNTIMES })
    expect(container.textContent, 'S1-步骤12 user 气泡渲染').toContain('查一下两章差异')
    expect(container.textContent, 'S1-步骤12 执行工具卡渲染').toContain('读取文件')
    expect(container.textContent, 'S1-步骤12 present 工具卡渲染（可读标题）').toContain('展示呈现')
    expect(container.querySelector('[data-acp-probe="result"]'), 'S1-步骤12 present 结果入口渲染').not.toBeNull()
    const card = container.querySelector('[data-testid="agent-permission-card"]')
    expect(card, 'S1-步骤12 审批卡渲染').not.toBeNull()
    expect(card!.textContent, 'S1-步骤12 审批摘要渲染').toContain('允许删除文件？')

    // S1-步骤13 点击审批通过 → transport.respondPermission + 本地 pending 清
    act(() => {
      ;(card!.querySelector('button') as HTMLButtonElement).click()
    })
    expect(transport.respondPermission, 'S1-步骤13 transport 录到审批响应').toHaveBeenCalledTimes(1)
    expect(transport.respondPermission, 'S1-步骤13 审批参数对 (requestId, optionId)').toHaveBeenCalledWith(41, 'allow')
    expect(store.getState().pendingPermission, 'S1-步骤13 点击后 pending 已清').toBeNull()
    expect(container.querySelector('[data-testid="agent-permission-card"]'), 'S1-步骤13 点击后审批卡撤下').toBeNull()

    // S1-步骤14 finish-turn（定居收尾）：冻结 streaming 全 false、pending 已清
    expect(ingestUpdate(store, { sessionUpdate: 'montree_settle_complete' }), 'S1-步骤14 收尾事件数').toBe(1)
    const final = activeMsgs(store)
    expect(store.getState().threads[0]!.feed.turnSettled, 'S1-步骤14 turnSettled').toBe(true)
    expect(final.every((m) => !m.streaming), 'S1-步骤14 冻结 streaming 全 false').toBe(true)
    expect(store.getState().pendingPermission, 'S1-步骤14 终态 pending 已清').toBeNull()
    expect(final.map((m) => m.role), 'S1-步骤14 终态 timeline 结构').toEqual(['user', 'agent', 'thought', 'tool', 'plan', 'tool', 'tool'])
    expect(msgByTool(final, 'present-1').presentResult?.kind, 'S1-步骤14 收尾后 present 仍挂载').toBe('component-ui')
  })
})

describe('S3-2 脏事件剧本（无抛错、无幽灵、状态单调）', () => {
  it('未知/空/缺 id/配置事件丢弃；plan 清卡；反复 patch 稳定；迟到 chunk；断连清 pending', () => {
    const store = createChatSessionStore(harness())
    store.appendUser('脏事件基线')
    store.beginReply()
    const baseline = activeMsgs(store).length

    // S2-步骤1 未知 kind（无文本）→ []，计数不动
    expect(ingestUpdate(store, { sessionUpdate: 'weird_future_kind_xyz' }), 'S2-步骤1 未知 kind 事件数').toBe(0)
    expect(activeMsgs(store).length, 'S2-步骤1 未知 kind 不增消息').toBe(baseline)

    // S2-步骤2 空 content → []；无 toolCallId 的 tool 更新 → []
    expect(ingestUpdate(store, { sessionUpdate: 'agent_message_chunk', content: [] }), 'S2-步骤2 空 content 事件数').toBe(0)
    expect(ingestUpdate(store, { sessionUpdate: 'tool_call_update', status: 'completed' }), 'S2-步骤2 缺 id 更新事件数').toBe(0)
    expect(ingestUpdate(store, { sessionUpdate: 'tool_call_content_chunk', content: { type: 'text', text: 'x' } }), 'S2-步骤2 缺 id chunk 事件数').toBe(0)
    expect(activeMsgs(store).length, 'S2-步骤2 空/缺 id 不增消息').toBe(baseline)

    // S2-步骤3 config_option_update（单复数）→ []，模型配置走专有口不进 feed
    expect(ingestUpdate(store, { sessionUpdate: 'config_option_update' }), 'S2-步骤3 配置事件数').toBe(0)
    expect(ingestUpdate(store, { sessionUpdate: 'config_options_update' }), 'S2-步骤3 配置复数事件数').toBe(0)
    expect(activeMsgs(store).length, 'S2-步骤3 配置事件不进时间线').toBe(baseline)

    // S2-步骤4 空 plan_update 清卡：同一 plan 消息 id 不变、条目清空、不新增
    expect(ingestUpdate(store, { sessionUpdate: 'plan', entries: [{ content: '做 A', status: 'in_progress' }] }), 'S2-步骤4 plan 事件数').toBe(1)
    const planBefore = activeMsgs(store).find((m) => m.role === 'plan')!
    const planId = planBefore.id
    expect(ingestUpdate(store, { sessionUpdate: 'plan_update', entries: [] }), 'S2-步骤4 空 plan 事件数').toBe(1)
    const plans = activeMsgs(store).filter((m) => m.role === 'plan')
    expect(plans, 'S2-步骤4 空 plan 不新增卡片').toHaveLength(1)
    expect(plans[0]!.id, 'S2-步骤4 清卡 id 稳定').toBe(planId)
    expect(plans[0]!.planEntries, 'S2-步骤4 清卡条目为空').toHaveLength(0)

    // S2-步骤5 同一 toolCallId 反复 patch：id/createdAt 不变，标题取最新
    expect(ingestUpdate(store, { sessionUpdate: 'tool_call', toolCallId: 't-dirty', title: 'v1', status: 'in_progress' }), 'S2-步骤5 首 patch 事件数').toBe(1)
    const first = msgByTool(activeMsgs(store), 't-dirty')
    const firstId = first.id
    const firstCreated = first.createdAt
    expect(ingestUpdate(store, { sessionUpdate: 'tool_call_update', toolCallId: 't-dirty', title: 'v2', status: 'in_progress' }), 'S2-步骤5 次 patch 事件数').toBe(1)
    expect(ingestUpdate(store, { sessionUpdate: 'tool_call_update', toolCallId: 't-dirty', title: 'v3', status: 'in_progress' }), 'S2-步骤5 三 patch 事件数').toBe(1)
    const patched = msgByTool(activeMsgs(store), 't-dirty')
    expect(patched.id, 'S2-步骤5 反复 patch id 不变').toBe(firstId)
    expect(patched.createdAt, 'S2-步骤5 反复 patch createdAt 不变').toBe(firstCreated)
    expect(patched.toolTitle, 'S2-步骤5 标题取最新').toBe('v3')
    expect(activeMsgs(store).filter((m) => m.toolCallId === 't-dirty'), 'S2-步骤5 同 id 不分裂').toHaveLength(1)

    // S2-步骤6 finish 后迟到 chunk：settled 新气泡，正文合入但不再点亮 streaming
    store.finishTurn()
    expect(ingestUpdate(store, agentChunk('迟到内容')), 'S2-步骤6 迟到 chunk 事件数').toBe(1)
    const late = activeMsgs(store)
    expect(late[late.length - 1]!.text, 'S2-步骤6 迟到内容落新气泡').toBe('迟到内容')
    expect(late[late.length - 1]!.streaming, 'S2-步骤6 迟到气泡不点亮 streaming').toBe(false)
    expect(late.every((m) => !m.streaming), 'S2-步骤6 迟到后仍全冻结').toBe(true)

    // S2-步骤7 disconnected 清 pending（经 mapConnectionStatus 归一化）
    const { permission } = mapPermissionRequest({ requestId: 77, summary: '脏审批', options: [] })
    store.requestPermission(permission)
    expect(store.getState().pendingPermission?.requestId, 'S2-步骤7 pending 先立住').toBe(77)
    store.setConnectionStatus(mapConnectionStatus('disconnected'))
    expect(store.getState().pendingPermission, 'S2-步骤7 断连清 pending').toBeNull()

    // S2-步骤8 无幽灵消息：非 plan 消息皆有正文；工具消息皆有 id
    const ghosts = activeMsgs(store).filter(
      (m) => m.role !== 'plan' && !m.text.trim(),
    )
    expect(ghosts, 'S2-步骤8 无空正文幽灵消息').toHaveLength(0)
    const idlessTools = activeMsgs(store).filter((m) => m.role === 'tool' && !m.toolCallId)
    expect(idlessTools, 'S2-步骤8 无无 id 工具消息').toHaveLength(0)
  })
})

describe('S3-3 多线程剧本（交错 ingest 隔离 + 切线程轻冻）', () => {
  it('threadId 路由隔离；切线程后旧线程轻冻（无 turnEnded）', () => {
    const store = createChatSessionStore(harness())
    const threadA = store.getState().activeThreadId!
    store.appendUser('A用户', { threadId: threadA })
    store.beginReply(threadA)
    expect(ingestUpdate(store, agentChunk('A正文'), threadA), 'S3-步骤1 A chunk 事件数').toBe(1)

    // S3-步骤2 新线程 B（旧 A 被轻冻），交错写入
    const threadB = store.newThread()
    store.appendUser('B用户', { threadId: threadB })
    store.beginReply(threadB)
    expect(ingestUpdate(store, agentChunk('B正文'), threadB), 'S3-步骤2 B chunk 事件数').toBe(1)
    expect(ingestUpdate(store, { sessionUpdate: 'tool_call', toolCallId: 't-A', title: 'A工具', status: 'in_progress' }, threadA), 'S3-步骤2 A 工具事件数').toBe(1)
    expect(ingestUpdate(store, { sessionUpdate: 'tool_call', toolCallId: 't-B', title: 'B工具', status: 'in_progress' }, threadB), 'S3-步骤2 B 工具事件数').toBe(1)

    // S3-步骤3 隔离：A 事件不污染 B
    const textsA = threadMsgs(store, threadA).map((m) => m.text).join('\n')
    const textsB = threadMsgs(store, threadB).map((m) => m.text).join('\n')
    expect(textsA, 'S3-步骤3 A 含自家正文').toContain('A正文')
    expect(textsA, 'S3-步骤3 A 不含 B 正文').not.toContain('B正文')
    expect(textsB, 'S3-步骤3 B 含自家正文').toContain('B正文')
    expect(textsB, 'S3-步骤3 B 不含 A 正文').not.toContain('A正文')
    expect(threadMsgs(store, threadA).some((m) => m.toolCallId === 't-A'), 'S3-步骤3 A 有自家工具').toBe(true)
    expect(threadMsgs(store, threadA).some((m) => m.toolCallId === 't-B'), 'S3-步骤3 A 无 B 工具').toBe(false)
    expect(threadMsgs(store, threadB).some((m) => m.toolCallId === 't-B'), 'S3-步骤3 B 有自家工具').toBe(true)
    expect(threadMsgs(store, threadB).some((m) => m.toolCallId === 't-A'), 'S3-步骤3 B 无 A 工具').toBe(false)

    // S3-步骤4 切回 A：旧线程 B 轻冻——streaming 全 false、无 turnEnded、不改 turnSettled
    store.switchThread(threadA)
    expect(store.getState().activeThreadId, 'S3-步骤4 切线程生效').toBe(threadA)
    const frozenB = threadMsgs(store, threadB)
    expect(frozenB.every((m) => !m.streaming), 'S3-步骤4 旧线程 streaming 全收').toBe(true)
    expect(frozenB.some((m) => m.turnEnded === true), 'S3-步骤4 轻冻不打 turnEnded').toBe(false)
    expect(store.getState().threads.find((t) => t.id === threadB)!.feed.turnSettled, 'S3-步骤4 轻冻不收尾回合').toBe(false)
  })
})

describe('S3-4 模型配置剧本（写配置 + 落盘 round-trip）', () => {
  it('selectRuntime/selectModel/setThinking 写 modelConfig；storage save 后新 store load 恢复', () => {
    const storage = mockStorage()
    const store = createChatSessionStore({ ...harness({ storage }), storage })

    // S4-步骤1 三口只写 modelConfig，不碰线程
    store.selectRuntime('codex-acp')
    store.selectModel('grok-4.7')
    store.setThinking('high')
    expect(store.getState().modelConfig, 'S4-步骤1 modelConfig 落子').toEqual({
      runtimeId: 'codex-acp',
      modelId: 'grok-4.7',
      thinkingLevel: 'high',
    })
    expect(store.getState().threads, 'S4-步骤1 配置不碰线程').toHaveLength(1)

    // S4-步骤2 落盘后新 store 恢复（pending 故意不恢复）
    store.appendUser('记住我')
    const { permission } = mapPermissionRequest({ requestId: 3, summary: '不落盘审批', options: [] })
    store.requestPermission(permission)
    expect(storage.saved.length, 'S4-步骤2 有落盘记录').toBeGreaterThan(0)

    const revived = createChatSessionStore({ ...harness({ storage }), storage })
    const rs = revived.getState()
    expect(rs.threads.find((t) => t.id === rs.activeThreadId)!.feed.messages[0]!.text, 'S4-步骤2 线程正文恢复').toBe('记住我')
    expect(rs.activeThreadId, 'S4-步骤2 active 恢复').toBe(store.getState().activeThreadId)
    expect(rs.modelConfig, 'S4-步骤2 modelConfig 恢复').toEqual({
      runtimeId: 'codex-acp',
      modelId: 'grok-4.7',
      thinkingLevel: 'high',
    })
    expect(rs.pendingPermission, 'S4-步骤2 pending 不恢复').toBeNull()
  })
})
