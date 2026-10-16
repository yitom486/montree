import type { MontreePresentResult } from '@montree/contracts'
import type { ChapterMarkPlanEntry, MarkProposalStatus, ProposedMark } from '@montree/annotations'
import type { ChatMessage } from './chat-message'
import type { AcpPlanEntry } from './plan'

/**
 * 单条 `ChatMessage` 的零件级拆分（E2 headless API）。
 *
 * 对照 `packages/chat-ui/src/ui/agent-message-bubble.tsx` 的分支条件，
 * 把一条消息拆成宿主实际渲染的块序列；调用方（自研 UI / 测试）按序渲染即可，
 * 不读 store、不碰 ACP、不依赖 react。
 *
 * 顺序依据（= 宿主渲染顺序，工具卡在前、业务/提议在后）：
 * 1. `approval` 前置（仅 role=tool + needsApproval + 有 toolCallId）。
 *    宿主把审批槽 render 在工具卡内/后（bubble 149-160、171-175），此处前置是
 *    E2 任务指定的 headless 约定（先拦截再展示），唯一与宿主 DOM 顺序不同的点。
 * 2. 主块：tool（bubble 148-214）/ plan（bubble 216-218，只渲染计划卡、
 *    不渲染正文）/ thought（bubble 220-244）/ text（bubble 140-146 system、
 *    246-359 user/agent）。
 * 3. `present`：业务结果紧随主卡。宿主 tool 分支把它包进工具卡/
 *    AgentResultEntry 的 businessResultSlot（bubble 183-212），agent 分支按
 *    正文引用内联（bubble 339-355）；headless 统一拆成独立 part。
 * 4. `steps`：独立 part（E2 决议：不并入 plan——steps 的
 *    {num,title,desc,anchorId} 与 AcpPlanEntry {content,priority,status}
 *    形状互不兼容，硬并会丢定位语义；bubble 360-413 也是独立区块
 *    “交互经纬流转”，与计划卡是两个组件）。
 * 5. `proposal`：单条 markProposal（bubble 162，非 dismissed 才渲染）与
 *    markProposals 数组（bubble 414，全状态渲染）合并为一个 part，单条在前。
 * 6. `chapter-plan`（bubble 424-430 尾部末位）。
 * 7. `plan`（planEntries；role=plan 时已在主块产出，不重复。宿主 plan 卡见
 *    AgentPlanCard，role 分支 bubble 216-218）。
 *
 * 空数组一律不产 part（对照 bubble 360/414/424 的 `?.length ?? 0 > 0` 门限）；
 * 空白正文不产 text part（对照 bubble 314 trim 门限与 247 showEmptyStreaming）；
 * thought 无文本门限（bubble 220-244 空流式仍渲染“思考中”容器）。
 * 调用方用 `toolMessageNeedsApproval(message, pending)` 算出布尔值后传入
 * `opts.needsApproval`，本函数只做 role + flag + toolCallId 三重门限。
 */

export interface MessageProposalItem {
  proposal: ProposedMark
  status: MarkProposalStatus
  toolCallId?: string
}

export type ChatStepsEntry = NonNullable<ChatMessage['steps']>[number]

export type MessagePart =
  | { kind: 'text'; text: string }
  | { kind: 'thought'; text: string; streaming: boolean }
  | { kind: 'tool'; message: ChatMessage }
  | { kind: 'approval'; toolCallId: string }
  | { kind: 'present'; result: MontreePresentResult }
  | { kind: 'proposal'; items: MessageProposalItem[] }
  | { kind: 'chapter-plan'; entries: ChapterMarkPlanEntry[] }
  | { kind: 'plan'; entries: AcpPlanEntry[] }
  | { kind: 'steps'; steps: ChatStepsEntry[] }

export interface SplitMessageOptions {
  needsApproval?: boolean
}

export function splitMessage(message: ChatMessage, opts?: SplitMessageOptions): MessagePart[] {
  const parts: MessagePart[] = []
  const needsApproval = opts?.needsApproval ?? false

  if (message.role === 'tool' && needsApproval && message.toolCallId) {
    parts.push({ kind: 'approval', toolCallId: message.toolCallId })
  }

  if (message.role === 'tool') {
    parts.push({ kind: 'tool', message })
  } else if (message.role === 'plan') {
    if ((message.planEntries?.length ?? 0) > 0) {
      parts.push({ kind: 'plan', entries: message.planEntries! })
    }
    return parts
  } else if (message.role === 'thought') {
    parts.push({ kind: 'thought', text: message.text, streaming: message.streaming ?? false })
  } else if (message.text.trim()) {
    parts.push({ kind: 'text', text: message.text })
  }

  if (message.presentResult) {
    parts.push({ kind: 'present', result: message.presentResult })
  }

  if ((message.steps?.length ?? 0) > 0) {
    parts.push({ kind: 'steps', steps: message.steps! })
  }

  const proposalItems: MessageProposalItem[] = []
  if (message.markProposal && message.markProposalStatus !== 'dismissed') {
    proposalItems.push({
      proposal: message.markProposal,
      status: message.markProposalStatus ?? 'pending',
      ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    })
  }
  for (const row of message.markProposals ?? []) {
    proposalItems.push({
      proposal: row.proposal,
      status: row.status,
      ...(row.toolCallId ? { toolCallId: row.toolCallId } : {}),
    })
  }
  if (proposalItems.length > 0) {
    parts.push({ kind: 'proposal', items: proposalItems })
  }

  if ((message.chapterMarkPlan?.length ?? 0) > 0) {
    parts.push({ kind: 'chapter-plan', entries: message.chapterMarkPlan! })
  }

  if ((message.planEntries?.length ?? 0) > 0) {
    parts.push({ kind: 'plan', entries: message.planEntries! })
  }

  return parts
}
