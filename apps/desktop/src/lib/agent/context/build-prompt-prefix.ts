import type { AcpContentBlock, AcpPromptMode } from '@yitom/contracts'
import { collectActiveDocument, collectReaderLocationKey, collectReadingState, collectTocTopLevelForDocument } from './collect-turn-context'
import {
  MONTREE_BOOTSTRAP_CLOSE_TAG,
  MONTREE_BOOTSTRAP_OPEN_TAG,
  MONTREE_RENDER_HINT_REFRESH,
  MONTREE_STATIC_SKILL,
  MONTREE_TOOL_OVERVIEW,
  MONTREE_INTERACTIVE_GUIDANCE,
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
 *
 * mode === 'native' 时静态块（首轮 Skill、每轮工具概览/交互偏好、周期渲染
 * 速览）全部省略——它们已由原生 developer_instructions 下发；
 * 动态 turn-context 照常发送。缺席/compatibility 保持原有行为。
 */
export function buildMontreePromptPrefix(
  threadId: string,
  options: { includeBootstrap?: boolean; mode?: AcpPromptMode } = {},
): AcpContentBlock[] {
  const blocks: AcpContentBlock[] = []
  const native = options.mode === 'native'
  if (!native && options.includeBootstrap !== false) {
    // 外层再套 bootstrap 标记（内层语义逐字保留）：cursor load 会把发过的内容
    // 原样重播为 user chunks，渲染端据此外层标记整段剥离（见 strip-replay-scaffolding）。
    blocks.push({
      type: 'text',
      text: `${MONTREE_BOOTSTRAP_OPEN_TAG}\n${MONTREE_STATIC_SKILL}\n${MONTREE_BOOTSTRAP_CLOSE_TAG}`,
    })
  }
  if (!native) {
    blocks.push({
      type: 'text',
      // 与逐轮工具概览共用一块，首次/恢复/长会话都能收到，回放仍统一剥离。
      text: `${MONTREE_BOOTSTRAP_OPEN_TAG}\n${MONTREE_TOOL_OVERVIEW}\n${MONTREE_INTERACTIVE_GUIDANCE}\n${MONTREE_BOOTSTRAP_CLOSE_TAG}`,
    })
  }

  // 长会话渲染速览：每隔 N 轮重贴一次（回放清洗据外层标记剥离，不污染时间线）。
  // 与 turn-context 相互独立；计数按线程，见 render-hint-refresh。
  // 计数每轮照常推进（native 也推进，切回兼容不断档）；贴块与否按模式切。
  const refreshDue = shouldRefreshRenderHint(threadId)
  if (!native && refreshDue) {
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
