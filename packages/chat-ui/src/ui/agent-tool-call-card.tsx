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
// 自宿主 `apps/desktop/src/components/agent/tools/AgentToolCallCard.tsx` 整搬改名改 props（M3c 工具卡批）：
// `AgentChatItem/AGENT_CHAT_PRE_CLASS` 改 `./AgentChatItem`；`AgentDiffPreview` 改包内私有 `./agent-diff-preview`；
// `ToolApprovalSlot` 改 `./tool-approval-slot`；`Tool*` 改包内私有 `./tool-shell`（宿主 `ai-elements/tool` 逐字复刻）；
// `Button` 改包内私有 `./button`；`toolMessageNeedsApproval/isProposeMarkToolTitle/toToolDisplayModel` 改 `@montree/chat-core`；
// `AcpChatMessage/AcpToolLocation` 即 core 的 `ChatMessage/ChatToolLocation`；其余渲染逻辑逐字不变。
// props-ify（见 `docs/chat-render-m3-inventory.md`）：
// - `useAcpPendingPermission()` → 必填前可选 `pending`（包内 `AgentApprovalPending | null` 全量结构，宿主 store 值直传）
//   + 必填前可选 `onRespond`（宿主 `respondPermissionRequest` 直传；缺省静默不断言）；
// - 恢复操作 `openChapterForMarkRecovery/promptSelectTextForMarkRecovery` →
//   `onRecoverChapter?(flatIndex?)/onPromptSelectText?()`（宿主原函数直传；缺省静默）；
//   失败分类 `classifyMarkProposalFailure` 的 `reader-navigation-store` 读取改为可选 `navFlatIndex` prop（宿主传 `nav.flatIndex`；缺省 -1 即无可用章节）；
// - 宿主编排器 `ToolBusinessResult`（stays，不进包）→ 可选 `businessResultSlot?: ReactNode`
//  （宿主传 `<ToolBusinessResult message={message}/>`；缺省不渲染业务卡；`suppressBusinessResult` 照旧优先）。
import {
  AgentChatItem,
  AGENT_CHAT_PRE_CLASS,
} from './AgentChatItem'
import { AgentDiffPreview } from './agent-diff-preview'
import { ToolApprovalSlot } from './tool-approval-slot'
import type { AgentApprovalPending } from './agent-permission-card'
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolOutput,
  ToolStateIcon,
  getToolStateBadge,
  type AiToolState,
} from './tool-shell'
import { Button } from './button'
import { toolMessageNeedsApproval } from '@montree/chat-core'
import { isProposeMarkToolTitle } from '@montree/chat-core'
import {
  toToolDisplayModel,
  type ToolDisplayState,
} from '@montree/chat-core'
import type { ChatMessage as AcpChatMessage, ChatToolLocation as AcpToolLocation } from '@montree/chat-core'

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

export type MarkProposalFailureCode =
  | 'wrong-chapter'
  | 'no-excerpt'
  | 'reader-not-ready'
  | 'unknown'

export interface MarkProposalFailureGuide {
  code: MarkProposalFailureCode
  message: string
  flatIndex?: number
  canOpenChapter: boolean
  canSelectText: boolean
}

/**
 * 自宿主 `lib/agent/mark-proposal-failure.ts` 的纯分类部分（包内复刻，不进 barrel）：
 * 唯一改动：`useReaderNavigationStore.getState().nav.flatIndex` 改为入参 `navFlatIndex`（宿主传 store 值；缺省 -1）。
 */
function classifyMarkProposalFailure(
  message: string,
  navFlatIndex = -1,
): MarkProposalFailureGuide {
  const text = message.trim() || '标记定位失败'
  const navFlat = navFlatIndex

  const lower = text.toLowerCase()
  if (/未就绪|未打开|没有打开/.test(text)) {
    return {
      code: 'reader-not-ready',
      message: text,
      canOpenChapter: false,
      canSelectText: false,
    }
  }
  if (/打开该章|对应章|翻到|当前页|找不到该摘录|未在/.test(text) || /not found/i.test(lower)) {
    return {
      code: /章|chapter|flatindex/i.test(text) ? 'wrong-chapter' : 'no-excerpt',
      message: text,
      flatIndex: navFlat >= 0 ? navFlat : undefined,
      canOpenChapter: navFlat >= 0,
      canSelectText: true,
    }
  }
  if (/划词|选区|selection/.test(text)) {
    return {
      code: 'no-excerpt',
      message: text,
      flatIndex: navFlat >= 0 ? navFlat : undefined,
      canOpenChapter: false,
      canSelectText: true,
    }
  }
  return {
    code: 'unknown',
    message: text,
    flatIndex: navFlat >= 0 ? navFlat : undefined,
    canOpenChapter: navFlat >= 0,
    canSelectText: true,
  }
}

