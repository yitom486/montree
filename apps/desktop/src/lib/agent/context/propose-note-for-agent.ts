export type { ProposeMarkOptions as ProposeNoteOptions } from '@/lib/agent/context/propose-mark'
export {
  adoptProposedMark as adoptProposedNote,
  dismissProposedMark as dismissProposedNote,
  proposeMarkForAgent as proposeNoteForAgent,
} from '@/lib/agent/context/propose-mark'

import { proposeMarksUnifiedForAgent } from '@/lib/agent/context/propose-mark'
import type { MarkProposalPayload } from '@montree/annotations'

function normalizePayload(payload: MarkProposalPayload): MarkProposalPayload {
  return payload
}

/** MCP propose-mark 快照入口（仅 note、选区模式；create-note/propose-note 资源别名） */
export async function createNoteForAgent(note: string) {
  return proposeMarksUnifiedForAgent({ note }, { source: 'agent' })
}

/** MCP montree_propose_mark 快照入口（单条 / 批量 / 高亮） */
export async function proposeMarkAtForAgentResult(payload: MarkProposalPayload) {
  return proposeMarksUnifiedForAgent(normalizePayload(payload), { source: 'agent' })
}
