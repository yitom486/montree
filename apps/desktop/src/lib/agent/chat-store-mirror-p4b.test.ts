import { beforeEach, describe, expect, it } from 'vitest'
import type { ChatMessage } from '@yitom/chat-core'
import {
  createChatSessionStore,
  type ChatSessionStore,
} from '@yitom/chat-session'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import {
  mirrorSessionUpdateToPackageStore,
  mirrorThreadActionToPackageStore,
  resetThreadMirrorForTests,
} from './chat-store-mirror'

/**
 * P4b 镜像扩展双跑一致：appendSystem / freezeSettled / cancelTools /
 * rollbackFailed / resolveProposal / selectChapterPlan / attachSnapshot /
 * deleteThread / renameThread / switchWorkspace。
 *
 * 同一宿主 action 与对应 mirror action 双写后，归一化比对 active（或全表）
 * 消息形状。归一化（id/时间戳/线程 id 一律忽略，只比用户可见内容）：
 * - role/text/streaming/toolCallId/toolStatus/planEntries/turnEnded；
 * - markProposal/markProposals/chapterMarkPlan 的 id + status；
 * - turnSettled（宿主根态 vs 包 active feed）与线程计数/标题。
 *
 * 已知不对齐（归一化时排除）：
 * - fallback：宿主 finish/attach 带 annotation store fallback，包侧恒 null；
 *   用例全程不碰 annotation store（fallback 为空即等价）。
 * - rollbackFailed：host keepIds 与包 id 分属不同 id 空间，mirror 内按
 *   lockstep 前缀长度翻译；用例保证两侧消息数一致。
 * - delete 后宿主新建兜底线程 id 无映射：用例止于删除不断言后续切换。
 */

interface ProposalShape {
  id: string
  status: string | null
}

interface MessageShape {
  role: ChatMessage['role']
  text: string
  streaming: boolean
  toolCallId: string | null
  toolStatus: string | null
  planEntries: ChatMessage['planEntries'] | null
  turnEnded: boolean
  markProposal: ProposalShape | null
  markProposals: ProposalShape[] | null
  chapterMarkPlan: ProposalShape[] | null
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
    markProposal: message.markProposal
      ? { id: message.markProposal.id, status: message.markProposalStatus ?? null }
      : null,
    markProposals:
      message.markProposals?.map((row) => ({
        id: row.proposal.id,
        status: row.status ?? null,
      })) ?? null,
    chapterMarkPlan:
      message.chapterMarkPlan?.map((row) => ({ id: row.id, status: row.status ?? null })) ??
      null,
  }
}

function hostActiveShapes(): MessageShape[] {
  const s = useAcpUiStore.getState()
  const thread = s.threads.find((t) => t.id === s.activeThreadId)
  return (thread?.messages ?? []).map(shapeOf)
}

function packageActiveShapes(pkg: ChatSessionStore): MessageShape[] {
  const s = pkg.getState()
  const thread = s.threads.find((t) => t.id === s.activeThreadId)
  return (thread?.feed.messages ?? []).map(shapeOf)
}

function packageActiveTurnSettled(pkg: ChatSessionStore): boolean {
  const s = pkg.getState()
  return s.threads.find((t) => t.id === s.activeThreadId)?.feed.turnSettled ?? false
}

function hostActiveTitle(): string | null {
  const s = useAcpUiStore.getState()
  return s.threads.find((t) => t.id === s.activeThreadId)?.title ?? null
}

function packageActiveTitle(pkg: ChatSessionStore): string | null {
  const s = pkg.getState()
  return s.threads.find((t) => t.id === s.activeThreadId)?.title ?? null
}

function hostThreadShapes(): MessageShape[][] {
  return useAcpUiStore.getState().threads.map((t) => t.messages.map(shapeOf))
}

function packageThreadShapes(pkg: ChatSessionStore): MessageShape[][] {
  return pkg.getState().threads.map((t) => t.feed.messages.map(shapeOf))
}

let pkg: ChatSessionStore

