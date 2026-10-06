import { mkdtemp, writeFile } from 'node:fs/promises'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * 落库读写集成测试（[2] 整棒验收）：走 service 层整条链——
 * 卡片增改查 → 记忆快照派生 → 复习落盘/待复习 → 测验追加/按书查 →
 * 存量 JSON/JSONL 懒迁移，三端（marks/quiz/flashcards）一次跑通。
 *
 * 隔离与清理：每个用例独占 `mkdtemp` 隔离目录（专用测试库，与开发/生产数据
 * 零交集）；`finally` 先关全部 DB 句柄（Windows 占文件删不掉）再 `rm -rf`，
 * 出 helper 即断言目录已消失——清理不及时测试直接红。
 */

let tempUserData = ''

vi.mock('electron', () => ({
  app: {
    getPath: () => tempUserData,
  },
}))

import { closeAllBookDbs, getBookDbDir, openBookDb } from './book-db/open-book-db'
import { closeAllMontreeDbs, openMontreeDb } from './app-db/open-app-db'
import {
  createReadingMark,
  deleteReadingMark,
  listReadingMarks,
  updateReadingMark,
} from './reading-marks-service'
import {
  appendFlashcardReview,
  clearFlashcardsBackfillCache,
  countDueFlashcardsForBook,
  exportMarksStore,
  listDueFlashcards,
} from './marks-db'
import { getFlashcardRow } from './flashcards-db'
import {
  appendQuizSession,
  readAllQuizSessions,
  readQuizSessionsByFile,
} from './quiz-service'
import { clearQuizFingerprintCache, exportQuizJsonl, importQuizJsonl } from './quiz-db'
import { isOk, toChapterKey } from '@montree/contracts'
import type { QuizSessionRecord } from '@montree/contracts'

afterEach(() => {
  // 兜底：helper 已做清理；此处只防用例中途抛错漏关句柄（不删目录，由 helper 断言负责）
  closeAllBookDbs()
  closeAllMontreeDbs()
})

/** 独占隔离目录跑一段流程；返回后目录必须已消失（清理及时性断言在调用方做） */
async function withIsolatedUserData(fn: (dir: string) => Promise<void>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'montree-integration-'))
  tempUserData = dir
  try {
    await fn(dir)
  } finally {
    // 先关句柄再删目录（顺序反了 Windows 上 rm 会失败，测试即红）
    closeAllBookDbs()
    closeAllMontreeDbs()
    clearFlashcardsBackfillCache()
    clearQuizFingerprintCache()
    tempUserData = ''
    rmSync(dir, { recursive: true, force: true })
  }
  return dir
}

function sampleQuizSession(overrides: Partial<QuizSessionRecord> = {}): QuizSessionRecord {
  return {
    id: 'quiz-e2e-1',
    bookTitle: '红楼梦',
    filePath: 'D:/books/hongloumeng.epub',
    chapterTitle: '第一回',
    createdAt: '2026-09-10T10:00:00.000Z',
    totalScore: 90,
    grade: 'A',
    questions: [
      {
        id: 'q1',
        title: '判词意图',
        prompt: '请阐述暗示手法。',
        keyPoints: ['命运'],
        sourceExcerpt: '满纸荒唐言。',
        markId: 'mark-1',
      },
    ],
    submissions: {
      q1: {
        questionId: 'q1',
        userAnswer: '暗示悲剧命运。',
        score: 90,
        grade: 'A',
        feedback: '好。',
        hitKeyPoints: ['命运'],
        missedKeyPoints: [],
        gradedAt: '2026-09-10T10:05:00.000Z',
      },
    },
    ...overrides,
  }
}

