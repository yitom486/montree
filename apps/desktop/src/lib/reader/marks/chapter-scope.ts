import type { ReadingMark } from '@montree/contracts'
import type { ReadingNotesChapterRef } from '@montree/reader-core'

/**
 * 本章 scope 窄化（[3] 索引化章节查询的调用方侧）。
 *
 * 输入是 `marks:list-by-chapter` 的返回：固化命中（`chapter_key ∈ keys`）+
 * `chapter_key = ''` 的未固化候选（file 后端返回本书全量，语义是其超集）。
 * 窄化规则与 MarginaliaBar 的 `chapterOfMark` 同构——固化优先、缺失回落运行时
 * 解析——因此 DB/file 双后端输出逐字一致：
 * 固化卡只信固化 key（`fe1603e` 治本口径；与展示侧 anchor 分组在 TOC 变更后
 * 可能相差一项，属固化本身的取舍，不在本期展开）；
 * 未固化卡走 `resolveChapter` 现场判定（老数据行为不变）。
 */
export function narrowChapterScopeMarks(input: {
  candidates: ReadingMark[]
  chapterKeys: string[]
  toc: ReadingNotesChapterRef[]
  current: ReadingNotesChapterRef | null
  resolveChapter: (mark: ReadingMark, toc: ReadingNotesChapterRef[]) => ReadingNotesChapterRef
}): ReadingMark[] {
  if (!input.current) return []
  const keySet = new Set(input.chapterKeys.map((key) => key.trim()).filter(Boolean))
  if (keySet.size === 0) return []
  const match = input.current.matchKey || input.current.key
  return input.candidates.filter((mark) => {
    const solidified = mark.chapter?.key
    if (solidified) return keySet.has(solidified)
    try {
      const resolved = input.resolveChapter(mark, input.toc)
      return (resolved.matchKey || resolved.key) === match
    } catch {
      return false
    }
  })
}
