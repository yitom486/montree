import { isOk } from '@montree/contracts'
import type { BookDbBlockHit } from '@montree/contracts'
import { rosettaApi } from '@/api/rosetta-api'
import { formatRosettaBlocksForAgent } from '@/lib/reader/rosetta/rosetta-agent-text'
import type { ReaderUnitText } from './reader-content-registry'

/**
 * 已入库 PDF 的罗盘章节迭代（S1.1）。
 *
 * 只走罗盘：chapters 查询失败/抛错/空列表、或全部章节无块（yield 0），
 * 直接抛错，禁止回退逐页 readPageText（`pdfOcrAgentAutoOcr` 默认 true，
 * 回退会把已建罗盘的书再整本 OCR 一遍）。单章块查询失败只跳过该章。
 * 未入库路径不在这里（S1 searchBlockedReason / 逐页内存原样）。
 */
export const ROSETTA_UNITS_UNAVAILABLE =
  '罗盘索引无法读取章节，请重建索引或手动识别本页'

type QueryBook = typeof rosettaApi.queryBook

export async function* iterateRosettaChapterUnits(
  fingerprint: string,
  queryBook: QueryBook = rosettaApi.queryBook,
): AsyncGenerator<ReaderUnitText> {
  let chapters: { index: number; title: string; startPage: number; endPage: number }[]
  try {
    const chaptersResult = await queryBook({ kind: 'chapters', fingerprint })
    if (!isOk(chaptersResult) || chaptersResult.value.kind !== 'chapters') {
      throw new Error(ROSETTA_UNITS_UNAVAILABLE)
    }
    chapters = chaptersResult.value.chapters
  } catch {
    throw new Error(ROSETTA_UNITS_UNAVAILABLE)
  }
  if (chapters.length === 0) throw new Error(ROSETTA_UNITS_UNAVAILABLE)
  let yielded = 0
  for (const chapter of chapters) {
    let blocks: readonly BookDbBlockHit[] | null = null
    try {
      const blocksResult = await queryBook({
        kind: 'chapter',
        fingerprint,
        chapterIndex: chapter.index,
      })
      if (isOk(blocksResult) && blocksResult.value.kind === 'chapter') {
        blocks = blocksResult.value.blocks
      }
    } catch {
      blocks = null
    }
    if (!blocks || blocks.length === 0) continue
    yielded += 1
    yield {
      label: chapter.title,
      text: `【${chapter.title} · 第 ${chapter.startPage}-${chapter.endPage} 页】\n${formatRosettaBlocksForAgent(blocks)}`,
    }
  }
  if (yielded === 0) throw new Error(ROSETTA_UNITS_UNAVAILABLE)
}
