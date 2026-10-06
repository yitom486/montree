import { useCallback, useState } from 'react'
import { isOk } from '@montree/contracts'
import { acpApi } from '@/api/acp-api'
import { buildMontreePromptPrefix } from '@/lib/agent/context/build-prompt-prefix'
import {
  markSessionBootstrapSent,
  shouldSendSessionBootstrap,
} from '@/lib/agent/context/session-bootstrap'
import { proposeMarkForAgent } from '@/lib/agent/context/propose-mark'
import {
  ANNOTATION_DIRECTION_ASK,
  buildAnnotationChatPrompt,
  buildAnnotationComposePrompt,
  buildAnnotationPolishPrompt,
  buildAnnotationRefinePrompt,
  detectAnnotationWriteIntent,
  extractAnnotationDraft,
  type AnnotationIntentId,
  type AnnotationRefineId,
} from '@/lib/agent/annotation-note-prompts'
import { listPreferredConfigPatches } from '@/lib/agent/acp-config-preferences'
import { reportAppError } from '@/lib/workspace/report-error'
import {
  annotationFileKey,
  useAnnotationAgentStore,
} from '@/stores/annotation-agent-store'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { toast } from 'sonner'

function resolvePreferredAgentCwd(): string | undefined {
  const s = useAcpUiStore.getState()
  const active = s.threads.find((t) => t.id === s.activeThreadId)
  const fromActive = active?.workspaceRoot?.trim()
  if (fromActive) return fromActive
  for (const thread of s.threads) {
    const root = thread.workspaceRoot?.trim()
    if (root) return root
  }
  return undefined
}

function activeAnnotationAgentSessionId(fileKey: string): string | null {
  const s = useAnnotationAgentStore.getState()
  const file = s.byFileKey[fileKey]
  if (!file) return null
  const thread = file.threads.find((t) => t.id === file.activeThreadId)
  // 按当前运行时取：换 Agent 后旧运行时的 session 不参与 resume/load
  const runtimeId = useAcpUiStore.getState().selectedRuntimeId
  return thread?.agentSessionIds?.[runtimeId]?.trim() || null
}

/**
 * 批注助手：独立 ACP session（与右侧 Agent 时间线 / 记忆隔离）。
 * 仅复用同一 Agent 进程连接；会话、历史互不互通。
 */
