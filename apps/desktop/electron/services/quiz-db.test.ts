import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
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

import { MONTREE_DB_SCHEMA_VERSION, migrateMontreeDb } from './app-db/schema'
import { closeAllMontreeDbs, openMontreeDb } from './app-db/open-app-db'
import { closeAllBookDbs, openBookDb } from './book-db/open-book-db'
import {
  appendQuizSession,
  getQuizFilePath,
  readAllQuizSessions,
  readQuizJsonlForSync,
  readQuizSessionsByFile,
  writeQuizJsonlForSync,
} from './quiz-service'
import {
  exportQuizJsonl,
  importQuizJsonl,
  listQuizSessionsByFile,
} from './quiz-db'
import { isOk, parseQuizJsonl, serializeQuizSession } from '@montree/contracts'
import type { QuizSessionRecord } from '@montree/contracts'
import { mergeQuizSessions } from './sync/mergers/quiz-merger'

function sampleSession(overrides: Partial<QuizSessionRecord> = {}): QuizSessionRecord {
  return {
    id: 'session-1',
    bookTitle: '红楼梦',
    filePath: 'D:/books/hongloumeng.epub',
    chapterKey: 'text/chapter-1',
    chapterTitle: '第一回',
    createdAt: '2026-09-01T12:00:00.000Z',
    totalScore: 85,
    grade: 'B',
    questions: [
      {
        id: 'q1',
        title: '太虚幻境判词意图',
        prompt: '请阐述作者在此处的暗示手法。',
        tag: '概念认知',
        keyPoints: ['暗示命运', '预叙结构'],
        sourceExcerpt: '满纸荒唐言，一把辛酸泪。',
        chapterTitle: '第一回',
        markId: 'mark-1',
      },
      {
        id: 'q2',
        title: '葬花词之悲',
        prompt: '黛玉葬花的深层寄托是什么？',
        keyPoints: ['身世之悲'],
        sourceExcerpt: '花谢花飞花满天，红消香断有谁怜。',
      },
    ],
    submissions: {
      q1: {
        questionId: 'q1',
        userAnswer: '借判词暗示人物悲剧命运。',
        score: 85,
        grade: 'B',
        feedback: '答出了命运预叙，结构线索略欠。',
        hitKeyPoints: ['暗示命运'],
        missedKeyPoints: ['预叙结构'],
        gradedAt: '2026-09-01T12:05:00.000Z',
      },
      q2: {
        questionId: 'q2',
        userAnswer: '寄托身世漂泊之悲。',
        score: 40,
        grade: 'D',
        feedback: '过于简略。',
        hitKeyPoints: [],
        missedKeyPoints: ['身世之悲'],
        gradedAt: '2026-09-01T12:06:00.000Z',
      },
    },
    ...overrides,
  }
}

