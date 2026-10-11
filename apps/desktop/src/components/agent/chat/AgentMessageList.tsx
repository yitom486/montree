import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Loader2 } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  useAcpActiveMessages,
  useAcpPendingPermission,
  useAcpUiStore,
} from '@/stores/acp-ui-store'
import { AgentActivityGroup } from '@/components/agent/chat/AgentActivityGroup'
import { groupChatTimeline } from '@/lib/agent/chat-timeline'
import { AgentMessageBubble } from '@/components/agent/chat/AgentMessageBubble'
import { AgentPermissionCard } from '@/components/agent/permission/AgentPermissionCard'
import { timelineRendersInlineApproval } from '@/lib/agent/acp-permission-ui'
import { logAcpLayoutProbe } from '@/lib/agent/acp-layout-probe'
import { useStickToBottomScroll } from '@/hooks/agent/useStickToBottomScroll'
import {
  CHAT_HISTORY_INITIAL_COUNT,
  CHAT_HISTORY_PAGE_STEP,
  resolveScrollViewport,
  sliceChatWindow,
} from '@/lib/agent/stick-to-bottom'
import { useCodeBlockCopy } from '@/hooks/preview/useCodeBlockCopy'
import { AGENT_CHAT_COL_CLASS } from '@/components/agent/chat/AgentChatItem'
import { AgentScrollToBottomButton } from '@/components/agent/chat/AgentScrollToBottomButton'
import { AgentMark } from '@/components/agent/AgentMark'
import type { ChapterMarkPlanSelectPayload } from '@/components/agent/propose/ChapterMarkPlanCard'

interface AgentMessageListProps {
  bottomRef: RefObject<HTMLDivElement | null>
  messagesRef: RefObject<HTMLDivElement | null>
  authHint: string | null
  runtimeName?: string
  onChapterPlanSelect?: (payload: ChapterMarkPlanSelectPayload) => void
}

/**
 * 消息列表：只订阅消息相关状态，避免流式输出让 Agent 面板的标题栏和输入栏一起更新。
 */
