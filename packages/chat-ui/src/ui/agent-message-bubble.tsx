/**
 * `ChatMessageBubble`（M3b 整搬改名 + M3c 收敛：ToolCallCard/AgentResultEntry/ChapterMarkPlanCard/
 * ProposeMark* 改包内相对路径；ComponentUiCard.lazy 类型改 `@montree/chat-ui`（M3d 新建，barrel 待接）；
 * stays 的 `ToolBusinessResult/AgentPlanCard` 改为可选渲染槽（M4 由宿主传入原组件；缺省不渲染）；
 * 富结果守卫 `hasBusinessResult` 改包内私有 `./business-result-guard`（宿主纯逻辑逐字复刻）。
 * M4 主题 prop 化：`theme?: ChatMarkdownTheme`（缺省 `light`），不再读宿主 store。
 */
import { ArrowRight, Check, Copy, Layers, Pencil } from 'lucide-react'
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AgentChatItem } from './AgentChatItem'
import { BuiMessage } from './BuiMessage'
import { BuiThinking } from './BuiThinking'
import { AgentLoadingState, useElapsedSeconds, type currentRunStatus } from './AgentLoadingState'
import { BeuiStreamingResponse } from './BeuiStreamingResponse'
import { BeuiAgentProgress } from './BeuiAgentProgress'
import { AgentToolCallCard } from './agent-tool-call-card'
import { AgentResultEntry } from './agent-result-entry'
import { ToolApprovalSlot } from './tool-approval-slot'
import { toolMessageNeedsApproval } from '@montree/chat-core'
import type { AgentApprovalPending } from './agent-permission-card'
import { hasBusinessResult } from './business-result-guard'
import { splitInlinePresent, type InlinePresentSlot } from '@montree/chat-core'
import { isRichToolMessage } from '@montree/chat-core'
import {
  ChapterMarkPlanCard,
  type ChapterMarkPlanSelectPayload,
} from './chapter-mark-plan-card'
import { ProposeMarkBlockList, ProposeMarkChatBlock, type ResolveMarkProposal } from './propose-mark-chat-block'
import { ChatMarkdownFallback, ChatMarkdownLazy } from './chat-markdown.lazy'
import type { ChatMarkdownTheme } from './chat-markdown'
import { cn } from './cn'
import type { ChatMessage as AcpChatMessage } from '@montree/chat-core'
import type { GenerativeSubmitPayload } from './component-ui-card'

interface ChatMessageBubbleProps {
  message: AcpChatMessage
  inlinePresentSlots?: Map<number, InlinePresentSlot>
  suppressPresentResult?: boolean
  runStatus?: ReturnType<typeof currentRunStatus>
  /** 批注提议落库（必填，无 store fallback，由宿主 `AgentMessageList` 自 store 传入） */
  resolveMarkProposal: ResolveMarkProposal
  /** 当前待审批（宿主 store 值直传；`null` 即无待审批） */
  pendingPermission: AgentApprovalPending | null
  /** 提议落定（adopted/dismissed）后清理草稿（宿主原 `dismissProposedMark` 函数直传） */
  onDismissProposedMark?: () => void
  /**
   * 审批响应（宿主 `respondPermissionRequest` 直传；批注提议分支的审批槽经此发送。
   * 并行审批批把槽改为必填 `pending + onRespond`，此处跟随透传——原任务三 prop 之外的第 4 个，
   * 纯透传无渲染逻辑改动）。
   */
  onPermissionRespond?: (optionId: string | null) => void
  onChapterPlanSelect?: (payload: ChapterMarkPlanSelectPayload) => void
  threadId?: string
  prompting?: boolean
  onGenerativeSubmit?: (payload: GenerativeSubmitPayload) => void
  /**
   * 用户消息“编辑后继续”：把原文回填输入框由用户续改后发新回合。
   * 无分支重写语义；缺省时不渲染编辑按钮。
   */
  onEditMessage?: (text: string) => void
  /**
   * M3c 新增（stays 槽，M4 由宿主传入原组件；缺省不渲染，现有单测不覆盖这些分支）：
   * - `renderBusinessResult`：宿主 `ToolBusinessResult`（`message + threadId/prompting/onGenerativeSubmit/compactResults`，入口分支 compact 为 true 还原旧 `AgentResultEntry` 语义）。
   * - `renderPlanCard`：宿主 `AgentPlanCard`（`message`）。
   */
  renderBusinessResult?: (
    message: AcpChatMessage,
    opts: { threadId?: string; prompting?: boolean; onGenerativeSubmit?: (payload: GenerativeSubmitPayload) => void; compactResults?: boolean },
  ) => ReactNode
  renderPlanCard?: (message: AcpChatMessage) => ReactNode
  /** 工具卡失败恢复（宿主 `openChapterForMarkRecovery/promptSelectTextForMarkRecovery/nav.flatIndex` 直传；缺省静默） */
  onRecoverChapter?: (flatIndex?: number) => void
  onPromptSelectText?: () => void
  navFlatIndex?: number
  /** 聊天 Markdown 主题（宿主 `useEditorUiStore` 的 `theme` 直接透传；缺省 `light`） */
  theme?: ChatMarkdownTheme
}

