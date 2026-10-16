import {
  mapConnectionStatus,
  mapPermissionRequest,
  mapSessionUpdate,
  type ChatSessionStore,
} from '@montree/chat-session'
import type { MarkProposalStatus } from '@montree/annotations'
import { acpDevLog } from '@/lib/agent/acp-dev-log'

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
          pkg.appendUser(event.text, { threadId: target })
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
 * P4b 线程生命周期镜像动作（包 store 否则是空壳：流式增量有 P4a 喂，
 * 但建/切/清/收尾没人调包 store，包侧 active 永远对不上宿主）。
 *
 * - `create`：调包 `newThread(runtimeId)`；宿主与包两侧 id 生成器各自随机，
 *   id 必然分叉，故本模块记 `hostThreadId -> pkgThreadId` 映射，后续 `switch`
 *   按映射翻译；无映射（P4b 前存量线程）回落原文 id，包侧未知即 no-op。
 * - `switch`：经映射调包 `switchThread`。
 * - `clear`：调包 `clearActiveThread`（线程保留只清 feed，对齐宿主“线程保留”部分；
 *   已知差：宿主另把 title 重置为新对话，包侧 title 不动，归一化比对时忽略 title）。
 * - `appendUser`：调包 `appendUser(text)`（active 线程；附件不进镜像，见下）。
 * - `beginReply`：调包 `beginReply()`（active 线程）。
 * - `finish`：调包 `finishTurn()`（prompt 成功语义，无 fallback；对齐宿主
 *   `finishStreaming` 的冻结部分，`prompting` 置 false 留宿主，P4c 才换动作）。
 *
 * 只做纯转发：不读宿主 store、不调 acpApi、不碰 UI；任一调用抛错内部吞掉并记
 * 一行诊断日志，镜像永不阻断主链路（复用 P4a 同一吞错模式）。
 *
 * P4b 扩展（同上只加法）：
 * - `appendSystem/freezeSettled/cancelTools`：直转包同名方法（active 线程）。
 * - `rollbackFailed`：host keepIds 跨 id 空间不可直转，按 lockstep 前缀长度
 *   翻译为包侧 id 再调包 `rollbackFailedTurn`。
 * - `resolveProposal/selectChapterPlan/attachSnapshot`：直转包同名方法
 *  （提议/章计划 id 与快照内容两侧一致，无需翻译）。
 * - `deleteThread/renameThread`：host id 经映射译包 id（无映射回落原文，
 *   包侧未知即 no-op）；删除后清映射。
 * - `switchWorkspace`：先对旧线程 id 调包 `freezeLight`，再按映射路由
 *   `switch`；目标无映射（宿主新建专属线程）则同建并记映射。
 */
export type ThreadMirrorAction =
  | { kind: 'create'; threadId?: string; runtimeId?: string }
  | { kind: 'switch'; threadId: string }
  | { kind: 'clear' }
  | { kind: 'appendUser'; text: string }
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

/** 宿主线程 id → 包镜像线程 id（两侧生成器独立，id 分叉是常态；按包 store 隔离，单例自动镜像与单测自备实例互不污染）。 */
const hostMapsByPackage = new WeakMap<ChatSessionStore, Map<string, string>>()
const allHostMaps = new Set<Map<string, string>>()

function hostMapFor(pkg: ChatSessionStore): Map<string, string> {
  let m = hostMapsByPackage.get(pkg)
  if (!m) {
    m = new Map<string, string>()
    hostMapsByPackage.set(pkg, m)
    allHostMaps.add(m)
  }
  return m
}

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
    const hostMap = hostMapFor(pkg)
    const mapped = hostMap.get(hostThreadId)
    if (mapped && state.threads.some((t) => t.id === mapped)) return mapped
    if (state.threads.some((t) => t.id === hostThreadId)) {
      hostMap.set(hostThreadId, hostThreadId)
      return hostThreadId
    }
    if (!provision) return undefined
    const created = pkg.newThread(runtimeId)
    hostMap.set(hostThreadId, created)
    return created
  }
  return state.activeThreadId ?? undefined
}

/** 仅单测用：清掉线程 id 映射（包 store 本体由调用方自备 fresh 实例）。 */
export function resetThreadMirrorForTests(): void {
  for (const m of allHostMaps) m.clear()
}

export function mirrorThreadActionToPackageStore(
  pkg: ChatSessionStore,
  action: ThreadMirrorAction,
  hostThreadId?: string,
): void {
  try {
    switch (action.kind) {
      case 'create': {
        const hostMap = hostMapFor(pkg)
        const packageThreadId = pkg.newThread(action.runtimeId)
        if (action.threadId) hostMap.set(action.threadId, packageThreadId)
        // 宿主修剪空白草稿/40 上限会丢线程，映射同步收敛防无限增长
        if (hostMap.size > 80) {
          const alive = new Set(pkg.getState().threads.map((t) => t.id))
          for (const [hostId, pkgId] of hostMap) {
            if (!alive.has(pkgId)) hostMap.delete(hostId)
          }
        }
        break
      }
      case 'switch': {
        pkg.switchThread(hostMapFor(pkg).get(action.threadId) ?? action.threadId)
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
        pkg.appendUser(action.text, { threadId: target })
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
        const hostMap = hostMapFor(pkg)
        hostMap.delete(action.threadId)
        if (hostThreadId && hostThreadId !== action.threadId) {
          hostMap.delete(hostThreadId)
        }
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
        const hostMap = hostMapFor(pkg)
        pkg.freezeLight(hostMap.get(action.fromThreadId) ?? action.fromThreadId)
        const mapped = hostMap.get(action.toThreadId)
        const alive = new Set(pkg.getState().threads.map((t) => t.id))
        if (mapped && alive.has(mapped)) {
          pkg.switchThread(mapped)
        } else if (alive.has(action.toThreadId)) {
          pkg.switchThread(action.toThreadId)
        } else {
          // 目标为宿主新建专属线程：包侧同建并记映射（同 create 分支）。
          const packageThreadId = pkg.newThread(action.runtimeId)
          hostMap.set(action.toThreadId, packageThreadId)
          if (hostMap.size > 80) {
            const alive = new Set(pkg.getState().threads.map((t) => t.id))
            for (const [hostId, pkgId] of hostMap) {
              if (!alive.has(pkgId)) hostMap.delete(hostId)
            }
          }
        }
        break
      }
    }
  } catch (error) {
    acpDevLog('chat-store-mirror thread action failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