// C2b1 过渡守卫：session-update 镜像桥已切包 `dispatchFeedEvent`（候选包 API，
// 正式依赖 0.1.9 尚无对应方法）；候选消费环境下执行，正式依赖下跳过。
// 正式升级六包后此守卫恒真，可整体移除。
const HAS_DISPATCH_FEED_EVENT =
  typeof (
    createChatSessionStore() as unknown as { dispatchFeedEvent?: unknown }
  ).dispatchFeedEvent === 'function'

beforeEach(() => {
  resetThreadMirrorForTests()
  const fresh = useAcpUiStore.getState().createThread()
  useAcpUiStore.setState({
    prompting: false,
    sessionId: null,
    status: 'disconnected',
    pendingPermission: null,
    pendingMarkProposalSnapshotContents: [],
    pendingReplayUserText: null,
    turnSettled: false,
    currentWorkspaceRoot: undefined,
  })
  const thread = useAcpUiStore.getState().threads.find((t) => t.id === fresh)
  useAcpUiStore.setState({
    threads: thread ? [thread] : useAcpUiStore.getState().threads.slice(0, 1),
    activeThreadId: fresh,
  })
  pkg = createChatSessionStore()
})

/** 同一文本问双写（user 气泡，两侧线程非空以避开修剪分叉）。 */
function seedUser(text: string): void {
  useAcpUiStore.getState().appendUserMessage(text)
  mirrorThreadActionToPackageStore(pkg, { kind: 'appendUser', text })
}

/** 同一 agent 文本增量双写（复用 P4a 路径，active 线程）。 */
function streamAgent(text: string): void {
  const update = { sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text }] }
  useAcpUiStore.getState().applySessionUpdate(update)
  mirrorSessionUpdateToPackageStore(pkg, update)
}

/** 同一工具调用双写（active 线程）。 */
function upsertTool(update: Record<string, unknown>): void {
  useAcpUiStore.getState().applySessionUpdate(update)
  mirrorSessionUpdateToPackageStore(pkg, update)
}

/**
 * 两侧同步为单映射线程并落字（返回宿主线程 id）：
 * beforeEach 后宿主 [h0] 与包 [p0] 天然无映射（h0 在自动镜像里指向单例），
 * id 翻译类用例（delete/rename）须先建映射——同建 hA 后直调删掉两侧旧线程，
 * 余 [hA]/[pA] 且映射 hA→pA 已立（显式 create 覆盖自动镜像的单例映射）。
 *
 * 注意顺序：显式镜像先于宿主 action（宿主 action 自带单例自动镜像，
 * 会覆写/消费全局映射；显式优先则单例侧回落 no-op，从不断言单例）。
 */
function syncToSingleMappedThread(seedText: string): string {
  const h0 = useAcpUiStore.getState().activeThreadId
  const p0 = pkg.getState().activeThreadId!
  const hA = useAcpUiStore.getState().createThread()
  mirrorThreadActionToPackageStore(pkg, {
    kind: 'create',
    threadId: hA,
    runtimeId: useAcpUiStore.getState().selectedRuntimeId,
  })
  useAcpUiStore.getState().deleteThread(h0)
  pkg.deleteThread(p0)
  seedUser(seedText)
  return hA
}

/** 同建第二映射线程并落字（返回宿主线程 id，active 落新线程）。 */
function createSecondMappedThread(seedText: string): string {
  const hB = useAcpUiStore.getState().createThread()
  mirrorThreadActionToPackageStore(pkg, {
    kind: 'create',
    threadId: hB,
    runtimeId: useAcpUiStore.getState().selectedRuntimeId,
  })
  seedUser(seedText)
  return hB
}

