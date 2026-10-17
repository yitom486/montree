import { beforeEach, describe, expect, it } from 'vitest'
import { MONTREE_SETTLE_COMPLETE_KIND } from '@yitom/contracts'
import { PRESENT_SCHEMA_VERSION } from '@yitom/contracts'
import { toProposedMark } from '@yitom/annotations'
import type { ChatMessage } from '@yitom/chat-core'
import {
  createChatSessionStore,
  type ChatSessionStore,
} from '@yitom/chat-session'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { useAnnotationAgentStore } from '@/stores/annotation-agent-store'
import {
  mirrorHostThreadToPackageStore,
  mirrorSessionUpdateToPackageStore,
  mirrorThreadActionToPackageStore,
} from './chat-store-mirror'
import { MONTREE_TURN_CONTEXT_CLOSE_TAG, MONTREE_TURN_CONTEXT_OPEN_TAG } from './context/turn-context'

// C2b1 过渡守卫：本文件全部用例走 session-update 镜像桥（已切包
// `dispatchFeedEvent`，候选包 API，正式依赖 0.1.9 尚无对应方法）；
// 候选消费环境下执行，正式依赖下跳过。正式升级六包后此守卫恒真，可整体移除。
const HAS_DISPATCH_FEED_EVENT =
  typeof (
    createChatSessionStore() as unknown as { dispatchFeedEvent?: unknown }
  ).dispatchFeedEvent === 'function'

let pkg: ChatSessionStore

beforeEach(() => {
  const fresh = useAcpUiStore.getState().createThread()
  useAcpUiStore.setState({
    prompting: false,
    sessionId: null,
    status: 'disconnected',
    pendingPermission: null,
    pendingMarkProposalSnapshotContents: [],
    pendingReplayUserText: null,
    turnSettled: false,
  })
  const thread = useAcpUiStore.getState().threads.find((t) => t.id === fresh)
  useAcpUiStore.setState({
    threads: thread ? [thread] : useAcpUiStore.getState().threads.slice(0, 1),
    activeThreadId: fresh,
  })
  useAnnotationAgentStore.setState({ proposeHost: null, pendingDraft: null })
  pkg = createChatSessionStore()
})

function hostActive() {
  const s = useAcpUiStore.getState()
  return s.threads.find((t) => t.id === s.activeThreadId)!
}

/** 双写：宿主权威写入 + 镜像桥（显式包线程目标缺省走 active）。 */
function dualWrite(update: Record<string, unknown>, hostThreadId?: string): void {
  useAcpUiStore.getState().applySessionUpdate(update)
  mirrorSessionUpdateToPackageStore(
    pkg,
    update,
    undefined,
    hostThreadId ?? useAcpUiStore.getState().activeThreadId,
  )
}

function packageActive() {
  const s = pkg.getState()
  return s.threads.find((t) => t.id === s.activeThreadId)!
}

/** 镜像按 hostThreadId 落到映射包线程（provision 建线程不切 active），断言须按映射取。 */
function packageThreadFor(hostId: string) {
  const thread = pkg.getState().threads.find((t) => t.hostThreadId === hostId)
  if (!thread) throw new Error(`missing package thread for ${hostId}`)
  return thread
}

