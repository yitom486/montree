import { beforeEach, describe, expect, it } from 'vitest'
import {
  createChatSessionStore,
  type ChatSessionSnapshot,
  type ChatSessionStore,
} from '@yitom/chat-session'
import {
  mirrorPermissionRequestToPackageStore,
  mirrorSessionUpdateToPackageStore,
  mirrorThreadActionToPackageStore,
  resetThreadMirrorForTests,
} from './chat-store-mirror'

/**
 * 镜像线程路由（hostThreadId 透传 + provision 补齐）等价测试：
 * - reload：包空 + 带 hostThreadId 事件自动建线程 + 建映射 + 内容落对应线程，
 *   再 switch 回来路由正确；
 * - provision 不污染：无 hostThreadId 且包空不建线程，空映射不建线程，
 *   未知包线程直写 no-op。
 */

const AGENT_CHUNK = (text: string): Record<string, unknown> => ({
  sessionUpdate: 'agent_message_chunk',
  content: [{ type: 'text', text }],
})

const PERMISSION_REQ = {
  requestId: 99,
  sessionId: 'sid-reload',
  toolCall: { toolCallId: 'tool-reload-1', title: '删除文件', kind: 'delete', status: 'pending' },
  options: [
    { optionId: 'allow', name: '允许', kind: 'allow' },
    { optionId: 'deny', name: '拒绝', kind: 'deny' },
  ],
  summary: '删除文件',
}

function threadTexts(pkg: ChatSessionStore, threadId: string): string[] {
  return (
    pkg.getState().threads.find((t) => t.id === threadId)?.feed.messages.map((m) => m.text) ?? []
  )
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
  pkg = createChatSessionStore()
})

