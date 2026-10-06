import { describe, expect, it, vi } from 'vitest'
import { err, ok } from '@montree/contracts'
import {
  iterateRosettaChapterUnits,
  ROSETTA_UNITS_UNAVAILABLE,
} from './rosetta-chapter-units'

function block(content: string, id = 1) {
  return {
    id,
    type: 'paragraph' as const,
    content,
    pageNumber: 2,
    chapterIndex: 0,
    chapterTitle: '第一章',
    blockIndex: 0,
    snippet: '',
    source: 'ocr' as const,
    extractVersion: '',
  }
}

async function collect(
  gen: AsyncGenerator<{ label: string; text: string }>,
): Promise<{ label: string; text: string }[]> {
  const out: { label: string; text: string }[] = []
  for await (const unit of gen) out.push(unit)
  return out
}

describe('iterateRosettaChapterUnits', () => {
  it('chapters 查询抛错 → 友好错误，不静默', async () => {
    const queryBook = vi.fn(async () => {
      throw new Error('ipc boom')
    })
    await expect(collect(iterateRosettaChapterUnits('fp-1', queryBook as never))).rejects.toThrow(
      ROSETTA_UNITS_UNAVAILABLE,
    )
    expect(queryBook).toHaveBeenCalledTimes(1)
  })

  it('chapters 非 ok / 空数组 → 友好错误', async () => {
    const bad = vi.fn(async () => err({ code: 'INVALID_STATE' as const, message: 'nope' }))
    await expect(collect(iterateRosettaChapterUnits('fp-1', bad as never))).rejects.toThrow(
      ROSETTA_UNITS_UNAVAILABLE,
    )
    const empty = vi.fn(async () => ok({ kind: 'chapters' as const, chapters: [] }))
    await expect(collect(iterateRosettaChapterUnits('fp-1', empty as never))).rejects.toThrow(
      ROSETTA_UNITS_UNAVAILABLE,
    )
  })

  it('全部章节无块 → 友好错误（不回退逐页）', async () => {
    const queryBook = vi.fn(async (query: { kind: string }) => {
      if (query.kind === 'chapters') {
        return ok({
          kind: 'chapters' as const,
          chapters: [{ index: 0, title: '第一章', startPage: 2, endPage: 3 }],
        })
      }
      return ok({ kind: 'chapter' as const, blocks: [] })
    })
    await expect(
      collect(iterateRosettaChapterUnits('fp-1', queryBook as never)),
    ).rejects.toThrow(ROSETTA_UNITS_UNAVAILABLE)
  })

  it('有块章节正常产出（label/文本形态与旧链路一致）', async () => {
    const queryBook = vi.fn(async (query: { kind: string }) => {
      if (query.kind === 'chapters') {
        return ok({
          kind: 'chapters' as const,
          chapters: [{ index: 0, title: '第一章', startPage: 2, endPage: 3 }],
        })
      }
      return ok({ kind: 'chapter' as const, blocks: [block('流水线正文')] })
    })
    const units = await collect(iterateRosettaChapterUnits('fp-1', queryBook as never))
    expect(units).toHaveLength(1)
    expect(units[0]?.label).toBe('第一章')
    expect(units[0]?.text).toContain('流水线正文')
    expect(units[0]?.text).toContain('第 2-3 页')
  })

  it('单章块查询失败只跳过该章，其他章照产', async () => {
    const queryBook = vi.fn(async (query: { kind: string; chapterIndex?: number }) => {
      if (query.kind === 'chapters') {
        return ok({
          kind: 'chapters' as const,
          chapters: [
            { index: 0, title: '第一章', startPage: 2, endPage: 3 },
            { index: 1, title: '第二章', startPage: 4, endPage: 5 },
          ],
        })
      }
      if (query.chapterIndex === 0) throw new Error('chapter boom')
      return ok({ kind: 'chapter' as const, blocks: [block('第二章正文')] })
    })
    const units = await collect(iterateRosettaChapterUnits('fp-1', queryBook as never))
    expect(units).toHaveLength(1)
    expect(units[0]?.label).toBe('第二章')
  })
})
