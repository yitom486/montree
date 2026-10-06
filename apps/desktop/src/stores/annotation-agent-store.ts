import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_ACP_RUNTIME_ID } from '@montree/contracts'
import type { AcpChatMessage, AcpChatRole } from '@/stores/acp-chat-types'
import {
  extractTextFromContent,
  flattenToolContent,
  isToolActiveStatus,
} from '@/stores/acp-chat-types'
import { parseAcpPlanEntries, summarizePlanProgress } from '@/lib/agent/acp-plan'
import { enrichAcpToolMessage } from '@/lib/agent/enrich-tool-message'
import { promoteMarkProposalsToLastAgent, resolveMarkProposalOnMessages } from '@/lib/agent/promote-mark-proposals'
import { extractAnnotationDraft } from '@/lib/agent/annotation-note-prompts'
import type { MarkProposalStatus } from '@montree/annotations'

function messageId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export type AnnotationDraftPhase = 'idle' | 'generating' | 'ready' | 'editing'

export interface AnnotationPendingDraft {
  fileKey: string
  excerpt: string
  note: string
  source: 'ai' | 'edit'
  lastIntentLabel?: string
}

export interface AnnotationAgentThread {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** 每个 ACP 运行时最近一次的 sessionId：换 Agent 不冲掉其他 Agent 的会话恢复能力 */
  agentSessionIds?: Record<string, string | null>
  messages: AcpChatMessage[]
}

/** 旧版持久化迁移：单值 agentSessionId → 按运行时分桶（旧数据均为 codex） */
export function migrateLegacyAnnotationThreadSessions(
  thread: AnnotationAgentThread & { agentSessionId?: unknown },
): AnnotationAgentThread {
  if (thread.agentSessionIds) return thread
  const legacy = thread.agentSessionId
  const migrated: AnnotationAgentThread = {
    ...thread,
    agentSessionIds:
      typeof legacy === 'string' && legacy.trim()
        ? { [DEFAULT_ACP_RUNTIME_ID]: legacy }
        : {},
  }
  delete (migrated as unknown as Record<string, unknown>).agentSessionId
  return migrated
}

export interface AnnotationAgentFileState {
  activeThreadId: string
  threads: AnnotationAgentThread[]
}

interface AnnotationAgentStore {
  byFileKey: Record<string, AnnotationAgentFileState>
  /** 当前对话框绑定的书；关闭可为 null */
  activeFileKey: string | null
  pendingDraft: AnnotationPendingDraft | null
  phase: AnnotationDraftPhase
  /** 提议卡应显示在右侧 Agent 还是批注小窗 */
  proposeHost: 'main-agent' | 'annotation' | null
  /** 为 true 时 ACP sessionUpdate 写入本 store，不进正式面板 */
  capturing: boolean
  prompting: boolean
  timelineOpen: boolean
  /** 正式 Agent 经 MCP propose 时弹出独立确认框 */
  externalProposeOpen: boolean
  /**
    * 断开重连后为 true：下次 ensure 时对已保存的 agentSessionIds 做 session/load。
    * 不清空 id（与右侧主会话一样保留，便于 resume）。
    */
  sessionsStale: boolean

  ensureFile: (fileKey: string) => void
  setActiveFileKey: (fileKey: string | null) => void
  createThread: (fileKey: string) => string
  setCapturing: (capturing: boolean) => void
  setPrompting: (prompting: boolean) => void
  setTimelineOpen: (open: boolean) => void
  setExternalProposeOpen: (open: boolean) => void
  setPhase: (phase: AnnotationDraftPhase) => void
  setPendingDraft: (draft: AnnotationPendingDraft | null) => void
  setProposeHost: (host: 'main-agent' | 'annotation' | null) => void
  updatePendingNote: (note: string) => void
  discardDraft: () => void
  appendUserMessage: (text: string) => void
  /** 本地即时气泡（不经 ACP），如追问写法方向 */
  appendAgentMessage: (text: string) => void
  beginAgentReply: () => void
  finishStreaming: () => void
  applySessionUpdate: (update: Record<string, unknown>) => void
  bindSessionId: (sessionId: string | null, runtimeId: string) => void
  markSessionsStale: () => void
  clearSessionsStale: () => void
  /** 测试 / 显式重置用 */
  clearAllAgentSessionIds: () => void
  lastAgentText: () => string
  resolveMarkProposal: (proposalId: string, status: Exclude<MarkProposalStatus, 'pending'>) => void
}

