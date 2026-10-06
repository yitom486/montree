import type { ReadingMark } from '@montree/contracts'
import { toChapterKey } from '@montree/contracts'
import {
  normalizeLoadKey,
  resolveEpubChapter,
  resolveMobiChapter,
  resolvePdfChapter,
  tocFromEpubUnits,
  tocFromPdfUnits,
  type ReadingNotesChapterRef,
} from '@montree/reader-core'
import { sortMarksByDocumentPosition } from './mark-document-order'

/**
 * 卡片统一文档序入口（全书 scope：先按章节、再按文中位置）。
 *
 * 右侧卡片轨（MarginaliaBar，经 ReaderContentShell 接线）与悬浮窗卡片流
 *（FloatingAIHud，经导航 store 的 units）都走本函数——任一处另起炉灶，
 * 展示顺序就会与另一处分叉。排序契约见 `card-rail-document-order.test.ts`。
 *
 * key 空间：目录键序与章节归属判定统一用固化 key 形态
 *（matchKey 经 normalizeLoadKey，与 toCanonicalChapter 写入口径同构）。
 */

export interface CardNavUnit {
  label: string
  href: string
  level?: number
}

export interface CardOrderTocs {
  epub: ReadingNotesChapterRef[]
  pdf: ReadingNotesChapterRef[]
}

/** 导航 units → 目录键序（units 顺序即文档顺序；去重但保序）。 */
export function chapterOrderFromNavUnits(units: CardNavUnit[]): string[] {
  const order: string[] = []
  const seen = new Set<string>()
  for (const unit of units) {
    const key = toChapterKey(normalizeLoadKey(unit.href))
    if (!key || seen.has(key)) continue
    seen.add(key)
    order.push(key)
  }
  return order
}

function buildCardOrderTocs(units: CardNavUnit[]): CardOrderTocs {
  return {
    // MOBI 共用 EPUB 口径：写入侧 mobi 卡片归属同样按该 TOC 固化（FoliateReaderViewer）
    epub: tocFromEpubUnits(units),
    pdf: tocFromPdfUnits(units),
  }
}

/**
 * 卡片章节归属：固化优先、缺失回落各格式运行时解析
 *（与 ReaderContentShell 传给 MarginaliaBar 的 chapterOfMark 同构）。
 */
export function chapterKeyOfCard(mark: ReadingMark, tocs: CardOrderTocs): string | null {
  try {
    if (mark.chapter) return mark.chapter.key
    switch (mark.anchor.format) {
      case 'epub':
        return toChapterKey(normalizeLoadKey(resolveEpubChapter(mark, tocs.epub).matchKey))
      case 'mobi':
        return toChapterKey(normalizeLoadKey(resolveMobiChapter(mark, tocs.epub).matchKey))
      case 'pdf':
        return toChapterKey(normalizeLoadKey(resolvePdfChapter(mark, tocs.pdf).matchKey))
      case 'web':
        // 悬浮窗只服务本书阅读标记；在线文档走 WebDocViewer 自己的轨
        return null
    }
  } catch {
    return null
  }
}

/** 对一批卡片做统一文档序：调用方只传 marks + 导航 units 即可。 */
export function sortCardsByDocumentPosition(
  marks: ReadingMark[],
  units: CardNavUnit[],
): ReadingMark[] {
  if (marks.length === 0 || units.length === 0) return [...marks]
  const tocs = buildCardOrderTocs(units)
  return sortMarksByDocumentPosition(
    marks,
    chapterOrderFromNavUnits(units),
    (mark) => chapterKeyOfCard(mark, tocs),
  )
}
