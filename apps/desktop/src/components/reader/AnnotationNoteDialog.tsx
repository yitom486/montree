import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Sparkles, ChevronDown, ChevronUp } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  ANNOTATION_DIRECTION_CHIPS,
  ANNOTATION_INTENT_CHIPS,
  ANNOTATION_REFINE_CHIPS,
  type AnnotationIntentId,
} from '@/lib/agent/annotation-note-prompts'
import { useAnnotationAgentAssist } from '@/hooks/agent/useAnnotationAgentAssist'
import {
  selectAnnotationActiveMessages,
  useAnnotationAgentStore,
} from '@/stores/annotation-agent-store'
import { ProposeMarkChatBlock } from '@/components/agent/propose/ProposeMarkChatBlock'
import { groupAgentMessages } from '@/components/agent/chat/AgentActivityGroup'
import { AgentMessageBubble } from '@/components/agent/chat/AgentMessageBubble'
import { AgentScrollToBottomButton } from '@/components/agent/chat/AgentScrollToBottomButton'
import { useStickToBottomScroll } from '@/hooks/agent/useStickToBottomScroll'
import { toProposedMark } from '@montree/annotations'
import { toast } from 'sonner'

interface AnnotationNoteDialogProps {
  open: boolean
  excerpt?: string
  initialNote?: string
  title?: string
  filePath: string
  fileFingerprint?: string
  /** 是否提供 AI 能力（默认开；界面默认仍先手写） */
  aiAssist?: boolean
  onOpenChange: (open: boolean) => void
  onSave: (note: string) => void
}

