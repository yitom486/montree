import type { SessionUpdate } from '@agentclientprotocol/sdk'
import {
  mapSessionUpdate,
  STD_SESSION_UPDATE_KIND,
  type StandardSessionUpdateKind,
} from '@yitom/chat-session'
import { flattenToolContent, type AcpPlanEntry, type ChatFeedToolCall } from '@yitom/chat-core'
import { MONTREE_SETTLE_COMPLETE_KIND } from '@yitom/contracts'

/**
 * ACP `session/update` → 宿主分发意图（C1 纯适配层）。
 *
 * 职责边界：只做“协议识别 + 字段归一化”，把线路命名翻译成宿主能直接消费的
 * 干净输入；**不读 store、不写 store、不排序、不碰回放清洗**。
 * 线程归属、回放清洗时序、快照/提议旁路、审批副作用与工作区边界仍归
 * `stores/acp/chat-slice.ts` 与 `lib/agent/*` 的既有宿主流程。
 *
 * 复用：标准成员一律经 `@yitom/chat-session` 的 `mapSessionUpdate`（包内与
 * 本宿主同源的单表 `STD_SESSION_UPDATE_KIND` + SDK 联合穷尽 switch），宿主
 * 不再自建 kind 名单或第二套字段解析。宿主独有语义仍在此显式处理：
 * - `montree_settle_complete`：宿主先落定回放悬垂再冻结，包只产出 finish-turn；
 * - `usage_update`：包明确返回 `[]`（线程级字段非 feed），归一化留在宿主；
 * - `tool_call_content_chunk`：厂商扩展，包额外容忍 snake_case id，宿主保持
 *   camelCase-only 的既有行为（见 `hostToolChunkId`）；
 * - `tool_call`/`tool_call_update` 无 id：包返回 `[]`，宿主仍需消费快照旁路
 *   并按 quiet 收尾，故仍产出 `tool-call` 意图（`call` 缺省）。
 */

/** 线程级 usage 记录（宿主 `AcpChatThread.usage` 的唯一定义处）。 */
export interface AcpThreadUsage {
  used: number
  size: number
  cost?: { amount: number; currency: string } | null
  thinkingTokens?: number | null
}

export type AcpUpdateIgnoreReason =
  | 'malformed'
  | 'config'
  | 'usage-incomplete'
  | 'vendor-tool-chunk-no-id'
  | 'vendor-tool-chunk-empty'
  | 'no-feed-event'

/** 单条 session/update 的归约意图；宿主 switch 后各写各的状态，互不串位。 */
export type AcpUpdateIntent =
  | { type: 'settle-complete' }
  | { type: 'ignored'; reason: AcpUpdateIgnoreReason; unknownKind?: string }
  | { type: 'tool-content-chunk'; toolCallId: string; text: string }
  | { type: 'usage'; usage: AcpThreadUsage }
  | { type: 'tool-call'; call?: ChatFeedToolCall; toolCallId?: string }
  | { type: 'plan'; entries: AcpPlanEntry[]; active: boolean }
  | { type: 'plan-remove' }
  | {
      type: 'text'
      role: 'agent' | 'thought' | 'user'
      text: string
      /** 非表成员的原始 kind（宿主留痕用；表成员恒缺省）。 */
      unknownKind?: string
    }

/**
 * 协议对齐总表（与包内 `STD_SESSION_UPDATE_KIND` 同一张表，宿主不得自建名单）：
 * 官方 SDK `SessionUpdate` 联合类型是唯一真源；下式在 SDK 新增协议成员
 * 而宿主未补分支时编译报错。厂商扩展（定居标记/复数 config/tool 内容分块）
 * 不在 union 内，各自早退，见 `classifyAcpUpdate` 头部。
 */
type VendorHostKind =
  | typeof MONTREE_SETTLE_COMPLETE_KIND
  | 'config_options_update'
  | 'tool_call_content_chunk'
type AssertHostCovered = Exclude<
  SessionUpdate['sessionUpdate'],
  StandardSessionUpdateKind | VendorHostKind
>
const _assertHostCovered: AssertHostCovered extends never ? true : AssertHostCovered = true

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** `tool_call_content_chunk` 的 id 只认 camelCase（保持宿主既有行为）。 */
function hostToolChunkId(update: Record<string, unknown>): string {
  return typeof update.toolCallId === 'string' ? update.toolCallId : ''
}

/**
 * `usage_update` 归一化：used/size 必需（缺一即整条丢弃），cost 需 amount+currency，
 * thinkingTokens 取 `_meta.thinkingTokens`（缺省不写该键）。
 */
