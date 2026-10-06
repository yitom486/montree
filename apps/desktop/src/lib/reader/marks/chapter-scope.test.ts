import { describe, expect, it } from 'vitest'
import { narrowChapterScopeMarks } from './chapter-scope'
import { toChapterKey } from '@montree/contracts'
import type { ReadingMark } from '@montree/contracts'
import type { ReadingNotesChapterRef } from '@montree/reader-core'

const toc: ReadingNotesChapterRef[] = [
  { key: '0:text/a', matchKey: 'text/a', label: '甲章', level: 0 },
  { key: '1:text/b', matchKey: 'text/b', label: '乙章', level: 0 },
]
const current = toc[0]!

function mark(overrides: Partial<ReadingMark> = {}): ReadingMark {
  return {
    id: 'm',
    filePath: 'D:/books/a.epub',
    fileFingerprint: 'fp',
    kind: 'highlight',
    anchor: { format: 'epub', cfi: 'cfi' },
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

// 运行时解析桩：excerpt 含甲则归甲章，否则归乙章
function resolveChapter(m: ReadingMark): ReadingNotesChapterRef {
  return (m.excerpt ?? '').includes('甲') ? toc[0]! : toc[1]!
}

const input = {
  toc,
  current,
  resolveChapter: (m: ReadingMark) => resolveChapter(m),
}

describe('narrowChapterScopeMarks', () => {
  it('固化卡只信固化 key（DB/file 同规则）', () => {
    const solidifiedA = mark({ id: 'a', chapter: { key: toChapterKey('text/a'), label: '甲章', index: 0 } })
    const solidifiedB = mark({ id: 'b', chapter: { key: toChapterKey('text/b'), label: '乙章', index: 1 } })
    const out = narrowChapterScopeMarks({
      ...input,
      candidates: [solidifiedA, solidifiedB],
      chapterKeys: ['0:text/a', 'text/a'],
    })
    expect(out.map((m) => m.id)).toEqual(['a'])
  })

  it('未固化卡回落运行时解析（老数据行为不变）', () => {
    const unkeyed = mark({ id: 'u', excerpt: '甲的摘录' })
    const other = mark({ id: 'o', excerpt: '乙的摘录' })
    const out = narrowChapterScopeMarks({
      ...input,
      candidates: [unkeyed, other],
      chapterKeys: ['text/a'],
    })
    expect(out.map((m) => m.id)).toEqual(['u'])
  })

  it('无当前章或空 keys 返回空（调用方展示空态）', () => {
    const m = mark({ id: 'a', chapter: { key: toChapterKey('text/a'), label: '甲章', index: 0 } })
    expect(
      narrowChapterScopeMarks({ ...input, current: null, candidates: [m], chapterKeys: ['text/a'] }),
    ).toEqual([])
    expect(
      narrowChapterScopeMarks({ ...input, candidates: [m], chapterKeys: ['  '] }),
    ).toEqual([])
  })
})
