import { buildSelectionContext, type SelectionContextResult } from './expand-selection-context'
import { readCurrentDocumentText } from './reader-content-registry'
import {
  readSelectionText,
  getStickyReaderSelection,
  getTurnReaderSelection,
  getSelectionProvider,
} from './reader-selection-registry'
import type { DocumentSelection } from '@yitom/contracts'

/**
 * 读取用户选区。
 * 短选区（≤30 字）仅在父文本里向前后各补 30 字作为 excerpt——**不会**把整章塞回给 Agent。
 * 父文本只用于定位选区位置，最终返回仍是短 excerpt。
 */
export async function readSelectionWithContext(): Promise<SelectionContextResult & { target?: DocumentSelection }> {
  // 本轮已冻结的快照优先：AI 回答期间用户取消选区也不能换掉本次对话的上下文。
  const snapshot = getTurnReaderSelection() ?? getStickyReaderSelection()
  if (snapshot?.target && snapshot.target.kind !== 'text') {
    return { selection: snapshot.text, excerpt: snapshot.text, expanded: false, selectionLength: snapshot.text.length, target: snapshot.target }
  }
  const provider = getSelectionProvider()
  const target = provider?.getSelectionTarget?.()
  if (target?.kind === 'text') {
    const selection = target.ranges.map((range) => range.text).join('\n')
    return { selection, excerpt: selection, expanded: false, selectionLength: selection.length, target }
  }
  const selection = readSelectionText()
  if (!selection) {
    throw new Error('当前没有选中文本')
  }

  let parentText = ''
  try {
    parentText = await readCurrentDocumentText()
  } catch {
    return {
      selection,
      excerpt: selection,
      expanded: false,
      selectionLength: selection.length,
    }
  }

  return buildSelectionContext(selection, parentText)
}
