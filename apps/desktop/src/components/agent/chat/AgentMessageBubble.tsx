import { ArrowRight, Check, Copy, Layers, Pencil } from 'lucide-react'
import { Suspense, useDeferredValue, useMemo, useState } from 'react'
import {
  AgentChatItem,
} from '@/components/agent/chat/AgentChatItem'
import { BuiMessage } from '@/components/agent/chat/BuiMessage'
import { BuiThinking } from '@/components/agent/chat/BuiThinking'
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
import { ProposeMarkBlockList, ProposeMarkChatBlock, type ResolveMarkProposal } from '@/components/agent/propose/ProposeMarkChatBlock'
import { dismissProposedMark } from '@/lib/agent/context/propose-mark'
import { useRevealText } from '@/hooks/agent/useRevealText'
import { AgentMarkdownFallback, AgentMarkdownLazy } from '@/components/markdown/AgentMarkdown.lazy'
import { cn } from '@/lib/utils'
import type { AcpChatMessage } from '@/stores/acp-chat-types'
import '@/styles/markdown-preview.css'

interface AgentMessageBubbleProps {
  message: AcpChatMessage
  resolveMarkProposal?: ResolveMarkProposal
  onChapterPlanSelect?: (payload: ChapterMarkPlanSelectPayload) => void
  /**
   * 用户消息“编辑后继续”：把原文回填输入框由用户续改后发新回合。
   * 无分支重写语义；缺省时不渲染编辑按钮。
   */
  onEditMessage?: (text: string) => void
}

export function AgentMessageBubble({
  message,
  resolveMarkProposal,
  onChapterPlanSelect,
  onEditMessage,
}: AgentMessageBubbleProps) {
  const resolveFromStore = useAcpUiStore((s) => s.resolveMarkProposal)
  const resolve = resolveMarkProposal ?? resolveFromStore
  const pendingPermission = useAcpPendingPermission()
  const [copied, setCopied] = useState(false)
  // 思考展开由本气泡受控：跨流式更新与落定保持（挂载期内不重置）
  const [thoughtOpen, setThoughtOpen] = useState(false)

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
    resolve(proposalId, status)
    if (status === 'adopted' || status === 'dismissed') dismissProposedMark()
  }
  const active = Boolean(message.streaming)
  // 流式平滑：chunk 进缓冲，rAF 匀速揭示；重解析再 defer 让路滚动/输入。
  // 只切片原文，下游单 Streamdown 实例与安全语义不变。
  const renderText = useDeferredValue(useRevealText(message.text, Boolean(message.streaming)))
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
      <div data-acp-probe="thought" className="mb-0 min-w-0">
        <BuiThinking
          state={message.streaming ? 'running' : 'done'}
          titleActive="思考中"
          titleDone={collapsedLabel}
          rows={[]}
          expanded={thoughtOpen}
          onToggle={() => setThoughtOpen((v) => !v)}
          partKey={`thought-${message.id}`}
          body={
            <Suspense fallback={<AgentMarkdownFallback text={message.text} />}>
              <AgentMarkdownLazy text={renderText} streaming={Boolean(message.streaming)} className={markdownClassName} />
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

  return (
    <AgentChatItem
      variant="bubble"
      bare={isUser}
      tone={isUser ? 'user' : 'agent'}
      align={isUser ? 'end' : 'start'}
      streaming={isUser ? Boolean(message.streaming) : active}
      probe={isUser ? 'user' : 'agent'}
      messageId={message.id}
      role={message.role}
      className={!isUser && showStreaming ? 'agent-beam-ring agent-beam-ring-emerald rounded-lg' : undefined}
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
        <div className="flex items-center gap-2 py-1 text-[11px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-primary animate-pulse" />
          <span>正在思考…</span>
        </div>
      ) : (
        <>
          <Suspense
            fallback={
              <AgentMarkdownFallback text={renderText} className={markdownClassName} />
            }
          >
            <AgentMarkdownLazy text={renderText} streaming={showStreaming} className={markdownClassName} />
          </Suspense>
          {!showEmptyStreaming && message.text ? (
            <div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100">
              <button
                type="button"
                aria-label="复制回答原文"
                title="复制回答原文（Markdown）"
                onClick={() => void copyText(message.text)}
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground/80 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              >
                {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
              </button>
            </div>
          ) : null}
        </>
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
