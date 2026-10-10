import type { DocumentSelection, SlideViewContext } from '@montree/contracts'

export interface DocumentToolProvider {
  filePath: string
  kind: 'table' | 'slide'
  isDirty: () => boolean
  save: () => Promise<void>
  undo: () => void
  read: (args: Record<string, unknown>) => unknown
  edit: (args: Record<string, unknown>) => unknown
  getSlideView?: () => SlideViewContext
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
export function getDocumentTools(filePath?: string): DocumentToolProvider | null {
  return current && (!filePath || current.filePath === filePath) ? current : null
}
export function requireDocumentTools(kind: 'table' | 'slide', args: Record<string, unknown>): DocumentToolProvider {
  if (!current || current.kind !== kind) throw new Error('当前文档尚未就绪或不支持此工具')
  if (typeof args.documentPath !== 'string' || args.documentPath !== current.filePath) throw new Error('documentPath 与当前文档不匹配，请重新读取')
  return current
}
export function selectionText(selection: DocumentSelection): string {
  return selection.kind === 'table' ? `${selection.sheet}!${selection.ranges.join(', ')}` : `幻灯片 ${selection.slide}：${selection.elementIds.join(', ')}`
}
