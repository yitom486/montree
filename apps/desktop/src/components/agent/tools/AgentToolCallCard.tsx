import {
  FilePenLine,
  FileText,
  FolderInput,
  Globe,
  Search,
  Sparkles,
  Terminal,
  Trash2,
  Wrench,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AgentChatItem,
  AGENT_CHAT_PRE_CLASS,
} from '@/components/agent/chat/AgentChatItem'
import { AgentDiffPreview } from '@/components/agent/tools/AgentDiffPreview'
import { ToolApprovalSlot } from '@/components/agent/permission/ToolApprovalSlot'
import { ToolBusinessResult, hasBusinessResult } from '@/components/agent/tools/ToolBusinessResult'
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolOutput,
  ToolStateIcon,
  getToolStateBadge,
  type AiToolState,
} from '@/components/ai-elements/tool'
import { Button } from '@/components/ui/button'
import { toolMessageNeedsApproval } from '@/lib/agent/acp-permission-ui'
import { isProposeMarkToolTitle } from '@/lib/agent/parse-mark-proposal'
import {
  classifyMarkProposalFailure,
  openChapterForMarkRecovery,
  promptSelectTextForMarkRecovery,
} from '@/lib/agent/mark-proposal-failure'
import {
  type AcpChatMessage,
  type AcpToolLocation,
} from '@/stores/acp-chat-types'
import {
  toToolDisplayModel,
  type ToolDisplayState,
} from '@/lib/agent/tool-display-model'
import { useAcpPendingPermission } from '@/stores/acp-ui-store'

function kindIcon(kind: string | undefined): ReactNode {
  const className = 'size-3.5 shrink-0 text-muted-foreground'
  switch (kind) {
    case 'read':
      return <FileText className={className} />
    case 'edit':
      return <FilePenLine className={className} />
    case 'delete':
      return <Trash2 className={className} />
    case 'move':
      return <FolderInput className={className} />
    case 'search':
      return <Search className={className} />
    case 'execute':
      return <Terminal className={className} />
    case 'think':
      return <Sparkles className={className} />
    case 'fetch':
      return <Globe className={className} />
    default:
      return <Wrench className={className} />
  }
}

/** ACP 展示状态 → 社区 Tool 状态（边界唯一映射：取消/未知不进成功）。 */
function toAiToolState(state: ToolDisplayState): AiToolState {
  switch (state) {
    case 'awaiting-approval':
      return 'awaiting-approval'
    case 'pending':
      return 'pending'
    case 'in-progress':
      return 'running'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'error'
    case 'cancelled':
      return 'cancelled'
    case 'unknown':
      return 'unknown'
  }
}

interface AgentToolCallCardProps {
  message: AcpChatMessage
}