export function normalizeUsageUpdate(update: Record<string, unknown>): AcpThreadUsage | undefined {
  const used = finiteNumber(update.used)
  const size = finiteNumber(update.size)
  if (used === undefined || size === undefined) return undefined

  let cost: AcpThreadUsage['cost']
  const rawCost = update.cost
  if (typeof rawCost === 'object' && rawCost !== null && !Array.isArray(rawCost)) {
    const row = rawCost as Record<string, unknown>
    const amount = finiteNumber(row.amount)
    if (amount !== undefined && typeof row.currency === 'string') {
      cost = { amount, currency: row.currency }
    }
  }

  let thinkingTokens: number | undefined
  const rawMeta = update._meta
  if (typeof rawMeta === 'object' && rawMeta !== null && !Array.isArray(rawMeta)) {
    thinkingTokens = finiteNumber((rawMeta as Record<string, unknown>).thinkingTokens)
  }

  return {
    used,
    size,
    ...(cost !== undefined ? { cost } : {}),
    ...(thinkingTokens !== undefined ? { thinkingTokens } : {}),
  }
}

/** 单条 ACP session/update → 一个宿主意图（同一事件只会被应用一次）。 */
export function classifyAcpUpdate(update: unknown): AcpUpdateIntent {
  const row = asRecord(update)
  if (!row) return { type: 'ignored', reason: 'malformed' }
  const kind = typeof row.sessionUpdate === 'string' ? row.sessionUpdate : ''

  // 厂商扩展：主进程定居收尾标记。悬垂落定与冻结由宿主完成，本层只识别。
  if (kind === MONTREE_SETTLE_COMPLETE_KIND) return { type: 'settle-complete' }

  // 模型配置走专有事件/端口，不进 feed（单数与复数两种历史写法）。
  if (kind === STD_SESSION_UPDATE_KIND.configOption || kind === 'config_options_update') {
    return { type: 'ignored', reason: 'config' }
  }

  // 厂商扩展：tool 内容分块（非协议成员）。
  if (kind === 'tool_call_content_chunk') {
    const toolCallId = hostToolChunkId(row)
    if (!toolCallId) return { type: 'ignored', reason: 'vendor-tool-chunk-no-id' }
    const text = flattenToolContent(row.content !== undefined ? [row.content] : row.content)
    if (!text) return { type: 'ignored', reason: 'vendor-tool-chunk-empty' }
    return { type: 'tool-content-chunk', toolCallId, text }
  }

  // usage 是线程级字段而非 feed 事件：包 mapper 明确返回 []，归一化留宿主。
  if (kind === STD_SESSION_UPDATE_KIND.usage) {
    const usage = normalizeUsageUpdate(row)
    return usage
      ? { type: 'usage', usage }
      : { type: 'ignored', reason: 'usage-incomplete' }
  }

  // 工具双拼/内容分块：有 id 走包 mapper 的干净 call；无 id 仍需落意图（快照旁路）。
  if (
    kind === STD_SESSION_UPDATE_KIND.toolCall ||
    kind === STD_SESSION_UPDATE_KIND.toolCallUpdate
  ) {
    // 旧宿主优先采纳字符串 camelCase id，即使为空；包 mapper 则会回退 snake_case。
    // C1 不改变该边界，空 id 仍只触发宿主快照旁路，不能误更新其它工具。
    if (row.toolCallId === '') return { type: 'tool-call' }
    const call = firstToolCall(mapSessionUpdate(row))
    return call ? { type: 'tool-call', call, toolCallId: call.toolCallId } : { type: 'tool-call' }
  }

  let unknownKind: string | undefined
  const event = mapSessionUpdate(row, (unknown) => {
    unknownKind = unknown
  })[0]
  if (!event) {
    return {
      type: 'ignored',
      reason: 'no-feed-event',
      ...(unknownKind !== undefined ? { unknownKind } : {}),
    }
  }

  switch (event.type) {
    case 'text-chunk':
      return {
        type: 'text',
        role: event.role,
        text: event.text,
        ...(unknownKind !== undefined ? { unknownKind } : {}),
      }
    case 'plan':
      return { type: 'plan', entries: event.entries, active: event.active }
    case 'plan-remove':
      return { type: 'plan-remove' }
    case 'tool-call':
      return { type: 'tool-call', call: event.call, toolCallId: event.call.toolCallId }
    // 其余 feed 事件不由 session/update 产出（生命周期/回滚由宿主动作驱动）。
    case 'user-append':
    case 'system-append':
    case 'begin-reply':
    case 'finish-turn':
    case 'freeze-light':
    case 'cancel-tools':
    case 'tool-chunk':
    case 'rollback-turn':
      return { type: 'ignored', reason: 'no-feed-event' }
    default: {
      const _exhaustive: never = event
      return _exhaustive
    }
  }
}

function firstToolCall(events: ReturnType<typeof mapSessionUpdate>): ChatFeedToolCall | undefined {
  for (const event of events) {
    if (event.type === 'tool-call') return event.call
  }
  return undefined
}
