import {
  mapConnectionStatus,
  mapPermissionRequest,
  mapSessionUpdate,
  type ChatSessionStore,
} from '@yitom/chat-session'
import type { MarkProposalStatus } from '@yitom/annotations'
import type { AcpMessageAttachment, ChatMessage } from '@yitom/chat-core'
import { DEFAULT_ACP_RUNTIME_ID } from '@yitom/contracts'
import { acpDevLog } from '@/lib/agent/acp-dev-log'

/** 回放清洗只在宿主发生；将清洗后的单线程 feed 对齐，原始脚手架不进包。 */
export function mirrorHostThreadToPackageStore(
  pkg: ChatSessionStore,
  thread: { id: string; runtimeId?: string; title: string; messages: ChatMessage[] },
  turnSettled: boolean,
): void {
  try {
    pkg.syncHostThread({
      id: thread.id,
      hostThreadId: thread.id,
      runtimeId: thread.runtimeId || DEFAULT_ACP_RUNTIME_ID,
      title: thread.title,
      feed: { messages: thread.messages, turnSettled },
    })
  } catch (error) {
    acpDevLog('chat-store-mirror host thread failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** 宿主历史权威迁入：仅启动/恢复和线程生命周期边界调用，增量仍单次转发。 */
export function mirrorHostSnapshotToPackageStore(
  pkg: ChatSessionStore,
  host: {
    threads: Array<{ id: string; runtimeId?: string; title: string; messages: ChatMessage[] }>
    activeThreadId: string
    turnSettled: boolean
  },
): void {
  try {
    pkg.reconcileHostThreads(host.threads.map((thread) => ({
      id: thread.id,
      hostThreadId: thread.id,
      runtimeId: thread.runtimeId || DEFAULT_ACP_RUNTIME_ID,
      title: thread.title,
      feed: {
        messages: thread.messages,
        turnSettled: thread.id === host.activeThreadId ? host.turnSettled : false,
      },
    })), host.activeThreadId)
  } catch (error) {
    acpDevLog('chat-store-mirror host snapshot failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * P4a 宿主→包双写对账镜像（只加法，不切换任何 UI）。
 *
 * 宿主分发点（`acp-stream-host` / `useAcpPermissionIngest`）在既有写入之后各调一行，
 * 把同一事件再喂给包 store；渲染与主链路一律走宿主 store。
 * 三函数只做纯转发：不读宿主 store、不调 acpApi、不碰 UI；
 * 任一映射抛错内部吞掉并记一行诊断日志，镜像永不阻断主链路。
 */

/**
 * P4c 起包 store 正式持有口为 `lib/agent/chat-session-owner.ts` 的
 * `getOwnedChatSessionStore()`（localStorage 持久化）；本模块只留纯转发镜像函数。
 */

/**
 * 会话增量镜像：经包 `mapSessionUpdate` 得 `ChatFeedEvent[]`，逐个按事件类型调包 store
 * 对应 ingest 方法。线程路由 hostThreadId（provision 自动建线程并记映射，
 * reload 存量线程无 create 事件时的补齐口）优先，显式 threadId（包线程直写，
 * 未知即 store 侧 no-op）次之，缺省 active。
 * 未知线程由 store 侧 no-op（与宿主“丢弃过时会话”语义对齐：绝不污染其它线程）。
 * 空映射（未知种类无文本 / config_option_update 等）直接跳过（不建线程）。
 */
export function mirrorSessionUpdateToPackageStore(
  pkg: ChatSessionStore,
  update: Record<string, unknown>,
  threadId?: string,
  hostThreadId?: string,
): void {
  try {
    const events = mapSessionUpdate(update)
    if (events.length === 0) return
    let target: string | undefined
    if (hostThreadId !== undefined) {
      target = resolvePackageThreadId(pkg, hostThreadId, undefined, true)
      if (!target) return
    } else {
      target = threadId ?? pkg.getState().activeThreadId ?? undefined
    }
    for (const event of events) {
      switch (event.type) {
        case 'text-chunk':
          if (event.role === 'thought') pkg.ingestThoughtChunk(event.text, target)
          else if (event.role === 'agent') pkg.ingestTextChunk(event.text, target)
          else pkg.appendUser(event.text, { threadId: target })
          break
        case 'tool-call':
          pkg.ingestToolCall(event.call, target)
          break
        case 'tool-chunk':
          pkg.ingestToolChunk(event.toolCallId, event.text, target)
          break
        case 'plan':
          pkg.ingestPlan(event.entries, event.active, target)
          break
        case 'finish-turn':
          pkg.finishTurn(target)
          break
        case 'begin-reply':
          pkg.beginReply(target)
          break
        case 'cancel-tools':
          pkg.cancelTools(target)
          break
        case 'freeze-light':
          pkg.freezeLight(target)
          break
        case 'user-append':
          pkg.appendUser(event.text, { threadId: target, attachments: event.attachments })
          break
        default:
          break
      }
    }
  } catch (error) {
    acpDevLog('chat-store-mirror session update failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * 审批请求镜像：经 `mapPermissionRequest` 调包 `requestPermission`
 *（包内同样单槽覆盖 + toolCall 落时间线，对齐宿主 `ingestPermissionRequest` 纯状态部分）。
 * hostThreadId 给定时经 provision 解析定向写入对应包线程时间线；
 * 未解析（未知且未建）直接跳过，pending 全局态不污染。
 */
export function mirrorPermissionRequestToPackageStore(
  pkg: ChatSessionStore,
  req: unknown,
  hostThreadId?: string,
): void {
  try {
    const { permission } = mapPermissionRequest(req)
    if (hostThreadId !== undefined) {
      const target = resolvePackageThreadId(pkg, hostThreadId, undefined, true)
      if (!target) return
      pkg.requestPermission(permission, target)
      return
    }
    pkg.requestPermission(permission)
  } catch (error) {
    acpDevLog('chat-store-mirror permission failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * 连接状态镜像：经 `mapConnectionStatus`，disconnected/error 由包 `setConnectionStatus`
 * 清 pending（对齐宿主断开清理）；其余状态包侧 no-op。
 */
export function mirrorConnectionStatusToPackageStore(pkg: ChatSessionStore, status: unknown): void {
  try {
    pkg.setConnectionStatus(mapConnectionStatus(status))
  } catch (error) {
    acpDevLog('chat-store-mirror connection status failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * 宿主生命周期与用户输入转发到包 store。hostThreadId 随 ChatThread 快照保存，
 * 重启后可直接解析；历史的首次迁入与旧快照修复由 acp-store 注册的同步口负责。
 * 只有显式 create/switch/switchWorkspace 改变 active；定向增量不会抢占可见会话。
 * 用户附件随 user-append 完整透传；宿主消息 id 的回滚锚点按消息前缀长度翻译。
 * 所有镜像异常仅记录诊断，不阻断宿主主链路。
 */
export type ThreadMirrorAction =
  | { kind: 'create'; threadId?: string; runtimeId?: string }
  | { kind: 'switch'; threadId: string }
  | { kind: 'clear' }
  | { kind: 'appendUser'; text: string; attachments?: AcpMessageAttachment[] }
  | { kind: 'beginReply' }
  | { kind: 'finish' }
  | { kind: 'appendSystem'; text: string }
  | { kind: 'freezeSettled' }
  | { kind: 'cancelTools' }
  | { kind: 'rollbackFailed'; keepIds: string[] }
  | { kind: 'resolveProposal'; proposalId: string; status: Exclude<MarkProposalStatus, 'pending'> }
  | { kind: 'selectChapterPlan'; entryId: string }
  | { kind: 'attachSnapshot'; content: string }
  | { kind: 'deleteThread'; threadId: string }
  | { kind: 'renameThread'; threadId: string; title: string }
  | { kind: 'switchWorkspace'; fromThreadId: string; toThreadId: string; runtimeId?: string }

/**
 * 解析包侧目标线程（P4b reload 空洞修复）：
 * 映射有效即用；包内有同 id 线程则认领；否则为消息承载路径新建并记映射
 * （reload 恢复的存量线程无 create 事件，不建则包侧永远空）。
 * 非消息路径（finish/freeze/cancel/rollback/resolve/select/attach/switch/delete/rename/clear）
 * 不自动建：未知即回落（包侧 no-op），避免凭空造空线程。
 */
function resolvePackageThreadId(
  pkg: ChatSessionStore,
  hostThreadId?: string,
  runtimeId?: string,
  provision = false,
): string | undefined {
  const state = pkg.getState()
  if (hostThreadId) {
    const existing = state.threads.find((t) => t.hostThreadId === hostThreadId || t.id === hostThreadId)
    if (existing) return existing.id
    if (!provision) return undefined
    return pkg.ensureHostThread(hostThreadId, runtimeId)
  }
  return state.activeThreadId ?? undefined
}

/** 兼容旧测试入口；关联已保存在各线程快照中，无模块内全局状态。 */
export function resetThreadMirrorForTests(): void {}

export function mirrorThreadActionToPackageStore(
  pkg: ChatSessionStore,
  action: ThreadMirrorAction,
  hostThreadId?: string,
): void {
  try {
    switch (action.kind) {
      case 'create': {
        if (action.threadId) pkg.ensureHostThread(action.threadId, action.runtimeId, true)
        else pkg.newThread(action.runtimeId)
        break
      }
      case 'switch': {
        const target = resolvePackageThreadId(pkg, action.threadId)
        if (target) pkg.switchThread(target)
        break
      }
      case 'clear': {
        const target = resolvePackageThreadId(pkg, hostThreadId)
        if (!target) return
        if (pkg.getState().activeThreadId !== target) {
          pkg.switchThread(target)
          if (pkg.getState().activeThreadId !== target) return
        }
        pkg.clearActiveThread()
        break
      }
      case 'appendUser': {
        const target = resolvePackageThreadId(pkg, hostThreadId, undefined, true)
        if (!target) return
        pkg.appendUser(action.text, { threadId: target, attachments: action.attachments })
        break
      }
      case 'beginReply': {
        const target = resolvePackageThreadId(pkg, hostThreadId, undefined, true)
        if (!target) return
        pkg.beginReply(target)
        break
      }
      case 'finish': {
        const target = resolvePackageThreadId(pkg, hostThreadId)
        if (!target) return
        pkg.finishTurn(target)
        break
      }
      case 'appendSystem': {
        const target = resolvePackageThreadId(pkg, hostThreadId, undefined, true)
        if (!target) return
        pkg.appendSystem(action.text, target)
        break
      }
      case 'freezeSettled': {
        const target = resolvePackageThreadId(pkg, hostThreadId)
        if (!target) return
        pkg.freezeSettled(target)
        break
      }
      case 'cancelTools': {
        const target = resolvePackageThreadId(pkg, hostThreadId)
        if (!target) return
        pkg.cancelTools(target)
        break
      }
      case 'rollbackFailed': {
        // host keepIds 与包 id 分属不同 id 空间，直接转发会误删包侧回合前消息；
        // 两侧 lockstep 时消息数一致，按前缀长度翻译为包侧 id（等价 host 语义）。
        const target = resolvePackageThreadId(pkg, hostThreadId)
        if (!target) return
        const messages =
          pkg.getState().threads.find((t) => t.id === target)?.feed.messages ?? []
        pkg.rollbackFailedTurn(
          messages.slice(0, action.keepIds.length).map((m) => m.id),
          target,
        )
        break
      }
      case 'resolveProposal': {
        const target = resolvePackageThreadId(pkg, hostThreadId)
        if (!target) return
        pkg.resolveProposal(action.proposalId, action.status, target)
        break
      }
      case 'selectChapterPlan': {
        const target = resolvePackageThreadId(pkg, hostThreadId)
        if (!target) return
        pkg.selectChapterPlan(action.entryId, target)
        break
      }
      case 'attachSnapshot': {
        const target = resolvePackageThreadId(pkg, hostThreadId)
        if (!target) return
        pkg.attachSnapshot(action.content, target)
        break
      }
      case 'deleteThread': {
        const hostId = hostThreadId ?? action.threadId
        const pkgId = resolvePackageThreadId(pkg, hostId)
        if (!pkgId) return
        pkg.deleteThread(pkgId)
        break
      }
      case 'renameThread': {
        const hostId = hostThreadId ?? action.threadId
        const pkgId = resolvePackageThreadId(pkg, hostId)
        if (!pkgId) return
        pkg.renameThread(pkgId, action.title)
        break
      }
      case 'switchWorkspace': {
        // 宿主切工作区先轻冻旧 active 再路由新 active（见 chat-slice switchWorkspace）；
        // 包侧 switchThread 本就轻冻旧线程，此处显式 freezeLight 只是幂等对齐。
        const from = resolvePackageThreadId(pkg, action.fromThreadId)
        if (from) pkg.freezeLight(from)
        pkg.ensureHostThread(action.toThreadId, action.runtimeId, true)
        break
      }
    }
  } catch (error) {
    acpDevLog('chat-store-mirror thread action failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
