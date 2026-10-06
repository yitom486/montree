import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { isOk } from '@montree/contracts'
import { migrateBookDb } from './schema'
import { importBookPages } from './import-book'
import { getBookDbPath } from './open-book-db'
import { inspectIndexedContentFile, inspectIndexedContentInDb } from './content-audit'

const FINGERPRINT = 'audit-book-1'

function seedDb(db: DatabaseSync): number {
  const result = importBookPages(db, {
    fingerprint: FINGERPRINT,
    title: '审计书',
    sourcePath: 'synthetic-fake.pdf',
    format: 'pdf',
    pageCount: 4,
    pageOffset: 0,
    cleanVersion: 'v3',
    printedToc: [
      { title: '第一章', printedPage: 2, level: 1 },
      { title: '第二章', printedPage: 4, level: 1 },
    ],
    pages: [
      { page: 1, markdown: '封面王道计' },
      { page: 2, markdown: '# 第一章\n\n王道计是出版社' },
      {
        page: 3,
        markdown: `这本王道计的书好王道计\n\n${'正'.repeat(1500)}超长关键词${'文'.repeat(1500)}`,
      },
      { page: 4, markdown: '# 第二章\n\n出版社是王道计' },
    ],
  })
  return result.bookId
}

describe('inspectIndexedContentInDb', () => {
  it('命中带真实 blockId/页码/章节与位置', () => {
    const db = new DatabaseSync(':memory:')
    migrateBookDb(db)
    seedDb(db)
    const result = inspectIndexedContentInDb(db, FINGERPRINT, '王道计', 10)
    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value.total).toBe(4)
    expect(result.value.truncated).toBe(false)
    const byPage = new Map(result.value.hits.map((hit) => [hit.locator.pageNumber, hit]))
    // 第 1 页块在首章之前：chapterTitle 为 null，不得编造
    expect(byPage.get(1)?.locator.chapterTitle).toBeNull()
    expect(byPage.get(1)?.locator.blockId).toBeGreaterThan(0)
    expect(byPage.get(2)?.matchPosition).toBe('start')
    expect(byPage.get(2)?.locator.chapterTitle).toBe('第一章')
    expect(byPage.get(3)?.matchPosition).toBe('multiple')
    expect(byPage.get(4)?.matchPosition).toBe('end')
    for (const hit of result.value.hits) {
      expect(hit.source).toBe('book-index')
    }
  })

  it('limit 只截断展示，total 保持精确', () => {
    const db = new DatabaseSync(':memory:')
    migrateBookDb(db)
    seedDb(db)
    const result = inspectIndexedContentInDb(db, FINGERPRINT, '王道计', 2)
    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value.hits).toHaveLength(2)
    expect(result.value.total).toBe(4)
    expect(result.value.truncated).toBe(true)
    expect(result.value.limit).toBe(2)
  })

  it('长块截断：命中保留、长度受限、标记截断', () => {
    const db = new DatabaseSync(':memory:')
    migrateBookDb(db)
    seedDb(db)
    const result = inspectIndexedContentInDb(db, FINGERPRINT, '超长关键词', 10)
    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value.total).toBe(1)
    const hit = result.value.hits[0]
    expect(hit?.text).toContain('超长关键词')
    expect(hit?.text.length).toBeLessThanOrEqual(1200)
    expect(hit?.textTruncated).toBe(true)
  })

  it('零命中是成功空结果，不是错误', () => {
    const db = new DatabaseSync(':memory:')
    migrateBookDb(db)
    seedDb(db)
    const result = inspectIndexedContentInDb(db, FINGERPRINT, '不存在的词条', 10)
    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value.total).toBe(0)
    expect(result.value.hits).toEqual([])
    expect(result.value.truncated).toBe(false)
  })

  it('参数错误：空词/过短/非法条数/缺指纹', () => {
    const db = new DatabaseSync(':memory:')
    migrateBookDb(db)
    seedDb(db)
    for (const query of ['', '  ', 'ab', 123]) {
      const result = inspectIndexedContentInDb(db, FINGERPRINT, query, 10)
      expect(isOk(result)).toBe(false)
      if (isOk(result)) continue
      expect(result.error.code).toBe('INVALID_ARGUMENT')
    }
    for (const limit of [0, 11, 1.5, Number.NaN, '10']) {
      const result = inspectIndexedContentInDb(db, FINGERPRINT, '王道计', limit)
      expect(isOk(result)).toBe(false)
    }
    const noFp = inspectIndexedContentInDb(db, '  ', '王道计', 10)
    expect(isOk(noFp)).toBe(false)
  })

  it('未入库指纹报 INVALID_STATE，不写库', () => {
    const db = new DatabaseSync(':memory:')
    migrateBookDb(db)
    seedDb(db)
    const before = (db.prepare('SELECT COUNT(*) AS n FROM blocks').get() as { n: number }).n
    const result = inspectIndexedContentInDb(db, 'no-such-book', '王道计', 10)
    expect(isOk(result)).toBe(false)
    if (isOk(result)) return
    expect(result.error.code).toBe('INVALID_STATE')
    const after = (db.prepare('SELECT COUNT(*) AS n FROM blocks').get() as { n: number }).n
    expect(after).toBe(before)
  })
})

describe('inspectIndexedContentFile 只读证明', () => {
  function makeFileDb(): { dir: string; dbPath: string } {
    const dir = mkdtempSync(join(tmpdir(), 'montree-audit-'))
    const dbPath = getBookDbPath(dir, FINGERPRINT)
    mkdirSync(dirname(dbPath), { recursive: true })
    const db = new DatabaseSync(dbPath)
    migrateBookDb(db)
    seedDb(db)
    db.close()
    return { dir, dbPath }
  }

  function snapshot(dbPath: string): string {
    const stat = statSync(dbPath)
    const hash = createHash('sha256').update(readFileSync(dbPath)).digest('hex')
    return `${stat.size}:${stat.mtimeMs}:${hash}`
  }

  function tableCounts(dbPath: string): string {
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const parts = ['books', 'chapters', 'blocks', 'toc_entries', 'block_fts'].map((table) => {
        try {
          return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
        } catch {
          return -1
        }
      })
      return parts.join('/')
    } finally {
      db.close()
    }
  }

  it('缺库直接报错且不创建任何文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'montree-audit-missing-'))
    const dbPath = getBookDbPath(dir, 'ghost-fp')
    const result = inspectIndexedContentFile(dir, 'ghost-fp', '王道计', 10)
    expect(isOk(result)).toBe(false)
    if (isOk(result)) return
    expect(result.error.code).toBe('INVALID_STATE')
    let fileCreated = false
    try {
      statSync(dbPath)
      fileCreated = true
    } catch {
      fileCreated = false
    }
    expect(fileCreated).toBe(false)
  })

  it('查询前后文件 hash/size/mtime 与表行数完全不变', () => {
    const { dir, dbPath } = makeFileDb()
    const beforeFile = snapshot(dbPath)
    const beforeTables = tableCounts(dbPath)
    const result = inspectIndexedContentFile(dir, FINGERPRINT, '王道计', 10)
    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value.total).toBe(4)
    expect(snapshot(dbPath)).toBe(beforeFile)
    expect(tableCounts(dbPath)).toBe(beforeTables)
  })
})
