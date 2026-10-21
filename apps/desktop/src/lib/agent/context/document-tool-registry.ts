import { LOCAL_WORKSPACE_ID } from '@yitom/contracts'
import type { DocumentSelection, SlideViewContext } from '@yitom/contracts'
import type { ProposalOrigin } from '@/lib/editor/ai-proposals/proposal-types'

export interface DocumentToolProvider {
  filePath: string
  /** 工作区身份；缺省为本机（local），与历史裸路径匹配兼容。 */
  workspaceId?: string
  kind: 'table' | 'slide' | 'text'
  isDirty: () => boolean
  save: () => Promise<void>
  undo: () => void
  read: (args: Record<string, unknown>) => unknown
  edit: (args: Record<string, unknown>, origin?: ProposalOrigin) => unknown
  /** 文本文档：创建待用户确认的修改建议（montree_text_propose）。 */
  propose?: (args: Record<string, unknown>, origin?: ProposalOrigin) => unknown
  getSlideView?: () => SlideViewContext
}

function scopedWorkspaceId(workspaceId?: string): string {
  return workspaceId?.trim() || LOCAL_WORKSPACE_ID
}

let current: DocumentToolProvider | null = null
const listeners = new Set<() => void>()
export const notifyDocumentTools = (): void => { listeners.forEach((listener) => listener()) }
export function subscribeDocumentTools(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function registerDocumentTools(provider: DocumentToolProvider): () => void {
  current = provider
  notifyDocumentTools()
  return () => { if (current === provider) { current = null; notifyDocumentTools() } }
}
/**
 * 按文件路径取当前文档工具；传入 workspaceId 后再按身份窄化
 * （同一相对路径在不同工作区是不同文档，防串读串写）。
 */
export function getDocumentTools(filePath?: string, workspaceId?: string): DocumentToolProvider | null {
  if (!current) return null
  if (filePath && current.filePath !== filePath) return null
  if (workspaceId && scopedWorkspaceId(current.workspaceId) !== scopedWorkspaceId(workspaceId)) {
    return null
  }
  return current
}
export function requireDocumentTools(kind: DocumentToolProvider['kind'], args: Record<string, unknown>): DocumentToolProvider {
  if (!current || current.kind !== kind) throw new Error('当前文档尚未就绪或不支持此工具')
  if (typeof args.documentPath !== 'string' || args.documentPath !== current.filePath) throw new Error('documentPath 与当前文档不匹配，请重新读取')
  if (
    typeof args.workspaceId === 'string' &&
    scopedWorkspaceId(current.workspaceId) !== scopedWorkspaceId(args.workspaceId)
  ) {
    throw new Error('workspaceId 与当前文档不匹配，请重新读取')
  }
  return current
}
export function selectionText(selection: DocumentSelection): string {
  if (selection.kind === 'text') return `文本 ${selection.from}–${selection.to}`
  return selection.kind === 'table' ? `${selection.sheet}!${selection.ranges.join(', ')}` : `幻灯片 ${selection.slide}：${selection.elementIds.join(', ')}`
}
