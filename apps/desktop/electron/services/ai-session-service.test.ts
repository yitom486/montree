import { mkdtemp } from 'node:fs/promises'
import { rmSync } from 'node:fs'
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

import { MONTREE_DB_SCHEMA_VERSION, getMontreeDbVersion, migrateMontreeDb } from './app-db/schema'
import { closeAllMontreeDbs, openMontreeDb } from './app-db/open-app-db'
import { getAiSession, putAiSession, touchAiSession } from './ai-session-service'
import { isOk } from '@montree/contracts'

describe('ai-session-service（一书一会话指针）', () => {
  beforeEach(async () => {
    tempUserData = await mkdtemp(join(tmpdir(), 'ai-session-'))
  })

  afterEach(() => {
    closeAllMontreeDbs()
    if (tempUserData) rmSync(tempUserData, { recursive: true, force: true })
    tempUserData = ''
  })

  it('v2 迁移建 ai_sessions（复合主键，quiz 表原位保留）', () => {
    const db = new DatabaseSync(':memory:')
    try {
      expect(migrateMontreeDb(db)).toEqual({ migrated: true, version: MONTREE_DB_SCHEMA_VERSION })
      expect(migrateMontreeDb(db).migrated).toBe(false)
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>
      const names = new Set(tables.map((row) => row.name))
      expect(names.has('ai_sessions')).toBe(true)
      expect(names.has('quiz_sessions')).toBe(true)
    } finally {
      db.close()
    }
  })

  it('get/put/touch round-trip：空取 null，upsert 覆盖，touch 计数', async () => {
    const empty = await getAiSession({ bookFingerprint: 'fp-1' })
    expect(isOk(empty)).toBe(true)
    if (!isOk(empty)) return
    expect(empty.value).toBeNull()

    expect(
      isOk(
        await putAiSession({
          bookFingerprint: 'fp-1',
          sessionId: 'sid-1',
          promptCount: 0,
          lastUsedAt: 100,
        }),
      ),
    ).toBe(true)

    const back = await getAiSession({ bookFingerprint: 'fp-1' })
    expect(isOk(back)).toBe(true)
    if (!isOk(back)) return
    expect(back.value).toMatchObject({
      bookFingerprint: 'fp-1',
      purpose: 'card-studio',
      sessionId: 'sid-1',
      promptCount: 0,
    })

    expect(isOk(await touchAiSession({ bookFingerprint: 'fp-1' }))).toBe(true)
    const touched = await getAiSession({ bookFingerprint: 'fp-1' })
    expect(isOk(touched)).toBe(true)
    if (!isOk(touched)) return
    expect(touched.value?.promptCount).toBe(1)

    // upsert 同书覆盖（轮转/手动新开）
    expect(
      isOk(
        await putAiSession({
          bookFingerprint: 'fp-1',
          sessionId: 'sid-2',
          promptCount: 0,
          lastUsedAt: 200,
        }),
      ),
    ).toBe(true)
    const rotated = await getAiSession({ bookFingerprint: 'fp-1' })
    expect(isOk(rotated)).toBe(true)
    if (!isOk(rotated)) return
    expect(rotated.value?.sessionId).toBe('sid-2')
    expect(rotated.value?.promptCount).toBe(0)

    // 分书隔离 + 空指纹回空
    const ghost = await getAiSession({ bookFingerprint: 'fp-ghost' })
    expect(isOk(ghost) && ghost.value).toBeNull()
    const blank = await getAiSession({ bookFingerprint: '   ' })
    expect(isOk(blank) && blank.value).toBeNull()
    const bad = await putAiSession({ bookFingerprint: 'fp-1', sessionId: '  ', promptCount: 0, lastUsedAt: 0 })
    expect(isOk(bad)).toBe(false)
  })

  it('v1 老库升级 v2：测验行保留', async () => {
    const db = openMontreeDb(tempUserData)
    db.prepare(
      `INSERT INTO quiz_sessions (
        id, book_fingerprint, file_path, book_title, chapter_key, chapter_title,
        total_score, grade, question_count, correct_count, created_at
      ) VALUES ('s1', NULL, 'D:/b.epub', '书', NULL, NULL, 80, 'B', 1, 1, 1)`,
    ).run()
    closeAllMontreeDbs()
    // 降回 v1 形态（删表 + 回拨版本号，模拟 02a 时代库），再打开即升 v2
    const raw = new DatabaseSync(join(tempUserData, 'montree.db'))
    try {
      raw.exec('DROP TABLE ai_sessions')
      raw.exec('PRAGMA user_version = 1')
      expect(getMontreeDbVersion(raw)).toBe(1)
    } finally {
      raw.close()
    }
    const upgraded = openMontreeDb(tempUserData)
    expect(getMontreeDbVersion(upgraded)).toBe(2)
    const count = (
      upgraded.prepare('SELECT COUNT(*) AS c FROM quiz_sessions').get() as {
        c: number
      }
    ).c
    expect(count).toBe(1)
  })
})
