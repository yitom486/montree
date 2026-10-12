import type { AcpContentBlock } from '@montree/contracts'
import { collectActiveDocument, collectReaderLocationKey, collectReadingState, collectTocTopLevelForDocument } from './collect-turn-context'
import {
  MONTREE_BOOTSTRAP_CLOSE_TAG,
  MONTREE_BOOTSTRAP_OPEN_TAG,
  MONTREE_RENDER_HINT_REFRESH,
  MONTREE_STATIC_SKILL,
  MONTREE_TOOL_OVERVIEW,
} from './montree-static-skill'
import { shouldRefreshRenderHint } from './render-hint-refresh'
import { beginPromptSelectionCycle } from './reader-selection-registry'
import { takeTurnContextDecision } from './should-attach-turn-context'
import { documentKey, formatTurnContextBlock } from './turn-context'
import { getReaderContentProvider } from './reader-content-registry'
import { getReaderViewportRect } from './reader-visual-context'

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

  // 长会话渲染速览：每隔 N 轮重贴一次（回放清洗据外层标记剥离，不污染时间线）。
  // 与 turn-context 相互独立；计数按线程，见 render-hint-refresh。
  if (shouldRefreshRenderHint(threadId)) {
    blocks.push({
      type: 'text',
      text: `${MONTREE_BOOTSTRAP_OPEN_TAG}\n${MONTREE_RENDER_HINT_REFRESH}\n${MONTREE_BOOTSTRAP_CLOSE_TAG}`,
    })
  }

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
  const provider = getReaderContentProvider()
  const visual = provider?.filePath === activeDocument?.path ? {
    imageCount: provider?.getImageCount?.(), screenshotAvailable: Boolean(getReaderViewportRect()),
  } : undefined
  blocks.push({
    type: 'text',
    text: formatTurnContextBlock({
      documentChanged: decision.documentChanged,
      activeDocument,
      reading: collectReadingState(activeDocument),
      ...(hasSelection ? { hasSelection: true } : {}),
      ...(tocTopLevel ? { tocTopLevel } : {}),
      ...(visual ? { visual } : {}),
    }),
  })
  return blocks
}
