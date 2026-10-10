import type { DocumentSelection } from '@montree/contracts'

export interface StickyReaderSelection {
  filePath: string
  text: string
  target?: DocumentSelection
}

export interface SelectionProvider {
  filePath: string
  /** 读取当前 DOM / 编辑器里的选区纯文本；无选区返回 null */
  getSelectionText: () => string | null
}

let current: SelectionProvider | null = null
let sticky: StickyReaderSelection | null = null
/**
 * 划选后等待在下一轮用户消息的 turn-context 里通知一次。
 * 通知并进入本轮工具可用后，下一轮用户消息开始时会清掉 sticky。
 */
let selectionNotifyPending = false

/**
 * 各 Viewer 在 mount 时注册，unmount 时注销。
 * 阅读器选区在 mouseup 时写入 sticky，供本轮 Agent 在 DOM 高亮消失后仍能读取。
 */
export function registerSelectionProvider(provider: SelectionProvider): () => void {
  current = provider
  return () => {
    if (current === provider) current = null
    if (sticky?.filePath === provider.filePath) {
      sticky = null
      selectionNotifyPending = false
    }
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
  selectionNotifyPending = true
}

/** 坐标选区允许内容为空；地址才是编辑目标，不能通过相同文字反查。 */
export function commitDocumentSelection(target: DocumentSelection, text: string): void {
  sticky = { filePath: target.documentPath, text, target }
  selectionNotifyPending = true
}

export function clearReaderSelection(): void {
  sticky = null
  selectionNotifyPending = false
}

export function getStickyReaderSelection(): StickyReaderSelection | null {
  return sticky
}

/** 「问 Agent」：若已有 sticky，重新挂起本轮 hasSelection 通知 */
export function reviveSelectionNotify(): boolean {
  if (!sticky?.text) return false
  selectionNotifyPending = true
  return true
}

/**
 * 每轮构建 prompt 开头调用：
 * - 若上一轮已通知过选区且用户未重新划选 → 清掉 sticky，避免后续轮次仍 hasSelection
 * - 若本轮有待通知选区 → 返回 true（turn-context 带 hasSelection），并标记已通知、本轮仍保留 sticky 供工具读
 */
export function beginPromptSelectionCycle(): boolean {
  if (!selectionNotifyPending) {
    sticky = null
    return false
  }

  if (!sticky?.text) {
    selectionNotifyPending = false
    sticky = null
    return false
  }

  selectionNotifyPending = false
  return true
}

/** 是否有可供工具读取的选区（含本轮已通知、尚未开启下一轮的 sticky） */
export function hasActiveSelection(): boolean {
  return Boolean(readSelectionText())
}

/** 防止 getSelectionText 误调 readSelectionText 造成无限递归 */
let selectionReadDepth = 0

export function readSelectionText(expectedFilePath?: string): string | null {
  if (sticky) {
    if (expectedFilePath && sticky.filePath !== expectedFilePath) return null
    return sticky.text
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