export function useAnnotationAgentAssist(options: {
  filePath: string
  fileFingerprint: string
  excerpt: string
}) {
  const status = useAcpUiStore((s) => s.status)
  const annotationPrompting = useAnnotationAgentStore((s) => s.prompting)
  const mainPrompting = useAcpUiStore((s) => s.prompting)
  const phase = useAnnotationAgentStore((s) => s.phase)
  const pendingDraft = useAnnotationAgentStore((s) => s.pendingDraft)
  const timelineOpen = useAnnotationAgentStore((s) => s.timelineOpen)
  const [composeHint, setComposeHint] = useState(false)
  const [awaitingDirection, setAwaitingDirection] = useState(false)

  const fileKey = annotationFileKey(options.fileFingerprint, options.filePath)
  /** 只需 Agent 进程已连接；不必占用右侧主 session */
  const agentReady = status === 'connected'
  const busy = annotationPrompting || mainPrompting

  const prepare = useCallback(() => {
    useAnnotationAgentStore.getState().ensureFile(fileKey)
    useAnnotationAgentStore.getState().setTimelineOpen(true)
  }, [fileKey])

  /** 为当前书的当前批注线程拿到专属 sessionId（resume/load 优先，否则 session/new） */
  const ensureAnnotationSession = useCallback(async (): Promise<string | null> => {
    prepare()
    if (useAcpUiStore.getState().status !== 'connected') {
      toast.message('请先连接 AI')
      return null
    }

    const store = useAnnotationAgentStore.getState()
    const existing = activeAnnotationAgentSessionId(fileKey)
    const stale = store.sessionsStale

    // 同一次连接内、未标记过期：直接复用（模型侧仍是同一条 session）
    if (existing && !stale) return existing

    const cwd = resolvePreferredAgentCwd()

    // 重连后：用 session/load 恢复模型记忆（ACP 无独立短期记忆，靠 session 续上）
    // bind 一律按当前运行时记账：换 Agent 后旧运行时的 session 不参与恢复
    const runtimeId = useAcpUiStore.getState().selectedRuntimeId
    if (existing && stale) {
      const loaded = await acpApi.loadSession({
        sessionId: existing,
        cwd,
        secondary: true,
      })
      if (isOk(loaded)) {
        useAnnotationAgentStore
          .getState()
          .bindSessionId(loaded.value.sessionId, runtimeId)
        useAnnotationAgentStore.getState().clearSessionsStale()
        return loaded.value.sessionId
      }
      // load 失败（Agent 不支持或 session 已失效）→ 新建，本地气泡仍保留
      useAnnotationAgentStore.getState().bindSessionId(null, runtimeId)
    }

    const created = await acpApi.sessionNew({ cwd })
    if (!isOk(created)) {
      reportAppError(created.error)
      return null
    }

    useAnnotationAgentStore
      .getState()
      .bindSessionId(created.value.sessionId, runtimeId)
    useAnnotationAgentStore.getState().clearSessionsStale()

    const preferred =
      useAcpUiStore.getState().preferredConfigByRuntime[runtimeId] ?? undefined
    const patches = listPreferredConfigPatches(
      created.value.configOptions ?? [],
      preferred,
    )
    for (const patch of patches) {
      await acpApi.setConfigOption({
        sessionId: created.value.sessionId,
        configId: patch.configId,
        value: patch.value,
      })
    }

    return created.value.sessionId
  }, [fileKey, prepare])

  const runPrompt = useCallback(
    async (
      displayText: string,
      promptText: string,
      mode: 'chat' | 'compose' | 'refine',
    ) => {
      prepare()
      const store = useAnnotationAgentStore.getState()
      if (store.prompting) return false
      if (useAcpUiStore.getState().prompting) {
        toast.message('右侧 AI 忙碌中，请稍后再试批注助手')
        return false
      }

      const sid = await ensureAnnotationSession()
      if (!sid) return false

      store.setCapturing(true)
      store.setPrompting(true)
      if (mode === 'compose' || mode === 'refine') store.setPhase('generating')
      store.appendUserMessage(displayText)
      store.beginAgentReply()

      const includeBootstrap = shouldSendSessionBootstrap(sid)
      const prefix = buildMontreePromptPrefix(`annotation:${fileKey}`, { includeBootstrap })
      const result = await acpApi.prompt({
        sessionId: sid,
        prompt: [...prefix, { type: 'text', text: promptText }],
      })
      if (isOk(result) && includeBootstrap) {
        markSessionBootstrapSent(sid)
      }

      store.finishStreaming()
      store.setCapturing(false)

      if (!isOk(result)) {
        // 会话可能已失效：清绑定，下次重建
        if (
          result.error.code === 'ACP_PROTOCOL_ERROR' ||
          result.error.code === 'ACP_NOT_CONNECTED'
        ) {
          useAnnotationAgentStore
            .getState()
            .bindSessionId(null, useAcpUiStore.getState().selectedRuntimeId)
        }
        reportAppError(result.error)
        store.setPhase(store.pendingDraft ? 'editing' : 'idle')
        return false
      }

      if (mode === 'chat') {
        store.setPhase(store.pendingDraft ? 'editing' : 'idle')
        setComposeHint(true)
        return true
      }

      const draft = extractAnnotationDraft(
        useAnnotationAgentStore.getState().lastAgentText(),
      )
      if (!draft) {
        store.setPhase(store.pendingDraft ? 'editing' : 'idle')
        toast.message('没整理出可用批注正文，请再说一下想怎么写')
        return false
      }

      await proposeMarkForAgent(draft, {
        excerpt: options.excerpt,
        filePath: options.filePath,
        fileFingerprint: options.fileFingerprint,
        source: 'annotation',
      })
      setComposeHint(false)
      setAwaitingDirection(false)
      return true
    },
    [
      ensureAnnotationSession,
      fileKey,
      options.excerpt,
      options.fileFingerprint,
      options.filePath,
      prepare,
    ],
  )

  const composeNote = useCallback(
    async (hint?: string) => {
      setAwaitingDirection(false)
      setComposeHint(false)
      const built = buildAnnotationComposePrompt({
        excerpt: options.excerpt,
        hint,
      })
      await runPrompt(built.displayText, built.promptText, 'compose')
    },
    [options.excerpt, runPrompt],
  )

  /** 「写成批注」：命令已明确，直接整理（方向可选，空白=默认） */
  const writeNoteNow = useCallback(
    async (hint?: string) => {
      if (!agentReady) {
        toast.message('请先连接 AI')
        return
      }
      await composeNote(hint?.trim() || undefined)
    },
    [agentReady, composeNote],
  )

  /** 「换个方向」：可选补方向；空白也可直接生成 */
  const requestComposeDirection = useCallback(() => {
    if (!agentReady) {
      toast.message('请先连接 AI')
      return
    }
    if (useAnnotationAgentStore.getState().prompting || useAcpUiStore.getState().prompting) {
      toast.message('AI 忙碌中，请稍后再试')
      return
    }
    prepare()
    const store = useAnnotationAgentStore.getState()
    store.appendUserMessage('换个方向再写')
    store.appendAgentMessage(ANNOTATION_DIRECTION_ASK)
    setAwaitingDirection(true)
    setComposeHint(false)
  }, [agentReady, prepare])

  const sendChat = useCallback(
    async (intent: AnnotationIntentId, customText?: string) => {
      if (intent === 'custom') {
        const text = customText?.trim() ?? ''

        // 等待方向时：空白也算确认「按默认写」
        if (awaitingDirection) {
          setAwaitingDirection(false)
          await composeNote(text || undefined)
          return
        }

        if (text) {
          const detected = detectAnnotationWriteIntent(text)
          if (detected.write) {
            // 「写批注」本身即明确命令；有方向带上，没有就默认写
            await composeNote(detected.hasDirection ? detected.direction : undefined)
            return
          }
        }
      }

      const built = buildAnnotationChatPrompt({
        excerpt: options.excerpt,
        intent,
        customText,
      })
      await runPrompt(built.displayText, built.promptText, 'chat')
    },
    [awaitingDirection, composeNote, options.excerpt, runPrompt],
  )

  const runRefine = useCallback(
    async (refine: AnnotationRefineId) => {
      const draft = useAnnotationAgentStore.getState().pendingDraft
      if (!draft?.note.trim()) return
      const built = buildAnnotationRefinePrompt({
        excerpt: options.excerpt || draft.excerpt,
        draft: draft.note,
        refine,
        lastIntentLabel: draft.lastIntentLabel,
      })
      await runPrompt(built.displayText, built.promptText, 'refine')
    },
    [options.excerpt, runPrompt],
  )

  /** 润色手写正文：返回新文案，不自动替换、不 propose */
  const polishNote = useCallback(
    async (draft: string): Promise<string | null> => {
      const text = draft.trim()
      if (!text) {
        toast.message('先写一点内容再润色')
        return null
      }
      prepare()
      const store = useAnnotationAgentStore.getState()
      if (store.prompting) return null
      if (useAcpUiStore.getState().prompting) {
        toast.message('右侧 AI 忙碌中，请稍后再试')
        return null
      }
      if (useAcpUiStore.getState().status !== 'connected') {
        toast.message('请先连接 AI')
        return null
      }

      const sid = await ensureAnnotationSession()
      if (!sid) return null

      const built = buildAnnotationPolishPrompt({
        excerpt: options.excerpt,
        draft: text,
      })

      store.setCapturing(true)
      store.setPrompting(true)
      store.setPhase('generating')
      store.appendUserMessage(built.displayText)
      store.beginAgentReply()

      const includeBootstrap = shouldSendSessionBootstrap(sid)
      const prefix = buildMontreePromptPrefix(`annotation:${fileKey}`, { includeBootstrap })
      const result = await acpApi.prompt({
        sessionId: sid,
        prompt: [...prefix, { type: 'text', text: built.promptText }],
      })
      if (isOk(result) && includeBootstrap) {
        markSessionBootstrapSent(sid)
      }

      store.finishStreaming()
      store.setCapturing(false)

      if (!isOk(result)) {
        if (
          result.error.code === 'ACP_PROTOCOL_ERROR' ||
          result.error.code === 'ACP_NOT_CONNECTED'
        ) {
          useAnnotationAgentStore
            .getState()
            .bindSessionId(null, useAcpUiStore.getState().selectedRuntimeId)
        }
        reportAppError(result.error)
        store.setPhase(store.pendingDraft ? 'editing' : 'idle')
        return null
      }

      const polished = extractAnnotationDraft(
        useAnnotationAgentStore.getState().lastAgentText(),
      )
      store.setPhase(store.pendingDraft ? 'editing' : 'idle')
      if (!polished) {
        toast.message('没得到可用润色结果，请再试一次')
        return null
      }
      return polished
    },
    [ensureAnnotationSession, fileKey, options.excerpt, prepare],
  )

  /** 新会话：本地新线程 + 下次 prompt 再建 ACP session（不碰右侧历史） */
  const newSession = useCallback(() => {
    useAnnotationAgentStore.getState().createThread(fileKey)
    setComposeHint(false)
    setAwaitingDirection(false)
  }, [fileKey])

  return {
    fileKey,
    agentReady,
    busy,
    phase,
    pendingDraft,
    timelineOpen,
    composeHint,
    awaitingDirection,
    dismissComposeHint: () => setComposeHint(false),
    prepare,
    sendChat,
    composeNote,
    writeNoteNow,
    requestComposeDirection,
    runRefine,
    polishNote,
    newSession,
    discardDraft: () => useAnnotationAgentStore.getState().discardDraft(),
    updatePendingNote: (note: string) =>
      useAnnotationAgentStore.getState().updatePendingNote(note),
  }
}