export function AgentToolCallCard({ message }: AgentToolCallCardProps) {
  const pendingPermission = useAcpPendingPermission()
  const needsApproval = toolMessageNeedsApproval(message, pendingPermission)
  const display = toToolDisplayModel(message, { needsApproval })
  const aiState = toAiToolState(display.state)
  // 进行中判定只看消息自身的 streaming（store 归并已保证 active 即 streaming），
  // 不再用 toolStatus 兜底：落定的未知残留不再顶着进行中样式。
  const streaming = Boolean(message.streaming) || needsApproval

  // 展开规则：成功默认收起；失败默认展开一次；流式进行中默认展开；
  // 富业务结果（图表/互引/审计/建议）默认展开，直接呈现在主流中。
  // 用户手动切换后不再被流式更新重置：记录用户是否主动选择过，
  // 未主动选择时随 completed/cancelled/unknown 落定自动收起（富结果除外）；
  // 失败到达后补开一次。流式 chunk 本身不碰 open。
  const diffs = message.toolDiffs ?? []
  const detail = message.toolContentText || message.text
  const locations = message.toolLocations ?? []
  const hasRichResult = hasBusinessResult(detail, message.toolTitle)
  const [open, setOpen] = useState(
    () => display.state === 'failed' || streaming || hasRichResult,
  )
  const userTouchedRef = useRef(false)
  const handleOpenChange = useCallback((next: boolean) => {
    userTouchedRef.current = true
    setOpen(next)
  }, [])
  const openedForFailureRef = useRef(display.state === 'failed')
  useEffect(() => {
    if (display.state === 'failed' && !openedForFailureRef.current) {
      openedForFailureRef.current = true
      setOpen(true)
      return
    }
    if (
      (display.state === 'completed' ||
        display.state === 'cancelled' ||
        display.state === 'unknown') &&
      !userTouchedRef.current &&
      !hasRichResult
    ) {
      setOpen(false)
    }
  }, [display.state, hasRichResult])

  const failed = display.state === 'failed'
  const proposeFailed =
    failed &&
    (isProposeMarkToolTitle(message.toolTitle) ||
      /propose.?mark|suggest.?chapters/i.test(message.toolTitle ?? ''))
  const failureGuide = proposeFailed
    ? classifyMarkProposalFailure(detail || message.toolTitle || '标记定位失败')
    : null
  // 失败时用业务说明，不再把原始报错塞进 pre
  const hasTextDetail =
    Boolean(detail && detail !== message.toolTitle && diffs.length === 0) && !failed

  return (
    <AgentChatItem
      variant="card"
      tone={needsApproval ? 'tool-pending' : 'tool'}
      streaming={streaming}
      probe="tool"
      messageId={message.id}
      role="tool"
    >
      {!display.hasBodyDetails ? (
        <div className="flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5">
          <ToolStateIcon state={aiState} />
          {kindIcon(message.toolKind)}
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground/90">
            {display.title}
            {display.targetSummary ? (
              <span className="ml-1.5 font-normal text-muted-foreground">
                {display.targetSummary}
              </span>
            ) : null}
          </span>
          {getToolStateBadge(aiState)}
        </div>
      ) : (
        <Tool open={open} onOpenChange={handleOpenChange}>
          <ToolHeader
            title={display.title}
            target={display.targetSummary}
            state={aiState}
            summary={display.errorHeadline}
            kindIcon={kindIcon(message.toolKind)}
          />
          <ToolContent>
            {locations.length > 0 && diffs.length === 0 ? (
              <ul className="min-w-0 space-y-0.5">
                {locations.map((loc: AcpToolLocation) => (
                  <li
                    key={`${loc.path}:${loc.line ?? ''}`}
                    className="truncate font-mono text-[10px] text-muted-foreground"
                    title={loc.path}
                  >
                    {loc.path.split(/[\\/]/).pop() || loc.path}
                    {loc.line != null ? `:${loc.line}` : ''}
                  </li>
                ))}
              </ul>
            ) : null}
            {diffs.length > 0 ? <AgentDiffPreview diffs={diffs} /> : null}
            {display.errorBody ? (
              <ToolOutput errorText={display.errorBody} />
            ) : null}
            <ToolBusinessResult message={message} />
            {hasRichResult || !hasTextDetail ? null : (
              <pre className={AGENT_CHAT_PRE_CLASS}>{detail}</pre>
            )}
            {failureGuide ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {failureGuide.canOpenChapter ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-[11px]"
                    onClick={() => {
                      void openChapterForMarkRecovery(failureGuide.flatIndex)
                    }}
                  >
                    打开该章
                  </Button>
                ) : null}
                {failureGuide.canSelectText ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2.5 text-[11px]"
                    onClick={() => promptSelectTextForMarkRecovery()}
                  >
                    去划词
                  </Button>
                ) : null}
              </div>
            ) : null}
          </ToolContent>
        </Tool>
      )}
      {/* 审批操作在折叠容器外：收起工具详情不影响批准/拒绝，且全时间线只有这一份；
          无正文的静态行同样外挂，保证待审批工具永远有一份可见操作 */}
      {needsApproval ? (
        <div className="px-2.5 pb-2">
          <ToolApprovalSlot message={message} />
        </div>
      ) : null}
    </AgentChatItem>
  )
}