function emptyThread(): AnnotationAgentThread {
  const now = Date.now()
  return {
    id: messageId('ann-thread'),
    title: '批注助手',
    createdAt: now,
    updatedAt: now,
    agentSessionIds: {},
    messages: [],
  }
}

function ensureFileState(
  byFileKey: Record<string, AnnotationAgentFileState>,
  fileKey: string,
): AnnotationAgentFileState {
  const existing = byFileKey[fileKey]
  if (existing && existing.threads.length > 0) return existing
  const thread = emptyThread()
  return { activeThreadId: thread.id, threads: [thread] }
}

function patchActiveThread(
  state: Pick<AnnotationAgentStore, 'byFileKey' | 'activeFileKey'>,
  patch: (thread: AnnotationAgentThread) => AnnotationAgentThread,
): Pick<AnnotationAgentStore, 'byFileKey'> {
  const fileKey = state.activeFileKey
  if (!fileKey) return { byFileKey: state.byFileKey }
  const file = state.byFileKey[fileKey]
  if (!file) return { byFileKey: state.byFileKey }
  const threads = file.threads.map((t) => (t.id === file.activeThreadId ? patch(t) : t))
  return {
    byFileKey: {
      ...state.byFileKey,
      [fileKey]: { ...file, threads },
    },
  }
}

function applyToolCallUpdate(
  messages: AcpChatMessage[],
  update: Record<string, unknown>,
): AcpChatMessage[] {
  const toolCallId = typeof update.toolCallId === 'string' ? update.toolCallId : ''
  if (!toolCallId) return messages
  const next = [...messages]
  const idx = next.findIndex((m) => m.role === 'tool' && m.toolCallId === toolCallId)
  const prev = idx >= 0 ? next[idx] : undefined
  const title = typeof update.title === 'string' ? update.title : (prev?.toolTitle ?? '工具调用')
  const kind = typeof update.kind === 'string' ? update.kind : (prev?.toolKind ?? 'other')
  const status = typeof update.status === 'string' ? update.status : (prev?.toolStatus ?? 'pending')
  const contentText =
    'content' in update
      ? flattenToolContent(update.content)
      : (prev?.toolContentText ?? prev?.text ?? '')
  const active = isToolActiveStatus(status)
  const base: AcpChatMessage = {
    id: prev?.id ?? messageId('tool'),
    role: 'tool',
    toolCallId,
    toolTitle: title,
    toolKind: kind,
    toolStatus: status,
    toolContentText: contentText,
    text: contentText || title,
    createdAt: prev?.createdAt ?? Date.now(),
    streaming: active,
    markProposal: prev?.markProposal,
    markProposalStatus: prev?.markProposalStatus,
  }
  const message = enrichAcpToolMessage(base)
  if (idx < 0) {
    next.push(message)
    return next
  }
  const prevMsg = next[idx]!
  next[idx] = {
    ...message,
    id: prevMsg.id,
    createdAt: prevMsg.createdAt,
    updatedAt: Date.now(),
  }
  return next
}

