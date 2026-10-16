import type {
  AcpMessageAttachment,
  AcpPlanEntry,
  ChatFeedState,
  ChatFeedToolCall,
} from '@montree/chat-core'
import type { AcpConnectionStatus } from '@montree/contracts'

export type { AcpMessageAttachment, AcpPlanEntry, ChatFeedState, ChatFeedToolCall }

/**
 * 聊天线程（S1 纯状态层）：
 * 对齐宿主 `AcpChatThread`（`apps/desktop/src/stores/acp/acp-types.ts`）的最小提炼——
 * 仅保留 id / 运行时归属 / 标题 / feed（messages + turnSettled）。
 * 宿主侧保留：workspaceRoot、agentSessionIds、createdAt/updatedAt、滚动记忆、
 * 回放清洗缓冲、快照旁路队列（均非 feed 归约职责，不进包）。
 */
export interface ChatThread {
  id: string
  /** 宿主线程的稳定身份；随快照保存，重启后无需依赖内存映射。 */
  hostThreadId?: string
  runtimeId: string
  title: string
  feed: ChatFeedState
}

/** 审批选项视图：对齐宿主 `AcpPermissionOptionView`（`lib/agent/acp-permission.ts`） */
export interface ChatPermissionOption {
  optionId: string
  name: string
  kind: string
}

/**
 * 待审批单例：对齐宿主 `AcpPendingPermission`（`stores/acp/acp-types.ts:21-28`）——
 * requestId/sessionId/toolCallId/summary/options/toolCall 全字段照抄。
 */
export interface ChatPendingPermission {
  requestId: number
  sessionId?: string
  toolCallId?: string
  summary: string
  options: ChatPermissionOption[]
  toolCall?: Record<string, unknown>
}

/**
 * 模型配置（S1 新增纯状态，宿主无同名纯态）：
 * 宿主 `setModel` 走 IPC 直写 Agent + `rememberConfigPreference` 落盘偏好；
 * 包内仅记录“当前想要的模型/思考档”，实际下发仍由宿主经 transport 完成。
 */
export interface ChatModelConfig {
  runtimeId: string
  modelId?: string
  thinkingLevel?: string
}

/** 落盘快照：pendingPermission 故意不持久化（同宿主“不持久化”标注） */
export interface ChatSessionSnapshot {
  threads: ChatThread[]
  activeThreadId: string | null
  modelConfig: ChatModelConfig
}

/** 存储端口：宿主实现（localStorage / 文件），包内只调接口 */
export interface ChatStoragePort {
  load(): ChatSessionSnapshot | null | undefined
  save(snapshot: ChatSessionSnapshot): void
}

/**
 * 传输端口（S1 仅定接口，不实现发送）：
 * sendText/cancel/respondPermission 的真实实现由宿主注入（acp-client / IPC）。
 */
export interface ChatTransportPort {
  sendText(threadId: string, text: string): Promise<void>
  cancel(threadId: string): Promise<void>
  respondPermission(requestId: number, optionId: string | null): Promise<void>
  /**
   * 模型配置下发（P3 可选，不改既有语义）：
   * 按线程归属解析 sessionId（active 线程在当前运行时的绑定，无归属回退 live session）
   * 调 `acpApi.setConfigOption`，失败返回 false 不抛；
   * 成功经 `rememberConfigPreference` 记忆偏好并同步 configOptions。
   */
  setModelOption?(configId: string, value: string | boolean): Promise<boolean>
}

export type ChatConnectionStatus = AcpConnectionStatus
