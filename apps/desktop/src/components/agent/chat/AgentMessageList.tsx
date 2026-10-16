import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { ArrowDown, Loader2 } from 'lucide-react'
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from '@assistant-ui/react'
import { cn } from '@/lib/utils'
import {
  useAcpActiveMessages,
  useAcpPendingPermission,
  useAcpUiStore,
} from '@/stores/acp-ui-store'
import type { AcpChatMessage } from '@/stores/acp-chat-types'
import { AgentActivityGroup } from '@/components/agent/chat/AgentActivityGroup'
import { planInlinePresent } from '@montree/chat-core'
import { groupChatTimeline } from '@montree/chat-core'
import { ChatMessageBubble } from '@montree/chat-ui'
import { dismissProposedMark } from '@/lib/agent/context/propose-mark'
import { AgentPermissionCard } from '@montree/chat-ui'
import { respondPermissionRequest } from '@/lib/agent/permission-respond'
import { openChapterForMarkRecovery, promptSelectTextForMarkRecovery } from '@/lib/agent/mark-proposal-failure'
import { useReaderNavigationStore } from '@/stores/reader-navigation-store'
import { useEditorUiStore } from '@/stores/editor-ui-store'
import { ToolBusinessResult } from '@/components/agent/tools/ToolBusinessResult'
import { AgentPlanCard } from '@/components/agent/tools/AgentPlanCard'
import { AgentLoadingState, currentRunStatus } from '@montree/chat-ui'
import { timelineRendersInlineApproval } from '@montree/chat-core'
import { logAcpLayoutProbe } from '@/lib/agent/acp-layout-probe'
import {
  CHAT_HISTORY_INITIAL_COUNT,
  CHAT_HISTORY_PAGE_STEP,
  resolveScrollViewport,
  sliceChatWindow,
} from '@/lib/agent/stick-to-bottom'
import { AGENT_CHAT_COL_CLASS } from '@montree/chat-ui'
import { AgentMark } from '@/components/agent/AgentMark'
import { AgentContextMenu } from '@/components/agent/chat/AgentContextMenu'
import { getOwnedChatSessionStore } from '@/lib/agent/chat-session-owner'
import { useChatSessionStore } from '@montree/chat-session'
import type { ChapterMarkPlanSelectPayload } from '@montree/chat-ui'
import type { GenerativeSubmitPayload } from '@montree/chat-ui'

/**
 * 消息读取源（P4b 壳收敛第一步，只切 docked 面）：
 * - `host`（缺省）：沿用宿主 `useAcpActiveMessages`，行为与现状逐字一致；
 * - `package-mirror`：消息数组改读包对账镜像 `getOwnedChatSessionStore()` 的 active
 *   线程 feed（经 `useChatSessionStore` 订阅），streaming 标记随消息同切；
 *   其余一律走宿主现有：`prompting`（动作驱动，P4c 才换）、`pendingPermission`、
 *   主题、滚动快照、全部回调与发送/审批/配置动作。
 */
export type AgentMessageSource = 'host' | 'package-mirror'

/** 包镜像 active 为空时的稳定空数组（避免每渲染新建数组抖动 memo）。 */
const EMPTY_PACKAGE_MIRROR_MESSAGES: AcpChatMessage[] = []

interface AgentMessageListProps {
  bottomRef: RefObject<HTMLDivElement | null>
  messagesRef: RefObject<HTMLDivElement | null>
  authHint: string | null
  runtimeName?: string
  messageSource?: AgentMessageSource
  onChapterPlanSelect?: (payload: ChapterMarkPlanSelectPayload) => void
  onGenerativeSubmit?: (payload: GenerativeSubmitPayload) => void
  onEditMessage?: (text: string) => void
  onQuote?: (text: string) => void
}

/**
 * 消息列表：采用 assistant-ui ThreadPrimitive.Viewport 视口引擎，
 * 获得原生 AI 流式平滑跟滚与 turnAnchor 锁定；正文由 Streamdown 渲染。
 */
export const AgentMessageList = memo(function AgentMessageList(props: AgentMessageListProps) {
  const threadId = useAcpUiStore((s) => s.activeThreadId)
  return <ThreadMessageList key={threadId} {...props} />
})

