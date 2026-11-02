import type { DocumentSelection } from '@yitom/contracts'

export interface StickyReaderSelection {
  filePath: string
  text: string
  target?: DocumentSelection
}

export interface SelectionProvider {
  filePath: string
  /** 读取当前 DOM / 编辑器里的选区纯文本；无选区返回 null */
  getSelectionText: () => string | null
  getSelectionTarget?: () => DocumentSelection | null
}

let current: SelectionProvider | null = null
/** 当前仍有效的选区；用户主动取消/点击空白时清空 */
let sticky: StickyReaderSelection | null = null
/** 本轮 prompt 发送时冻结的选区；AI 回答期间不再随 DOM 变化 */
let turnSelection: StickyReaderSelection | null = null

/**
 * 各 Viewer 在 mount 时注册，unmount 时注销。
 * 阅读器选区在 mouseup 时写入 sticky，供本轮 Agent 在 DOM 高亮消失后仍能读取。
 */
export function registerSelectionProvider(provider: SelectionProvider): () => void {
  current = provider
  return () => {
    if (current === provider) current = null
    // 只清「当前选区」；本轮已冻结的快照留给正在回答的 Agent 读完。
    if (sticky?.filePath === provider.filePath) sticky = null
  }
}

export function getSelectionProvider(): SelectionProvider | null {
  return current
}

/** 阅读器划选成功后调用；Markdown 等可编辑文档不走 sticky */
export function commitReaderSelection(filePath: string, text: string): void {
  const trimmed = text.trim()
  if (!trimmed) {
    clearReaderSelection()
    return
  }
  sticky = { filePath, text: trimmed }
}

/** 坐标选区允许内容为空；地址才是编辑目标，不能通过相同文字反查。 */
export function commitDocumentSelection(target: DocumentSelection, text: string): void {
  sticky = { filePath: target.documentPath, text, target }
}

/** 用户取消选区（点击空白、Esc、切换文档等）：只清当前选区，不回收本轮已冻结的快照 */
export function clearReaderSelection(): void {
  sticky = null
}

export function getStickyReaderSelection(): StickyReaderSelection | null {
  return sticky
}

/** 本轮 prompt 冻结的选区快照；AI 回答期间只读这一份 */
export function getTurnReaderSelection(): StickyReaderSelection | null {
  return turnSelection
}

/**
 * 每轮构建 prompt 开头调用：
 * - 发送时选区仍有效 → 冻结为本轮 turnSelection，返回 true（turn-context 带 hasSelection）
 * - 发送时选区已消失 → 返回 false，不带任何旧选区
 * 本轮 AI 回答期间即使取消选区，工具仍读 turnSelection；下一轮再按当时状态重新冻结。
 */
export function beginPromptSelectionCycle(): boolean {
  turnSelection = null
  if (!sticky) return false
  turnSelection = sticky
  return true
}

/** 是否有可供工具读取的选区（优先本轮冻结快照，其次当前活动选区） */
export function hasActiveSelection(): boolean {
  return Boolean(readSelectionText())
}

/** 防止 getSelectionText 误调 readSelectionText 造成无限递归 */
let selectionReadDepth = 0

export function readSelectionText(expectedFilePath?: string): string | null {
  const frozen = turnSelection ?? sticky
  if (frozen) {
    if (expectedFilePath && frozen.filePath !== expectedFilePath) return null
    return frozen.text
  }
  selectionReadDepth += 1
  if (selectionReadDepth > 1) {
    selectionReadDepth -= 1
    console.error(
      '[reader-selection] getSelectionText 不得调用 readSelectionText，请改为读 DOM/快照',
    )
    return null
  }
  try {
    const text = current?.getSelectionText()?.trim()
    return text || null
  } finally {
    selectionReadDepth -= 1
  }
}
