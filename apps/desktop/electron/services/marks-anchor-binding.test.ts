import { mkdtemp } from 'node:fs/promises'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempUserData = ''
/** 已建临时目录登记簿：beforeEach 断言上一轮已清零（清理证明），afterEach 清理本轮 */
const createdDirs: string[] = []

vi.mock('electron', () => ({
  app: {
    getPath: () => tempUserData,
  },
}))

import { BOOK_DB_SCHEMA_VERSION, migrateBookDb } from './book-db/schema'
import { closeAllBookDbs, openBookDb } from './book-db/open-book-db'
import { backfillAnchorKeys } from './book-db/marks-anchor-backfill'
import {
  createReadingMark,
  deleteReadingMark,
  listReadingMarks,
  listReadingMarksByChapter,
} from './reading-marks-service'
import {
  exportMarksStore,
  findLiveMarkRowsByAnchorKey,
  insertMarkRow,
  updateMarkRow,
} from './marks-db'
import { canonicalAnchorKey, isOk, toChapterKey, type ReadingMark } from '@montree/contracts'

/**
 * 锚点绑定真库集成测试（一卡一段、一段多卡的 DB 体现）。
 * 全部跑真实 node:sqlite 库；每个用例独立 mkdtemp，afterEach 关句柄删目录；
 * beforeEach 先验上一轮目录已消失——清理本身被测试锁定。
 */