export function AnnotationNoteDialog({
  open,
  excerpt = '',
  initialNote = '',
  title = '添加批注',
  filePath,
  fileFingerprint = '',
  aiAssist = true,
  onOpenChange,
  onSave,
}: AnnotationNoteDialogProps) {
  const [note, setNote] = useState('')
  /** 默认收起：先手写，需要时再展开 AI */
  const [showAi, setShowAi] = useState(false)
  const [askText, setAskText] = useState('')
  const [excerptOpen, setExcerptOpen] = useState(true)
  const [polishPreview, setPolishPreview] = useState<string | null>(null)
  const askInputRef = useRef<HTMLTextAreaElement>(null)
  const noteInputRef = useRef<HTMLTextAreaElement>(null)
  const aiMessagesRef = useRef<HTMLDivElement>(null)

  const assist = useAnnotationAgentAssist({
    filePath,
    fileFingerprint,
    excerpt,
  })

  const messages = useAnnotationAgentStore(
    useShallow((s) => selectAnnotationActiveMessages(s)),
  )
  const resolveMarkProposal = useAnnotationAgentStore((s) => s.resolveMarkProposal)

  const hasDraft = Boolean(assist.pendingDraft)
  const canPolish = aiAssist && note.trim().length > 0
  const streamingAny =
    messages.some((m) => m.streaming) || assist.busy || assist.phase === 'generating'
  const stickToBottomState = useMemo(
    () => ({
      messageCount: messages.length,
      lastMessageId: messages.at(-1)?.id,
      lastMessageStreaming: Boolean(messages.at(-1)?.streaming),
      prompting: assist.busy,
    }),
    [messages.length, messages.at(-1)?.id, messages.at(-1)?.streaming, assist.busy],
  )
  const { pinned, scrollToBottom } = useStickToBottomScroll({
    contentRef: aiMessagesRef,
    messageState: stickToBottomState,
    streaming: streamingAny,
  })

  useEffect(() => {
    if (!open) return
    setNote(initialNote)
    setShowAi(false)
    setAskText('')
    setExcerptOpen(true)
    setPolishPreview(null)
    assist.prepare()
    assist.dismissComposeHint()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open edge
  }, [open, excerpt, initialNote, aiAssist])

  useEffect(() => {
    if (assist.pendingDraft) {
      setNote(assist.pendingDraft.note)
      setPolishPreview(null)
    }
  }, [assist.pendingDraft])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      if (showAi) askInputRef.current?.focus()
      else noteInputRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [open, showAi, hasDraft, assist.phase, assist.awaitingDirection])

  const handleIntent = async (id: AnnotationIntentId) => {
    if (id === 'custom') {
      askInputRef.current?.focus()
      return
    }
    if (!assist.agentReady) {
      toast.message('请先连接 AI')
      return
    }
    await assist.sendChat(id)
  }

  const handleAskSend = async () => {
    if (!askText.trim() && !assist.awaitingDirection) return
    if (!assist.agentReady) {
      toast.message('请先连接 AI')
      return
    }
    const text = askText
    setAskText('')
    await assist.sendChat('custom', text)
  }

  const handleComposeNow = () => {
    void assist.writeNoteNow()
  }

  const handleDirectionChip = async (hint: string) => {
    await assist.writeNoteNow(hint)
  }

  const handleRecompose = () => {
    if (!assist.agentReady) {
      toast.message('请先连接 AI')
      return
    }
    assist.requestComposeDirection()
    window.setTimeout(() => askInputRef.current?.focus(), 0)
  }

  const handlePolish = async () => {
    if (!assist.agentReady) {
      toast.message('请先连接 AI')
      return
    }
    const polished = await assist.polishNote(note)
    if (polished) setPolishPreview(polished)
  }

  const handleAdoptPolish = () => {
    if (!polishPreview) return
    setNote(polishPreview)
    if (assist.pendingDraft) assist.updatePendingNote(polishPreview)
    setPolishPreview(null)
    toast.message('已替换为润色稿，确认无误后再保存')
  }

  const handleAdopt = () => {
    const text = (assist.pendingDraft?.note ?? note).trim()
    onSave(text)
    assist.discardDraft()
    onOpenChange(false)
  }

  const handleSaveHandwrite = () => {
    onSave(note.trim())
    assist.discardDraft()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(90vh,720px)] flex-col gap-3 overflow-hidden sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          window.setTimeout(() => noteInputRef.current?.focus(), 0)
        }}
      >
        <DialogHeader className="space-y-1">
          <DialogTitle>{title}</DialogTitle>
          {aiAssist ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant={showAi ? 'secondary' : 'ghost'}
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => setShowAi((value) => !value)}
              >
                <Sparkles className="size-3.5" />
                {showAi ? '收起 AI' : '用 AI 聊'}
              </Button>
              {showAi ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  disabled={assist.busy}
                  onClick={() => assist.newSession()}
                >
                  新会话
                </Button>
              ) : null}
            </div>
          ) : null}
        </DialogHeader>

        {excerpt ? (
          <div className="shrink-0 space-y-1">
            <button
              type="button"
              className="flex items-center gap-1 text-[11px] text-muted-foreground"
              onClick={() => setExcerptOpen((value) => !value)}
            >
              {excerptOpen ? (
                <ChevronUp className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
              划线原文
            </button>
            {excerptOpen ? (
              <blockquote className="max-h-20 overflow-y-auto border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground italic">
                {excerpt}
              </blockquote>
            ) : null}
          </div>
        ) : null}

        {/* 主路径：始终可手写 */}
        <div className="shrink-0 space-y-2">
          <textarea
            ref={noteInputRef}
            value={note}
            onChange={(event) => {
              setNote(event.target.value)
              setPolishPreview(null)
              if (assist.pendingDraft) {
                assist.updatePendingNote(event.target.value)
              }
            }}
            placeholder="写下你的想法…"
            rows={4}
            className="flex min-h-[88px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {!showAi && aiAssist ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1 px-2.5 text-xs"
                disabled={assist.busy || !canPolish}
                onClick={() => void handlePolish()}
              >
                <Sparkles className="size-3.5" />
                {assist.phase === 'generating' ? '润色中…' : 'AI 润色'}
              </Button>
              <span className="text-[11px] text-muted-foreground">
                先手写；需要时再润色或点上方「用 AI 聊」
              </span>
            </div>
          ) : null}
          {polishPreview ? (
            <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-2">
              <p className="text-[11px] font-medium">润色预览（尚未替换）</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{polishPreview}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={handleAdoptPolish}
                >
                  替换原文
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setPolishPreview(null)}
                >
                  不用
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {showAi && aiAssist ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
            {hasDraft && assist.pendingDraft ? (
              <ProposeMarkChatBlock
                defaultExpanded
                proposal={toProposedMark({
                  id: `annotation:${assist.pendingDraft.fileKey}`,
                  excerpt: assist.pendingDraft.excerpt || excerpt,
                  note: assist.pendingDraft.note,
                  source: 'annotation',
                })}
                onNoteChange={(value) => {
                  setNote(value)
                  assist.updatePendingNote(value)
                }}
                onAdopt={async (text) => {
                  onSave(text)
                  assist.discardDraft()
                  onOpenChange(false)
                }}
                onDismiss={() => assist.discardDraft()}
                extraActions={
                  <>
                    {ANNOTATION_REFINE_CHIPS.map((chip) => (
                      <Button
                        key={chip.id}
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 rounded-full px-2.5 text-[11px]"
                        disabled={assist.busy}
                        onClick={() => void assist.runRefine(chip.id)}
                      >
                        {chip.label}
                      </Button>
                    ))}
                  </>
                }
              />
            ) : null}

            <div className="relative min-h-0 flex-1">
              <div className="min-h-0 h-full space-y-2 overflow-y-auto rounded-md border border-border/60 p-2">
                <div ref={aiMessagesRef} className="space-y-2">
              {messages.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  先聊聊这段话。想留批注时点「写成批注」或说「写批注」即可生成到上方。
                </p>
              ) : (
                groupAgentMessages(messages).map((item) =>
                  item.type === 'activity' ? (
                    <div
                      key={item.messages.map((m) => m.id).join('-')}
                      className="space-y-1 opacity-80"
                    >
                      {item.messages.map((message) => (
                        <AgentMessageBubble
                          key={message.id}
                          message={message}
                          resolveMarkProposal={resolveMarkProposal}
                        />
                      ))}
                    </div>
                  ) : (
                    <AgentMessageBubble
                      key={item.message.id}
                      message={item.message}
                      resolveMarkProposal={resolveMarkProposal}
                    />
                  ),
                )
              )}
              {assist.phase === 'generating' && !polishPreview ? (
                <p className="text-xs text-muted-foreground">正在整理…</p>
              ) : null}
                </div>
              </div>
              {!pinned && messages.length > 0 ? (
                <AgentScrollToBottomButton
                  className="absolute bottom-2 left-1/2 z-10 h-7 -translate-x-1/2 gap-1 rounded-full border border-border/60 bg-background/95 px-3 text-[11px] shadow-md backdrop-blur-sm"
                  onClick={scrollToBottom}
                />
              ) : null}
            </div>

            {!hasDraft ? (
              <div className="shrink-0 space-y-2">
                {assist.awaitingDirection ? (
                  <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-2">
                    <p className="text-[11px] font-medium text-foreground">
                      方向可选，空白也可直接生成
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {ANNOTATION_DIRECTION_CHIPS.map((chip) => (
                        <Button
                          key={chip.id}
                          type="button"
                          size="sm"
                          variant={chip.id === 'direct' ? 'default' : 'secondary'}
                          className="h-7 rounded-full px-2.5 text-xs"
                          disabled={assist.busy}
                          onClick={() => void handleDirectionChip(chip.hint)}
                        >
                          {chip.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {ANNOTATION_INTENT_CHIPS.map((chip) => (
                        <Button
                          key={chip.id}
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 rounded-full px-2.5 text-xs"
                          disabled={assist.busy}
                          onClick={() => void handleIntent(chip.id)}
                        >
                          {chip.label}
                        </Button>
                      ))}
                    </div>
                    {(assist.composeHint || messages.length > 0) && !assist.busy ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5">
                        <span className="text-[11px] text-muted-foreground">
                          聊得差不多了？
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 px-2.5 text-xs"
                          disabled={assist.busy}
                          onClick={() => handleComposeNow()}
                        >
                          写成批注
                        </Button>
                        {assist.composeHint ? (
                          <button
                            type="button"
                            className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                            onClick={() => assist.dismissComposeHint()}
                          >
                            先不写
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ) : (
              <div className="shrink-0">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs"
                  disabled={assist.busy}
                  onClick={() => handleRecompose()}
                >
                  换个方向再写
                </Button>
              </div>
            )}

            <div className="flex shrink-0 flex-col gap-2">
              <textarea
                ref={askInputRef}
                value={askText}
                onChange={(event) => setAskText(event.target.value)}
                placeholder={
                  assist.awaitingDirection
                    ? '可选：写一句方向，或留空直接发送…'
                    : '继续问，或说「写批注」直接生成…'
                }
                rows={2}
                className="flex min-h-[56px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void handleAskSend()
                  }
                }}
              />
              {!assist.agentReady ? (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  未连接 AI 时可先手写保存。
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <DialogFooter className="shrink-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          {showAi && hasDraft ? (
            <Button
              onClick={handleAdopt}
              disabled={!note.trim() && !assist.pendingDraft?.note.trim()}
            >
              采用并保存
            </Button>
          ) : showAi && !hasDraft ? (
            <Button
              disabled={
                assist.busy || (!askText.trim() && !assist.awaitingDirection)
              }
              onClick={() => void handleAskSend()}
            >
              发送
            </Button>
          ) : (
            <Button onClick={handleSaveHandwrite} disabled={assist.busy}>
              保存
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
