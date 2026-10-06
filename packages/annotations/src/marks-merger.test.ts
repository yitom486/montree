import { describe, it, expect } from 'vitest'
import { mergeReadingMarks, type SyncMarksPayload } from './marks-merger'
import type { ReadingMark } from '@montree/contracts'

describe('marks-merger', () => {
  const markA: ReadingMark = {
    id: 'mark-1',
    filePath: 'book.pdf',
    fileFingerprint: 'fp-1',
    createdAt: 1000,
    updatedAt: 1000,
    kind: 'highlight',
    anchor: { format: 'pdf', page: 1 },
    excerpt: 'highlight 1',
  }

  const markB: ReadingMark = {
    id: 'mark-2',
    filePath: 'book.pdf',
    fileFingerprint: 'fp-1',
    createdAt: 2000,
    updatedAt: 2000,
    kind: 'note',
    anchor: { format: 'pdf', page: 2 },
    excerpt: 'highlight 2',
    note: 'my note',
  }

  it('合并两端互不重叠的批注为全集并集', () => {
    const local: SyncMarksPayload = { marks: [markA] }
    const remote: SyncMarksPayload = { marks: [markB] }

    const result = mergeReadingMarks(local, remote)
    expect(result.merged.marks).toHaveLength(2)
    expect(result.addedCount).toBe(1)
    expect(result.merged.marks.map((m) => m.id).sort()).toEqual(['mark-1', 'mark-2'])
  })

  it('同一条批注两端都有时，以更新时间戳较大者为准', () => {
    const markAUpdated: ReadingMark = {
      ...markA,
      updatedAt: 5000,
      note: 'updated on remote',
    }

    const local: SyncMarksPayload = { marks: [markA] }
    const remote: SyncMarksPayload = { marks: [markAUpdated] }

    const result = mergeReadingMarks(local, remote)
    expect(result.merged.marks).toHaveLength(1)
    expect(result.updatedCount).toBe(1)
    expect(result.merged.marks[0]?.note).toBe('updated on remote')
    expect(result.merged.marks[0]?.updatedAt).toBe(5000)
  })

  it('墓碑机制生效：已在一端删除的划线不会被对端旧记录复活', () => {
    const local: SyncMarksPayload = {
      marks: [],
      tombstones: { 'mark-1': 3000 },
    }
    const remote: SyncMarksPayload = {
      marks: [markA], // updatedAt: 1000 <= tombstone: 3000
    }

    const result = mergeReadingMarks(local, remote)
    expect(result.merged.marks).toHaveLength(0)
    expect(result.deletedCount).toBe(1)
    expect(result.merged.tombstones?.['mark-1']).toBe(3000)
  })

  it('若用户在删除后重新以更新的时间戳创建/编辑，则取消墓碑并保留新划线', () => {
    const local: SyncMarksPayload = {
      marks: [],
      tombstones: { 'mark-1': 2000 },
    }
    const reCreatedMark: ReadingMark = {
      ...markA,
      updatedAt: 4000, // > tombstone 2000
    }
    const remote: SyncMarksPayload = {
      marks: [reCreatedMark],
    }

    const result = mergeReadingMarks(local, remote)
    expect(result.merged.marks).toHaveLength(1)
    expect(result.merged.marks[0]?.id).toBe('mark-1')
    expect(result.merged.tombstones?.['mark-1']).toBeUndefined()
  })

  it('GC 回收过期且两端均无活标记的墓碑', () => {
    const now = 200_000_000_000
    const local: SyncMarksPayload = {
      marks: [],
      tombstones: { 'mark-gone': now - 91 * 24 * 3600 * 1000 },
    }
    const remote: SyncMarksPayload = { marks: [] }

    const result = mergeReadingMarks(local, remote, { now })
    expect(result.merged.tombstones?.['mark-gone']).toBeUndefined()
    expect(result.tombstonesPrunedCount).toBe(1)
  })

  it('GC 保留未过期的孤墓碑', () => {
    const now = 200_000_000_000
    const local: SyncMarksPayload = {
      marks: [],
      tombstones: { 'mark-gone': now - 10 * 24 * 3600 * 1000 },
    }
    const remote: SyncMarksPayload = { marks: [] }

    const result = mergeReadingMarks(local, remote, { now })
    expect(result.merged.tombstones?.['mark-gone']).toBe(now - 10 * 24 * 3600 * 1000)
    expect(result.tombstonesPrunedCount).toBe(0)
  })

  it('GC 不回收对端仍持有活标记的过期墓碑（复活可见优于静默丢数）', () => {
    const now = 200_000_000_000
    const local: SyncMarksPayload = {
      marks: [],
      tombstones: { 'mark-1': now - 91 * 24 * 3600 * 1000 },
    }
    const remote: SyncMarksPayload = {
      marks: [markA], // updatedAt: 1000，远早于墓碑，仍被压制
    }

    const result = mergeReadingMarks(local, remote, { now })
    expect(result.merged.marks).toHaveLength(0)
    expect(result.deletedCount).toBe(1)
    expect(result.merged.tombstones?.['mark-1']).toBe(now - 91 * 24 * 3600 * 1000)
    expect(result.tombstonesPrunedCount).toBe(0)
  })
})
