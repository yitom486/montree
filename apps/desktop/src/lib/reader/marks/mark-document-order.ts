import type { ReadingMark } from '@montree/contracts'
import { highlightSortKey } from '@montree/reader-core'

/**
 * 卡片按文档位置排序：先按目录键序（章），同章内按锚点位置键排序，
 * 让卡片纵序与正文纵序一致（此前章内是创建时间序，与正文错位）。
 *
 * 位置键即 `highlightSortKey`（与 Anki 导出排序同口径）：
 * PDF 按页（零填充精确），EPUB 按 href + cfiRange 字符串近似（同章同 spine 内有效，
 * 跨位 CFI 字典序在 10+ 编号时近似，不丢稳定性），MOBI 按 chapterId + cfi
 *（老锚点无 cfi 时退回创建时间序），WEB 按 URL。
 * 无章节归属的沉底；全同则保输入序（sort 稳定 + originalIndex 兜底）。
 *
 * 调用方义务：chapterOrder 必须与 chapterKeyOf 返回值同 key 空间
 *（固化 key 恒为 matchKey 形态，见 toCanonicalChapter），否则章分组恒 miss。
 */
export function sortMarksByDocumentPosition(
  marks: ReadingMark[],
  chapterOrder: string[],
  chapterKeyOf: (mark: ReadingMark) => string | null,
): ReadingMark[] {
  if (chapterOrder.length === 0) return [...marks]
  const orderIndex = new Map<string, number>()
  chapterOrder.forEach((key, idx) => {
    if (!orderIndex.has(key)) orderIndex.set(key, idx)
  })
  return marks
    .map((mark, originalIndex) => {
      let chapterIdx: number | null = null
      let positionKey = ''
      try {
        const key = chapterKeyOf(mark)
        chapterIdx = key !== null && orderIndex.has(key) ? (orderIndex.get(key) as number) : null
      } catch {
        chapterIdx = null
      }
      try {
        positionKey = highlightSortKey(mark)
      } catch {
        positionKey = ''
      }
      return { mark, chapterIdx, positionKey, originalIndex }
    })
    .sort((a, b) => {
      const ai = a.chapterIdx ?? Number.POSITIVE_INFINITY
      const bi = b.chapterIdx ?? Number.POSITIVE_INFINITY
      if (ai !== bi) return ai - bi
      if (a.positionKey !== b.positionKey) {
        return a.positionKey < b.positionKey ? -1 : 1
      }
      return a.originalIndex - b.originalIndex
    })
    .map((row) => row.mark)
}
