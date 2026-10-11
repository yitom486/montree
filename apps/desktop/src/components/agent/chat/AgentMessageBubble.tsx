import { ArrowRight, Layers } from 'lucide-react'
import { Suspense, useMemo } from 'react'
import { Reasoning, ReasoningTrigger, ReasoningContent } from '@/components/ai-elements/reasoning'
import {
  AgentChatItem,
} from '@/components/agent/chat/AgentChatItem'
import { AgentToolCallCard } from '@/components/agent/tools/AgentToolCallCard'
import { AgentResultEntry } from '@/components/agent/tools/AgentResultEntry'
import { ToolApprovalSlot } from '@/components/agent/permission/ToolApprovalSlot'
import { toolMessageNeedsApproval } from '@/lib/agent/acp-permission-ui'
import { useAcpPendingPermission, useAcpUiStore } from '@/stores/acp-ui-store'
import { hasBusinessResult } from '@/components/agent/tools/ToolBusinessResult'
import { isRichToolMessage } from '@/lib/agent/chat-timeline'
import { AgentPlanCard } from '@/components/agent/tools/AgentPlanCard'
import {
  ChapterMarkPlanCard,
  type ChapterMarkPlanSelectPayload,
} from '@/components/agent/propose/ChapterMarkPlanCard'
import { ProposeMarkBlockList, ProposeMarkChatBlock } from '@/components/agent/propose/ProposeMarkChatBlock'
import type { ResolveMarkProposal } from '@/components/agent/tools/AgentBlockRenderer'
import { dismissProposedMark } from '@/lib/agent/context/propose-mark'
import { AgentMarkdownFallback, AgentMarkdownLazy } from '@/components/markdown/AgentMarkdown.lazy'
import { cn } from '@/lib/utils'
import type { AcpChatMessage } from '@/stores/acp-chat-types'
import '@/styles/markdown-preview.css'

interface AgentMessageBubbleProps {
  message: AcpChatMessage
  resolveMarkProposal?: ResolveMarkProposal
  onChapterPlanSelect?: (payload: ChapterMarkPlanSelectPayload) => void
}

export function AgentMessageBubble({
  message,
  resolveMarkProposal,
  onChapterPlanSelect,
}: AgentMessageBubbleProps) {
  const resolveFromStore = useAcpUiStore((s) => s.resolveMarkProposal)
  const resolve = resolveMarkProposal ?? resolveFromStore
  const pendingPermission = useAcpPendingPermission()

  const handleResolved: ResolveMarkProposal = (proposalId, status) => {
    resolve(proposalId, status)
    if (status === 'adopted' || status === 'dismissed') dismissProposedMark()
  }
  const active = Boolean(message.streaming)
  const renderText = message.text

  if (message.role === 'system') {
    return (
      <AgentChatItem variant="system" probe="system" messageId={message.id} role="system">
        {message.text}
      </AgentChatItem>
    )
  }

  if (message.role === 'tool') {
    if (message.markProposal && message.markProposalStatus !== 'dismissed') {
      // 批注提议分支同样外挂审批槽：命中 pending 的工具不能因为不走工具卡就丢审批
      return (
        <>
          <ProposeMarkChatBlock
            proposal={message.markProposal}
            status={message.markProposalStatus ?? 'pending'}
            onResolved={(status) => handleResolved(message.markProposal!.id, status)}
          />
          <ToolApprovalSlot message={message} />
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
      hasBusinessResult(detail, message.toolTitle)
    ) {
      return <AgentResultEntry message={message} />
    }
    return (
      <AgentToolCallCard message={message} />
    )
  }

  if (message.role === 'plan') {
    return <AgentPlanCard message={message} />
  }

  if (message.role === 'thought') {
    const preview = message.text.replace(/\s+/g, ' ').trim()
    const collapsedLabel = message.streaming
      ? '思考中'
      : preview
        ? `思考 · ${preview.slice(0, 48)}${preview.length > 48 ? '…' : ''}`
        : '思考'

    return (
      <Reasoning defaultOpen={false} isStreaming={Boolean(message.streaming)} data-acp-probe="thought" className="mb-0 min-w-0">
        <ReasoningTrigger className="min-h-11 text-xs focus-visible:ring-2 focus-visible:ring-ring" getThinkingMessage={() => collapsedLabel} />
        <ReasoningContent className="min-w-0 pb-2 text-xs text-muted-foreground">
          <AssistantMarkdownText text={message.text} streaming={Boolean(message.streaming)} />
        </ReasoningContent>
      </Reasoning>
    )
  }

  const isUser = message.role === 'user'
  const showEmptyStreaming = !isUser && message.streaming && !message.text.trim()
  // 排空期间保持流式外衣，避免闪烁切换
  const showStreaming = active && !isUser
  const markdownClassName = useMemo(
    () =>
      cn(
        'markdown-preview agent-md min-w-0 max-w-full break-words text-[12px] [overflow-wrap:anywhere]',
        '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
        '[&_.mermaid]:my-2 [&_.mermaid]:overflow-x-auto [&_.mermaid]:rounded-md [&_.mermaid]:bg-muted/40 [&_.mermaid]:p-2',
      ),
    [],
  )

  return (
    <AgentChatItem
      variant="bubble"
      tone={isUser ? 'user' : 'agent'}
      align={isUser ? 'end' : 'start'}
      streaming={isUser ? Boolean(message.streaming) : active}
      probe={isUser ? 'user' : 'agent'}
      messageId={message.id}
      role={message.role}
    >
      {isUser ? (
        <div className="flex min-w-0 flex-col gap-1.5">
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
            <div className="flex items-center justify-end pt-0.5 select-none font-mono text-[10px] text-muted-foreground/60">
              {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          ) : null}
        </div>
      ) : showEmptyStreaming ? (
        <div className="flex items-center gap-2 py-1 text-[11px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-primary animate-pulse" />
          <span>正在思考…</span>
        </div>
      ) : (
        <div className="relative min-w-0">
          <AssistantMarkdownText text={renderText} streaming={showStreaming} />
        </div>
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
