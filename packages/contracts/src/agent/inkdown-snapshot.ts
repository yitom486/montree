import type { InkdownVirtualResource } from './inkdown-virtual-fs'

/**
 * 主进程能向渲染进程索取的内存快照。
 *
 * 虚拟文件资源都能当快照读；`search` 只走 MCP —— 它需要参数，
 * 没法表达成一个固定的 fs 路径。
 */
export type InkdownSnapshotResource =
  | InkdownVirtualResource
  | 'search'
  | 'selection'
  | 'chapter'
  | 'marks'
  | 'highlights'
  | 'create-bookmark'
  | 'create-note'
  | 'propose-note'
  | 'propose-mark'
  | 'suggest-chapters'
  | 'toc-draft-read'
  | 'toc-draft-write'
  | 'content-audit'

export interface InkdownSnapshotArgs {
  query?: string
  /** content-audit：展示条数 1–10，缺省 10（非法值由审计服务报 INVALID_ARGUMENT） */
  limit?: number
  flatIndex?: number
  title?: string
  note?: string
  excerpt?: string
  kind?: 'highlight' | 'note' | 'auto'
  /** inkdown_list_marks：all | highlights | bookmarks */
  filter?: 'all' | 'highlights' | 'bookmarks'
  chapters?: Array<{
    flatIndex: number
    title: string
    reason: string
  }>
  marks?: Array<{
    excerpt: string
    note?: string
    flatIndex?: number
    kind?: 'highlight' | 'note' | 'auto'
  }>
  /** toc-draft-write：replace | upsert | delete */
  op?: string
  /** toc-draft 系列：目标书指纹（快照侧校验归属） */
  fingerprint?: string
  /** toc-draft-write replace：整单条目 */
  entries?: unknown
  /** toc-draft-write upsert：单条 */
  entry?: unknown
  /** toc-draft-write delete：按序号或标题 */
  index?: number
  [key: string]: unknown
}

/** 常规快照应在毫秒级返回 */
export const ACP_SNAPSHOT_TIMEOUT_MS = 5_000

/** 可能触发扫描 PDF 按需 OCR 的快照 */
export const ACP_SNAPSHOT_OCR_TIMEOUT_MS = 120_000

export function resolveSnapshotTimeoutMs(resource: InkdownSnapshotResource): number {
  switch (resource) {
    case 'viewport.txt':
    case 'chapter.txt':
    case 'chapter':
    case 'search':
      return ACP_SNAPSHOT_OCR_TIMEOUT_MS
    default:
      return ACP_SNAPSHOT_TIMEOUT_MS
  }
}
