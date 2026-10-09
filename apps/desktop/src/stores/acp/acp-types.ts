import { DEFAULT_ACP_RUNTIME_ID } from '@montree/contracts'
import type {
  AcpConfigOption,
  AcpConnectionStatus,
  AcpPromptCapabilities,
  AppErrorCode,
} from '@montree/contracts'
import type { AcpPermissionOptionView } from '@/lib/agent/acp-permission'
import type { AcpChatMessage, AcpChatRole } from '@/stores/acp-chat-types'
import type { AcpMessageAttachment } from '@/lib/agent/acp-composer'
import type { AcpPreferredConfigMap } from '@/lib/agent/acp-config-preferences'
import type { MarkProposalStatus } from '@montree/annotations'

export type AcpHudDisplayMode = 'docked' | 'floating' | 'capsule'

export const MAX_THREADS = 40
export const MAX_MESSAGES_PER_THREAD = 300

export interface AcpPendingPermission {
  requestId: number
  sessionId?: string
  toolCallId?: string
  summary: string
  options: AcpPermissionOptionView[]
  toolCall?: Record<string, unknown>
}

export interface AcpChatThread {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  workspaceRoot?: string
  /** 所属 Agent 运行时，默认为 DEFAULT_ACP_RUNTIME_ID ('codex-acp') */
  runtimeId?: string
  /**
   * 每个 ACP 运行时最近一次的 sessionId：断开后仍保留，供同运行时重连 resume/load。
   * 按运行时分桶：切换 Agent 不覆盖其他 Agent 的会话 id。
   */
  agentSessionIds?: Record<string, string | null>
  messages: AcpChatMessage[]
}

export interface AcpUiStore {
  panelOpen: boolean
  /** 伴读 HUD 模式：docked=侧栏分栏（HUD 内可选），floating=悬浮伴读小窗（默认），capsule=极简药丸胶囊 */
  hudDisplayMode: AcpHudDisplayMode
  setHudDisplayMode: (mode: AcpHudDisplayMode) => void
  selectedRuntimeId: string
  status: AcpConnectionStatus
  sessionId: string | null
  statusError?: string
  statusErrorCode?: AppErrorCode
  configOptions: AcpConfigOption[]
  prompting: boolean
  /** 当前连接 Agent 的 prompt 能力（不持久化） */
  promptCapabilities: AcpPromptCapabilities
  /**
   * Cursor 横杠 canonical 模型目录（内存态，不持久化）：
   * connect 成功写入，disconnect/切换清空。见 session-slice。
   */
  modelCatalogByRuntime: Record<string, string[]>
  threads: AcpChatThread[]
  activeThreadId: string
  historyOpen: boolean
  /** 各线程聊天滚动记忆（scrollTop + 是否贴底），悬浮/侧栏共用（persist） */
  chatScrollByThread: Record<string, { scrollTop: number; pinned: boolean }>
  /**
   * 各运行时下用户选过的 Mode / Model 等（persist）。
   * 连接后写回 Agent，避免每次重开都回到默认。
   */
  preferredConfigByRuntime: AcpPreferredConfigMap
  /** 当前待用户审批的工具权限（不持久化） */
  pendingPermission: AcpPendingPermission | null
  /** MCP 快照先于对应 tool_call 到达时暂存；仅当前回合有效，不持久化。 */
  pendingMarkProposalSnapshotContents: string[]
  /**
   * cursor load 回放清洗中的跨 chunk 悬垂缓冲（不持久化）：
   * 详见 ChatSlice.pendingReplayUserText。
   */
  pendingReplayUserText: { threadId: string; raw: string } | null
  /** 递增以触发 AgentComposer 聚焦（不持久化） */
  composerFocusNonce: number
  /** 递增以在输入框追加「选区」短标记（不持久化） */
  composerInsertNonce: number
  /**
   * 子会话（制卡/测验）的连接请求信令：nonce，0=无请求（不持久化）。
   * `useAcpSession` 监听并驱动完整 connect（含认证弹窗），子会话只发信号。
   */
  connectRequestedAt: number
  requestConnect: () => void
  /**
   * 子会话（目录/制卡/测验）的运行时切换信令：0=无请求（不持久化）。
   * `useAcpSession` 监听并驱动 switchRuntime。
   */
  runtimeSwitchRequestedAt: number
  requestedRuntimeId: string | null
  requestSwitchRuntime: (runtimeId: string) => void
  setPanelOpen: (open: boolean) => void
  togglePanel: () => void
  /** 面板已打开时聚焦输入框；不会强行打开面板（阅读器划选等场景） */
  requestComposerFocus: () => void
  /** 打开 Agent 面板并聚焦输入框（选区「问 Agent」） */
  openPanelAndFocusComposer: () => void
  /** 打开面板、聚焦，并通知输入框插入选区短标记 */
  insertComposerSelectionMarker: () => void
  setHistoryOpen: (open: boolean) => void
  setSelectedRuntimeId: (id: string) => void
  setStatus: (status: AcpConnectionStatus, errorMessage?: string, errorCode?: AppErrorCode) => void
  setSession: (sessionId: string | null, configOptions?: AcpConfigOption[]) => void
  setConfigOptions: (options: AcpConfigOption[]) => void
  setPromptCapabilities: (caps: AcpPromptCapabilities) => void
  setPrompting: (prompting: boolean) => void
  setModelCatalog: (runtimeId: string, catalog: string[] | null) => void
  rememberConfigPreference: (
    runtimeId: string,
    configId: string,
    value: string | boolean,
  ) => void
  setPendingPermission: (pending: AcpPendingPermission | null) => void
  /** 把 permission 请求里的 toolCall 写入时间线，保证审批卡能挂上工具气泡 */
  ingestPermissionRequest: (pending: AcpPendingPermission) => void
  clearPendingPermission: (requestId?: number) => void
  appendUserMessage: (text: string, attachments?: AcpMessageAttachment[]) => void
  appendSystemMessage: (text: string) => void
  beginAgentReply: () => void
  clearMessages: () => void
  applySessionUpdate: (update: Record<string, unknown>) => void
  finishStreaming: () => void
  /**
   * 定居收尾冻结：与 finishStreaming 同一冻结语义（残留 streaming → false +
   * updatedAt=now，中间态 agent 气泡规整），但不碰 prompting。
   * load 恢复回放场景 prompting 本就 false，prompt 回合仍走 finishStreaming。
   */
  freezeSettledStreaming: () => void
  /** MCP 结果不会回传到 ACP session/update 时，由快照响应直接补到对应工具消息。 */
  attachMarkProposalsFromSnapshot: (content: string) => void
  resolveMarkProposal: (proposalId: string, status: Exclude<MarkProposalStatus, 'pending'>) => void
  selectChapterMarkPlan: (entryId: string) => void
  createThread: (workspaceRoot?: string, runtimeId?: string) => string
  switchThread: (threadId: string) => void
  deleteThread: (threadId: string) => void
  renameThread: (threadId: string, title: string) => void
  setChatScroll: (threadId: string, scroll: { scrollTop: number; pinned: boolean }) => void
}

