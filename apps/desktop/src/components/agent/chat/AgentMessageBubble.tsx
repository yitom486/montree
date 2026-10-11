import { ArrowRight, ChevronDown, ChevronRight, Layers, Loader2, Sparkles } from 'lucide-react'
import { useMemo } from 'react'
import { useSmoothStreamingText, useThrottledValue } from '@/hooks/agent/useSmoothStreamingText'
import {
  AgentChatItem,
  AgentChatItemBody,
  useAgentChatOpen,
} from '@/components/agent/chat/AgentChatItem'
import { AgentToolCallCard } from '@/components/agent/tools/AgentToolCallCard'
import { ToolApprovalSlot } from '@/components/agent/permission/ToolApprovalSlot'
import { AgentPlanCard } from '@/components/agent/tools/AgentPlanCard'
import {
  ChapterMarkPlanCard,
  type ChapterMarkPlanSelectPayload,
} from '@/components/agent/propose/ChapterMarkPlanCard'
import { ProposeMarkBlockList, ProposeMarkChatBlock } from '@/components/agent/propose/ProposeMarkChatBlock'
import type { ResolveMarkProposal } from '@/components/agent/tools/AgentBlockRenderer'
import { dismissProposedMark } from '@/lib/agent/context/propose-mark'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { MarkdownContent } from '@/components/markdown/MarkdownContent'
import { renderAgentMarkdown, renderStreamingTail } from '@/lib/agent/agent-markdown'
import { splitStableTail } from '@/lib/agent/streaming-split'
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

  const handleResolved: ResolveMarkProposal = (proposalId, status) => {
    resolve(proposalId, status)
    if (status === 'adopted' || status === 'dismissed') dismissProposedMark()
  }
  const [thoughtOpen, setThoughtOpen] = useAgentChatOpen(Boolean(message.streaming))

  // 流式：rAF 自适应揭示 + 32ms 可见更新 + 稳定区冻结复用（只重绘尾部）；
  // active 区分接收结束与展示结束：排空完才切精确全文，避免尾部跳变
  const streaming = Boolean(message.streaming)
  const { text: displayed, active } = useSmoothStreamingText(message.text, streaming)
  const throttled = useThrottledValue(displayed, 32, active)
  const renderText = active ? throttled : message.text
  const { stable, tail } = useMemo(
    () => (active ? splitStableTail(renderText) : { stable: renderText, tail: '' }),
    [renderText, active],
  )
  const stableHtml = useMemo(() => {
    if (message.role !== 'agent') return null
    if (!stable.trim() && active) return null
    return renderAgentMarkdown(stable, { streaming: active })
  }, [stable, message.role, active])
  const tailHtml = useMemo(() => {
    if (message.role !== 'agent' || !active) return null
    if (!tail) return ''
    return renderStreamingTail(renderText, tail)
  }, [tail, renderText, message.role, active])
  const html = useMemo(() => {
    if (message.role !== 'agent') return null
    if (active) return null
    if (!renderText.trim()) return null
    return renderAgentMarkdown(renderText, { streaming: false })
  }, [renderText, message.role, active])

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
      <AgentChatItem
        variant="card"
        tone="thought"
        streaming={Boolean(message.streaming)}
        probe="thought"
        messageId={message.id}
        role="thought"
      >
        <button
          type="button"
          className="flex w-full min-w-0 items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground"
          onClick={() => setThoughtOpen((v) => !v)}
        >
          {thoughtOpen ? (
            <ChevronDown className="size-3.5 shrink-0" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0" />
          )}
          <Sparkles className="size-3.5 shrink-0 text-amber-500/80" />
          <span className="min-w-0 flex-1 truncate">
            {thoughtOpen ? (message.streaming ? '思考中' : '思考') : collapsedLabel}
          </span>
          {message.streaming ? (
            <Loader2 className="size-3 shrink-0 animate-spin text-amber-500" />
          ) : null}
        </button>
        {thoughtOpen ? (
          <AgentChatItemBody className="border-border/30 text-[11px] leading-relaxed text-muted-foreground italic">
            <div className="min-w-0 break-words border-l-2 border-amber-500/30 pl-2.5 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {message.text}
              {message.streaming ? (
                <span className="ml-1 inline-block h-2.5 w-1 animate-pulse rounded-sm bg-amber-500/60 align-middle" />
              ) : null}
            </div>
          </AgentChatItemBody>
        ) : null}
      </AgentChatItem>
    )
  }

  const isUser = message.role === 'user'
  const showEmptyStreaming = !isUser && message.streaming && !message.text.trim()
  // 排空期间保持流式外衣，避免闪烁切换
  const showStreaming = active && !isUser

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
      {!isUser ? (
        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          Agent
          {showStreaming ? (
            <Loader2 className="size-3 animate-spin text-emerald-500" />
          ) : null}
        </div>
      ) : null}

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
        </div>
      ) : showEmptyStreaming ? (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex gap-1">
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:-0.2s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:-0.1s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70" />
          </span>
          正在生成
        </div>
      ) : active && !isUser ? (
        <>
          {stableHtml ? (
            <MarkdownContent
              html={stableHtml}
              deferMermaid
              className={cn(
                'markdown-preview agent-md min-w-0 max-w-full break-words text-[12px] [overflow-wrap:anywhere]',
                '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
                '[&_.mermaid]:my-2 [&_.mermaid]:overflow-x-auto [&_.mermaid]:rounded-md [&_.mermaid]:bg-muted/40 [&_.mermaid]:p-2',
              )}
            />
          ) : null}
          {tailHtml ? (
            <MarkdownContent
              html={tailHtml}
              deferMermaid
              className={cn(
                'markdown-preview agent-md min-w-0 max-w-full break-words text-[12px] [overflow-wrap:anywhere]',
                '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
                '[&_.mermaid]:my-2 [&_.mermaid]:overflow-x-auto [&_.mermaid]:rounded-md [&_.mermaid]:bg-muted/40 [&_.mermaid]:p-2',
              )}
            />
          ) : null}
        </>
      ) : (
        <MarkdownContent
          html={html ?? ''}
          deferMermaid={false}
          className={cn(
            'markdown-preview agent-md min-w-0 max-w-full break-words text-[12px] [overflow-wrap:anywhere]',
            '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
            '[&_.mermaid]:my-2 [&_.mermaid]:overflow-x-auto [&_.mermaid]:rounded-md [&_.mermaid]:bg-muted/40 [&_.mermaid]:p-2',
          )}
        />
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
      {showStreaming && !showEmptyStreaming ? (
        <span className="mt-0.5 inline-block h-3.5 w-0.5 animate-pulse rounded-sm bg-foreground/60 align-middle" />
      ) : null}
    </AgentChatItem>
  )
}