describe('quiz-db（[2]-02a 测验全局库后端）', () => {
  beforeEach(async () => {
    delete process.env.MONTREE_QUIZ_BACKEND
    tempUserData = await mkdtemp(join(tmpdir(), 'quiz-db-'))
  })

  afterEach(() => {
    closeAllMontreeDbs()
    closeAllBookDbs()
    // 先关句柄再删目录（Windows 占文件删不掉）；用后即焚，不留 tmp 堆积
    if (tempUserData) rmSync(tempUserData, { recursive: true, force: true })
    delete process.env.MONTREE_QUIZ_BACKEND
    tempUserData = ''
  })

  it('v1 迁移建 sessions/questions 表与索引（幂等）', () => {
    const db = new DatabaseSync(':memory:')
    try {
      const first = migrateMontreeDb(db)
      expect(first).toEqual({ migrated: true, version: MONTREE_DB_SCHEMA_VERSION })
      expect(migrateMontreeDb(db)).toEqual({ migrated: false, version: MONTREE_DB_SCHEMA_VERSION })
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>
      const names = new Set(tables.map((row) => row.name))
      expect(names.has('quiz_sessions')).toBe(true)
      expect(names.has('quiz_questions')).toBe(true)
      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as Array<{ name: string }>
      const indexNames = new Set(indexes.map((row) => row.name))
      expect(indexNames.has('idx_quiz_sessions_file_time')).toBe(true)
      expect(indexNames.has('idx_quiz_questions_session')).toBe(true)
      // 通用题 id 跨场次不撞主键：代理键 + 复合唯一
      const createSql = db
        .prepare("SELECT sql FROM sqlite_master WHERE name = 'quiz_questions'")
        .get() as { sql: string }
      expect(createSql.sql).toContain('UNIQUE (session_id, question_id)')
    } finally {
      db.close()
    }
  })

  it('追加/读取 round-trip：题目/作答/标题原样回来，同 id 幂等', async () => {
    expect(isOk(await appendQuizSession(sampleSession()))).toBe(true)
    // 同 id 重复追加不翻倍（会话创建后不可变）
    expect(isOk(await appendQuizSession(sampleSession()))).toBe(true)

    const all = await readAllQuizSessions()
    expect(isOk(all)).toBe(true)
    if (!isOk(all)) return
    expect(all.value).toHaveLength(1)
    const back = all.value[0]!
    expect(back.questions).toHaveLength(2)
    expect(back.questions[0]).toEqual(sampleSession().questions[0])
    expect(back.submissions).toEqual(sampleSession().submissions)
    expect(back.chapterKey).toBe('text/chapter-1')
    expect(back.createdAt).toBe('2026-09-01T12:00:00.000Z')

    // 派生列：2 题、1 题及格（85 分过线，40 分不过）
    const db = openMontreeDb(tempUserData)
    const row = db.prepare('SELECT question_count, correct_count FROM quiz_sessions WHERE id = ?').get(
      'session-1',
    ) as { question_count: number; correct_count: number }
    expect(row).toEqual({ question_count: 2, correct_count: 1 })

    // 按书查：别书为空
    const other = await readQuizSessionsByFile('D:/books/other.epub')
    expect(isOk(other)).toBe(true)
    if (!isOk(other)) return
    expect(other.value).toHaveLength(0)
  })

  it('分书隔离 + 倒序（最新优先，与 JSONL 版一致）', async () => {
    expect(isOk(await appendQuizSession(sampleSession({ id: 's-old', createdAt: '2026-08-01T00:00:00.000Z' })))).toBe(true)
    expect(
      isOk(
        await appendQuizSession(
          sampleSession({
            id: 's-new',
            filePath: 'D:/books/other.epub',
            bookTitle: '三国演义',
            createdAt: '2026-09-02T00:00:00.000Z',
          }),
        ),
      ),
    ).toBe(true)

    const all = await readAllQuizSessions()
    expect(isOk(all)).toBe(true)
    if (!isOk(all)) return
    expect(all.value.map((session) => session.id)).toEqual(['s-new', 's-old'])

    const mine = await readQuizSessionsByFile('D:/books/hongloumeng.epub')
    expect(isOk(mine)).toBe(true)
    if (!isOk(mine)) return
    expect(mine.value.map((session) => session.id)).toEqual(['s-old'])
  })

  it('按书查询与题行关联走索引（EXPLAIN 抽查）', async () => {
    expect(isOk(await appendQuizSession(sampleSession()))).toBe(true)
    expect(listQuizSessionsByFile(tempUserData, 'D:/books/hongloumeng.epub')).toHaveLength(1)

    const db = openMontreeDb(tempUserData)
    const filePlan = db
      .prepare(
        'EXPLAIN QUERY PLAN SELECT * FROM quiz_sessions WHERE file_path = ? ORDER BY created_at DESC',
      )
      .all('D:/books/hongloumeng.epub') as Array<{ detail: string }>
    expect(filePlan.some((row) => /idx_quiz_sessions_file_time/i.test(row.detail))).toBe(true)

    const joinPlan = db
      .prepare('EXPLAIN QUERY PLAN SELECT * FROM quiz_questions WHERE session_id = ?')
      .all('session-1') as Array<{ detail: string }>
    expect(joinPlan.some((row) => /idx_quiz_questions_session/i.test(row.detail))).toBe(true)
  })

  it('存量迁移：JSONL 灌库、对账一致、落 .bak 与 marker（坏行跳过）', async () => {
    const second = sampleSession({ id: 'session-2', createdAt: '2026-09-03T00:00:00.000Z' })
    const raw = `${serializeQuizSession(sampleSession())}this is not json\n${serializeQuizSession(second)}`
    await writeFile(join(tempUserData, 'quiz-records.jsonl'), raw, 'utf-8')

    // 首个 DB 操作触发懒迁移
    const all = await readAllQuizSessions()
    expect(isOk(all)).toBe(true)
    if (!isOk(all)) return
    expect(all.value.map((session) => session.id)).toEqual(['session-2', 'session-1'])

    const db = openMontreeDb(tempUserData)
    const sessionCount = (db.prepare('SELECT COUNT(*) AS c FROM quiz_sessions').get() as { c: number }).c
    const questionCount = (db.prepare('SELECT COUNT(*) AS c FROM quiz_questions').get() as { c: number }).c
    expect(sessionCount).toBe(2)
    expect(questionCount).toBe(4)

    const bak = await readFile(join(tempUserData, 'quiz-records.jsonl.bak'), 'utf-8')
    expect(parseQuizJsonl(bak)).toHaveLength(2)
    const marker = await readFile(join(tempUserData, 'quiz-records.jsonl.migrated-to-db'), 'utf-8')
    expect(JSON.parse(marker).sessions).toBe(2)

    // 迁移幂等：重复触发不翻倍
    const again = await readAllQuizSessions()
    expect(isOk(again)).toBe(true)
    if (!isOk(again)) return
    expect(again.value).toHaveLength(2)
  })

  it('同步兼容：导出 ⇄ 合并 ⇄ 写回 round-trip（远端仍是 JSONL）', async () => {
    expect(isOk(await appendQuizSession(sampleSession()))).toBe(true)
    const localJsonl = await readQuizJsonlForSync()
    expect(parseQuizJsonl(localJsonl)).toHaveLength(1)

    // 远端多一场：merge 纯函数不变，写回应灌库
    const remote = sampleSession({ id: 'session-remote', createdAt: '2026-09-04T00:00:00.000Z' })
    const merged = mergeQuizSessions(localJsonl, serializeQuizSession(remote))
    expect(merged.addedCount).toBe(1)
    await writeQuizJsonlForSync(merged.mergedJsonl)

    const after = await readAllQuizSessions()
    expect(isOk(after)).toBe(true)
    if (!isOk(after)) return
    expect(after.value.map((session) => session.id).sort()).toEqual(['session-1', 'session-remote'])

    // 异机导入：导出的 JSONL 灌进新库，对账一致
    const fresh = await mkdtemp(join(tmpdir(), 'quiz-db-fresh-'))
    try {
      const stats = importQuizJsonl(fresh, await readQuizJsonlForSync())
      expect(stats).toEqual({ sessions: 2, questions: 4, skipped: 0 })
      expect(parseQuizJsonl(exportQuizJsonl(fresh)).map((session) => session.id).sort()).toEqual([
        'session-1',
        'session-remote',
      ])
    } finally {
      closeAllMontreeDbs()
      rmSync(fresh, { recursive: true, force: true })
    }
  })

  it('指纹回填：已索引书落指纹，未索引书记 NULL', async () => {
    const bookDb = openBookDb(tempUserData, 'fp-honglou')
    bookDb
      .prepare(
        `INSERT INTO books (fingerprint, title, source_path, format, page_count, created_at, updated_at)
         VALUES ('fp-honglou', '红楼梦', 'D:/books/hongloumeng.epub', 'epub', 100, 1, 1)`,
      )
      .run()

    expect(isOk(await appendQuizSession(sampleSession()))).toBe(true)
    expect(
      isOk(
        await appendQuizSession(
          sampleSession({ id: 's-loose', filePath: 'D:/books/loose.epub', createdAt: '2026-09-05T00:00:00.000Z' }),
        ),
      ),
    ).toBe(true)

    const db = openMontreeDb(tempUserData)
    const rows = db
      .prepare('SELECT id, book_fingerprint AS fp FROM quiz_sessions ORDER BY id')
      .all() as Array<{ id: string; fp: string | null }>
    expect(rows).toEqual([
      { id: 's-loose', fp: null },
      { id: 'session-1', fp: 'fp-honglou' },
    ])
  })

  it('回滚开关：MONTREE_QUIZ_BACKEND=file 走旧 JSONL 路径', async () => {
    process.env.MONTREE_QUIZ_BACKEND = 'file'
    expect(isOk(await appendQuizSession(sampleSession()))).toBe(true)
    const raw = await readFile(getQuizFilePath(), 'utf-8')
    expect(parseQuizJsonl(raw)).toHaveLength(1)
    const all = await readAllQuizSessions()
    expect(isOk(all)).toBe(true)
    if (!isOk(all)) return
    expect(all.value).toHaveLength(1)
    // 文件后端只碰 JSONL：库中无写入
    const db = openMontreeDb(tempUserData)
    const count = (db.prepare('SELECT COUNT(*) AS c FROM quiz_sessions').get() as { c: number }).c
    expect(count).toBe(0)
  })
})
