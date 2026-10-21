import type { EditProposal } from './proposal-types'

/** 渲染进程内所有存活文本文档的建议管理器（按窗口隔离：每个窗口独立进程/模块）。 */
interface LiveDocument {
  readonly proposals: {
    withdraw: (predicate: (item: EditProposal) => boolean, note: string) => number
    dispose: () => void
  }
}

const live = new Set<LiveDocument>()
const pendingDispose = new Map<LiveDocument, ReturnType<typeof setTimeout>>()

/**
 * 登记文档；返回的 release 在文件关闭时调用，延迟一拍再 dispose，
 * 以兼容 React StrictMode 的卸载-重挂（重挂会取消待执行的 dispose）。
 */
export function registerLiveDocument(document: LiveDocument): () => void {
  const timer = pendingDispose.get(document)
  if (timer) { clearTimeout(timer); pendingDispose.delete(document) }
  live.add(document)
  return () => {
    pendingDispose.set(document, setTimeout(() => {
      pendingDispose.delete(document)
      live.delete(document)
      document.proposals.dispose()
    }, 0))
  }
}

export function withdrawProposals(predicate: (item: EditProposal) => boolean, note: string): number {
  let total = 0
  for (const document of live) total += document.proposals.withdraw(predicate, note)
  return total
}

export function liveDocumentCount(): number { return live.size }