describe.runIf(HAS_DISPATCH_FEED_EVENT)('chat-store-mirror dispatch 统一桥 parity', () => {
  it('单次镜像恰好一次通知；空映射与未知无文本零通知', () => {
    let notified = 0
    pkg.subscribe(() => {
      notified += 1
    })
    mirrorSessionUpdateToPackageStore(pkg, {
      sessionUpdate: 'agent_message_chunk',
      content: [{ type: 'text', text: 'hi' }],
    })
    expect(notified).toBe(1)
    mirrorSessionUpdateToPackageStore(pkg, { sessionUpdate: 'config_option_update', configId: 'm', value: 'x' })
    mirrorSessionUpdateToPackageStore(pkg, { sessionUpdate: 'something_new' })
    expect(notified).toBe(1)
    expect(packageActive().feed.messages.map((m) => m.text)).toEqual(['hi'])
  })

  it('显式包线程 id 定向隔离：只动目标，active 不动', () => {
    const secondHost = 'host-second'
    mirrorSessionUpdateToPackageStore(
      pkg,
      { sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: '后台文' }] },
      undefined,
      secondHost,
    )
    const activeId = pkg.getState().activeThreadId!
    const target = pkg.getState().threads.find((t) => t.hostThreadId === secondHost)!
    expect(target.feed.messages.map((m) => m.text)).toEqual(['后台文'])
    expect(pkg.getState().activeThreadId).toBe(activeId)
    expect(pkg.getState().threads.find((t) => t.id === activeId)!.feed.messages).toEqual([])
  })

  it('plan-remove 双写删卡；settle 只冻结不置 turnSettled', () => {
    dualWrite({
      sessionUpdate: 'agent_message_chunk',
      content: [{ type: 'text', text: '答' }],
    })
    dualWrite({
      sessionUpdate: 'plan',
      entries: [{ content: '做', status: 'in_progress' }],
    })
    expect(hostActive().messages.some((m) => m.role === 'plan')).toBe(true)
    expect(packageThreadFor(hostActive().id).feed.messages.some((m) => m.role === 'plan')).toBe(true)

    dualWrite({ sessionUpdate: 'plan_removed' })
    expect(hostActive().messages.some((m) => m.role === 'plan')).toBe(false)
    expect(packageThreadFor(hostActive().id).feed.messages.some((m) => m.role === 'plan')).toBe(false)

    const settle = { sessionUpdate: MONTREE_SETTLE_COMPLETE_KIND }
    useAcpUiStore.getState().applySessionUpdate(settle)
    mirrorSessionUpdateToPackageStore(pkg, settle, undefined, hostActive().id)
    const pkgMapped = packageThreadFor(hostActive().id)
    expect(hostActive().messages.every((m) => !m.streaming)).toBe(true)
    expect(pkgMapped.feed.messages.every((m) => !m.streaming)).toBe(true)
    // 旧桥误调 finishTurn 默认值会把包侧置 true；统一桥只走 freezeSettled。
    expect(pkgMapped.feed.turnSettled).toBe(false)
    expect(useAcpUiStore.getState().turnSettled).toBe(false)
  })

  it('工具 fallback 显式注入：两侧末条 agent 同落提议；无参数时两侧皆无', () => {
    useAcpUiStore.getState().appendUserMessage('带提议的问题')
    useAcpUiStore.getState().beginAgentReply()
    dualWrite({ sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: '答' }] })
    useAcpUiStore.getState().finishStreaming()
    mirrorThreadActionToPackageStore(pkg, { kind: 'finish' }, hostActive().id)
    useAnnotationAgentStore.setState({
      proposeHost: 'main-agent',
      pendingDraft: { fileKey: 'f1', excerpt: 'e', note: 'n', source: 'ai' },
    })
    try {
      const tool = {
        sessionUpdate: 'tool_call',
        toolCallId: 't-fb',
        title: '读',
        kind: 'read',
        status: 'completed',
      }
      useAcpUiStore.getState().applySessionUpdate(tool)
      mirrorSessionUpdateToPackageStore(pkg, tool, undefined, hostActive().id, {
        proposalFallback: {
          proposal: toProposedMark({ id: 'main:f1', excerpt: 'e', note: 'n', source: 'agent' }),
          status: 'pending',
        },
      })
      const proposalIds = (messages: ChatMessage[]) =>
        messages.flatMap((m) => m.markProposals ?? []).map((e) => e.proposal.id)
      expect(proposalIds(packageThreadFor(hostActive().id).feed.messages)).toContain('main:f1')
      expect(proposalIds(hostActive().messages)).toContain('main:f1')
    } finally {
      useAnnotationAgentStore.setState({ proposeHost: null, pendingDraft: null })
    }
  })

  it('空 camelCase id 不误写：两侧都不建幽灵工具', () => {
    const update = {
      sessionUpdate: 'tool_call',
      toolCallId: '',
      tool_call_id: 'snake-1',
      title: 'X',
      kind: 'read',
      status: 'completed',
    }
    useAcpUiStore.getState().applySessionUpdate(update)
    mirrorSessionUpdateToPackageStore(pkg, update, undefined, hostActive().id)
    expect(hostActive().messages.some((m) => m.toolCallId === 'snake-1')).toBe(false)
    expect(packageActive().feed.messages.some((m) => m.role === 'tool')).toBe(false)
  })

  it('纯 snake_case 厂商分块两侧一致忽略', () => {
    const update = {
      sessionUpdate: 'tool_call_content_chunk',
      tool_call_id: 'snake-2',
      content: [{ type: 'text', text: 'x' }],
    }
    useAcpUiStore.getState().applySessionUpdate(update)
    mirrorSessionUpdateToPackageStore(pkg, update, undefined, hostActive().id)
    expect(hostActive().messages).toEqual([])
    expect(packageActive().feed.messages).toEqual([])
  })

  it('未知 kind 有文本两侧兼容成 agent 文本；无文本两侧无变化', () => {
    const hostId = hostActive().id
    dualWrite({ sessionUpdate: 'future_kind_xyz', content: [{ type: 'text', text: '新能力' }] })
    expect(hostActive().messages.map((m) => m.text)).toEqual(['新能力'])
    expect(packageThreadFor(hostId).feed.messages.map((m) => m.text)).toEqual(['新能力'])
    const hostBefore = hostActive().messages.length
    const pkgBefore = packageThreadFor(hostId).feed.messages.length
    dualWrite({ sessionUpdate: 'future_kind_xyz' })
    expect(hostActive().messages).toHaveLength(hostBefore)
    expect(packageThreadFor(hostId).feed.messages).toHaveLength(pkgBefore)
  })

  it('稀疏工具更新保留业务字段；新内容刷新呈现结果', () => {
    const richTool: ChatMessage = {
      id: 't-1',
      role: 'tool',
      toolCallId: 't1',
      toolKind: 'read',
      toolStatus: 'completed',
      toolTitle: '读',
      text: '{"a":1}',
      toolContentText: '{"a":1}',
      createdAt: 1,
      markProposals: [
        {
          proposal: toProposedMark({ id: 'p0', excerpt: 'e', note: 'n', source: 'agent' }),
          status: 'pending',
          toolCallId: 't1',
        },
      ],
      presentResult: {
        schemaVersion: PRESENT_SCHEMA_VERSION,
        kind: 'html-artifact',
        id: 'r1',
        title: '小应用',
        html: '<p>x</p>',
      },
    }
    mirrorHostThreadToPackageStore(
      pkg,
      { id: 'h-rich', title: '旧会话', messages: [richTool] },
      false,
    )
    const sparse = { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' }
    useAcpUiStore.getState().applySessionUpdate(sparse)
    mirrorSessionUpdateToPackageStore(pkg, sparse, undefined, 'h-rich')
    const kept = packageThreadFor('h-rich').feed.messages.find((m) => m.id === 't-1')!
    expect(kept.toolContentText).toBe('{"a":1}')
    expect(kept.presentResult).toEqual(richTool.presentResult)
    expect(kept.markProposals?.map((e) => e.proposal.id)).toEqual(['p0'])

    const fresh = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'completed',
      content: [{ type: 'text', text: '{"b":2}' }],
    }
    useAcpUiStore.getState().applySessionUpdate(fresh)
    mirrorSessionUpdateToPackageStore(pkg, fresh, undefined, 'h-rich')
    const refreshed = packageThreadFor('h-rich').feed.messages.find((m) => m.id === 't-1')!
    expect(refreshed.toolContentText).toBe('{"b":2}')
    expect(refreshed.presentResult).not.toEqual(richTool.presentResult)
    expect(hostActive().messages.filter((m) => m.role === 'tool')).toHaveLength(1)
  })

  it('syncHostThread 导入后定向写入落对应线程', () => {
    mirrorHostThreadToPackageStore(
      pkg,
      { id: 'h-old', title: '旧', messages: [{ id: 'u-1', role: 'user', text: '旧问', createdAt: 1 }] },
      true,
    )
    mirrorSessionUpdateToPackageStore(
      pkg,
      { sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: '旧答' }] },
      undefined,
      'h-old',
    )
    const thread = pkg.getState().threads.find((t) => t.hostThreadId === 'h-old')!
    expect(thread.feed.messages.map((m) => m.text)).toEqual(['旧问', '旧答'])
  })

  it('未清洗 user chunk 直调桥原样入包；宿主清洗后同步无脚手架', () => {
    const context = `${MONTREE_TURN_CONTEXT_OPEN_TAG}\n{"private":"context"}\n${MONTREE_TURN_CONTEXT_CLOSE_TAG}`
    mirrorSessionUpdateToPackageStore(pkg, {
      sessionUpdate: 'user_message_chunk',
      content: [{ type: 'text', text: `${context}\n原始问` }],
    })
    // 桥本身不清洗（生产中 stream-host 从不转发 user chunk，清洗走 syncHostThread）；
    // 此断言锁定边界，不代表期望行为。
    expect(packageActive().feed.messages.map((m) => m.text)).toEqual([`${context}\n原始问`])

    useAcpUiStore.getState().applySessionUpdate({
      sessionUpdate: 'user_message_chunk',
      content: [{ type: 'text', text: `${context}\n完整用户问` }],
    })
    const host = useAcpUiStore.getState()
    const thread = host.threads.find((t) => t.id === host.activeThreadId)!
    mirrorHostThreadToPackageStore(pkg, thread, host.turnSettled)
    const mapped = packageThreadFor(thread.id)
    const texts = mapped.feed.messages.map((m) => m.text)
    expect(texts).toContain('完整用户问')
    expect(texts.join('\n')).not.toContain(MONTREE_TURN_CONTEXT_OPEN_TAG)
  })
})