export const AgentMessageList = memo(function AgentMessageList({
  bottomRef,
  messagesRef,
  authHint,
  runtimeName,
  onChapterPlanSelect,
}: AgentMessageListProps) {
  const messages = useAcpActiveMessages()
  const pendingPermission = useAcpPendingPermission()
  const prompting = useAcpUiStore((s) => s.prompting)
  const [nowMs, setNowMs] = useState(() => Date.now())

  // 历史分页窗：初次只看末尾 N 条，上滑 5 条 5 条向前补。
  // start 为 null = 贴底锚定；数字 = 冻结起点（未贴底时新消息不移位）。
  const [chatWindow, setChatWindow] = useState<{ start: number | null; count: number }>({
    start: null,
    count: CHAT_HISTORY_INITIAL_COUNT,
  })
  const windowRef = useRef(chatWindow)
  windowRef.current = chatWindow
  const messagesLengthRef = useRef(messages.length)
  messagesLengthRef.current = messages.length
  const pinnedRef = useRef(true)

  const streamingAny = messages.some((m) => m.streaming) || prompting
  // 滚动记忆归属：只订阅线程 id（极少变化），快照读写走 getState，不引入额外订阅
  const threadId = useAcpUiStore((s) => s.activeThreadId)
  const loadChatScroll = useCallback(
    () => useAcpUiStore.getState().chatScrollByThread[threadId],
    [threadId],
  )
  const saveChatScroll = useCallback(
    (next: { scrollTop: number; pinned: boolean }) => {
      useAcpUiStore.getState().setChatScroll(threadId, next)
    },
    [threadId],
  )
  const stickToBottomState = useMemo(
    () => ({
      messageCount: messages.length,
      lastMessageId: messages.at(-1)?.id,
      lastMessageStreaming: Boolean(messages.at(-1)?.streaming),
      prompting,
    }),
    [messages.length, messages.at(-1)?.id, messages.at(-1)?.streaming, prompting],
  )

  const { pinned, scrollToBottom } = useStickToBottomScroll({
    contentRef: messagesRef,
    messageState: stickToBottomState,
    streaming: streamingAny,
    threadId,
    loadScroll: loadChatScroll,
    saveScroll: saveChatScroll,
  })
  pinnedRef.current = pinned

  const visibleMessages = useMemo(() => {
    // 贴底时恒为底锚（加载更多后来的新消息也不被冻结窗挡住）；离底才冻结。
    const effectiveStart = pinned ? null : chatWindow.start
    return sliceChatWindow(messages, effectiveStart, chatWindow.count)
  }, [messages, pinned, chatWindow])
  const remainingOlder = messages.length - visibleMessages.length

  useCodeBlockCopy(messagesRef, visibleMessages)

  const preserveRef = useRef<{ height: number; top: number } | null>(null)

  const loadMore = useCallback(() => {
    const total = messagesLengthRef.current
    const w = windowRef.current
    // 贴底时起点恒为末尾；离底时沿用冻结起点
    const base = pinnedRef.current ? Math.max(0, total - w.count) : (w.start ?? Math.max(0, total - w.count))
    // 已全量：不再长大，避免空转重渲染
    if (base <= 0 && total <= w.count) return
    const viewport = resolveScrollViewport(messagesRef.current)
    if (viewport) {
      preserveRef.current = { height: viewport.scrollHeight, top: viewport.scrollTop }
    }
    setChatWindow({ start: Math.max(0, base - CHAT_HISTORY_PAGE_STEP), count: w.count + CHAT_HISTORY_PAGE_STEP })
  }, [messagesRef])
  const loadMoreRef = useRef(loadMore)
  loadMoreRef.current = loadMore

  // 前补导致内容增高：paint 前恢复偏移，视觉原地不动（无滑动动画）。
  const windowKey = `${chatWindow.start ?? 'end'}-${chatWindow.count}-${messages.length}`
  useLayoutEffect(() => {
    const preserved = preserveRef.current
    if (!preserved) return
    preserveRef.current = null
    const viewport = resolveScrollViewport(messagesRef.current)
    if (!viewport) return
    viewport.scrollTop = preserved.top + (viewport.scrollHeight - preserved.height)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowKey])

  const timeline = useMemo(
    () =>
      groupChatTimeline(visibleMessages, {
        pendingToolCallId: pendingPermission?.toolCallId,
        nowMs,
      }),
    [visibleMessages, pendingPermission?.toolCallId, nowMs],
  )

  // 切线程重置窗口（回到底部看末 5 条）。
  useEffect(() => {
    setChatWindow({ start: null, count: CHAT_HISTORY_INITIAL_COUNT })
  }, [threadId])

  // 贴底态变化同步窗口锚定：离开底部冻结当前起点（起点=总数-窗宽）；
  // 贴底时渲染恒用底锚，此处无需清除。
  const prevPinnedRef = useRef(pinned)
  pinnedRef.current = pinned
  useEffect(() => {
    if (prevPinnedRef.current && !pinned) {
      const total = messagesLengthRef.current
      const count = windowRef.current.count
      setChatWindow({ start: Math.max(0, total - count), count })
    }
    prevPinnedRef.current = pinned
  }, [pinned])

  // 滑到顶部自动向前补（懒加载）；内容未撑满视口不触发。
  useEffect(() => {
    const viewport = resolveScrollViewport(messagesRef.current)
    if (!viewport) return
    let queued = false
    const onScroll = () => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => {
        queued = false
        if (viewport.scrollTop > 200) return
        if (viewport.scrollHeight <= viewport.clientHeight) return
        loadMoreRef.current()
      })
    }
    viewport.addEventListener('scroll', onScroll, { passive: true })
    return () => viewport.removeEventListener('scroll', onScroll)
  }, [messagesRef])

  // 孤立审批兜底按实际渲染结果决定：可见分组里已有审批槽（工具卡/提议分支外挂）
  // 即隐藏；被分组跳过、晚到、缺 ID、裁剪掉时才浮出。两者互斥，同一时间线只有一份。
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
    <div className="relative min-h-0 min-w-0 flex-1">
      <ScrollArea
        className={cn(
          'h-full min-h-0 min-w-0 overflow-x-hidden',
          // Radix Viewport 内层常为 display:table + min-width:100%，长内容会撑开整列
          '[&_[data-slot=scroll-area-viewport]]:min-w-0',
          '[&_[data-slot=scroll-area-viewport]>div]:!block',
          '[&_[data-slot=scroll-area-viewport]>div]:!min-w-0',
          '[&_[data-slot=scroll-area-viewport]>div]:max-w-full',
        )}
      >
      <div
        ref={messagesRef}
        data-acp-probe="message-list"
        className={cn('flex flex-col gap-3 px-3 py-3', AGENT_CHAT_COL_CLASS)}
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
              className="rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
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
              onChapterPlanSelect={onChapterPlanSelect}
            />
          ) : (
            <AgentMessageBubble
              key={item.key}
              message={item.message}
              onChapterPlanSelect={onChapterPlanSelect}
            />
          ),
        )}
        {prompting && !messages.some((m) => m.streaming) ? (
          <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            正在生成…
          </div>
        ) : null}
        {pendingOrphan && pendingPermission ? (
          <AgentPermissionCard pending={pendingPermission} />
        ) : null}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
      {!pinned && messages.length > 0 ? (
        <AgentScrollToBottomButton onClick={scrollToBottom} />
      ) : null}
    </div>
  )
})
