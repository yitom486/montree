import type { ChangeDesc, Text } from '@codemirror/state'
import type { EditProposal } from './proposal-types'

/**
 * 把一条待审建议的目标区间穿过一次文档变更：
 * - 变更触及目标区间（含插入点紧邻）→ 失效，不做自动合并；
 * - 其余情况用 mapPos 平移。
 */
export function mapProposal(proposal: EditProposal, changes: ChangeDesc): EditProposal {
  if (proposal.status !== 'pending' && proposal.status !== 'drafting') return proposal
  if (changes.empty) return proposal
  if (changes.touchesRange(proposal.from, proposal.to)) {
    return { ...proposal, status: 'invalid', invalidReason: '目标文本已被修改' }
  }
  const from = changes.mapPos(proposal.from, 1)
  const to = proposal.from === proposal.to ? from : changes.mapPos(proposal.to, -1)
  if (from === proposal.from && to === proposal.to) return proposal
  return { ...proposal, from, to }
}

/** 无法取得变更描述时（整体替换状态）按原文核对：位置或原文对不上即失效。 */
export function revalidateProposal(proposal: EditProposal, doc: Text): EditProposal {
  if (proposal.status !== 'pending' && proposal.status !== 'drafting') return proposal
  if (proposal.to > doc.length || doc.sliceString(proposal.from, proposal.to) !== proposal.expectedText) {
    return { ...proposal, status: 'invalid', invalidReason: '文档已被替换，目标文本不再匹配' }
  }
  return proposal
}

/** 两个区间是否冲突（重叠，或在同一位置插入/紧邻插入）。与 TextDocument.edit 的同批规则一致。 */
export function rangesConflict(a: { from: number; to: number }, b: { from: number; to: number }): boolean {
  if (a.from < b.to && b.from < a.to) return true
  if (a.from === a.to || b.from === b.to) return a.from <= b.to && b.from <= a.to
  return false
}