describe('落库读写集成（marks/quiz/flashcards 全链路）', () => {
  it('单书全链路：建卡→快照→复习→改卡→删卡，目录用后即焚', async () => {
    const dir = await withIsolatedUserData(async () => {
      const created = await createReadingMark({
        filePath: 'D:\\books\\demo.epub',
        fileFingerprint: 'fp-e2e',
        kind: 'highlight',
        anchor: { format: 'epub', cfi: 'cfi-e2e' },
        excerpt: '集成测试摘录托克维尔',
        note: '集成测试提问',
        chapter: { key: toChapterKey('text/part1'), label: '第一部分', index: 3 },
      })
      expect(isOk(created)).toBe(true)
      if (!isOk(created)) return
      const id = created.value.id

      // 读：列表 + 章节固化 round-trip
      const listed = await listReadingMarks('D:\\books\\demo.epub')
      expect(isOk(listed)).toBe(true)
      if (!isOk(listed)) return
      expect(listed.value).toHaveLength(1)
      expect(listed.value[0]?.chapter?.label).toBe('第一部分')

      // 快照：建卡即派生
      const db = openBookDb(tempUserData, 'fp-e2e')
      expect(getFlashcardRow(db, id)?.front).toBe('集成测试提问')

      // 复习：评分落盘，待复习可见且计数 1
      expect(appendFlashcardReview(tempUserData, 'fp-e2e', id, 'good', 1000)).toBe(true)
      expect(countDueFlashcardsForBook(tempUserData, 'fp-e2e')).toBe(1)
      expect(listDueFlashcards(tempUserData, 'fp-e2e')[0]?.reviewCount).toBe(1)

      // 改：批注一改快照跟随
      expect(isOk(await updateReadingMark({ id, note: '改后提问' }))).toBe(true)
      expect(getFlashcardRow(db, id)?.front).toBe('改后提问')

      // 删：列表空、待复习空、同步导出记 tombstone
      expect(isOk(await deleteReadingMark(id))).toBe(true)
      const empty = await listReadingMarks('D:\\books\\demo.epub')
      expect(isOk(empty) && empty.value).toHaveLength(0)
      expect(countDueFlashcardsForBook(tempUserData, 'fp-e2e')).toBe(0)
      const exported = exportMarksStore(tempUserData)
      expect(exported.marks).toHaveLength(0)
      expect(typeof exported.tombstones?.[id]).toBe('number')
    })
    // 清理及时性：目录必须已消失
    expect(existsSync(dir)).toBe(false)
  })

  it('测验全链路：双书追加→按书查→指纹回填→导出异库导入，目录用后即焚', async () => {
    const dir = await withIsolatedUserData(async () => {
      // 其中一本书已索引：指纹可回填；另一本没索引：记 NULL
      openBookDb(tempUserData, 'fp-honglou')
        .prepare(
          `INSERT INTO books (fingerprint, title, source_path, format, page_count, created_at, updated_at)
           VALUES ('fp-honglou', '红楼梦', 'D:/books/hongloumeng.epub', 'epub', 100, 1, 1)`,
        )
        .run()

      expect(isOk(await appendQuizSession(sampleQuizSession()))).toBe(true)
      expect(
        isOk(
          await appendQuizSession(
            sampleQuizSession({
              id: 'quiz-e2e-2',
              bookTitle: '三国演义',
              filePath: 'D:/books/sanguo.epub',
              createdAt: '2026-09-11T10:00:00.000Z',
            }),
          ),
        ),
      ).toBe(true)

      const all = await readAllQuizSessions()
      expect(isOk(all)).toBe(true)
      if (!isOk(all)) return
      expect(all.value.map((session) => session.id)).toEqual(['quiz-e2e-2', 'quiz-e2e-1'])

      const mine = await readQuizSessionsByFile('D:/books/hongloumeng.epub')
      expect(isOk(mine)).toBe(true)
      if (!isOk(mine)) return
      expect(mine.value).toHaveLength(1)
      expect(mine.value[0]?.submissions['q1']?.score).toBe(90)

      // 指纹回填对账
      const rows = openMontreeDb(tempUserData)
        .prepare('SELECT id, book_fingerprint AS fp FROM quiz_sessions ORDER BY id')
        .all() as Array<{ id: string; fp: string | null }>
      expect(rows).toEqual([
        { id: 'quiz-e2e-1', fp: 'fp-honglou' },
        { id: 'quiz-e2e-2', fp: null },
      ])

      // 导出 JSONL 灌进第二隔离库，对账一致
      const jsonl = exportQuizJsonl(tempUserData)
      const dir2 = await withIsolatedUserData(async (inner) => {
        const stats = importQuizJsonl(inner, jsonl)
        expect(stats).toEqual({ sessions: 2, questions: 2, skipped: 0 })
        const back = await readAllQuizSessions()
        expect(isOk(back)).toBe(true)
        if (!isOk(back)) return
        expect(back.value.map((session) => session.id).sort()).toEqual([
          'quiz-e2e-1',
          'quiz-e2e-2',
        ])
      })
      expect(existsSync(dir2)).toBe(false)
    })
    expect(existsSync(dir)).toBe(false)
  })

  it('存量迁移链路：JSON/JSONL 灌库＋快照回填＋.bak/marker，目录用后即焚', async () => {
    const dir = await withIsolatedUserData(async (root) => {
      await writeFile(
        join(root, 'reading-marks.json'),
        JSON.stringify({
          marks: [
            {
              id: 'm-old',
              filePath: 'D:\\books\\old.epub',
              fileFingerprint: 'fp-old',
              kind: 'highlight',
              anchor: { format: 'epub', cfi: 'cfi-old' },
              excerpt: '旧摘录待回填',
              createdAt: 1,
              updatedAt: 2,
            },
          ],
          tombstones: {},
        }),
      )
      await writeFile(
        join(root, 'quiz-records.jsonl'),
        `${JSON.stringify(sampleQuizSession({ id: 'quiz-old', filePath: 'D:/books/old.epub' }))}\n`,
      )

      // 首读触发两边懒迁移
      const listed = await listReadingMarks('D:\\books\\old.epub')
      expect(isOk(listed)).toBe(true)
      if (!isOk(listed)) return
      expect(listed.value.map((mark) => mark.id)).toEqual(['m-old'])
      const quizzes = await readAllQuizSessions()
      expect(isOk(quizzes)).toBe(true)
      if (!isOk(quizzes)) return
      expect(quizzes.value.map((session) => session.id)).toEqual(['quiz-old'])

      // 旧卡快照经读路径回填
      expect(listDueFlashcards(root, 'fp-old').map((card) => card.id)).toEqual(['m-old'])

      // .bak 与 marker 三件套
      expect(existsSync(join(root, 'reading-marks.json.bak'))).toBe(true)
      expect(existsSync(join(root, 'reading-marks.json.migrated-to-db'))).toBe(true)
      expect(existsSync(join(root, 'quiz-records.jsonl.bak'))).toBe(true)
      expect(existsSync(join(root, 'quiz-records.jsonl.migrated-to-db'))).toBe(true)
      expect(
        existsSync(join(getBookDbDir(root, 'fp-old'), 'flashcards-backfilled.json')),
      ).toBe(true)
    })
    expect(existsSync(dir)).toBe(false)
  })
})
