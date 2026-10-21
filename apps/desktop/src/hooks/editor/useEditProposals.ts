import { useSyncExternalStore } from 'react'
import type { TextDocument } from '@/lib/editor/text-document'
import type { EditProposal } from '@/lib/editor/ai-proposals/proposal-types'

const EMPTY: readonly EditProposal[] = []
const noop = () => () => {}

/** 订阅某个 TextDocument 的修改建议列表（不随编辑器卸载丢失）。 */
export function useEditProposals(document: TextDocument | undefined): readonly EditProposal[] {
  return useSyncExternalStore(document ? document.proposals.subscribe : noop, document ? document.proposals.list : () => EMPTY, () => EMPTY)
}