describe('chat-store-mirror hostThreadId 路由', () => {
  it.runIf(HAS_DISPATCH_FEED_EVENT)('快照重建后切回历史线程并续聊，线程身份和原有消息不分裂', () => {
    let saved: ChatSessionSnapshot | null = null
    const storage = {
      load: () => saved,
      save: (snapshot: ChatSessionSnapshot) => { saved = JSON.parse(JSON.stringify(snapshot)) as ChatSessionSnapshot },
    }
    const original = createChatSessionStore({ storage })
    mirrorThreadActionToPackageStore(original, { kind: 'create', threadId: 'host-a', runtimeId: 'codex-acp' })
    mirrorThreadActionToPackageStore(original, { kind: 'appendUser', text: '甲旧问' }, 'host-a')
    mirrorSessionUpdateToPackageStore(original, AGENT_CHUNK('甲旧答'), undefined, 'host-a')
    mirrorThreadActionToPackageStore(original, { kind: 'finish' }, 'host-a')
    const aId = original.getState().activeThreadId!
    mirrorThreadActionToPackageStore(original, { kind: 'create', threadId: 'host-b', runtimeId: 'opencode' })
    mirrorThreadActionToPackageStore(original, { kind: 'appendUser', text: '乙旧问' }, 'host-b')

    resetThreadMirrorForTests()
    const restored = createChatSessionStore({ storage })
    const count = restored.getState().threads.length
    mirrorThreadActionToPackageStore(restored, { kind: 'switch', threadId: 'host-a' })
    expect(restored.getState().activeThreadId).toBe(aId)
    expect(restored.getState().modelConfig.runtimeId).toBe('codex-acp')
    mirrorThreadActionToPackageStore(restored, { kind: 'appendUser', text: '甲续问' }, 'host-a')
    expect(restored.getState().threads).toHaveLength(count)
    expect(threadTexts(restored, aId)).toEqual(['甲旧问', '甲旧答', '甲续问'])
  })

  it('迁入宿主已有历史可修复旧版随机 ID 快照，保留附件和运行时', () => {
    const legacy = createChatSessionStore()
    legacy.appendUser('旧影子副本')
    const attachments = [{ id: 'file-1', kind: 'file' as const, name: 'notes.md', mimeType: 'text/markdown', absolutePath: 'D:/notes.md' }]
    const messages = [{ id: 'host-message', role: 'user' as const, text: '宿主历史', attachments, createdAt: 1, updatedAt: 1 }]
    legacy.reconcileHostThreads([
      { id: 'host-history', runtimeId: 'opencode', title: '宿主历史', feed: { messages, turnSettled: true } },
    ], 'host-history')
    const thread = legacy.getState().threads[0]!
    expect(legacy.getState().threads).toHaveLength(1)
    expect(thread.hostThreadId).toBe('host-history')
    expect(thread.feed.messages[0]?.attachments).toEqual(attachments)
    expect(legacy.getState().modelConfig.runtimeId).toBe('opencode')
    mirrorThreadActionToPackageStore(legacy, { kind: 'appendUser', text: '续聊', attachments }, 'host-history')
    expect(legacy.getState().threads).toHaveLength(1)
    expect(threadTexts(legacy, thread.id)).toEqual(['宿主历史', '续聊'])
    expect(legacy.getState().threads[0]!.feed.messages[1]?.attachments).toEqual(attachments)
  })

  it.runIf(HAS_DISPATCH_FEED_EVENT)('后台迟到消息只写对应历史，不切换可见线程或其运行时', () => {
    mirrorThreadActionToPackageStore(pkg, { kind: 'create', threadId: 'visible', runtimeId: 'opencode' })
    const active = pkg.getState().activeThreadId
    mirrorSessionUpdateToPackageStore(pkg, AGENT_CHUNK('后台迟到'), undefined, 'background')
    const background = pkg.getState().threads.find((t) => t.hostThreadId === 'background')!
    expect(background.feed.messages[0]?.text).toBe('后台迟到')
    expect(pkg.getState().activeThreadId).toBe(active)
    expect(pkg.getState().modelConfig.runtimeId).toBe('opencode')
    expect(threadTexts(pkg, active!)).toEqual([])
  })

  it.runIf(HAS_DISPATCH_FEED_EVENT)('reload：带 hostThreadId 事件自动建线程 + 建映射 + 内容落对应线程，switch 回来路由正确', () => {
    const p0 = pkg.getState().activeThreadId!
    expect(pkg.getState().threads).toHaveLength(1)
    const hostA = 'host-reload-A'
    const hostB = 'host-reload-B'

    // A 线程首个增量：包空 + host 未映射 → 自动建线程并落内容
    mirrorSessionUpdateToPackageStore(pkg, AGENT_CHUNK('甲答'), undefined, hostA)
    expect(pkg.getState().threads).toHaveLength(2)
    const pA = pkg.getState().threads.find((t) => t.hostThreadId === hostA)!.id
    expect(pA).not.toBe(p0)
    expect(pkg.getState().activeThreadId).toBe(p0)
    expect(threadTexts(pkg, pA).join('')).toContain('甲答')
    expect(threadTexts(pkg, p0)).toEqual([])

    // B 线程用户问：同样自动建线程并记映射
    mirrorThreadActionToPackageStore(pkg, { kind: 'appendUser', text: '乙问' }, hostB)
    expect(pkg.getState().threads).toHaveLength(3)
    const pB = pkg.getState().threads.find((t) => t.hostThreadId === hostB)!.id
    expect(pB).not.toBe(pA)
    expect(pkg.getState().activeThreadId).toBe(p0)
    expect(threadTexts(pkg, pB).join('')).toContain('乙问')

    // 切回 A：经映射路由到 pA，内容保持
    mirrorThreadActionToPackageStore(pkg, { kind: 'switch', threadId: hostA }, hostA)
    expect(pkg.getState().activeThreadId).toBe(pA)
    expect(threadTexts(pkg, pA).join('')).toContain('甲答')

    // 再往 A 写增量：不再建线程，落同一包线程
    mirrorSessionUpdateToPackageStore(pkg, AGENT_CHUNK('甲答二'), undefined, hostA)
    expect(pkg.getState().threads).toHaveLength(3)
    expect(pkg.getState().activeThreadId).toBe(pA)
    expect(threadTexts(pkg, pA).join('')).toContain('甲答二')

    // A 线程审批：定向写入 pA 时间线，不建线程
    mirrorPermissionRequestToPackageStore(pkg, PERMISSION_REQ, hostA)
    expect(pkg.getState().threads).toHaveLength(3)
    expect(pkg.getState().pendingPermission).not.toBeNull()
    const timelineHasTool = (pkg.getState().threads.find((t) => t.id === pA)?.feed.messages ?? []).some(
      (m) => m.toolCallId === 'tool-reload-1',
    )
    expect(timelineHasTool).toBe(true)

    // beginReply/appendSystem 同样路由到映射线程（不建新线程）
    mirrorThreadActionToPackageStore(pkg, { kind: 'beginReply' }, hostA)
    expect(pkg.getState().threads).toHaveLength(3)
    mirrorThreadActionToPackageStore(pkg, { kind: 'appendSystem', text: '系统注' }, hostA)
    expect(pkg.getState().threads).toHaveLength(3)
    expect(threadTexts(pkg, pA).join('')).toContain('系统注')
  })

  it.runIf(HAS_DISPATCH_FEED_EVENT)('provision 不污染未知线程：无 hostThreadId 且包空不建线程，空映射不建线程', () => {
    const beforeCount = pkg.getState().threads.length
    const beforeActive = pkg.getState().activeThreadId
    expect(beforeCount).toBe(1)

    // 空映射（config_option_update）即使带 host 也不建线程
    mirrorSessionUpdateToPackageStore(
      pkg,
      { sessionUpdate: 'config_option_update', configId: 'model', value: 'x' },
      undefined,
      'host-ghost',
    )
    expect(pkg.getState().threads).toHaveLength(beforeCount)

    // 显式未知包线程直写 no-op：不建线程不写
    mirrorSessionUpdateToPackageStore(pkg, AGENT_CHUNK('幽灵'), 'no-such-thread')
    expect(pkg.getState().threads).toHaveLength(beforeCount)
    expect(threadTexts(pkg, beforeActive!)).toEqual([])

    // 无 host 正常写入 active：不建线程，内容落 active
    mirrorSessionUpdateToPackageStore(pkg, AGENT_CHUNK('正文'))
    expect(pkg.getState().threads).toHaveLength(beforeCount)
    expect(pkg.getState().activeThreadId).toBe(beforeActive)
    expect(threadTexts(pkg, beforeActive!).join('')).toContain('正文')

    // 非 provision 路径未知 host 不建线程不写
    const countBeforeFinish = pkg.getState().threads.length
    mirrorThreadActionToPackageStore(pkg, { kind: 'finish' }, 'host-unknown-no-map')
    expect(pkg.getState().threads).toHaveLength(countBeforeFinish)
    mirrorThreadActionToPackageStore(
      pkg,
      { kind: 'deleteThread', threadId: 'no-such-host' },
      'no-such-host',
    )
    expect(pkg.getState().threads).toHaveLength(countBeforeFinish)
  })
})