export function ChatMessageBubble({
  message,
  inlinePresentSlots,
  suppressPresentResult,
  runStatus,
  resolveMarkProposal,
  pendingPermission,
  onDismissProposedMark,
  onPermissionRespond,
  onChapterPlanSelect,
  threadId,
  prompting,
  onGenerativeSubmit,
  onEditMessage,
  renderBusinessResult,
  renderPlanCard,
  onRecoverChapter,
  onPromptSelectText,
  navFlatIndex,
  theme = 'light',
}: ChatMessageBubbleProps) {
  const [copied, setCopied] = useState(false)
  // 流式 chunk 不重置选择；思考落定只自动收起一次，之后仍可手动查看。
  const [thoughtOpen, setThoughtOpen] = useState(Boolean(message.streaming))
  const wasThinking = useRef(Boolean(message.streaming))
  useEffect(() => {
    if (message.role === 'thought' && wasThinking.current && !message.streaming) setThoughtOpen(false)
    wasThinking.current = Boolean(message.streaming)
  }, [message.role, message.streaming])
  const elapsedSeconds = useElapsedSeconds(message.createdAt, Boolean(message.streaming) && (message.role === 'thought' || !message.text.trim()), message.updatedAt)

  const copyText = async (text: string) => {
    if (!text || copied) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板异常静默（与图表复制一致）
    }
  }

  const handleResolved: ResolveMarkProposal = (proposalId, status) => {
    resolveMarkProposal(proposalId, status)
    if (status === 'adopted' || status === 'dismissed') onDismissProposedMark?.()
  }
  const active = Boolean(message.streaming)
  // 原文直接交给 Streamdown：分块与字符显现使用同一套原生调度。
  const renderText = message.text
  const markdownClassName = useMemo(
    () =>
      cn(
        'markdown-preview agent-md min-w-0 max-w-full break-words text-[12px] [overflow-wrap:anywhere]',
        '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
        '[&_.mermaid]:my-2 [&_.mermaid]:overflow-x-auto [&_.mermaid]:rounded-md [&_.mermaid]:bg-muted/40 [&_.mermaid]:p-2',
      ),
    [],
  )

  if (message.role === 'system') {
    return (
      <BuiMessage from="system">
        {message.text}
      </BuiMessage>
    )
  }

  if (message.role === 'tool') {
    if (suppressPresentResult && !toolMessageNeedsApproval(message, pendingPermission)) {
      return (
        <AgentToolCallCard
          message={message}
          suppressBusinessResult
          pending={pendingPermission}
          onRespond={(optionId) => onPermissionRespond?.(optionId)}
          onRecoverChapter={onRecoverChapter}
          onPromptSelectText={onPromptSelectText}
          navFlatIndex={navFlatIndex}
        />
      )
    }
    if (message.markProposal && message.markProposalStatus !== 'dismissed') {
      // 批注提议分支同样外挂审批槽：命中 pending 的工具不能因为不走工具卡就丢审批
      return (
        <>
          <ProposeMarkChatBlock
            proposal={message.markProposal}
            status={message.markProposalStatus ?? 'pending'}
            onResolved={(status) => handleResolved(message.markProposal!.id, status)}
          />
          <ToolApprovalSlot
            message={message}
            pending={pendingPermission}
            onRespond={(optionId) => onPermissionRespond?.(optionId)}
          />
        </>
      )
    }
    // 富业务结果走独立入口：紧凑过程行 + 独立业务卡，单次调用只渲染一处。
    // 审批优先：待审批仍走工具卡（审批槽在折叠外），不进结果入口。
    const detail = message.toolContentText || message.text
    const needsApproval = toolMessageNeedsApproval(message, pendingPermission)
    if (
      !needsApproval &&
      isRichToolMessage(message) &&
      hasBusinessResult(detail, message.toolTitle, message.presentResult)
    ) {
      return (
        <AgentResultEntry
          message={message}
          threadId={threadId}
          prompting={prompting}
          onGenerativeSubmit={onGenerativeSubmit}
          pending={pendingPermission}
          onRespond={(optionId) => onPermissionRespond?.(optionId)}
          onRecoverChapter={onRecoverChapter}
          onPromptSelectText={onPromptSelectText}
          navFlatIndex={navFlatIndex}
          businessResultSlot={renderBusinessResult?.(message, { threadId, prompting, onGenerativeSubmit, compactResults: true })}
        />
      )
    }
    return (
      <AgentToolCallCard
        message={message}
        pending={pendingPermission}
        onRespond={(optionId) => onPermissionRespond?.(optionId)}
        onRecoverChapter={onRecoverChapter}
        onPromptSelectText={onPromptSelectText}
        navFlatIndex={navFlatIndex}
        businessResultSlot={renderBusinessResult?.(message, {})}
      />
    )
  }

  if (message.role === 'plan') {
    return renderPlanCard ? <>{renderPlanCard(message)}</> : null
  }

  if (message.role === 'thought') {
    const collapsedLabel = message.streaming
      ? '思考中'
      : '已思考'

    return (
      <div data-acp-probe="thought" data-message-id={message.id} className="mb-0 min-w-0">
        <BuiThinking
          state={message.streaming ? 'running' : 'done'}
          titleActive="思考中"
          titleDone={collapsedLabel}
          elapsedSeconds={elapsedSeconds}
          rows={[]}
          expanded={thoughtOpen}
          onToggle={() => setThoughtOpen((v) => !v)}
          partKey={`thought-${message.id}`}
          body={
            <Suspense fallback={<ChatMarkdownFallback text={message.text} />}>
              <ChatMarkdownLazy text={renderText} streaming={Boolean(message.streaming)} className={markdownClassName} theme={theme} />
            </Suspense>
          }
        />
      </div>
    )
  }

  const isUser = message.role === 'user'
  const showEmptyStreaming = !isUser && message.streaming && !message.text.trim()
  // 排空期间保持流式外衣，避免闪烁切换
  const showStreaming = active && !isUser
  if (showEmptyStreaming && runStatus?.phase === 'thinking') return null

  return (
    <AgentChatItem
      variant="bubble"
      bare
      tone={isUser ? 'user' : 'agent'}
      align={isUser ? 'end' : 'start'}
      streaming={isUser ? Boolean(message.streaming) : active}
      probe={isUser ? 'user' : 'agent'}
      messageId={message.id}
      role={message.role}
    >
      {isUser ? (
        <BuiMessage
          from="user"
          actions={
            <>
              <button
                type="button"
                aria-label="复制正文"
                title="复制正文"
                onClick={() => void copyText(message.text)}
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground/80 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              >
                {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
              </button>
              {onEditMessage && message.text.trim() ? (
                <button
                  type="button"
                  aria-label="编辑后继续"
                  title="拿回输入框续改（发送后为新回合）"
                  onClick={() => onEditMessage(message.text)}
                  className="flex size-8 items-center justify-center rounded-md text-muted-foreground/80 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <Pencil className="size-3.5" />
                </button>
              ) : null}
            </>
          }
        >
          {(message.attachments?.length ?? 0) > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {message.attachments!.map((att) => (
                <div
                  key={att.id}
                  className={cn(
                    'inline-flex max-w-[11rem] items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
                    'border-primary-foreground/30 bg-primary-foreground/12',
                  )}
                  title={att.absolutePath ?? att.name}
                >
                  {att.kind === 'image' && att.previewUrl ? (
                    <img
                      src={att.previewUrl}
                      alt=""
                      className="size-5 shrink-0 rounded object-cover"
                    />
                  ) : null}
                  <span className="min-w-0 truncate">{att.name}</span>
                </div>
              ))}
            </div>
          ) : null}
          {message.text.trim() ? (
            <div className="min-w-0 break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
              {message.text}
            </div>
          ) : null}
          {message.createdAt ? (
            <div className="flex items-center justify-end gap-0.5 pt-0.5 select-none font-mono text-[10px] text-muted-foreground/60">
              {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          ) : null}
        </BuiMessage>
      ) : showEmptyStreaming ? (
        <AgentLoadingState label={runStatus?.label ?? (pendingPermission ? '等待批准' : '等待响应')} seconds={elapsedSeconds} awaitingApproval={runStatus?.phase === 'approval' || pendingPermission != null} />
      ) : (
        <BuiMessage from="assistant" streaming={showStreaming}>
        <BeuiStreamingResponse streaming={showStreaming} actions={message.text ? (
          <button type="button" aria-label="复制回答原文" title="复制回答原文（Markdown）" onClick={() => void copyText(message.text)} className="flex size-8 items-center justify-center rounded-md text-muted-foreground/80 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
            {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
          </button>
        ) : null}>
          <Suspense
            fallback={
              <ChatMarkdownFallback text={renderText} className={markdownClassName} />
            }
          >
            {inlinePresentSlots?.size ? splitInlinePresent(renderText).map(part => {
              if (part.kind === 'markdown') return <ChatMarkdownLazy key={part.offset} text={part.text} streaming={showStreaming} className={markdownClassName} theme={theme} />
              const slot = inlinePresentSlots.get(part.offset)
              return slot?.state === 'ready' && slot.message ? (
                <div key={part.offset} data-testid="inline-present" className="my-3 min-w-0 max-w-full">
                  {renderBusinessResult?.(slot.message, { threadId, prompting, onGenerativeSubmit })}
                </div>
              ) : slot?.state === 'streaming' ? (
                <div key={part.offset} data-testid="inline-present-loading" className="my-3 rounded-xl border border-border/60 bg-card px-3 py-2">
                  <BeuiAgentProgress label="交互组件将在回答完成后嵌入此处" elapsedSeconds={null} />
                </div>
              ) : (
                <p key={part.offset} className="my-2 text-xs text-muted-foreground" role="status">
                  {slot?.state === 'duplicate' ? '该组件已在上文展示' : '引用的组件不可用，请查看工具结果或重新生成'}
                </p>
              )
            }) : <ChatMarkdownLazy text={renderText} streaming={showStreaming} className={markdownClassName} theme={theme} />}
          </Suspense>
        </BeuiStreamingResponse>
        </BuiMessage>
      )}
      {(message.steps?.length ?? 0) > 0 ? (
        <div className="mt-3 space-y-2 pt-2 border-t border-border/40 font-serif">
          <div className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5">
            <Layers className="size-3.5 text-primary" />
            <span>交互经纬流转</span>
          </div>
          <div className="space-y-1.5">
            {message.steps!.map((step) => (
              <div
                key={step.num}
                className="p-2.5 rounded-xl bg-muted/30 border border-border/50 hover:border-border transition-all flex items-start justify-between gap-2"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="size-4 rounded-full bg-primary/10 text-primary font-serif text-[10px] font-bold flex items-center justify-center shrink-0">
                      {step.num}
                    </span>
                    <span className="font-medium text-foreground text-xs truncate">
                      {step.title}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground pl-5 leading-normal">
                    {step.desc}
                  </p>
                </div>

                {step.anchorId && (
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        const escaped = CSS.escape(step.anchorId!)
                        const el = document.querySelector(`[data-anchor="${escaped}"]`)
                        if (el) {
                          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                          el.classList.add('animate-anchor-glow')
                          setTimeout(() => el.classList.remove('animate-anchor-glow'), 2500)
                        }
                      } catch {
                        // ignore selector escape error
                      }
                    }}
                    className="shrink-0 px-2 py-1 rounded-md text-[10px] text-primary bg-primary/10 hover:bg-primary hover:text-primary-foreground transition-all flex items-center gap-1 cursor-pointer border border-primary/20"
                    title="在正文中对照此段章句"
                  >
                    <span>对应章句</span>
                    <ArrowRight className="size-2.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {(message.markProposals?.length ?? 0) > 0 ? (
        <ProposeMarkBlockList
          embedded
          proposals={message.markProposals!.map((row) => ({
            proposal: row.proposal,
            status: row.status,
          }))}
          onResolved={handleResolved}
        />
      ) : null}
      {(message.chapterMarkPlan?.length ?? 0) > 0 ? (
        <ChapterMarkPlanCard
          embedded
          entries={message.chapterMarkPlan!}
          onSelectChapter={onChapterPlanSelect}
        />
      ) : null}
    </AgentChatItem>
  )
}
