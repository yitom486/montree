import type { ProposalHunk } from './proposal-hunks'

/** AI 修改建议（Edit Proposal）：Agent 提议、用户逐条确认后才落入 TextDocument。 */
export type EditProposalStatus = 'drafting' | 'pending' | 'accepted' | 'rejected' | 'invalid'

export interface EditProposal {
  id: string
  /** 同一次工具调用的多处修改共享 batchId。 */
  batchId: string
  documentPath: string
  threadId: string | null
  toolCallId: string | null
  /** 创建时 Agent 读取到的 TextDocument revision。 */
  baseRevision: number
  /** 当前文档中的 UTF-16 偏移，会随用户编辑通过 ChangeDesc.mapPos 映射。 */
  from: number
  to: number
  expectedText: string
  replacement: string
  status: EditProposalStatus
  /** 创建来源：显式提议工具，或审阅模式下被拦截的直接编辑。 */
  source: 'text-propose' | 'text-edit'
  createdAt: number
  /** invalid 时的原因（目标被用户改动、文档已替换等）。 */
  invalidReason?: string
  /** 被撤回时的说明（对话取消/删除、Agent 断开），在审阅面板可见。 */
  note?: string
  /** accepted 时实际写入的文本（逐句审阅可能只应用一部分），撤销/重做据此核对。 */
  appliedText?: string
  /** 逐句审阅：按句拆分的子修改与各自决定（null = 未决定）。 */
  hunks?: readonly ProposalHunk[]
  hunkDecisions?: readonly (boolean | null)[]
}

export interface ProposalOrigin {
  threadId?: string | null
  toolCallId?: string | null
  source?: EditProposal['source']
}

export interface ProposalEditInput {
  from: number
  to: number
  expectedText: string
  insert: string
}

export const isOpenProposal = (proposal: EditProposal): boolean => proposal.status === 'pending' || proposal.status === 'drafting'
