import { memo, useCallback, useRef, useState, type RefObject } from 'react'
import {
  ChatMessageList,
  currentRunStatus,
  type ChapterMarkPlanSelectPayload,
  type ChatMessageListHandle,
  type ChatScrollSnapshot,
  type GenerativeSubmitPayload,
} from '@yitom/chat-ui'
import {
  useAcpActiveMessages,
  useAcpPendingPermission,
  useAcpUiStore,
} from '@/stores/acp-ui-store'
import { useReaderNavigationStore } from '@/stores/reader-navigation-store'
import { useEditorUiStore } from '@/stores/editor-ui-store'
import { ToolBusinessResult } from '@/components/agent/tools/ToolBusinessResult'
import { AgentPlanCard } from '@/components/agent/tools/AgentPlanCard'
import { AgentMark } from '@/components/agent/AgentMark'
import { AgentContextMenu } from '@/components/agent/chat/AgentContextMenu'
import { toast } from 'sonner'
import { adoptProposedMark } from '@/lib/agent/context/propose-mark'
import { toastMarkProposalFailure } from '@/lib/agent/mark-proposal-failure'
import type { ProposedMark } from '@yitom/annotations'
import { dismissProposedMark } from '@/lib/agent/context/propose-mark'
import { respondPermissionRequest } from '@/lib/agent/permission-respond'
import { openChapterForMarkRecovery, promptSelectTextForMarkRecovery } from '@/lib/agent/mark-proposal-failure'

/** 线程用量数字格式化（包内无现成工具，就地 `k` 缩写）：8281 → `8.3k` */
function formatUsageTokens(used: number): string {
  return used >= 1000 ? `${(used / 1000).toFixed(1)}k` : `${used}`
}

/** 用量后缀文案：`已用 8.3k tokens`，有思考 token 数再缀 `· 思考 2.0k`（纯函数，单测锁定）。 */
export function formatUsageText(usage: { used: number; thinkingTokens?: number | null }): string {
  const base = `已用 ${formatUsageTokens(usage.used)} tokens`
  return usage.thinkingTokens != null ? `${base} · 思考 ${formatUsageTokens(usage.thinkingTokens)}` : base
}

interface AgentMessageListProps {
  bottomRef: RefObject<HTMLDivElement | null>
  messagesRef: RefObject<HTMLDivElement | null>
  authHint: string | null
  runtimeName?: string
  onChapterPlanSelect?: (payload: ChapterMarkPlanSelectPayload) => void
  onGenerativeSubmit?: (payload: GenerativeSubmitPayload) => void
  onEditMessage?: (text: string) => void
  onQuote?: (text: string) => void
}

/**
 * 消息列表宿主薄适配（C6）：只保留状态订阅与业务接线。
 * 通用列表编排（assistant-ui runtime/viewport、历史窗口与分页、时间线/气泡编排、
 * 贴底跟滚/上滑保持/滚动恢复、回到底部、运行状态行）由包 `ChatMessageList` 实现。
 * 宿主负责：包 feed 与宿主元数据订阅、滚动快照落盘、空态/usage 文案、
 * 业务槽位（ToolBusinessResult/AgentPlanCard）、权限执行、章节/批注/恢复/
 * 生成式/编辑/引用回调、右键外壳与外部 ref 契约。
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
  onChapterPlanSelect,
  onGenerativeSubmit,
  onEditMessage,
  onQuote,
}: AgentMessageListProps) {
  const messages = useAcpActiveMessages()
  const pendingPermission = useAcpPendingPermission()
  const resolveMarkProposal = useAcpUiStore((s) => s.resolveMarkProposal)
  // 「采用并保存」：按提议摘录写库，note 为用户在卡片里改过的文本；成功后包内再落定 adopted
  const adoptMarkProposal = useCallback(async (proposal: ProposedMark, note: string) => {
    await adoptProposedMark({
      note,
      excerpt: proposal.excerpt,
      flatIndex: proposal.flatIndex,
      kind: proposal.kind,
      category: proposal.category,
      title: proposal.title,
    })
    toast.success(proposal.kind === 'highlight' || !note.trim() ? '已添加高亮' : '已保存批注')
  }, [])
  const markProposalError = useCallback((cause: unknown, context: { flatIndex?: number }) => {
    toastMarkProposalFailure(cause, context)
  }, [])
  const prompting = useAcpUiStore((s) => s.prompting)
  const threadId = useAcpUiStore((s) => s.activeThreadId)
  // 线程级用量（usage_update 落库）：存量引用，替换时才变，不抖动订阅
  const threadUsage = useAcpUiStore((s) => s.threads.find((t) => t.id === s.activeThreadId)?.usage)
  const navFlatIndex = useReaderNavigationStore((s) => s.nav.flatIndex)
  const theme = useEditorUiStore((s) => s.theme)
  const listHandle = useRef<ChatMessageListHandle>(null)

  // 运行相位由包 `currentRunStatus` 只读派生（与包内行显隐同源）；
  // 用量后缀只在 thinking/composing 相且 usage 存在时传，其他相不传（零视觉变化）。
  const runPhase = currentRunStatus(messages, pendingPermission != null, prompting).phase
  const usageText =
    threadUsage != null && (runPhase === 'thinking' || runPhase === 'composing')
      ? formatUsageText(threadUsage)
      : undefined

  // 滚动快照初值：挂载时按线程读一次（与旧实现一致，不订阅，避免自写高频重渲染）。
  // 恢复与窗口初值由包消费；变更经回调落盘，携带包绑定的线程 id。
  const [initialScroll] = useState(() => useAcpUiStore.getState().chatScrollByThread[threadId])
  const handleScrollSnapshot = useCallback((id: string, snapshot: ChatScrollSnapshot) => {
    useAcpUiStore.getState().setChatScroll(id, snapshot)
  }, [])

  const handleScrollToBottom = useCallback(() => {
    listHandle.current?.scrollToBottom()
  }, [])

  return (
    <AgentContextMenu selectionRoot={messagesRef} onQuote={onQuote} getMessage={(id) => messages.find((message) => message.id === id)} onScrollToBottom={handleScrollToBottom}>
      <ChatMessageList
        ref={listHandle}
        messages={messages}
        threadId={threadId}
        prompting={prompting}
        pendingPermission={pendingPermission}
        usageText={usageText}
        initialScroll={initialScroll}
        onScrollSnapshot={handleScrollSnapshot}
        contentRef={messagesRef}
        bottomRef={bottomRef}
        emptyState={
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
                className={
                  authHint.startsWith('已检测')
                    ? 'mt-2 rounded-md px-2 py-1.5 text-[10px] leading-relaxed bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                    : 'mt-2 rounded-md px-2 py-1.5 text-[10px] leading-relaxed bg-amber-500/10 text-amber-700 dark:text-amber-400'
                }
              >
                {authHint}
              </p>
            ) : null}
          </div>
        }
        resolveMarkProposal={resolveMarkProposal}
        onAdoptMarkProposal={adoptMarkProposal}
        onMarkProposalError={markProposalError}
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
        onGenerativeSubmit={onGenerativeSubmit}
        onEditMessage={onEditMessage}
        theme={theme}
      />
    </AgentContextMenu>
  )
})

