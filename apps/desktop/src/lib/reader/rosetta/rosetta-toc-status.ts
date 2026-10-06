import { computeTocSignature } from '@montree/reader-core'
import { resolveRosettaTocEntries } from '@/lib/reader/rosetta/rosetta-toc'

/**
 * 罗盘目录健康状态：数据库签名缺失/不一致时不得只显示“✓ AI 直接读库”。
 * - 无索引（info 为空）：'no-index'
 * - 有索引但签名缺失或与当前 OCR 目录不一致：'stale'（显示“更新罗盘目录”）
 * - 一致：'ready'（显示“AI 直接读库”）
 */
export type RosettaTocStatus = 'no-index' | 'stale' | 'ready'

export function resolveRosettaTocStatus(
  dbSignature: string | null | undefined,
  currentSignature: string,
): RosettaTocStatus {
  if (!currentSignature) return 'ready'
  if (!dbSignature) return 'stale'
  return dbSignature === currentSignature ? 'ready' : 'stale'
}

export function resolveRosettaIndexStatus(
  info: { tocSignature?: string } | null | undefined,
  currentSignature: string,
): RosettaTocStatus {
  if (!info) return 'no-index'
  return resolveRosettaTocStatus(info.tocSignature, currentSignature)
}

/** 当前 OCR/大纲目录的签名（真实页帧，与入库侧同一规范化；纯本地计算） */
export function getCurrentRosettaTocSignature(args: {
  outlineUnits: readonly { label: string; href: string; level?: number }[]
  ocrEntries: readonly { title: string; printedPage: number; level: number }[]
  pageOffset: number
  pageCount: number
}): string {
  if (!Number.isInteger(args.pageCount) || args.pageCount < 1) return ''
  const entries = resolveRosettaTocEntries({
    outlineUnits: args.outlineUnits,
    ocrEntries: args.ocrEntries,
    pageOffset: args.pageOffset,
    pageCount: args.pageCount,
  })
  return computeTocSignature(entries)
}