const ThreadMessageList = memo(function ThreadMessageList({
  bottomRef,
  messagesRef,
  authHint,
  runtimeName,
  messageSource = 'host',
  onChapterPlanSelect,
  onGenerativeSubmit,
  onEditMessage,
  onQuote,
}: AgentMessageListProps) {
  const hostMessages = useAcpActiveMessages()
  // P4b 包镜像订阅：host 模式下同样订阅（hooks 禁条件调用），但渲染不用其消息；
  // 输出与现状一致，仅多一次无害订阅（输出仍由 hostMessages 决定）。
  const packageMirrorState = useChatSessionStore(getOwnedChatSessionStore())
  const packageMirrorThread =
    packageMirrorState.activeThreadId != null
      ? packageMirrorState.threads.find((t) => t.id === packageMirrorState.activeThreadId)
      : undefined
  const messages =
    messageSource === 'package-mirror'
      ? (packageMirrorThread?.feed.messages ?? EMPTY_PACKAGE_MIRROR_MESSAGES)
      : hostMessages
  const pendingPermission = useAcpPendingPermission()
  const resolveMarkProposal = useAcpUiStore((s) => s.resolveMarkProposal)
  const prompting = useAcpUiStore((s) => s.prompting)
  const threadId = useAcpUiStore((s) => s.activeThreadId)
  const navFlatIndex = useReaderNavigationStore((s) => s.nav.flatIndex)
  const theme = useEditorUiStore((s) => s.theme)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const streamingAny = messages.some((m) => m.streaming) || prompting
  const runStatus = currentRunStatus(messages, pendingPermission != null, prompting)
  // 底部状态行显隐：有可见流式内容（思考/带文本回答）时让位；
  // 空占位（首包未到的 agent 空壳）只在 thinking 相让位给底部行（气泡自身返回 null），
  // 工具运行/组织回答等阶段气泡自带状态行，底部行让位，避免双行。
  const streamingContent = messages.some((m) => m.streaming && (m.role === 'thought' || (m.role === 'agent' && m.text.trim())))
  const emptyPlaceholder = messages.some((m) => m.streaming && m.role === 'agent' && !m.text.trim())
  const showRunStatusRow = prompting && !streamingContent && (runStatus.phase === 'thinking' || !emptyPlaceholder)
  const runStartedAt = messages.findLast(message => message.role === 'user')?.createdAt
  const viewportRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)

  const checkNearBottom = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const near = distance <= 96
    isNearBottomRef.current = near
    if (near) {
      userScrolledUpRef.current = false
    }
    // 滚动快照即落盘：离底/贴底翻转不依赖后续 scroll 事件
    //（无位移滚轮、程序化滚动可能无事件，导致历史恢复读不到）。
    // set 高频但无订阅者重渲染，落盘由 persist 节流合并。
    const store = useAcpUiStore.getState()
    store.setChatScroll(store.activeThreadId, {
      scrollTop: el.scrollTop,
      pinned: near,
      windowStart: near ? null : windowRef.current.start,
      windowCount: windowRef.current.count,
    })
  }, [])

  // chunk 与正文高度变化交给 Viewport 的 autoScroll，避免两套跟滚互相抢位置。

  // 新发送提问或进入思考：重置贴底并滚到底部
  const lastUserMsgId = useMemo(
    () => messages.findLast((m) => m.role === 'user')?.id,
    [messages],
  )
  const prevUserMsgIdRef = useRef(lastUserMsgId)
  // 本次观看中的用户上滑意图（可信滚轮/触摸）：仅真向上滚轮时标记；
  // 用户发新消息、回到底部或向下滚到底时复位为 false，确保新回合必定平滑跟滚。
  const userScrolledUpRef = useRef(false)
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const mark = (e: Event) => {
      if ('deltaY' in e && typeof (e as WheelEvent).deltaY === 'number') {
        const wheel = e as WheelEvent
        if (wheel.deltaY < 0) {
          // 明确向上滚轮：标记用户上翻看历史意图
          userScrolledUpRef.current = true
        } else if (wheel.deltaY > 0 && isNearBottomRef.current) {
          // 向下滚到底部：清除上滑意图
          userScrolledUpRef.current = false
        }
      } else {
        // 触控滑动
        userScrolledUpRef.current = true
      }
    }
    el.addEventListener('wheel', mark, { passive: true, capture: true })
    el.addEventListener('touchmove', mark, { passive: true })
    return () => {
      el.removeEventListener('wheel', mark, { capture: true })
      el.removeEventListener('touchmove', mark)
    }
  }, [])
  useEffect(() => {
    if (lastUserMsgId && lastUserMsgId !== prevUserMsgIdRef.current) {
      // 仅在用户未主动上翻看历史时，新消息到达才自动跟滚到底部
      if (!userScrolledUpRef.current) {
        isNearBottomRef.current = true
        setChatWindow((prev) => (prev.start !== null ? { ...prev, start: null } : prev))
        const el = viewportRef.current
        if (el) {
          const reduceMotion =
            typeof window !== 'undefined' &&
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches
          el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? 'instant' : 'smooth' })
        }
      }
    }
    prevUserMsgIdRef.current = lastUserMsgId
  }, [lastUserMsgId])

  useEffect(() => {
    if (prompting && isNearBottomRef.current) {
      const el = viewportRef.current
      if (el) el.scrollTop = el.scrollHeight
    }
  }, [prompting])

  // 初次装载：有离底快照则恢复位置，否则贴底。
  // 用被动 effect：子级视口自身的挂载置底先跑，本级后跑才盖得住；
  // 挂载后 rAF 再补一次，防懒加载块撑高后的跟滚。
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const saved = useAcpUiStore.getState().chatScrollByThread[threadId]
    if (!saved || saved.pinned !== false) {
      el.scrollTop = el.scrollHeight
      return
    }
    el.scrollTop = saved.scrollTop
    // 挂载后下一帧再设一次：子级 autoScroll 与懒加载块撑高都可能抢置底，
    // 用户一帧内无法操作，无条件补设是安全的。
    const frame = requestAnimationFrame(() => {
      const target = viewportRef.current
      if (target) target.scrollTop = saved.scrollTop
    })
    return () => cancelAnimationFrame(frame)
  }, [threadId])

  const handleScrollToBottom = useCallback(() => {
    isNearBottomRef.current = true
    userScrolledUpRef.current = false
    setChatWindow((prev) => (prev.start !== null ? { ...prev, start: null } : prev))
    const el = viewportRef.current
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
  }, [])

  // 历史分页窗：初次只看末尾 N 条，上滑向前加载
  const [chatWindow, setChatWindow] = useState<{ start: number | null; count: number }>(() => {
    const saved = useAcpUiStore.getState().chatScrollByThread[threadId]
    return {
      start: saved?.pinned === false ? saved.windowStart ?? null : null,
      count:
        saved?.windowCount && Number.isSafeInteger(saved.windowCount)
          ? Math.max(CHAT_HISTORY_INITIAL_COUNT, Math.min(300, saved.windowCount))
          : CHAT_HISTORY_INITIAL_COUNT,
    }
  })
  const windowRef = useRef(chatWindow)
  windowRef.current = chatWindow
  const messagesLengthRef = useRef(messages.length)
  messagesLengthRef.current = messages.length

  // 转换为 assistant-ui Runtime 消息
  const convertedMessages = useMemo(() => {
    return messages.map((m) => ({
      id: m.id,
      role: m.role === 'user' ? ('user' as const) : m.role === 'system' ? ('system' as const) : ('assistant' as const),
      content: [{ type: 'text' as const, text: m.text || '' }],
    }))
  }, [messages])

  const runtime = useExternalStoreRuntime({
    messages: convertedMessages,
    convertMessage: (m) => m,
    isRunning: streamingAny,
    onNew: async () => {},
    onCancel: async () => {},
  })

  const visibleMessages = useMemo(() => {
    // 核心底锚守护：贴底时（或正在提示/流式生成时）恒为底锚（start=null），
    // 取末尾最新 count 条，确保新提问与新回答绝不被固定的历史头部切片挡住；
    // 仅当用户离开底部浏览历史时才使用冻结 start。
    const isPinned = isNearBottomRef.current || prompting || streamingAny
    const effectiveStart = isPinned ? null : chatWindow.start
    return sliceChatWindow(messages, effectiveStart, chatWindow.count)
  }, [messages, chatWindow, prompting, streamingAny])
  const remainingOlder = messages.length - visibleMessages.length

  const preserveRef = useRef<{ height: number; top: number } | null>(null)

  const loadMore = useCallback(() => {
    const total = messagesLengthRef.current
    const w = windowRef.current
    const base = w.start ?? Math.max(0, total - w.count)
    if (base <= 0 && total <= w.count) return
    const el = messagesRef.current
    const viewport = viewportRef.current ?? resolveScrollViewport(el) ?? el?.parentElement
    if (viewport) {
      preserveRef.current = { height: viewport.scrollHeight, top: viewport.scrollTop }
    }
    setChatWindow({
      start: Math.max(0, base - CHAT_HISTORY_PAGE_STEP),
      count: w.count + CHAT_HISTORY_PAGE_STEP,
    })
  }, [messagesRef])
  const loadMoreRef = useRef(loadMore)
  loadMoreRef.current = loadMore

  // 前补导致内容增高：paint 前恢复偏移
  const windowKey = `${chatWindow.start ?? 'end'}-${chatWindow.count}-${messages.length}`
  useLayoutEffect(() => {
    const preserved = preserveRef.current
    if (!preserved) return
    preserveRef.current = null
    const el = messagesRef.current
    const viewport = viewportRef.current ?? resolveScrollViewport(el) ?? el?.parentElement
    if (!viewport) return
    viewport.scrollTop = preserved.top + (viewport.scrollHeight - preserved.height)
  }, [windowKey, messagesRef])

  const inlinePresent = useMemo(() => planInlinePresent(messages, new Set(visibleMessages.map(m => m.id))), [messages, visibleMessages])

  const timeline = useMemo(() => {
    const visibleIds = new Set(visibleMessages.map((m) => m.id))
    return groupChatTimeline(messages, {
      pendingToolCallId: pendingPermission?.toolCallId,
      nowMs,
      visibleIds,
      scopeKey: threadId ?? 'default',
    })
  }, [messages, visibleMessages, pendingPermission?.toolCallId, nowMs, threadId])

  // 滑到顶部自动向前补（懒加载）
  useEffect(() => {
    const el = messagesRef.current
    if (!el) return
    const scroller = viewportRef.current ?? resolveScrollViewport(el) ?? el.parentElement?.parentElement ?? el.parentElement
    if (!scroller) return
    let queued = false
    const onScroll = (e?: Event) => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => {
        queued = false
        const target = (e?.target || e?.currentTarget || scroller) as HTMLElement
        const st = typeof target?.scrollTop === 'number' ? target.scrollTop : scroller.scrollTop
        const sh = typeof target?.scrollHeight === 'number' ? target.scrollHeight : scroller.scrollHeight
        const ch = typeof target?.clientHeight === 'number' ? target.clientHeight : scroller.clientHeight
        if (st > 200) return
        if (sh > 0 && ch > 0 && sh <= ch) return
        loadMoreRef.current()
      })
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      window.removeEventListener('scroll', onScroll, { capture: true })
    }
  }, [messagesRef])

  const pendingOrphan =
    pendingPermission != null &&
    !timelineRendersInlineApproval(timeline, pendingPermission.toolCallId)

  useEffect(() => {
    if (!prompting) return
    setNowMs(Date.now())
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [prompting])

  const prevStreamingAny = useRef(streamingAny)

  useEffect(() => {
    const flipped = prevStreamingAny.current !== streamingAny
    prevStreamingAny.current = streamingAny
    const id = window.requestAnimationFrame(() => {
      logAcpLayoutProbe(messagesRef.current, {
        tag: 'AgentMessageList',
        role: 'list',
        streaming: streamingAny,
        force: flipped,
      })
    })
    return () => window.cancelAnimationFrame(id)
  }, [messages, messagesRef, streamingAny])

  return (
    <AgentContextMenu selectionRoot={messagesRef} onQuote={onQuote} getMessage={(id) => messages.find((message) => message.id === id)} onScrollToBottom={handleScrollToBottom}>
    <div className="relative min-h-0 min-w-0 flex-1">
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root className="flex-1 flex flex-col min-h-0 h-full">
          <ThreadPrimitive.Viewport
            ref={viewportRef}
            data-testid="chat-viewport"
            autoScroll
            scrollToBottomOnInitialize={false}
            scrollToBottomOnRunStart={false}
            scrollToBottomOnThreadSwitch={false}
            onScroll={checkNearBottom}
            className="flex-1 overflow-y-auto overflow-x-hidden p-3 [scrollbar-gutter:stable]"
          >
            <div
              ref={messagesRef}
              data-acp-probe="message-list"
              className={cn('flex flex-col gap-3 min-w-0 max-w-full', AGENT_CHAT_COL_CLASS)}
            >
              {messages.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/60 bg-muted/20 px-3 py-4 text-center">
                  <AgentMark className="mx-auto mb-2 size-6 text-muted-foreground/60" />
                  <p className="text-xs font-medium text-foreground/80">
                    开始与 {runtimeName ?? 'Agent'} 对话
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    点击右上角连接。复用本机 Codex 登录或环境变量中的 API Key。
                  </p>
                  {authHint ? (
                    <p
                      className={cn(
                        'mt-2 rounded-md px-2 py-1.5 text-[10px] leading-relaxed',
                        authHint.startsWith('已检测')
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                          : 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
                      )}
                    >
                      {authHint}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {remainingOlder > 0 ? (
                <div className="flex justify-center">
                  <button
                    type="button"
                    data-testid="chat-load-more"
                    onClick={() => loadMore()}
                    className="rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer shadow-xs"
                  >
                    加载更早消息（还剩 {remainingOlder} 条）
                  </button>
                </div>
              ) : null}

              {timeline.map((item) =>
                item.kind === 'work-log' ? (
                  <AgentActivityGroup
                    key={item.key}
                    group={item}
                    running={item.turnKey === (lastUserMsgId ? `turn:${threadId}:${lastUserMsgId}` : `prefix:${threadId ?? 'default'}`) && (streamingAny || item.isActive)}
                    onChapterPlanSelect={onChapterPlanSelect}
                    onEditMessage={onEditMessage}
                  />
                ) : (
                  <ChatMessageBubble
                    key={item.key}
                    message={item.message}
                    inlinePresentSlots={inlinePresent.slotsByMessage.get(item.message.id)}
                    suppressPresentResult={inlinePresent.claimedToolIds.has(item.message.id)}
                    runStatus={runStatus}
                    resolveMarkProposal={resolveMarkProposal}
                    pendingPermission={pendingPermission}
                    onDismissProposedMark={dismissProposedMark}
                    onPermissionRespond={(optionId) => {
                      if (pendingPermission) respondPermissionRequest(pendingPermission, optionId)
                    }}
                    onRecoverChapter={(flatIndex) => {
                      void openChapterForMarkRecovery(flatIndex)
                    }}
                    onPromptSelectText={() => promptSelectTextForMarkRecovery()}
                    navFlatIndex={navFlatIndex}
                    renderBusinessResult={(message, opts) => (
                      <ToolBusinessResult
                        message={message}
                        threadId={opts.threadId}
                        prompting={opts.prompting}
                        onGenerativeSubmit={opts.onGenerativeSubmit}
                        compactResults={opts.compactResults}
                      />
                    )}
                    renderPlanCard={(message) => <AgentPlanCard message={message} />}
                    onChapterPlanSelect={onChapterPlanSelect}
                    threadId={threadId}
                    prompting={prompting}
                    onGenerativeSubmit={onGenerativeSubmit}
                    onEditMessage={onEditMessage}
                    theme={theme}
                  />
                ),
              )}

              {showRunStatusRow ? (
                <AgentLoadingState label={runStatus.label} awaitingApproval={runStatus.phase === 'approval'} seconds={runStartedAt ? Math.max(0, Math.floor((nowMs - runStartedAt) / 1000)) : null} />
              ) : null}

              {pendingOrphan && pendingPermission ? (
                <AgentPermissionCard
                  pending={pendingPermission}
                  onRespond={(optionId) => respondPermissionRequest(pendingPermission, optionId)}
                />
              ) : null}

              <div ref={bottomRef} />
            </div>

            <ThreadPrimitive.ViewportFooter className="sticky bottom-0 z-10 flex justify-center pointer-events-none h-0 overflow-visible">
              <ThreadPrimitive.ScrollToBottom asChild>
                <button
                  type="button"
                  aria-label="回到底部"
                  title="回到底部"
                  onClick={handleScrollToBottom}
                  className="absolute bottom-3 pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card/90 backdrop-blur text-xs text-muted-foreground hover:text-primary hover:border-primary/40 shadow-md transition-all cursor-pointer disabled:invisible disabled:pointer-events-none"
                >
                  <ArrowDown className="size-3.5" />
                  回到底部
                </button>
              </ThreadPrimitive.ScrollToBottom>
            </ThreadPrimitive.ViewportFooter>
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </div>
    </AgentContextMenu>
  )
})
