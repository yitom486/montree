import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  computeBodyWatermarkPlanSignature,
  planBodyWatermarkPatches,
  sha256HexAscii,
  type BodyWatermarkPatch,
} from '@montree/ocr-core'
import type { BookBlockType } from '@montree/contracts'
import { getBookDbPath } from './open-book-db'
import { migrateBookDb } from './schema'
import { getBookRecord, searchBookBlocks } from './queries'
import { previewBodyWatermarkFile, previewBodyWatermarkInDb } from './body-watermark-preview'
import {
  applyBodyWatermarkFile,
  applyBodyWatermarkInDb,
  formatBodyWatermarkBackupTimestamp,
  resolveBodyWatermarkBackupPath,
} from './body-watermark-apply'

/**
 * Phase 2.3 备份并应用正文水印清洗。
 * 全部写库测试仅用 :memory: 或 tmp 临时目录 + 合成指纹/文件名；
 * 绝不触碰用户真实书库（AppData/book-index），绝不写入真实路径固件。
 */

let seq = 0
function nextFingerprint(prefix: string): string {
  seq += 1
  return `${prefix}-fp-${Date.now()}-${seq}`
}

function openMemDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  migrateBookDb(db)
  return db
}

interface SeedBlock {
  type?: string
  content: string
  pageNumber: number
}

/** 合成书：books + chapters + toc_entries + blocks（目录数据供“不变”断言） */
function seedApplyBook(
  db: DatabaseSync,
  fingerprint: string,
  blocks: SeedBlock[],
): { bookId: number; blockIds: number[] } {
  const now = Date.now()
  const bookId = Number(
    db
      .prepare(
        `INSERT INTO books
          (fingerprint, title, source_path, format, page_count, page_offset, clean_version, completed_pages, toc_signature, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        fingerprint,
        '合成测试书',
        'synthetic-fake.pdf',
        'pdf',
        340,
        0,
        'ocr-watermark-v3',
        JSON.stringify([36, 37, 38]),
        'synthetic-toc-sig-v1',
        now,
        now,
      ).lastInsertRowid,
  )
  const chapterIdByIndex = new Map<number, number>()
  const insertChapter = db.prepare(
    `INSERT INTO chapters (book_id, chapter_index, title, level, start_page, end_page)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  for (const [index, title] of ['第一章 合成章', '第二章 合成章'].entries()) {
    const result = insertChapter.run(bookId, index, title, 1, 36 + index * 10, 45 + index * 10)
    chapterIdByIndex.set(index, Number(result.lastInsertRowid))
  }
  const insertToc = db.prepare(
    `INSERT INTO toc_entries (book_id, toc_index, title, level, start_page, end_page)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  insertToc.run(bookId, 0, '第一章 合成章', 1, 36, 45)
  insertToc.run(bookId, 1, '第二章 合成章', 1, 46, 55)
  const insertBlock = db.prepare(
    `INSERT INTO blocks
      (book_id, chapter_id, chapter_index, block_index, type, content, page_number, bbox, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const blockIds: number[] = []
  blocks.forEach((block, index) => {
    const chapterIndex = index % 2
    const result = insertBlock.run(
      bookId,
      chapterIdByIndex.get(chapterIndex) ?? null,
      chapterIndex,
      index,
      block.type ?? 'paragraph',
      block.content,
      block.pageNumber,
      null,
      null,
    )
    blockIds.push(Number(result.lastInsertRowid))
  })
  return { bookId, blockIds }
}

/** 标准混合数据：删/改/合法移码/表中王/普通正文 */
function standardBlocks(): SeedBlock[] {
  return [
    { content: '王', pageNumber: 36 },
    { content: '输入/输出系统 王道计', pageNumber: 36 },
    { content: '王道计 王道计 机教育 机教育', pageNumber: 38 },
    { content: '(4)移码表示法 王道计 移码主要用于表示', pageNumber: 37 },
    { content: '移码表示法常用于偏置表示', pageNumber: 37 },
    { content: '普通正文，无水印', pageNumber: 37 },
    { type: 'table', content: '王', pageNumber: 38 },
  ]
}

function snapshotDbFull(db: DatabaseSync): {
  counts: Record<string, number>
  booksRow: unknown
  hash: string
} {
  const counts: Record<string, number> = {}
  const parts: string[] = []
  for (const table of ['books', 'chapters', 'blocks', 'toc_entries']) {
    const row = db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as {
      total?: unknown
    }
    const total = typeof row?.total === 'number' ? row.total : -1
    counts[table] = total
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()
    parts.push(`${table}:${JSON.stringify(rows)}`)
  }
  const fts = db.prepare('SELECT COUNT(*) AS total FROM block_fts').get() as {
    total?: unknown
  }
  counts.block_fts = typeof fts?.total === 'number' ? fts.total : -1
  parts.push(`block_fts-count:${counts.block_fts}`)
  const booksRow = db.prepare('SELECT * FROM books ORDER BY id').all()
  return { counts, booksRow, hash: createHash('sha256').update(parts.join('\n')).digest('hex') }
}

function createFileDbForApply(
  fingerprint: string,
  blocks: SeedBlock[],
): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'body-watermark-apply-'))
  const dbPath = getBookDbPath(dir, fingerprint)
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  try {
    migrateBookDb(db)
    seedApplyBook(db, fingerprint, blocks)
  } finally {
    db.close()
  }
  // 关闭后清理 WAL 伴生文件，保持“文件哈希稳定”可断言（仅 tmp 临时库）
  for (const suffix of ['-wal', '-shm']) {
    try {
      rmSync(`${dbPath}${suffix}`, { force: true })
    } catch {
      // 无伴生文件时忽略
    }
  }
  return { dir, dbPath }
}

function listBakFiles(dbPath: string): string[] {
  const dir = dirname(dbPath)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.startsWith('book.db.') && name.endsWith('.bak'))
    .map((name) => join(dir, name))
    .sort()
}