interface AgentToolCallCardProps {
  message: AcpChatMessage
  /**
   * 结果入口外壳使用：只渲染紧凑过程行与详情，不内嵌业务结果卡
   * （业务卡由结果入口独立渲染，单次调用只出现一处）。
   */
  suppressBusinessResult?: boolean
  /** 结果入口使用：跳过外层卡片壳，由入口提供唯一外壳，避免双层描边。 */
  bare?: boolean
  /** 工作记录已提供展开按钮，直接显示详情，不再叠第二层工具头。 */
  detailsOnly?: boolean
  /** 当前待审批（宿主 `useAcpPendingPermission()` 值直传；`null` 即无待审批） */
  pending?: AgentApprovalPending | null
  /** 审批响应（宿主 `respondPermissionRequest(pending, optionId)` 直传；缺省静默） */
  onRespond?: (optionId: string | null) => void
  /** 失败恢复：打开该章（宿主 `openChapterForMarkRecovery` 直传；缺省静默） */
  onRecoverChapter?: (flatIndex?: number) => void
  /** 失败恢复：去划词（宿主 `promptSelectTextForMarkRecovery` 直传；缺省静默） */
  onPromptSelectText?: () => void
  /** 失败分类用的当前章节（宿主 `reader-navigation-store.nav.flatIndex` 直传；缺省 -1） */
  navFlatIndex?: number
  /**
   * 宿主业务结果槽（stays 的 `ToolBusinessResult` 由宿主传
   * `<ToolBusinessResult message={message}/>`；缺省不渲染；`suppressBusinessResult` 照旧优先）。
   */
  businessResultSlot?: ReactNode
}

export function AgentToolCallCard({ message, suppressBusinessResult, bare, detailsOnly, pending = null, onRespond, onRecoverChapter, onPromptSelectText, navFlatIndex = -1, businessResultSlot }: AgentToolCallCardProps) {
  const pendingPermission = pending
  const needsApproval = toolMessageNeedsApproval(message, pendingPermission)
  const display = toToolDisplayModel(message, { needsApproval })
  const aiState = toAiToolState(display.state)
  // 进行中判定只看消息自身的 streaming（store 归并已保证 active 即 streaming），
  // 不再用 toolStatus 兜底：落定的未知残留不再顶着进行中样式。
  const streaming = Boolean(message.streaming) || needsApproval

  // 展开规则：成功/失败默认收起（失败摘要与恢复操作在行外常驻）；
  // 流式进行中也默认收起。富业务结果不再强制展开——结果入口自带独立呈现，
  // 此处只留紧凑过程行。用户手动切换后不再被流式更新重置；
  // 未主动选择时随 completed/cancelled/unknown 落定自动收起；
  // 流式 chunk 本身不碰 open。
  const diffs = message.toolDiffs ?? []
  const detail = message.toolContentText || message.text
  const locations = message.toolLocations ?? []
  const [open, setOpen] = useState(false)
  const userTouchedRef = useRef(false)
  const handleOpenChange = useCallback((next: boolean) => {
    userTouchedRef.current = true
    setOpen(next)
  }, [])
  useEffect(() => {
    if (
      (display.state === 'completed' ||
        display.state === 'cancelled' ||
        display.state === 'unknown') &&
      !userTouchedRef.current
    ) {
      setOpen(false)
    }
  }, [display.state])

  const failed = display.state === 'failed'
  const proposeFailed =
    failed &&
    (isProposeMarkToolTitle(message.toolTitle) ||
      /propose.?mark|suggest.?chapters/i.test(message.toolTitle ?? ''))
  const failureGuide = proposeFailed
    ? classifyMarkProposalFailure(detail || message.toolTitle || '标记定位失败', navFlatIndex)
    : null
  // 失败时用业务说明，不再把原始报错塞进 pre
  const hasTextDetail =
    Boolean(detail && detail !== message.toolTitle && diffs.length === 0) && !failed
  // 失败恢复操作（打开该章/去划词）在折叠外常驻：收起也能恢复，不依赖详情展开
  const recoveryActions = failureGuide ? (
    <div className="flex flex-wrap gap-1.5 px-2.5 pb-2">
      {failureGuide.canOpenChapter ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2.5 text-[11px]"
          onClick={() => {
            onRecoverChapter?.(failureGuide.flatIndex)
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
          onClick={() => onPromptSelectText?.()}
        >
          去划词
        </Button>
      ) : null}
    </div>
  ) : null

  const details = (
    <>
      {locations.length > 0 && diffs.length === 0 ? (
        <ul className="min-w-0 space-y-0.5">
          {locations.map((loc: AcpToolLocation) => (
            <li key={`${loc.path}:${loc.line ?? ''}`} className="truncate font-mono text-[10px] text-muted-foreground" title={loc.path}>
              {loc.path.split(/[\\/]/).pop() || loc.path}{loc.line != null ? `:${loc.line}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {diffs.length > 0 ? <AgentDiffPreview diffs={diffs} /> : null}
      {display.errorBody ? <ToolOutput errorText={display.errorBody} /> : null}
      {suppressBusinessResult ? null : businessResultSlot}
      {hasTextDetail ? <pre className={AGENT_CHAT_PRE_CLASS}>{detail}</pre> : null}
    </>
  )
  const body = (
    <>
      {detailsOnly ? details : !display.hasBodyDetails ? (
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
            {details}
          </ToolContent>
        </Tool>
      )}
      {recoveryActions}
      {/* 审批操作在折叠容器外：收起工具详情不影响批准/拒绝，且全时间线只有这一份；
          无正文的静态行同样外挂，保证待审批工具永远有一份可见操作 */}
      {needsApproval ? (
        <div className="px-2.5 pb-2">
          <ToolApprovalSlot
            message={message}
            pending={pendingPermission}
            onRespond={(optionId) => onRespond?.(optionId)}
          />
        </div>
      ) : null}
    </>
  )

  if (bare) return body
  return (
    <AgentChatItem
      variant="card"
      tone={needsApproval ? 'tool-pending' : 'tool'}
      streaming={streaming}
      probe="tool"
      messageId={message.id}
      role="tool"
    >
      {body}
    </AgentChatItem>
  )
}
