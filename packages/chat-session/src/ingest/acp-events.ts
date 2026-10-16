import {
  extractTextFromContent,
  flattenToolContent,
  parseToolDiffs,
  parseToolLocations,
  toolUpdateContentText,
  parseToolCallMetadata,
  parseAcpPlanEntries,
  summarizePlanProgress,
  type ChatFeedEvent,
  type ChatFeedToolCall,
} from '@montree/chat-core'
import { MONTREE_SETTLE_COMPLETE_KIND } from '@montree/contracts'
import type {
  ChatConnectionStatus,
  ChatPendingPermission,
} from '../session/types'

/**
 * acp-client 事件 → core `ChatFeedEvent` 归一化（S1 纯函数，无 store/API）。
 *
 * 逐字对齐宿主 `applySessionUpdate`（`apps/desktop/src/stores/acp/chat-slice.ts:545-726`）：
 * 宿主负责的部分（回放清洗/合并器保序/快照旁路队列/单例审批 ingest/隔离过滤/
 * 连接状态机）仍留宿主，本模块只做“ACP 线路命名 → 干净 feed 事件”翻译。
 *
 * 类型说明：输入一律 `unknown`（包与 acp-client 零耦合，不 import 其类型；
 * 载荷形状对照 `@yitom/acp-client` contracts `AcpSessionUpdateEvent.update` /
 * `AcpPermissionRequestEvent` / `AcpConnectionStatus`，只取形状不取类型）。
 */

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** 对齐宿主 `toolCallIdFromUpdate`（`chat-slice.ts:57-63`）：`toolCallId|tool_call_id` 双拼 */
function toolCallIdFromUpdate(update: Record<string, unknown>): string | undefined {
  const a = asString(update.toolCallId)
  if (a) return a
  const b = asString(update.tool_call_id)
  if (b) return b
  return undefined
}

/** 对齐宿主 `buildToolFeedCall`（`chat-slice.ts:65-77`） */
function buildToolFeedCall(update: Record<string, unknown>): ChatFeedToolCall | undefined {
  const toolCallId = toolCallIdFromUpdate(update)
  if (!toolCallId) return undefined
  const call: ChatFeedToolCall = { toolCallId }
  Object.assign(call, parseToolCallMetadata(update))
  const title = asString(update.title)
  if (title !== undefined) call.title = title
  const kind = asString(update.kind)
  if (kind !== undefined) call.kind = kind
  const status = asString(update.status)
  if (status !== undefined) call.status = status
  const contentText = toolUpdateContentText(update)
  if (contentText !== undefined) call.contentText = contentText
  if ('content' in update) call.diffs = parseToolDiffs(update.content)
  if ('locations' in update) call.locations = parseToolLocations(update.locations)
  return call
}

/**
 * `sessionUpdate` → `ChatFeedEvent[]`：
 * - 文本三 chunk 经 core `extractTextFromContent`；空文本 → `[]`；
 * - tool 双拼经 `toolCallIdFromUpdate`，content/diff/locations 走 core 解析函数；
 * - plan 走 core `parseAcpPlanEntries/summarizePlanProgress`；
 * - `config_option_update` → `[]`（模型配置走专有事件/端口，不进 feed）；
 * - `montree_settle_complete` → `[{type:'finish-turn'}]`
 *   （字面量来源 `packages/contracts/src/types/acp.ts` 的 `MONTREE_SETTLE_COMPLETE_KIND`）；
 * - 未知种类：有文本按宿主默认走 agent chunk，无文本 → `[]`；
 *   两种都经 `onUnknownKind` 上报（缺省静默），便于新协议能力留痕，纯函数本身不记日志。
 */
export function mapSessionUpdate(update: unknown, onUnknownKind?: (kind: string) => void): ChatFeedEvent[] {
  const row = asRecord(update)
  if (!row) return []
  const kind = asString(row.sessionUpdate) ?? ''
  if (
    kind !== MONTREE_SETTLE_COMPLETE_KIND &&
    kind !== 'config_option_update' && kind !== 'config_options_update' &&
    kind !== 'plan' && kind !== 'plan_update' &&
    kind !== 'tool_call' && kind !== 'tool_call_update' &&
    kind !== 'tool_call_content_chunk' &&
    kind !== 'agent_message_chunk' && kind !== 'agent_thought_chunk' && kind !== 'user_message_chunk'
  ) {
    onUnknownKind?.(kind)
  }

  // 主进程定居收尾标记（宿主 `chat-slice.ts:549-564` 先落悬垂再 `freezeSettledStreaming`；
  // 悬垂落定留宿主，本映射只产出收尾事件）。
  // 字面量来源：packages/contracts/src/types/acp.ts `MONTREE_SETTLE_COMPLETE_KIND`。
  if (kind === MONTREE_SETTLE_COMPLETE_KIND) {
    return [{ type: 'finish-turn' }]
  }

  if (kind === 'config_option_update' || kind === 'config_options_update') {
    return []
  }

  if (kind === 'plan' || kind === 'plan_update') {
    const entries = parseAcpPlanEntries(row)
    const summary = summarizePlanProgress(entries)
    return [{ type: 'plan', entries, active: summary.active }]
  }

  if (kind === 'tool_call' || kind === 'tool_call_update') {
    const call = buildToolFeedCall(row)
    if (!call) return []
    return [{ type: 'tool-call', call }]
  }

  if (kind === 'tool_call_content_chunk') {
    const toolCallId = toolCallIdFromUpdate(row) ?? asString(row.toolCallId) ?? ''
    if (!toolCallId) return []
    // 对齐宿主 `chat-slice.ts:649-651`：`flattenToolContent([content])` 包一层再压平
    const chunkText = flattenToolContent(row.content !== undefined ? [row.content] : row.content)
    if (!chunkText) return []
    return [{ type: 'tool-chunk', toolCallId, text: chunkText }]
  }

  const text = extractTextFromContent(row.content)
  if (!text) return []
  const role =
    kind === 'agent_thought_chunk' ? ('thought' as const)
    : kind === 'user_message_chunk' ? ('user' as const)
    : ('agent' as const)
  return [{ type: 'text-chunk', role, text }]
}