/**
 * 旧版持久化迁移：`agentSessionId`（单值）→ `agentSessionIds`（按运行时分桶）。
 */
export function migrateLegacyThreadSessions(
  thread: AcpChatThread & { agentSessionId?: unknown },
): AcpChatThread {
  const legacy = thread.agentSessionId
  const runtimeId = thread.runtimeId || DEFAULT_ACP_RUNTIME_ID
  const migrated: AcpChatThread = {
    ...thread,
    runtimeId,
    agentSessionIds:
      thread.agentSessionIds ??
      (typeof legacy === 'string' && legacy.trim()
        ? { [DEFAULT_ACP_RUNTIME_ID]: legacy }
        : {}),
  }
  delete (migrated as unknown as Record<string, unknown>).agentSessionId
  return migrated
}

/** 当前线程在指定运行时下的可恢复 ACP sessionId（未连过该运行时为 null） */
export function threadAgentSessionForRuntime(
  thread: AcpChatThread,
  runtimeId: string,
): string | null {
  return thread.agentSessionIds?.[runtimeId]?.trim() || null
}

/** 当前激活线程在当前运行时下的可恢复 ACP sessionId */
export function selectActiveThreadAgentSessionId(
  state: Pick<AcpUiStore, 'threads' | 'activeThreadId' | 'selectedRuntimeId'>,
): string | undefined {
  const thread = state.threads.find((t) => t.id === state.activeThreadId)
  if (!thread) return undefined
  return threadAgentSessionForRuntime(thread, state.selectedRuntimeId) || undefined
}

/**
 * 当前激活线程是否有本地实质消息（空线程例外用）：
 * 仅系统消息或空白 → false，主进程 load 回放仅监视不限流，由回放重建时间线。
 */
export function selectActiveThreadHasSubstantiveMessages(
  state: Pick<AcpUiStore, 'threads' | 'activeThreadId'>,
): boolean {
  const thread = state.threads.find((t) => t.id === state.activeThreadId)
  if (!thread) return false
  return thread.messages.some((m) => m.role !== 'system')
}

/** 仅获取指定 Agent 运行时名下的会话线程列表（按更新时间降序） */
export function selectThreadsForRuntime(
  threads: AcpChatThread[],
  runtimeId: string,
): AcpChatThread[] {
  return threads
    .filter((t) => (t.runtimeId || DEFAULT_ACP_RUNTIME_ID) === runtimeId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export type {
  AcpChatMessage,
  AcpChatRole,
  AcpConfigOption,
  AcpConnectionStatus,
  AcpPromptCapabilities,
  AppErrorCode,
}