describe('chat-store-mirror P4b 扩展双跑', () => {
  it('appendSystem：系统消息双写一致，标题不动', () => {
    seedUser('种子问')
    useAcpUiStore.getState().appendSystemMessage('系统通知')
    mirrorThreadActionToPackageStore(pkg, { kind: 'appendSystem', text: '系统通知' })
    expect(packageActiveShapes(pkg)).toEqual(hostActiveShapes())
    expect(hostActiveShapes().map((m) => m.role)).toEqual(['user', 'system'])
    expect(packageActiveTitle(pkg)).toBe(hostActiveTitle())
  })

  it.runIf(HAS_DISPATCH_FEED_EVENT)('freezeSettled：定居冻结双写一致且不置 turnSettled', () => {
    seedUser('种子问')
    useAcpUiStore.getState().beginAgentReply()
    mirrorThreadActionToPackageStore(pkg, { kind: 'beginReply' })
    streamAgent('正文')
    expect(hostActiveShapes().some((m) => m.streaming)).toBe(true)

    useAcpUiStore.getState().freezeSettledStreaming()
    mirrorThreadActionToPackageStore(pkg, { kind: 'freezeSettled' })
    expect(packageActiveShapes(pkg)).toEqual(hostActiveShapes())
    expect(hostActiveShapes().some((m) => m.streaming)).toBe(false)
    expect(useAcpUiStore.getState().turnSettled).toBe(false)
    expect(packageActiveTurnSettled(pkg)).toBe(false)
  })

  it.runIf(HAS_DISPATCH_FEED_EVENT)('cancelTools：进行中工具双写标 cancelled，已落定不动', () => {
    seedUser('种子问')
    useAcpUiStore.getState().beginAgentReply()
    mirrorThreadActionToPackageStore(pkg, { kind: 'beginReply' })
    upsertTool({
      sessionUpdate: 'tool_call',
      toolCallId: 'tool-1',
      title: '读取文件',
      kind: 'read',
      status: 'in_progress',
      content: [{ type: 'text', text: 'reading' }],
    })

    useAcpUiStore.getState().cancelActiveTools()
    mirrorThreadActionToPackageStore(pkg, { kind: 'cancelTools' })
    expect(packageActiveShapes(pkg)).toEqual(hostActiveShapes())
    const tool = hostActiveShapes().find((m) => m.toolCallId === 'tool-1')
    expect(tool?.toolStatus).toBe('cancelled')
    const pkgTool = packageActiveShapes(pkg).find((m) => m.toolCallId === 'tool-1')
    expect(pkgTool?.toolStatus).toBe('cancelled')
  })

  it.runIf(HAS_DISPATCH_FEED_EVENT)('rollbackFailed：失败回合新增 thought 双写回滚，旧消息保留', () => {
    seedUser('种子问')
    useAcpUiStore.getState().beginAgentReply()
    mirrorThreadActionToPackageStore(pkg, { kind: 'beginReply' })
    // 发送方快照口径：begin 之后、首个新气泡之前
    const keepIds = useAcpUiStore
      .getState()
      .threads.find((t) => t.id === useAcpUiStore.getState().activeThreadId)!
      .messages.map((m) => m.id)
    streamAgent('正文')
    const thought = {
      sessionUpdate: 'agent_thought_chunk',
      content: [{ type: 'text', text: '失败前思考' }],
    }
    useAcpUiStore.getState().applySessionUpdate(thought)
    mirrorSessionUpdateToPackageStore(pkg, thought)
    expect(hostActiveShapes().map((m) => m.role)).toEqual(['user', 'agent', 'thought'])

    useAcpUiStore.getState().rollbackFailedTurn(keepIds)
    mirrorThreadActionToPackageStore(pkg, { kind: 'rollbackFailed', keepIds })
    expect(packageActiveShapes(pkg)).toEqual(hostActiveShapes())
    expect(hostActiveShapes().map((m) => m.role)).toEqual(['user', 'agent'])
    expect(hostActiveShapes()[1]?.text).toBe('正文')
  })

  it('attachSnapshot + resolveProposal：快照挂载后决议双写一致', () => {
    seedUser('划重点')
    upsertTool({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-p1',
      title: 'montree_propose_mark',
      kind: 'other',
      status: 'in_progress',
    })
    const content = JSON.stringify({ proposed: true, note: '批注一', excerpt: '原文一' })
    useAcpUiStore.getState().attachMarkProposalsFromSnapshot(content)
    mirrorThreadActionToPackageStore(pkg, { kind: 'attachSnapshot', content })
    expect(packageActiveShapes(pkg)).toEqual(hostActiveShapes())
    const attached = hostActiveShapes().find((m) => m.toolCallId === 'tc-p1')
    expect(attached?.markProposal).toEqual({ id: 'tool:tc-p1', status: 'pending' })

    useAcpUiStore.getState().resolveMarkProposal('tool:tc-p1', 'adopted')
    mirrorThreadActionToPackageStore(pkg, {
      kind: 'resolveProposal',
      proposalId: 'tool:tc-p1',
      status: 'adopted',
    })
    expect(packageActiveShapes(pkg)).toEqual(hostActiveShapes())
    expect(hostActiveShapes().find((m) => m.toolCallId === 'tc-p1')?.markProposal).toEqual({
      id: 'tool:tc-p1',
      status: 'adopted',
    })
  })

  it('attachSnapshot 无命中只排队：消息不动双写一致', () => {
    seedUser('种子问')
    const content = JSON.stringify({ proposed: true, note: '等工具', excerpt: '原文' })
    useAcpUiStore.getState().attachMarkProposalsFromSnapshot(content)
    mirrorThreadActionToPackageStore(pkg, { kind: 'attachSnapshot', content })
    expect(packageActiveShapes(pkg)).toEqual(hostActiveShapes())
    expect(useAcpUiStore.getState().pendingMarkProposalSnapshotContents).toHaveLength(1)
  })

  it('selectChapterPlan：章计划选中其余 dismiss 双写一致', () => {
    seedUser('章建议')
    upsertTool({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-ch',
      title: 'montree_suggest_chapters',
      kind: 'other',
      status: 'in_progress',
    })
    upsertTool({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-ch',
      title: 'montree_suggest_chapters',
      kind: 'other',
      status: 'completed',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            suggested: true,
            chapters: [
              { flatIndex: 0, title: '第一章', reason: '重点' },
              { flatIndex: 1, title: '第二章', reason: '次点' },
            ],
          }),
        },
      ],
    })
    expect(packageActiveShapes(pkg)).toEqual(hostActiveShapes())
    const plan = hostActiveShapes().find((m) => m.toolCallId === 'tc-ch')
    expect(plan?.chapterMarkPlan).toEqual([
      { id: 'tool:tc-ch:0', status: 'pending' },
      { id: 'tool:tc-ch:1', status: 'pending' },
    ])

    useAcpUiStore.getState().selectChapterMarkPlan('tool:tc-ch:0')
    mirrorThreadActionToPackageStore(pkg, { kind: 'selectChapterPlan', entryId: 'tool:tc-ch:0' })
    expect(packageActiveShapes(pkg)).toEqual(hostActiveShapes())
    expect(hostActiveShapes().find((m) => m.toolCallId === 'tc-ch')?.chapterMarkPlan).toEqual([
      { id: 'tool:tc-ch:0', status: 'selected' },
      { id: 'tool:tc-ch:1', status: 'dismissed' },
    ])
  })

  it('deleteThread + renameThread：删非 active 与重命名双写一致', () => {
    const hA = syncToSingleMappedThread('甲问')
    const hB = createSecondMappedThread('乙问')

    // 显式优先：先喂镜像再走宿主（宿主自带单例自动镜像回落 no-op）
    mirrorThreadActionToPackageStore(pkg, { kind: 'renameThread', threadId: hB, title: '新标题' })
    useAcpUiStore.getState().renameThread(hB, '新标题')
    expect(packageActiveTitle(pkg)).toBe('新标题')
    expect(packageActiveTitle(pkg)).toBe(hostActiveTitle())

    mirrorThreadActionToPackageStore(pkg, { kind: 'deleteThread', threadId: hA })
    useAcpUiStore.getState().deleteThread(hA)
    expect(useAcpUiStore.getState().threads.length).toBe(pkg.getState().threads.length)
    expect(packageActiveShapes(pkg)).toEqual(hostActiveShapes())
    expect(hostActiveShapes().map((m) => m.text)).toEqual(['乙问'])
    expect(packageActiveTitle(pkg)).toBe(hostActiveTitle())
  })

  it('deleteThread 删 active 有同 runtime 兄弟：路由双写一致', () => {
    syncToSingleMappedThread('甲问')
    const hB = createSecondMappedThread('乙问')

    mirrorThreadActionToPackageStore(pkg, { kind: 'deleteThread', threadId: hB })
    useAcpUiStore.getState().deleteThread(hB)
    expect(useAcpUiStore.getState().threads.length).toBe(pkg.getState().threads.length)
    expect(packageActiveShapes(pkg)).toEqual(hostActiveShapes())
    expect(hostActiveShapes().map((m) => m.text)).toEqual(['甲问'])
    expect(packageActiveTitle(pkg)).toBe(hostActiveTitle())
  })

  it('deleteThread 删唯一线程兜底：两侧同建空白线程双写一致', () => {
    const hA = syncToSingleMappedThread('甲问')

    mirrorThreadActionToPackageStore(pkg, { kind: 'deleteThread', threadId: hA })
    useAcpUiStore.getState().deleteThread(hA)
    expect(useAcpUiStore.getState().threads.length).toBe(pkg.getState().threads.length)
    expect(packageActiveShapes(pkg)).toEqual(hostActiveShapes())
    expect(packageActiveShapes(pkg)).toEqual([])
  })

  it('switchWorkspace：旧线程轻冻 + 新建专属线程双写一致', () => {
    seedUser('甲问')
    const before = useAcpUiStore.getState().activeThreadId
    const target = useAcpUiStore.getState().switchWorkspace('/ws-a')
    mirrorThreadActionToPackageStore(pkg, {
      kind: 'switchWorkspace',
      fromThreadId: before,
      toThreadId: target,
      runtimeId: useAcpUiStore.getState().selectedRuntimeId,
    })
    expect(useAcpUiStore.getState().threads.length).toBe(pkg.getState().threads.length)
    expect(packageThreadShapes(pkg)).toEqual(hostThreadShapes())
    expect(packageActiveShapes(pkg)).toEqual([])

    seedUser('乙问')
    const before2 = useAcpUiStore.getState().activeThreadId
    const target2 = useAcpUiStore.getState().switchWorkspace('/ws-b')
    mirrorThreadActionToPackageStore(pkg, {
      kind: 'switchWorkspace',
      fromThreadId: before2,
      toThreadId: target2,
      runtimeId: useAcpUiStore.getState().selectedRuntimeId,
    })
    expect(useAcpUiStore.getState().threads.length).toBe(pkg.getState().threads.length)
    expect(packageThreadShapes(pkg)).toEqual(hostThreadShapes())

    // 同工作区重复切换 early-return：宿主无变更，不喂镜像
    const same = useAcpUiStore.getState().switchWorkspace('/ws-b')
    expect(same).toBe(target2)
    expect(packageThreadShapes(pkg)).toEqual(hostThreadShapes())
  })

  it('未知线程删除/重命名/切换 no-op：不写不抛', () => {
    seedUser('留守问')
    const before = packageActiveShapes(pkg)
    const beforeActive = pkg.getState().activeThreadId
    const beforeCount = pkg.getState().threads.length
    mirrorThreadActionToPackageStore(pkg, { kind: 'deleteThread', threadId: 'no-such-thread' })
    mirrorThreadActionToPackageStore(pkg, {
      kind: 'renameThread',
      threadId: 'no-such-thread',
      title: '幽灵',
    })
    mirrorThreadActionToPackageStore(pkg, { kind: 'switch', threadId: 'no-such-thread' })
    expect(packageActiveShapes(pkg)).toEqual(before)
    expect(pkg.getState().activeThreadId).toBe(beforeActive)
    expect(pkg.getState().threads.length).toBe(beforeCount)
  })

  it('P4b 镜像动作抛错永不阻断主链路', () => {
    const bomb = new Proxy({}, { get(): never { throw new Error('boom') } })
    expect(() =>
      mirrorThreadActionToPackageStore(pkg, {
        kind: 'rollbackFailed',
        keepIds: bomb as unknown as string[],
      }),
    ).not.toThrow()
    expect(() =>
      mirrorThreadActionToPackageStore(pkg, bomb as unknown as { kind: 'freezeSettled' }),
    ).not.toThrow()
    // appendSystem 文本异常对象：归约器内无字符串操作不触发读取，
    // 但绝不抛到主链路；镜像事后仍可用
    expect(() =>
      mirrorThreadActionToPackageStore(pkg, { kind: 'appendSystem', text: bomb as unknown as string }),
    ).not.toThrow()
    mirrorThreadActionToPackageStore(pkg, { kind: 'appendSystem', text: 'ok' })
    expect(packageActiveShapes(pkg).map((m) => m.role)).toEqual(['system', 'system'])
  })
})