function readBlocksById(db: DatabaseSync, bookId: number): Map<number, string> {
  const rows = db
    .prepare('SELECT id, content FROM blocks WHERE book_id = ? ORDER BY id ASC')
    .all(bookId) as { id?: unknown; content?: unknown }[]
  const map = new Map<number, string>()
  for (const row of rows) {
    if (typeof row?.id === 'number' && typeof row?.content === 'string') {
      map.set(row.id, row.content)
    }
  }
  return map
}

describe('body-watermark planSignature 纯函数', () => {
  it('与 Node sha256 同值、排序无关、空计划为 sha256("[]")', () => {
    const a: BodyWatermarkPatch[] = [
      { id: 2, action: 'update', before: '输入/输出系统 王道计', after: '输入/输出系统', reason: 'trim-edge:王道计', pageNumber: 36 },
      { id: 1, action: 'delete', before: '王', reason: 'whole-block:王', pageNumber: 36 },
    ]
    const b = [...a].reverse()
    expect(computeBodyWatermarkPlanSignature(a)).toBe(computeBodyWatermarkPlanSignature(b))
    expect(computeBodyWatermarkPlanSignature(a)).toMatch(/^[0-9a-f]{64}$/)
    const canonical = JSON.stringify([
      [1, 'delete', '王', '', 'whole-block:王'],
      [2, 'update', '输入/输出系统 王道计', '输入/输出系统', 'trim-edge:王道计'],
    ])
    const expected = createHash('sha256').update(canonical, 'utf8').digest('hex')
    expect(computeBodyWatermarkPlanSignature(a)).toBe(expected)
    expect(computeBodyWatermarkPlanSignature([])).toBe(
      createHash('sha256').update('[]', 'utf8').digest('hex'),
    )
    // after 缺省与 '' 同签名（delete 无 after）
    const withEmpty: BodyWatermarkPatch[] = [
      { id: 1, action: 'delete', before: '王', after: '', reason: 'whole-block:王', pageNumber: 36 },
    ]
    const without: BodyWatermarkPatch[] = [
      { id: 1, action: 'delete', before: '王', reason: 'whole-block:王', pageNumber: 36 },
    ]
    expect(computeBodyWatermarkPlanSignature(withEmpty)).toBe(
      computeBodyWatermarkPlanSignature(without),
    )
  })

  it('sha256HexAscii 与 Node crypto 对中文一致', () => {
    for (const text of ['', 'abc', '[]', '王道计', '移码表示法']) {
      expect(sha256HexAscii(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'))
    }
  })

  it('规划器输入顺序不同不影响签名（排序覆盖 id/action/before/after/reason）', () => {
    const blocksA = [
      { id: 1, type: 'paragraph' as const, content: '王', pageNumber: 36 },
      { id: 2, type: 'paragraph' as const, content: '输入/输出系统 王道计', pageNumber: 36 },
    ]
    const blocksB = [...blocksA].reverse()
    const sigA = computeBodyWatermarkPlanSignature(planBodyWatermarkPatches(blocksA))
    const sigB = computeBodyWatermarkPlanSignature(planBodyWatermarkPatches(blocksB))
    expect(sigA).toBe(sigB)
  })
})

describe('body-watermark-apply 备份并应用', () => {
  it('预览签名与应用重算一致（不重复改预览语义）', () => {
    const db = openMemDb()
    try {
      const fp = nextFingerprint('apply-preview-sig')
      seedApplyBook(db, fp, standardBlocks())
      const preview = previewBodyWatermarkInDb(db, fp)
      expect(preview.ok).toBe(true)
      if (!preview.ok) return
      // Phase 2.2 语义：总数/删改/样例上限不变，仅新增签名
      expect(preview.value.totalPatches).toBe(3)
      expect(preview.value.deleteCount).toBe(2)
      expect(preview.value.updateCount).toBe(1)
      expect(preview.value.planSignature).toMatch(/^[0-9a-f]{64}$/)
      const record = getBookRecord(db, fp)
      expect(record).not.toBeNull()
    } finally {
      db.close()
    }
  })

  it('内存库成功应用：备份校验 + 单事务 + 目录不变 + FTS同步 + 移码可检索', () => {
    const db = openMemDb()
    const backupDir = mkdtempSync(join(tmpdir(), 'body-watermark-apply-bak-'))
    try {
      const fp = nextFingerprint('apply-mem-success')
      const { bookId } = seedApplyBook(db, fp, standardBlocks())
      const beforeSnap = snapshotDbFull(db)
      const preview = previewBodyWatermarkInDb(db, fp)
      expect(preview.ok).toBe(true)
      if (!preview.ok) return
      const beforeBlocks = readBlocksById(db, bookId)
      // 重算补丁供“王道计”条件断言（不硬编码数量）
      const rows = db
        .prepare('SELECT id, type, content, page_number AS pageNumber FROM blocks WHERE book_id = ?')
        .all(bookId) as { id: number; type: string; content: string; pageNumber: number }[]
      const patches = planBodyWatermarkPatches(
        rows.map((r) => ({
          id: r.id,
          type: r.type as BookBlockType,
          content: r.content,
          pageNumber: r.pageNumber,
        })),
      )
      const expectedSig = computeBodyWatermarkPlanSignature(patches)
      expect(preview.value.planSignature).toBe(expectedSig)

      const result = applyBodyWatermarkInDb(
        db,
        fp,
        {
          planSignature: preview.value.planSignature,
          deleteCount: preview.value.deleteCount,
          updateCount: preview.value.updateCount,
        },
        { backupDir },
      )
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.status).toBe('applied')
      expect(result.value.planSignature).toBe(expectedSig)
      expect(result.value.backupPath.startsWith(backupDir)).toBe(true)
      expect(existsSync(result.value.backupPath)).toBe(true)
      expect(result.value.backupSize).toBeGreaterThan(0)
      expect(result.value.backupHash).toMatch(/^[0-9a-f]{64}$/)
      // 备份文件名含时间戳且不可覆盖（book.db.YYYYMMDD-HHmmss-SSS.bak）
      expect(result.value.backupPath).toMatch(/book\.db\.\d{8}-\d{6}-\d{3}\.bak$/)
      // blocks = 原行数 - 删除数（动态断言，不硬编码）
      expect(result.value.blocksAfter).toBe(result.value.blocksBefore - result.value.deleteCount)
      expect(result.value.blocksAfter).toBe(beforeSnap.counts.blocks - preview.value.deleteCount)

      // 目录数据不变：chapters/toc_entries/签名/completed_pages/cleanVersion
      const afterSnap = snapshotDbFull(db)
      expect(afterSnap.counts.chapters).toBe(beforeSnap.counts.chapters)
      expect(afterSnap.counts.toc_entries).toBe(beforeSnap.counts.toc_entries)
      expect(afterSnap.counts.block_fts).toBe(afterSnap.counts.blocks)
      const beforeBooks = beforeSnap.booksRow as { toc_signature?: unknown; completed_pages?: unknown; clean_version?: unknown }[]
      const afterBooks = afterSnap.booksRow as { toc_signature?: unknown; completed_pages?: unknown; clean_version?: unknown }[]
      expect(afterBooks[0]?.toc_signature).toBe(beforeBooks[0]?.toc_signature)
      expect(afterBooks[0]?.completed_pages).toBe(beforeBooks[0]?.completed_pages)
      expect(afterBooks[0]?.clean_version).toBe(beforeBooks[0]?.clean_version)

      // 具体内容：删块消失、改块修剪、合法块逐字保留
      const afterBlocks = readBlocksById(db, bookId)
      for (const patch of patches) {
        if (patch.action === 'delete') {
          expect(afterBlocks.has(patch.id)).toBe(false)
        } else {
          expect(afterBlocks.get(patch.id)).toBe(patch.after)
        }
      }
      // 合法“移码表示法”（≥3字）仍可检索
      const yima = searchBookBlocks(db, bookId, '移码表示法', 20)
      expect(yima.length).toBeGreaterThanOrEqual(1)
      // “王道计”按重算计划条件断言（仅全覆盖才可断零）
      const withTerm = db
        .prepare('SELECT id FROM blocks WHERE book_id = ? AND content LIKE ?')
        .all(bookId, '%王道计%') as { id?: unknown }[]
      void beforeBlocks
      const planIds = new Set(patches.map((p) => p.id))
      // 注意：withTerm 是应用后的剩余含词块；需对比应用前的含词覆盖情况
      const beforeWithTermIds = rows.filter((r) => r.content.includes('王道计')).map((r) => r.id)
      const allCovered = beforeWithTermIds.every((id) => planIds.has(id))
      const hits = searchBookBlocks(db, bookId, '王道计', 50)
      if (allCovered) {
        expect(hits).toHaveLength(0)
      } else {
        // 本用例含“(4)移码表示法 王道计 …”合法块未被覆盖，必有剩余命中
        expect(hits.length).toBeGreaterThanOrEqual(1)
        expect(withTerm.length).toBe(hits.length)
      }
    } finally {
      db.close()
      rmSync(backupDir, { recursive: true, force: true })
    }
  })

  it('签名失配零写入：库快照前后一致且不产生备份', () => {
    const db = openMemDb()
    const backupDir = mkdtempSync(join(tmpdir(), 'body-watermark-apply-sigmismatch-'))
    try {
      const fp = nextFingerprint('apply-sig-mismatch')
      seedApplyBook(db, fp, standardBlocks())
      const preview = previewBodyWatermarkInDb(db, fp)
      expect(preview.ok).toBe(true)
      if (!preview.ok) return
      const before = snapshotDbFull(db)
      const badSig =
        preview.value.planSignature.slice(0, 63) +
        (preview.value.planSignature.endsWith('0') ? '1' : '0')
      const result = applyBodyWatermarkInDb(
        db,
        fp,
        { planSignature: badSig, deleteCount: preview.value.deleteCount, updateCount: preview.value.updateCount },
        { backupDir },
      )
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('INVALID_STATE')
      const after = snapshotDbFull(db)
      expect(after.counts).toEqual(before.counts)
      expect(after.hash).toBe(before.hash)
      expect(readdirSync(backupDir)).toEqual([])
    } finally {
      db.close()
      rmSync(backupDir, { recursive: true, force: true })
    }
  })

  it('统计失配零写入：delete/update 任一不对即中止', () => {
    const db = openMemDb()
    const backupDir = mkdtempSync(join(tmpdir(), 'body-watermark-apply-countmismatch-'))
    try {
      const fp = nextFingerprint('apply-count-mismatch')
      seedApplyBook(db, fp, standardBlocks())
      const preview = previewBodyWatermarkInDb(db, fp)
      expect(preview.ok).toBe(true)
      if (!preview.ok) return
      const before = snapshotDbFull(db)
      const result = applyBodyWatermarkInDb(
        db,
        fp,
        {
          planSignature: preview.value.planSignature,
          deleteCount: preview.value.deleteCount + 1,
          updateCount: preview.value.updateCount,
        },
        { backupDir },
      )
      expect(result.ok).toBe(false)
      const after = snapshotDbFull(db)
      expect(after.hash).toBe(before.hash)
      expect(readdirSync(backupDir)).toEqual([])
    } finally {
      db.close()
      rmSync(backupDir, { recursive: true, force: true })
    }
  })

  it('备份失败零写入：mock 注入失败不写库', () => {
    const db = openMemDb()
    const backupDir = mkdtempSync(join(tmpdir(), 'body-watermark-apply-bakfail-'))
    try {
      const fp = nextFingerprint('apply-bak-fail')
      seedApplyBook(db, fp, standardBlocks())
      const preview = previewBodyWatermarkInDb(db, fp)
      expect(preview.ok).toBe(true)
      if (!preview.ok) return
      const before = snapshotDbFull(db)
      const result = applyBodyWatermarkInDb(
        db,
        fp,
        {
          planSignature: preview.value.planSignature,
          deleteCount: preview.value.deleteCount,
          updateCount: preview.value.updateCount,
        },
        {
          backupDir,
          vacuumRunner: () => {
            throw new Error('synthetic no space')
          },
        },
      )
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('FILE_WRITE_ERROR')
      const after = snapshotDbFull(db)
      expect(after.counts).toEqual(before.counts)
      expect(after.hash).toBe(before.hash)
    } finally {
      db.close()
      rmSync(backupDir, { recursive: true, force: true })
    }
  })

  it('任一条件写冲突则全回滚：写前钩子篡改一行使 changes=0', () => {
    const db = openMemDb()
    const backupDir = mkdtempSync(join(tmpdir(), 'body-watermark-apply-conflict-'))
    try {
      const fp = nextFingerprint('apply-conflict')
      const { bookId } = seedApplyBook(db, fp, standardBlocks())
      const preview = previewBodyWatermarkInDb(db, fp)
      expect(preview.ok).toBe(true)
      if (!preview.ok) return
      const rows = db
        .prepare(
          'SELECT id, type, content, page_number AS pageNumber FROM blocks WHERE book_id = ? ORDER BY page_number ASC, id ASC',
        )
        .all(bookId) as { id: number; type: string; content: string; pageNumber: number }[]
      // 按真实类型/页码重算补丁找受害行（table 永不进计划，不可用简化类型）
      const patchRows = planBodyWatermarkPatches(
        rows.map((r) => ({
          id: r.id,
          type: r.type as BookBlockType,
          content: r.content,
          pageNumber: r.pageNumber,
        })),
      )
      expect(patchRows.length).toBeGreaterThanOrEqual(2)
      const victim = patchRows[patchRows.length - 1]!
      const firstPatch = patchRows[0]!
      const firstBefore = rows.find((r) => r.id === firstPatch.id)?.content ?? ''
      const result = applyBodyWatermarkInDb(
        db,
        fp,
        {
          planSignature: preview.value.planSignature,
          deleteCount: preview.value.deleteCount,
          updateCount: preview.value.updateCount,
        },
        {
          backupDir,
          onBeforeTransaction: (target) => {
            target.prepare('UPDATE blocks SET content=? WHERE id=?').run('合成并发篡改', victim.id)
          },
        },
      )
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('INVALID_STATE')
      // 全回滚：首个补丁目标仍为原值（未被部分提交），受害行保持篡改值（钩子在事务外）
      const after = readBlocksById(db, bookId)
      expect(after.get(firstPatch.id)).toBe(firstBefore)
      expect(after.get(victim.id)).toBe('合成并发篡改')
      // FTS 仍与 blocks 一致（回滚后触发器未留脏）
      const blocksCount = (db.prepare('SELECT COUNT(*) AS total FROM blocks').get() as { total: number }).total
      const ftsCount = (db.prepare('SELECT COUNT(*) AS total FROM block_fts').get() as { total: number }).total
      expect(ftsCount).toBe(blocksCount)
    } finally {
      db.close()
      rmSync(backupDir, { recursive: true, force: true })
    }
  })

  it('文件库成功应用：同目录时间戳备份、提交后校验、FTS等于blocks', () => {
    const fp = nextFingerprint('apply-file-success')
    const { dir, dbPath } = createFileDbForApply(fp, standardBlocks())
    try {
      const preview = previewBodyWatermarkFile(dir, fp)
      expect(preview.ok).toBe(true)
      if (!preview.ok) return
      const db0 = new DatabaseSync(dbPath)
      const blocksBefore = (db0.prepare('SELECT COUNT(*) AS total FROM blocks').get() as { total: number }).total
      const chaptersBefore = (db0.prepare('SELECT COUNT(*) AS total FROM chapters').get() as { total: number }).total
      const tocBefore = (db0.prepare('SELECT COUNT(*) AS total FROM toc_entries').get() as { total: number }).total
      const sigBefore = (db0.prepare('SELECT toc_signature AS v FROM books').get() as { v: string }).v
      const completedBefore = (db0.prepare('SELECT completed_pages AS v FROM books').get() as { v: string }).v
      db0.close()

      const result = applyBodyWatermarkFile(dir, fp, {
        fingerprint: fp,
        planSignature: preview.value.planSignature,
        deleteCount: preview.value.deleteCount,
        updateCount: preview.value.updateCount,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.status).toBe('applied')
      // 备份在同目录、时间戳、不可覆盖
      expect(dirname(result.value.backupPath)).toBe(dirname(dbPath))
      expect(result.value.backupPath).toMatch(/book\.db\.\d{8}-\d{6}-\d{3}\.bak$/)
      expect(existsSync(result.value.backupPath)).toBe(true)
      expect(statSync(result.value.backupPath).size).toBe(result.value.backupSize)
      expect(createHash('sha256').update(readFileSync(result.value.backupPath)).digest('hex')).toBe(
        result.value.backupHash,
      )
      // 备份可用只读打开且核心计数与备份前一致（blocksBefore）
      const bakDb = new DatabaseSync(result.value.backupPath, { readOnly: true })
      try {
        const bakBlocks = (bakDb.prepare('SELECT COUNT(*) AS total FROM blocks').get() as { total: number }).total
        expect(bakBlocks).toBe(blocksBefore)
      } finally {
        bakDb.close()
      }

      const db1 = new DatabaseSync(dbPath)
      try {
        const blocksAfter = (db1.prepare('SELECT COUNT(*) AS total FROM blocks').get() as { total: number }).total
        const ftsAfter = (db1.prepare('SELECT COUNT(*) AS total FROM block_fts').get() as { total: number }).total
        expect(blocksAfter).toBe(blocksBefore - preview.value.deleteCount)
        expect(ftsAfter).toBe(blocksAfter)
        expect((db1.prepare('SELECT COUNT(*) AS total FROM chapters').get() as { total: number }).total).toBe(
          chaptersBefore,
        )
        expect((db1.prepare('SELECT COUNT(*) AS total FROM toc_entries').get() as { total: number }).total).toBe(
          tocBefore,
        )
        expect((db1.prepare('SELECT toc_signature AS v FROM books').get() as { v: string }).v).toBe(sigBefore)
        expect((db1.prepare('SELECT completed_pages AS v FROM books').get() as { v: string }).v).toBe(
          completedBefore,
        )
        expect(searchBookBlocks(db1, result.value.bookId, '移码表示法', 10).length).toBeGreaterThanOrEqual(1)
      } finally {
        db1.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('文件库签名失配零写入：文件哈希不变且无备份', () => {
    const fp = nextFingerprint('apply-file-sigmismatch')
    const { dir, dbPath } = createFileDbForApply(fp, standardBlocks())
    try {
      const preview = previewBodyWatermarkFile(dir, fp)
      expect(preview.ok).toBe(true)
      if (!preview.ok) return
      const beforeBytes = readFileSync(dbPath)
      const beforeHash = createHash('sha256').update(beforeBytes).digest('hex')
      const badSig =
        preview.value.planSignature.slice(0, 63) +
        (preview.value.planSignature.endsWith('0') ? '1' : '0')
      const result = applyBodyWatermarkFile(dir, fp, {
        fingerprint: fp,
        planSignature: badSig,
        deleteCount: preview.value.deleteCount,
        updateCount: preview.value.updateCount,
      })
      expect(result.ok).toBe(false)
      expect(createHash('sha256').update(readFileSync(dbPath)).digest('hex')).toBe(beforeHash)
      expect(listBakFiles(dbPath)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('文件库备份失败零写入：不可用备份路径不写库', () => {
    const fp = nextFingerprint('apply-file-bakfail')
    const { dir, dbPath } = createFileDbForApply(fp, standardBlocks())
    try {
      const preview = previewBodyWatermarkFile(dir, fp)
      expect(preview.ok).toBe(true)
      if (!preview.ok) return
      const beforeHash = createHash('sha256').update(readFileSync(dbPath)).digest('hex')
      const badOverride = join(dir, 'no-such-dir', 'book.db.20200101-000000-000.bak')
      const db = new DatabaseSync(dbPath)
      let result
      try {
        const record = getBookRecord(db, fp)
        expect(record).not.toBeNull()
        // 直接走 InDb 并强制不可用路径，模拟不可写目录
        result = applyBodyWatermarkInDb(
          db,
          fp,
          { planSignature: preview.value.planSignature, deleteCount: preview.value.deleteCount, updateCount: preview.value.updateCount },
          { dbPath, backupPathOverride: badOverride },
        )
      } finally {
        db.close()
      }
      expect(result!.ok).toBe(false)
      expect(createHash('sha256').update(readFileSync(dbPath)).digest('hex')).toBe(beforeHash)
      expect(listBakFiles(dbPath)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('备份—恢复—再应用演练仅在临时库：恢复后复原、再应用成功', () => {
    const fp = nextFingerprint('apply-restore-drill')
    const { dir, dbPath } = createFileDbForApply(fp, standardBlocks())
    try {
      const preview1 = previewBodyWatermarkFile(dir, fp)
      expect(preview1.ok).toBe(true)
      if (!preview1.ok) return
      const beforeBytes = readFileSync(dbPath)
      const beforeHash = createHash('sha256').update(beforeBytes).digest('hex')

      const applied1 = applyBodyWatermarkFile(dir, fp, {
        fingerprint: fp,
        planSignature: preview1.value.planSignature,
        deleteCount: preview1.value.deleteCount,
        updateCount: preview1.value.updateCount,
      })
      expect(applied1.ok).toBe(true)
      if (!applied1.ok) return
      expect(applied1.value.status).toBe('applied')
      const backupPath = applied1.value.backupPath
      expect(existsSync(backupPath)).toBe(true)
      expect(createHash('sha256').update(readFileSync(dbPath)).digest('hex')).not.toBe(beforeHash)

      // 从备份恢复（仅 tmp 临时库，关闭句柄 → 删 WAL 伴生 → 拷贝覆盖）
      for (const suffix of ['-wal', '-shm']) {
        try {
          rmSync(`${dbPath}${suffix}`, { force: true })
        } catch {
          // 忽略
        }
      }
      copyFileSync(backupPath, dbPath)
      for (const suffix of ['-wal', '-shm']) {
        try {
          rmSync(`${dbPath}${suffix}`, { force: true })
        } catch {
          // 忽略
        }
      }
      expect(createHash('sha256').update(readFileSync(dbPath)).digest('hex')).toBe(
        createHash('sha256').update(readFileSync(backupPath)).digest('hex'),
      )
      // 复原断言：预览签名回到最初，块数回到备份前
      const previewRestored = previewBodyWatermarkFile(dir, fp)
      expect(previewRestored.ok).toBe(true)
      if (!previewRestored.ok) return
      expect(previewRestored.value.planSignature).toBe(preview1.value.planSignature)
      expect(previewRestored.value.totalPatches).toBe(preview1.value.totalPatches)

      // 再应用成功（新时间戳备份，不可覆盖旧备份）
      const applied2 = applyBodyWatermarkFile(dir, fp, {
        fingerprint: fp,
        planSignature: previewRestored.value.planSignature,
        deleteCount: previewRestored.value.deleteCount,
        updateCount: previewRestored.value.updateCount,
      })
      expect(applied2.ok).toBe(true)
      if (!applied2.ok) return
      expect(applied2.value.status).toBe('applied')
      expect(applied2.value.backupPath).not.toBe(backupPath)
      expect(existsSync(applied2.value.backupPath)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('重复应用幂等：第二次空计划返回 noop 而非报错', () => {
    const db = openMemDb()
    const backupDir = mkdtempSync(join(tmpdir(), 'body-watermark-apply-idempotent-'))
    try {
      const fp = nextFingerprint('apply-idempotent')
      seedApplyBook(db, fp, standardBlocks())
      const preview1 = previewBodyWatermarkInDb(db, fp)
      expect(preview1.ok).toBe(true)
      if (!preview1.ok) return
      const first = applyBodyWatermarkInDb(
        db,
        fp,
        {
          planSignature: preview1.value.planSignature,
          deleteCount: preview1.value.deleteCount,
          updateCount: preview1.value.updateCount,
        },
        { backupDir },
      )
      expect(first.ok).toBe(true)
      if (!first.ok) return
      expect(first.value.status).toBe('applied')
      const bakCountAfterFirst = readdirSync(backupDir).length

      // 第二次计划为空：重算签名应为空计划签名
      const preview2 = previewBodyWatermarkInDb(db, fp)
      expect(preview2.ok).toBe(true)
      if (!preview2.ok) return
      expect(preview2.value.totalPatches).toBe(0)
      expect(preview2.value.deleteCount).toBe(0)
      expect(preview2.value.updateCount).toBe(0)
      expect(preview2.value.planSignature).toBe(computeBodyWatermarkPlanSignature([]))

      const snapBeforeSecond = snapshotDbFull(db)
      const second = applyBodyWatermarkInDb(
        db,
        fp,
        {
          planSignature: preview2.value.planSignature,
          deleteCount: 0,
          updateCount: 0,
        },
        { backupDir },
      )
      expect(second.ok).toBe(true)
      if (!second.ok) return
      // 语义锁定：空计划返回 noop，不报错、不备份、不写库
      expect(second.value.status).toBe('noop')
      expect(second.value.backupPath).toBe('')
      expect(second.value.backupSize).toBe(0)
      expect(second.value.backupHash).toBe('')
      expect(second.value.blocksBefore).toBe(second.value.blocksAfter)
      const snapAfterSecond = snapshotDbFull(db)
      expect(snapAfterSecond.hash).toBe(snapBeforeSecond.hash)
      expect(readdirSync(backupDir).length).toBe(bakCountAfterFirst)
    } finally {
      db.close()
      rmSync(backupDir, { recursive: true, force: true })
    }
  })

  it('备份命名：时间戳格式 + 同毫秒不覆盖', () => {
    const fixed = new Date(2026, 8, 10, 12, 34, 56, 789)
    expect(formatBodyWatermarkBackupTimestamp(fixed)).toBe('20260910-123456-789')
    const dir = mkdtempSync(join(tmpdir(), 'body-watermark-apply-naming-'))
    try {
      const fakeDbPath = join(dir, 'book-index', 'synthetic', 'book.db')
      mkdirSync(dirname(fakeDbPath), { recursive: true })
      const first = resolveBodyWatermarkBackupPath(fakeDbPath, fixed)
      expect(first).toMatch(/book\.db\.20260910-123456-789\.bak$/)
      // 占位后再次解析应追加 -1（不可覆盖）
      mkdirSync(dirname(first), { recursive: true })
      // 手动占位（合成临时文件，非真实书库）
      writeFileSync(first, 'placeholder')
      const second = resolveBodyWatermarkBackupPath(fakeDbPath, fixed)
      expect(second).not.toBe(first)
      expect(second).toMatch(/-1\.bak$/)
      expect(existsSync(second)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('缺库不建库：应用返回 FILE_NOT_FOUND 且不创建文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'body-watermark-apply-missing-'))
    try {
      const fp = nextFingerprint('apply-missing')
      const emptySig = computeBodyWatermarkPlanSignature([])
      const result = applyBodyWatermarkFile(dir, fp, {
        fingerprint: fp,
        planSignature: emptySig,
        deleteCount: 0,
        updateCount: 0,
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('FILE_NOT_FOUND')
      expect(existsSync(getBookDbPath(dir, fp))).toBe(false)
      expect(readdirSync(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
