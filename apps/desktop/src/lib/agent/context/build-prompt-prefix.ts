import type { AcpContentBlock } from '@montree/contracts'
import { collectActiveDocument, collectReaderLocationKey, collectReadingState, collectTocTopLevelForDocument } from './collect-turn-context'
import {
  MONTREE_BOOTSTRAP_CLOSE_TAG,
  MONTREE_BOOTSTRAP_OPEN_TAG,
  MONTREE_STATIC_SKILL,
  MONTREE_TOOL_OVERVIEW,
} from './montree-static-skill'
import { beginPromptSelectionCycle } from './reader-selection-registry'
import { takeTurnContextDecision } from './should-attach-turn-context'
import { documentKey, formatTurnContextBlock } from './turn-context'

/**
 * 每次 session/prompt 的前缀：静态 Skill（可被上游缓存） + 可选的 turn-context。
 * 这些块不会进入本地聊天时间线，用户看不到。
 */
export function buildMontreePromptPrefix(
  threadId: string,
  options: { includeBootstrap?: boolean } = {},
): AcpContentBlock[] {
  const blocks: AcpContentBlock[] = []
  if (options.includeBootstrap !== false) {
    // 外层再套 bootstrap 标记（内层语义逐字保留）：cursor load 会把发过的内容
    // 原样重播为 user chunks，渲染端据此外层标记整段剥离（见 strip-replay-scaffolding）。
    blocks.push({
      type: 'text',
      text: `${MONTREE_BOOTSTRAP_OPEN_TAG}\n${MONTREE_STATIC_SKILL}\n${MONTREE_BOOTSTRAP_CLOSE_TAG}`,
    })
  }
  blocks.push({
    type: 'text',
    text: `${MONTREE_BOOTSTRAP_OPEN_TAG}\n${MONTREE_TOOL_OVERVIEW}\n${MONTREE_BOOTSTRAP_CLOSE_TAG}`,
  })

  // 选区只「通知一轮」：本轮若刚划选则 hasSelection；否则清掉上一轮 sticky
  const hasSelection = beginPromptSelectionCycle()
  const activeDocument = collectActiveDocument()
  const decision = takeTurnContextDecision(
    threadId,
    documentKey(activeDocument),
    undefined,
    hasSelection,
    collectReaderLocationKey(),
  )
  if (!decision.attach) return blocks

  const tocTopLevel = collectTocTopLevelForDocument(activeDocument)
  blocks.push({
    type: 'text',
    text: formatTurnContextBlock({
      documentChanged: decision.documentChanged,
      activeDocument,
      reading: collectReadingState(activeDocument),
      ...(hasSelection ? { hasSelection: true } : {}),
      ...(tocTopLevel ? { tocTopLevel } : {}),
    }),
  })
  return blocks
}