/** 对齐宿主 `toolCallIdFromPermission`（`lib/agent/acp-permission.ts:71-79`）：三兼容 */
function toolCallIdFromPermissionCompat(toolCall: Record<string, unknown> | undefined): string | undefined {
  if (!toolCall) return undefined
  const a = asString(toolCall.toolCallId)
  if (a) return a
  const b = asString(toolCall.tool_call_id)
  if (b) return b
  const c = asString(toolCall.id)
  if (c) return c
  return undefined
}

/** 对齐宿主 `permissionSummaryFromToolCall`（`acp-permission.ts:61-69`） */
function permissionSummaryFromToolCallCompat(
  toolCall: Record<string, unknown> | undefined,
  fallback = 'Agent 请求执行工具',
): string {
  if (!toolCall) return fallback
  const title = asString(toolCall.title)
  if (title?.trim()) return title
  const name = asString(toolCall.name)
  if (name?.trim()) return name
  return fallback
}

/** 对齐宿主 `parsePermissionOptions`（`acp-permission.ts:9-32`）：`optionId/id` + `name/title` 双兼容 */
function parsePermissionOptionsCompat(raw: unknown): ChatPendingPermission['options'] {
  if (!Array.isArray(raw)) return []
  const out: ChatPendingPermission['options'] = []
  for (const item of raw) {
    const row = asRecord(item)
    if (!row) continue
    const optionId = asString(row.optionId) ?? asString(row.id) ?? ''
    if (!optionId) continue
    const kind = asString(row.kind) ?? ''
    const name = asString(row.name) ?? asString(row.title) ?? optionId
    out.push({ optionId, name, kind })
  }
  return out
}

/**
 * 审批请求 → `{ permission, toolCall }`（对照宿主 `permission-slice.ts:34-52`）：
 * - `permission` 为单例槽内容（含 `toolCallId/tool_call_id/id` 三兼容 id）；
 * - `toolCall` 为落时间线的干净调用（title 回退 summary、kind 回退 other、
 *   status 回退 pending；content/locations 透传；无 id 时调用方经 feed `tool-call`
 *   事件写入即 no-op，对齐宿主“无 id 不写时间线”）。
 */
export function mapPermissionRequest(req: unknown): {
  permission: ChatPendingPermission
  toolCall: ChatFeedToolCall
} {
  const row = asRecord(req) ?? {}
  const requestId = typeof row.requestId === 'number' ? row.requestId : 0
  const sessionId = asString(row.sessionId)
  const toolCallRaw = asRecord(row.toolCall)
  const toolCallId = asString(row.toolCallId) ?? toolCallIdFromPermissionCompat(toolCallRaw)
  const rawSummary = asString(row.summary)
  const summary =
    rawSummary && rawSummary.trim() ? rawSummary : permissionSummaryFromToolCallCompat(toolCallRaw)
  const options = parsePermissionOptionsCompat(row.options)
  const permission: ChatPendingPermission = {
    requestId,
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(toolCallId !== undefined ? { toolCallId } : {}),
    summary,
    options,
    ...(toolCallRaw !== undefined ? { toolCall: toolCallRaw } : {}),
  }
  const toolCall: ChatFeedToolCall = {
    toolCallId: toolCallId ?? '',
    ...parseToolCallMetadata(toolCallRaw ?? {}),
    title: toolCallRaw != null && typeof toolCallRaw.title === 'string' ? toolCallRaw.title : summary,
    kind: toolCallRaw != null && typeof toolCallRaw.kind === 'string' ? toolCallRaw.kind : 'other',
    status:
      toolCallRaw != null && typeof toolCallRaw.status === 'string' ? toolCallRaw.status : 'pending',
  }
  if (toolCallRaw != null && 'content' in toolCallRaw) toolCall.contentText = toolUpdateContentText(toolCallRaw)
  if (toolCallRaw != null && 'locations' in toolCallRaw) {
    toolCall.locations = parseToolLocations(toolCallRaw.locations)
  }
  return { permission, toolCall }
}

const KNOWN_CONNECTION_STATUSES = new Set([
  'connected',
  'connecting',
  'awaiting_auth',
  'disconnected',
  'error',
])

/**
 * 连接状态归一化（对照 acp-client contracts `AcpConnectionStatus` 五值）：
 * 已知值透传，未知 → `'disconnected'`（安全默认：不断言在线）。
 * 规则：`disconnected`/`error` 清 pending——由 store `setConnectionStatus`
 * 执行（对齐宿主 `session-slice.ts:135-145`），本函数只做映射。
 */
export function mapConnectionStatus(status: unknown): ChatConnectionStatus {
  if (typeof status === 'string' && KNOWN_CONNECTION_STATUSES.has(status)) {
    return status as ChatConnectionStatus
  }
  return 'disconnected'
}