export const useAnnotationAgentStore = create<AnnotationAgentStore>()(
  persist(
    (set, get) => ({
      byFileKey: {},
      activeFileKey: null,
      pendingDraft: null,
      phase: 'idle',
      proposeHost: null,
      capturing: false,
      prompting: false,
      timelineOpen: false,
      externalProposeOpen: false,
      sessionsStale: false,

      ensureFile: (fileKey) =>
        set((s) => {
          const file = ensureFileState(s.byFileKey, fileKey)
          return {
            activeFileKey: fileKey,
            byFileKey: { ...s.byFileKey, [fileKey]: file },
          }
        }),

      setActiveFileKey: (fileKey) => set({ activeFileKey: fileKey }),

      createThread: (fileKey) => {
        const thread = emptyThread()
        set((s) => {
          const prev = ensureFileState(s.byFileKey, fileKey)
          return {
            activeFileKey: fileKey,
            byFileKey: {
              ...s.byFileKey,
              [fileKey]: {
                activeThreadId: thread.id,
                threads: [thread, ...prev.threads].slice(0, 8),
              },
            },
            pendingDraft: null,
            phase: 'idle',
            externalProposeOpen: false,
            proposeHost: null,
          }
        })
        return thread.id
      },

      setCapturing: (capturing) => set({ capturing }),
      setPrompting: (prompting) => set({ prompting }),
      setTimelineOpen: (open) => set({ timelineOpen: open }),
      setExternalProposeOpen: (open) => set({ externalProposeOpen: open }),
      setPhase: (phase) => set({ phase }),
      setPendingDraft: (draft) => set({ pendingDraft: draft }),
      setProposeHost: (host) => set({ proposeHost: host }),
      updatePendingNote: (note) =>
        set((s) =>
          s.pendingDraft
            ? {
                pendingDraft: { ...s.pendingDraft, note, source: 'edit' },
                phase: 'editing',
              }
            : s,
        ),

      discardDraft: () =>
        set({ pendingDraft: null, phase: 'idle', externalProposeOpen: false, proposeHost: null }),

      appendUserMessage: (text) =>
        set((s) =>
          patchActiveThread(s, (t) => ({
            ...t,
            messages: [
              ...t.messages,
              { id: messageId('user'), role: 'user', text, createdAt: Date.now() },
            ],
            updatedAt: Date.now(),
          })),
        ),

      appendAgentMessage: (text) =>
        set((s) =>
          patchActiveThread(s, (t) => ({
            ...t,
            messages: [
              ...t.messages,
              {
                id: messageId('agent'),
                role: 'agent',
                text,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                streaming: false,
              },
            ],
            updatedAt: Date.now(),
          })),
        ),

      beginAgentReply: () =>
        set((s) =>
          patchActiveThread(s, (t) => {
            const last = t.messages[t.messages.length - 1]
            if (last?.role === 'agent' && last.streaming) return t
            return {
              ...t,
              messages: [
                ...t.messages,
                {
                  id: messageId('agent'),
                  role: 'agent',
                  text: '',
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                  streaming: true,
                },
              ],
              updatedAt: Date.now(),
            }
          }),
        ),

      finishStreaming: () =>
        set((s) => {
          const patched = patchActiveThread(s, (t) => {
            const now = Date.now()
            const frozen = t.messages.map((m) => {
              if (!m.streaming) return m
              if (m.role === 'tool' && isToolActiveStatus(m.toolStatus)) {
                return enrichAcpToolMessage({
                  ...m,
                  streaming: false,
                  updatedAt: now,
                  toolStatus: m.toolStatus === 'pending' ? 'cancelled' : 'completed',
                })
              }
              return { ...m, streaming: false, updatedAt: now }
            })
            return {
              ...t,
              updatedAt: now,
              messages: promoteMarkProposalsToLastAgent(
                frozen.map((m) => (m.role === 'tool' ? enrichAcpToolMessage(m) : m)),
              ),
            }
          })
          return { prompting: false, ...patched }
        }),

      bindSessionId: (sessionId, runtimeId) => {
        return set((s) =>
          patchActiveThread(s, (t) => ({
            ...t,
            agentSessionIds: { ...(t.agentSessionIds ?? {}), [runtimeId]: sessionId },
            updatedAt: Date.now(),
          })),
        )
      },

      markSessionsStale: () =>
        set({ sessionsStale: true, capturing: false, prompting: false }),

      clearSessionsStale: () => set({ sessionsStale: false }),

      clearAllAgentSessionIds: () =>
        set((s) => {
          const byFileKey: Record<string, AnnotationAgentFileState> = {}
          for (const [key, file] of Object.entries(s.byFileKey)) {
            byFileKey[key] = {
              ...file,
              threads: file.threads.map((t) => ({
                ...t,
                agentSessionIds: {},
              })),
            }
          }
          return { byFileKey, capturing: false, prompting: false, sessionsStale: false }
        }),

      applySessionUpdate: (update) => {
        const kind =
          typeof update.sessionUpdate === 'string' ? update.sessionUpdate : ''

        if (kind === 'config_option_update' || kind === 'config_options_update') {
          return
        }

        if (kind === 'plan' || kind === 'plan_update') {
          const entries = parseAcpPlanEntries(update)
          const summary = summarizePlanProgress(entries)
          set((s) =>
            patchActiveThread(s, (t) => {
              const messages = [...t.messages]
              const idx = messages.findIndex((m) => m.role === 'plan')
              const prev = idx >= 0 ? messages[idx] : undefined
              const next: AcpChatMessage = {
                id: prev?.id ?? messageId('plan'),
                role: 'plan',
                text: entries.map((e) => e.content).join('\n'),
                planEntries: entries,
                createdAt: prev?.createdAt ?? Date.now(),
                updatedAt: Date.now(),
                streaming: summary.active,
              }
              if (idx >= 0) messages[idx] = next
              else messages.push(next)
              return { ...t, messages, updatedAt: Date.now() }
            }),
          )
          return
        }

        if (kind === 'tool_call' || kind === 'tool_call_update') {
          set((s) =>
            patchActiveThread(s, (t) => ({
              ...t,
              messages: applyToolCallUpdate(t.messages, update),
              updatedAt: Date.now(),
            })),
          )
          return
        }

        if (kind === 'tool_call_content_chunk') {
          const toolCallId =
            typeof update.toolCallId === 'string' ? update.toolCallId : ''
          if (!toolCallId) return
          const chunkText = flattenToolContent(
            update.content !== undefined ? [update.content] : update.content,
          )
          if (!chunkText) return
          set((s) =>
            patchActiveThread(s, (t) => {
              const messages = applyToolCallUpdate(t.messages, {
                toolCallId,
                title: '工具调用',
                kind: 'other',
                status: 'in_progress',
                content: chunkText,
              })
              return { ...t, messages, updatedAt: Date.now() }
            }),
          )
          return
        }

        const text = extractTextFromContent(update.content)
        if (
          !text &&
          kind !== 'agent_message_chunk' &&
          kind !== 'agent_thought_chunk' &&
          kind !== 'user_message_chunk'
        ) {
          return
        }
        if (!text) return

        const role: AcpChatRole =
          kind === 'agent_thought_chunk'
            ? 'thought'
            : kind === 'user_message_chunk'
              ? 'user'
              : 'agent'

        set((s) =>
          patchActiveThread(s, (t) => {
            const messages = [...t.messages]
            const last = messages[messages.length - 1]
            if (last && last.role === role && last.streaming) {
              messages[messages.length - 1] = {
                ...last,
                text: last.text + text,
                updatedAt: Date.now(),
              }
              return { ...t, messages, updatedAt: Date.now() }
            }
            const emptyAgentIdx = messages.findIndex(
              (m) => m.role === 'agent' && m.streaming && !m.text.trim(),
            )
            if (role === 'agent' && emptyAgentIdx >= 0) {
              messages[emptyAgentIdx] = {
                ...messages[emptyAgentIdx]!,
                text,
                updatedAt: Date.now(),
                streaming: true,
              }
              return { ...t, messages, updatedAt: Date.now() }
            }
            messages.push({
              id: messageId(role),
              role,
              text,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              streaming: true,
            })
            return { ...t, messages, updatedAt: Date.now() }
          }),
        )
      },

      lastAgentText: () => {
        const s = get()
        const fileKey = s.activeFileKey
        if (!fileKey) return ''
        const file = s.byFileKey[fileKey]
        if (!file) return ''
        const thread = file.threads.find((t) => t.id === file.activeThreadId)
        if (!thread) return ''
        for (let i = thread.messages.length - 1; i >= 0; i -= 1) {
          const message = thread.messages[i]!
          if (message.role === 'agent' && message.text.trim()) {
            return extractAnnotationDraft(message.text)
          }
        }
        return ''
      },

      resolveMarkProposal: (proposalId, status) =>
        set((s) =>
          patchActiveThread(s, (t) => ({
            ...t,
            messages: resolveMarkProposalOnMessages(t.messages, proposalId, status),
            updatedAt: Date.now(),
          })),
        ),
    }),
    {
      name: 'montree-annotation-agent',
      partialize: (s) => ({
        byFileKey: s.byFileKey,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as { byFileKey?: Record<string, AnnotationAgentFileState> }
        const byFileKey: Record<string, AnnotationAgentFileState> = {}
        for (const [key, file] of Object.entries(p.byFileKey ?? current.byFileKey)) {
          byFileKey[key] = {
            ...file,
            threads: file.threads.map(migrateLegacyAnnotationThreadSessions),
          }
        }
        return { ...current, byFileKey }
      },
    },
  ),
)

export function annotationFileKey(fileFingerprint: string, filePath: string): string {
  const fingerprint = fileFingerprint.trim()
  if (fingerprint) return `fp:${fingerprint}`
  return `path:${filePath}`
}

export function selectAnnotationActiveMessages(state: AnnotationAgentStore): AcpChatMessage[] {
  const fileKey = state.activeFileKey
  if (!fileKey) return []
  const file = state.byFileKey[fileKey]
  if (!file) return []
  return file.threads.find((t) => t.id === file.activeThreadId)?.messages ?? []
}

/** 任意批注线程是否绑定了该 ACP sessionId（用于分流 sessionUpdate） */
export function annotationOwnsSessionId(
  state: Pick<AnnotationAgentStore, 'byFileKey'>,
  sessionId: string,
): boolean {
  const id = sessionId.trim()
  if (!id) return false
  for (const file of Object.values(state.byFileKey)) {
    for (const thread of file.threads) {
      for (const bound of Object.values(thread.agentSessionIds ?? {})) {
        if (bound === id) return true
      }
    }
  }
  return false
}