describe('marks anchor_key 绑定', () => {
  beforeEach(async () => {
    for (const dir of createdDirs) {
      expect(existsSync(dir), `上一轮临时库未清理: ${dir}`).toBe(false)
    }
    createdDirs.length = 0
    delete process.env.MONTREE_MARKS_BACKEND
    tempUserData = await mkdtemp(join(tmpdir(), 'marks-anchor-'))
    createdDirs.push(tempUserData)
  })

  afterEach(() => {
    closeAllBookDbs()
    // 先关句柄再删目录（Windows 占文件删不掉）；用后即焚
    if (tempUserData) rmSync(tempUserData, { recursive: true, force: true })
    tempUserData = ''
  })

  it('v7 迁移：marks 有 anchor_key 列与索引', () => {
    const db = new DatabaseSync(':memory:')
    try {
      const result = migrateBookDb(db)
      expect(result.version).toBe(BOOK_DB_SCHEMA_VERSION)
      expect(BOOK_DB_SCHEMA_VERSION).toBe(7)
      const columns = db.prepare('PRAGMA table_info(marks)').all() as Array<{ name: string }>
      expect(columns.map((c) => c.name)).toContain('anchor_key')
      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'marks'")
        .all() as Array<{ name: string }>
      expect(indexes.map((row) => row.name)).toContain('idx_marks_anchor_key')
    } finally {
      db.close()
    }
  })

  it('存量空键行回填：口径与写入侧一致，幂等', async () => {
    const created = await createReadingMark({
      filePath: '/books/demo.epub',
      fileFingerprint: 'fp-backfill',
      kind: 'highlight',
      anchor: { format: 'epub', cfi: 'cfi-1', cfiRange: 'cfi-r1', href: 'ch1.xhtml' },
      excerpt: '摘录',
    })
    expect(isOk(created)).toBe(true)
    if (!isOk(created)) return

    // 模拟 v7 之前的存量行：键置空
    let db = openBookDb(tempUserData, 'fp-backfill')
    db.prepare("UPDATE marks SET anchor_key = ''").run()
    closeAllBookDbs()

    // 重新 open 触发回填（生产链路：openBookDb → migrate → backfill）
    db = openBookDb(tempUserData, 'fp-backfill')
    const row = db.prepare('SELECT anchor_key FROM marks WHERE id = ?').get(created.value.id) as {
      anchor_key: string
    }
    expect(row.anchor_key).toBe('epub|ch1.xhtml|cfi-r1')
    closeAllBookDbs()

    // 二次 open 无空键行，回填零行（直接调函数验证幂等返回值）
    db = openBookDb(tempUserData, 'fp-backfill')
    expect(backfillAnchorKeys(db)).toBe(0)
  })

  it('写入口径：四格式 anchor_key 精确值', async () => {
    const cases: Array<{ fp: string; anchor: ReadingMark['anchor']; expected: string }> = [
      {
        fp: 'fp-epub',
        anchor: { format: 'epub', cfi: 'c', cfiRange: 'r', href: 'Text/Ch1.xhtml#x' },
        expected: 'epub|text/ch1.xhtml|r',
      },
      {
        fp: 'fp-pdf',
        anchor: {
          format: 'pdf',
          page: 19,
          version: 2,
          begin: { itemIndex: 4, offset: 0 },
          end: { itemIndex: 4, offset: 12 },
        },
        expected: 'pdf|19|4,0-4,12',
      },
      {
        fp: 'fp-mobi',
        anchor: { format: 'mobi', chapterId: 'Mobi-Ch1', cfiRange: 'r1' },
        expected: 'mobi|mobi-ch1|r1',
      },
      {
        fp: 'fp-web',
        anchor: { format: 'web', url: 'https://example.com/a', headingId: 's2' },
        expected: 'web|https://example.com/a|s2',
      },
    ]
    for (const [index, item] of cases.entries()) {
      const created = await createReadingMark({
        filePath: `/books/b${index}`,
        fileFingerprint: item.fp,
        kind: 'highlight',
        anchor: item.anchor,
        excerpt: `摘录${index}`,
      })
      expect(isOk(created)).toBe(true)
      if (!isOk(created)) return
      const db = openBookDb(tempUserData, item.fp)
      const row = db.prepare('SELECT anchor_key FROM marks WHERE id = ?').get(created.value.id) as {
        anchor_key: string
      }
      expect(row.anchor_key).toBe(item.expected)
      // TS 写入与 contracts 口径同源（回填一致性根基）
      expect(row.anchor_key).toBe(canonicalAnchorKey(item.anchor))
    }
  })

  it('更新锚点刷新 anchor_key', async () => {
    const created = await createReadingMark({
      filePath: '/books/demo.pdf',
      fileFingerprint: 'fp-update',
      kind: 'highlight',
      anchor: { format: 'pdf', page: 3 },
      excerpt: '摘录',
    })
    expect(isOk(created)).toBe(true)
    if (!isOk(created)) return
    const db = openBookDb(tempUserData, 'fp-update')
    updateMarkRow(db, { ...created.value, anchor: { format: 'pdf', page: 5 } })
    const row = db.prepare('SELECT anchor_key FROM marks WHERE id = ?').get(created.value.id) as {
      anchor_key: string
    }
    expect(row.anchor_key).toBe('pdf|5|-')
  })

  it('一对多共存：同锚两卡各一行，按锚查回两张', async () => {
    const anchor = { format: 'epub', cfi: 'c', cfiRange: 'r', href: 'ch.xhtml' } as const
    const first = await createReadingMark({
      filePath: '/books/demo.epub',
      fileFingerprint: 'fp-1n',
      kind: 'highlight',
      anchor: { ...anchor },
      excerpt: '同一段正文',
      category: 'concept',
    })
    const second = await createReadingMark({
      filePath: '/books/demo.epub',
      fileFingerprint: 'fp-1n',
      kind: 'note',
      anchor: { ...anchor },
      note: '同一段的另一张卡',
      category: 'quote',
    })
    expect(isOk(first) && isOk(second)).toBe(true)
    if (!isOk(first) || !isOk(second)) return
    expect(first.value.id).not.toBe(second.value.id)

    const listed = await listReadingMarks('/books/demo.epub')
    expect(isOk(listed)).toBe(true)
    if (!isOk(listed)) return
    expect(listed.value).toHaveLength(2)

    // 按锚查回两张（无唯一约束，软删除才排除）
    const db = openBookDb(tempUserData, 'fp-1n')
    const found = findLiveMarkRowsByAnchorKey(db, 'epub|ch.xhtml|r')
    expect(found.map((row) => row.id).sort()).toEqual([first.value.id, second.value.id].sort())

    const deleted = await deleteReadingMark(first.value.id)
    expect(isOk(deleted)).toBe(true)
    expect(findLiveMarkRowsByAnchorKey(db, 'epub|ch.xhtml|r').map((row) => row.id)).toEqual([
      second.value.id,
    ])
  })

  it('空键查回空；anchor_key 查询走索引', async () => {
    await createReadingMark({
      filePath: '/books/demo.epub',
      fileFingerprint: 'fp-idx',
      kind: 'highlight',
      anchor: { format: 'epub', cfi: 'c', href: 'ch.xhtml' },
      excerpt: '摘录',
    })
    const db = openBookDb(tempUserData, 'fp-idx')
    expect(findLiveMarkRowsByAnchorKey(db, '')).toEqual([])
    const plan = db
      .prepare('EXPLAIN QUERY PLAN SELECT * FROM marks WHERE deleted_at IS NULL AND anchor_key = ?')
      .all('epub|ch.xhtml|c') as Array<{ detail: string }>
    expect(plan.some((row) => /idx_marks_anchor_key/i.test(row.detail))).toBe(true)
  })

  it('章节门路不受影响 + 数据级清理（删卡后列表空、tombstone 留痕）', async () => {
    const chapter = { key: toChapterKey('text/part1'), label: '第一部分', index: 3 }
    const first = await createReadingMark({
      filePath: '/books/demo.epub',
      fileFingerprint: 'fp-ch',
      kind: 'highlight',
      anchor: { format: 'epub', cfi: 'c1', href: 'part1.xhtml' },
      excerpt: '摘录一',
      chapter,
    })
    const second = await createReadingMark({
      filePath: '/books/demo.epub',
      fileFingerprint: 'fp-ch',
      kind: 'highlight',
      anchor: { format: 'epub', cfi: 'c2', href: 'part1.xhtml' },
      excerpt: '摘录二',
      chapter,
    })
    expect(isOk(first) && isOk(second)).toBe(true)
    if (!isOk(first) || !isOk(second)) return

    const byChapter = await listReadingMarksByChapter({
      filePath: '/books/demo.epub',
      chapterKeys: ['text/part1'],
    })
    expect(isOk(byChapter)).toBe(true)
    if (!isOk(byChapter)) return
    expect(byChapter.value).toHaveLength(2)

    // 数据级清理：逐张删除 → 列表空，同步 tombstone 留痕，导出无残留
    for (const mark of [first.value, second.value]) {
      expect(isOk(await deleteReadingMark(mark.id))).toBe(true)
    }
    const empty = await listReadingMarks('/books/demo.epub')
    expect(isOk(empty)).toBe(true)
    if (!isOk(empty)) return
    expect(empty.value).toHaveLength(0)
    const exported = exportMarksStore(tempUserData)
    expect(exported.marks).toHaveLength(0)
    for (const mark of [first.value, second.value]) {
      expect(typeof exported.tombstones?.[mark.id]).toBe('number')
    }
  })

  it('insertMarkRow 直写同样落键（含 V1 pdf 只有页）', () => {
    const db = openBookDb(tempUserData, 'fp-direct')
    const mark: ReadingMark = {
      id: 'direct-1',
      filePath: '/books/direct.pdf',
      fileFingerprint: 'fp-direct',
      kind: 'highlight',
      anchor: { format: 'pdf', page: 7 },
      excerpt: '摘录',
      createdAt: 1,
      updatedAt: 1,
    }
    insertMarkRow(db, mark)
    const row = db.prepare('SELECT anchor_key FROM marks WHERE id = ?').get('direct-1') as {
      anchor_key: string
    }
    expect(row.anchor_key).toBe('pdf|7|-')
    expect(findLiveMarkRowsByAnchorKey(db, 'pdf|7|-')).toHaveLength(1)
  })
})
