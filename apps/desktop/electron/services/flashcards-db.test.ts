import { mkdtemp } from 'node:fs/promises'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempUserData = ''

vi.mock('electron', () => ({
  app: {
    getPath: () => tempUserData,
  },
}))

import { BOOK_DB_SCHEMA_VERSION, migrateBookDb } from './book-db/schema'
import { closeAllBookDbs, getBookDbDir, openBookDb } from './book-db/open-book-db'
import {
  createReadingMark,
  deleteReadingMark,
  updateReadingMark,
} from './reading-marks-service'
import {
  appendFlashcardReview as appendFlashcardReviewService,
  listDueFlashcards as listDueFlashcardsService,
} from './reading-marks-service'
import {
  appendFlashcardReview,
  clearFlashcardsBackfillCache,
  countDueFlashcardsForBook,
  importMarksStore,
  listDueFlashcards,
} from './marks-db'
import { countDueFlashcards, deriveFlashcard, getFlashcardRow, listReviewRows } from './flashcards-db'
import { isOk, toChapterKey } from '@montree/contracts'

describe('flashcards-db（[2]-02b 记忆卡片复习态）', () => {
  beforeEach(async () => {
    delete process.env.MONTREE_MARKS_BACKEND
    tempUserData = await mkdtemp(join(tmpdir(), 'flashcards-db-'))
  })

  afterEach(() => {
    closeAllBookDbs()
    // 先关句柄再删目录（Windows 占文件删不掉）；用后即焚，不留 tmp 堆积
    if (tempUserData) rmSync(tempUserData, { recursive: true, force: true })
    delete process.env.MONTREE_MARKS_BACKEND
    tempUserData = ''
  })

  it('v6 迁移建 flashcards/review_log 与索引（幂等，存量行保留）', () => {
    const db = new DatabaseSync(':memory:')
    try {
      const first = migrateBookDb(db)
      expect(first).toEqual({ migrated: true, version: BOOK_DB_SCHEMA_VERSION })
      expect(migrateBookDb(db)).toEqual({ migrated: false, version: BOOK_DB_SCHEMA_VERSION })
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>
      const names = new Set(tables.map((row) => row.name))
      expect(names.has('flashcards')).toBe(true)
      expect(names.has('review_log')).toBe(true)
      // v5 系表原位保留
      expect(names.has('marks')).toBe(true)

      const indexes = db
        .prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = 'index'")
        .all() as Array<{ name: string; tbl_name: string }>
      const byTable = new Map(indexes.map((row) => [row.name, row.tbl_name]))
      expect(byTable.get('idx_flashcards_chapter_key')).toBe('flashcards')
      expect(byTable.get('idx_review_log_card_time')).toBe('review_log')

      // 存量行在重复迁移后保留
      db.prepare(
        `INSERT INTO flashcards
          (id, mark_id, kind, front, back, tags, chapter_key, chapter_id, orphaned, created_at, updated_at)
         VALUES ('c1', 'c1', 'basic', '问', '答', '[]', '', NULL, 0, 1, 1)`,
      ).run()
      expect(migrateBookDb(db).migrated).toBe(false)
      expect(getFlashcardRow(db, 'c1')?.front).toBe('问')
    } finally {
      db.close()
    }
  })

  it('章节/题行关联走索引（EXPLAIN 抽查）', async () => {
    const created = await createReadingMark({
      filePath: 'D:\\books\\demo.epub',
      fileFingerprint: 'fp-idx',
      kind: 'highlight',
      anchor: { format: 'epub', cfi: 'cfi-1' },
      excerpt: '荒野求生',
      chapter: { key: toChapterKey('text/part1'), label: '第一部分', index: 3 },
    })
    expect(isOk(created)).toBe(true)

    const db = openBookDb(tempUserData, 'fp-idx')
    const chapterPlan = db
      .prepare('EXPLAIN QUERY PLAN SELECT * FROM flashcards WHERE chapter_key = ?')
      .all('text/part1') as Array<{ detail: string }>
    expect(chapterPlan.some((row) => /idx_flashcards_chapter_key/i.test(row.detail))).toBe(true)

    const logPlan = db
      .prepare('EXPLAIN QUERY PLAN SELECT * FROM review_log WHERE card_id = ?')
      .all('x') as Array<{ detail: string }>
    expect(logPlan.some((row) => /idx_review_log_card_time/i.test(row.detail))).toBe(true)
  })

  it('派生口径与 Anki 导出一致：basic/cloze/书签与无摘录不出卡', () => {
    const base = {
      id: 'm',
      filePath: 'D:\\books\\a.epub',
      fileFingerprint: 'fp',
      anchor: { format: 'epub', cfi: 'c' },
      createdAt: 1,
      updatedAt: 2,
    } as const
    // 有批注 → basic
    expect(deriveFlashcard({ ...base, kind: 'highlight', excerpt: '原文', note: '提问' })).toEqual({
      kind: 'basic',
      front: '提问',
      back: '原文',
      tags: [],
      chapterKey: '',
    })
    // 无批注 → cloze
    expect(deriveFlashcard({ ...base, kind: 'highlight', excerpt: '原文' })?.front).toBe(
      '{{c1::原文}}',
    )
    // 摘录走 anchor.selectedText 兜底（与 isHighlightPassage 同判据；无批注即 cloze，摘录进 front）
    const viaAnchor = deriveFlashcard({
      ...base,
      kind: 'note',
      anchor: { format: 'pdf', page: 3, selectedText: '划选文字' },
    })
    expect(viaAnchor?.front).toBe('{{c1::划选文字}}')
    // 书签 / 无摘录 → 不出卡
    expect(deriveFlashcard({ ...base, kind: 'bookmark', excerpt: '原文' })).toBeNull()
    expect(deriveFlashcard({ ...base, kind: 'note' })).toBeNull()
    // 章节 key 与用户标签进快照
    const withMeta = deriveFlashcard({
      ...base,
      kind: 'highlight',
      excerpt: '原文',
      tags: ['重点'],
      chapter: { key: toChapterKey('text/p1'), label: '第一章', index: 0 },
    })
    expect(withMeta?.chapterKey).toBe('text/p1')
    expect(withMeta?.tags).toEqual(['重点'])
  })

  it('卡片跟随增删改：upsert/失格标脏/删卡 orphan（日志保留，待复习排除）', async () => {
    const created = await createReadingMark({
      filePath: 'D:\\books\\demo.epub',
      fileFingerprint: 'fp-1',
      kind: 'highlight',
      anchor: { format: 'epub', cfi: 'cfi-1' },
      excerpt: '托克维尔参观了荒野',
      note: '为什么写荒野？',
      chapter: { key: toChapterKey('text/part1'), label: '第一部分', index: 3 },
    })
    expect(isOk(created)).toBe(true)
    if (!isOk(created)) return
    const id = created.value.id

    // 创建即派生 basic 卡，id 即 mark.id（直跳原书身份不变）
    const db = openBookDb(tempUserData, 'fp-1')
    expect(getFlashcardRow(db, id)).toMatchObject({
      kind: 'basic',
      front: '为什么写荒野？',
      back: '托克维尔参观了荒野',
      chapter_key: 'text/part1',
    })
    expect(countDueFlashcardsForBook(tempUserData, 'fp-1')).toBe(1)

    // 批注一改，快照跟随；复习日志原位保留
    expect(appendFlashcardReview(tempUserData, 'fp-1', id, 'hard', 100)).toBe(true)
    const updated = await updateReadingMark({ id, note: '改后的提问' })
    expect(isOk(updated)).toBe(true)
    expect(getFlashcardRow(db, id)?.front).toBe('改后的提问')
    expect(listReviewRows(db, id)).toHaveLength(1)

    // 改成书签即失格 → 标脏
    expect(isOk(await updateReadingMark({ id, kind: 'bookmark' }))).toBe(true)
    expect(getFlashcardRow(db, id)?.orphaned).toBe(1)
    expect(countDueFlashcardsForBook(tempUserData, 'fp-1')).toBe(0)

    // 书签从创建起就不出卡
    const bookmark = await createReadingMark({
      filePath: 'D:\\books\\demo.epub',
      fileFingerprint: 'fp-1',
      kind: 'bookmark',
      anchor: { format: 'epub', cfi: 'cfi-bm' },
    })
    expect(isOk(bookmark)).toBe(true)
    if (!isOk(bookmark)) return
    expect(getFlashcardRow(db, bookmark.value.id)).toBeNull()

    // 删卡 → orphan（日志保留，待复习排除）
    expect(isOk(await deleteReadingMark(id))).toBe(true)
    expect(getFlashcardRow(db, id)?.orphaned).toBe(1)
    expect(listReviewRows(db, id)).toHaveLength(1)
    expect(listDueFlashcards(tempUserData, 'fp-1').map((card) => card.id)).not.toContain(id)
  })

  it('复习一次 log+1；待复习未复习优先、其次最久未复习', async () => {
    const ids: string[] = []
    for (const excerpt of ['甲', '乙乙乙', '丙丙丙']) {
      const created = await createReadingMark({
        filePath: 'D:\\books\\due.epub',
        fileFingerprint: 'fp-due',
        kind: 'highlight',
        anchor: { format: 'epub', cfi: `cfi-${excerpt}` },
        excerpt: `${excerpt}原文内容`,
      })
      expect(isOk(created)).toBe(true)
      if (!isOk(created)) return
      ids.push(created.value.id)
    }
    const [a, b, c] = ids as [string, string, string]
    expect(appendFlashcardReview(tempUserData, 'fp-due', b, 'good', 1000)).toBe(true)
    expect(appendFlashcardReview(tempUserData, 'fp-due', c, 'again', 2000)).toBe(true)
    // 非法评级与未知卡拒绝落盘
    const db = openBookDb(tempUserData, 'fp-due')
    expect(appendFlashcardReview(tempUserData, 'fp-due', 'ghost', 'good', 3000)).toBe(false)
    expect(db.prepare('SELECT COUNT(*) AS c FROM review_log').get() as { c: number }).toEqual({
      c: 2,
    })

    const due = listDueFlashcards(tempUserData, 'fp-due')
    expect(due.map((card) => card.id)).toEqual([a, b, c])
    expect(due[0]).toMatchObject({ lastReviewed: null, reviewCount: 0 })
    expect(due[2]).toMatchObject({ lastReviewed: 2000, reviewCount: 1 })
  })

  it('存量回填：01 时代旧卡一次派生，marker 幂等', async () => {
    const created = await createReadingMark({
      filePath: 'D:\\books\\old.epub',
      fileFingerprint: 'fp-old',
      kind: 'highlight',
      anchor: { format: 'epub', cfi: 'cfi-old' },
      excerpt: '旧摘录',
    })
    expect(isOk(created)).toBe(true)
    if (!isOk(created)) return

    // 模拟 01 时代：清快照 + 删 marker + 清进程记忆（模拟新进程首次触书）
    const db = openBookDb(tempUserData, 'fp-old')
    db.exec('DELETE FROM flashcards')
    rmSync(join(getBookDbDir(tempUserData, 'fp-old'), 'flashcards-backfilled.json'))
    clearFlashcardsBackfillCache()
    expect(countDueFlashcards(db)).toBe(0)

    // 下一次读写触发回填
    const due = listDueFlashcards(tempUserData, 'fp-old')
    expect(due.map((card) => card.id)).toEqual([created.value.id])
    expect(due[0]?.front).toBe('{{c1::旧摘录}}')
    expect(existsSync(join(getBookDbDir(tempUserData, 'fp-old'), 'flashcards-backfilled.json'))).toBe(
      true,
    )

    // 回填幂等：复习记录不受二次回填影响
    expect(appendFlashcardReview(tempUserData, 'fp-old', created.value.id, 'good', 500)).toBe(true)
    expect(listDueFlashcards(tempUserData, 'fp-old')).toHaveLength(1)
    expect(listReviewRows(db, created.value.id)).toHaveLength(1)
  })

  it('同步兼容：导入 upsert、复活解 orphan、tombstone 标脏', async () => {
    const created = await createReadingMark({
      filePath: 'D:\\books\\sync.epub',
      fileFingerprint: 'fp-sync',
      kind: 'highlight',
      anchor: { format: 'epub', cfi: 'cfi-sync' },
      excerpt: '同步摘录',
      note: '同步提问',
    })
    expect(isOk(created)).toBe(true)
    if (!isOk(created)) return
    const mark = created.value

    // 同步写回：新卡快照落盘（幂等复灌不翻倍）
    importMarksStore(tempUserData, { marks: [{ ...mark }], tombstones: {} })
    const db = openBookDb(tempUserData, 'fp-sync')
    expect(getFlashcardRow(db, mark.id)?.front).toBe('同步提问')

    // 远端删除 → 标脏（待复习排除）
    importMarksStore(tempUserData, { marks: [], tombstones: { [mark.id]: 999 } })
    expect(getFlashcardRow(db, mark.id)?.orphaned).toBe(1)
    expect(countDueFlashcards(db)).toBe(0)

    // 对端复活（更新摘录）→ 解 orphan + 快照跟随
    importMarksStore(tempUserData, {
      marks: [{ ...mark, excerpt: '新摘录', updatedAt: mark.updatedAt + 1 }],
      tombstones: {},
    })
    expect(getFlashcardRow(db, mark.id)).toMatchObject({ orphaned: 0, back: '新摘录' })
  })

  it('file 后端：卡片联动不碰库（回滚即无 DB 写入）', async () => {
    process.env.MONTREE_MARKS_BACKEND = 'file'
    const created = await createReadingMark({
      filePath: 'D:\\books\\demo.epub',
      fileFingerprint: 'fp-file',
      kind: 'highlight',
      anchor: { format: 'epub', cfi: 'cfi-1' },
      excerpt: '文件后端摘录',
    })
    expect(isOk(created)).toBe(true)
    expect(existsSync(join(tempUserData, 'book-index'))).toBe(false)
  })

  it('UI批 service：待复习列表与评分落盘（含 file 后端回空）', async () => {
    const created = await createReadingMark({
      filePath: 'D:\\books\\svc.epub',
      fileFingerprint: 'fp-svc',
      kind: 'highlight',
      anchor: { format: 'epub', cfi: 'cfi-svc' },
      excerpt: '待复习摘录内容',
      note: '待复习提问',
    })
    expect(isOk(created)).toBe(true)
    if (!isOk(created)) return
    const id = created.value.id

    const due = await listDueFlashcardsService({ filePath: 'D:\\books\\svc.epub' })
    expect(isOk(due)).toBe(true)
    if (!isOk(due)) return
    expect(due.value).toHaveLength(1)
    expect(due.value[0]).toMatchObject({
      id,
      markId: id,
      kind: 'basic',
      front: '待复习提问',
      lastReviewed: null,
      reviewCount: 0,
    })

    const persisted = await appendFlashcardReviewService({
      filePath: 'D:\\books\\svc.epub',
      cardId: id,
      rating: 'good',
    })
    expect(isOk(persisted)).toBe(true)
    if (!isOk(persisted)) return
    expect(persisted.value).toBe(true)

    const after = await listDueFlashcardsService({ filePath: 'D:\\books\\svc.epub' })
    expect(isOk(after)).toBe(true)
    if (!isOk(after)) return
    expect(after.value[0]).toMatchObject({ reviewCount: 1 })

    // 未知卡/未知书：落盘 false、列表空（不抛错，不断复习流）
    const ghost = await appendFlashcardReviewService({
      filePath: 'D:\\books\\svc.epub',
      cardId: 'ghost',
      rating: 'good',
    })
    expect(isOk(ghost) && ghost.value).toBe(false)
    const ghostBook = await listDueFlashcardsService({ filePath: 'D:\\books\\ghost.epub' })
    expect(isOk(ghostBook) && ghostBook.value).toEqual([])
  })

  it('UI批 service file 后端：列表空、落盘 false（调用方回落内存）', async () => {
    process.env.MONTREE_MARKS_BACKEND = 'file'
    const due = await listDueFlashcardsService({ filePath: 'D:\\books\\demo.epub' })
    expect(isOk(due) && due.value).toEqual([])
    const persisted = await appendFlashcardReviewService({
      filePath: 'D:\\books\\demo.epub',
      cardId: 'any',
      rating: 'good',
    })
    expect(isOk(persisted) && persisted.value).toBe(false)
  })
})
