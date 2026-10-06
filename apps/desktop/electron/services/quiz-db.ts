import type { DatabaseSync } from 'node:sqlite'
import type {
  QuizAnswerSubmission,
  QuizQuestion,
  QuizSessionRecord,
} from '@montree/contracts'
import { parseQuizJsonl, serializeQuizSession } from '@montree/contracts'
import { openMontreeDb } from './app-db/open-app-db'
import { resolveFingerprintForFile } from './marks-db'

/**
 * 测验 SQL 后端（[2]-02a）：全局 `montree.db` v1 的 quiz_sessions + quiz_questions。
 * API 语义与 JSONL 版一致（倒序、按文件过滤、坏行容错）；questions 数组拆行后
 * "错题本/按题统计"变普通查询，不再内存拆数组。
 * 同步远端格式不变（仍是 quiz-records.jsonl）：导出→合并（纯函数不变）→导入，
 * `sync-manager` 只换传输层。
 */

/** 及格线：与 contracts `calculateQuizGrade` 的 C 档（60）对齐，仅供 correct_count 统计 */
export const QUIZ_PASS_SCORE = 60
/** 整卷满分：UI 以 `/ 100` 呈现（见 QuizHistoryDialog），题行 max_score 恒为此值 */
export const QUIZ_MAX_SCORE = 100

interface QuizSessionRow {
  id: string
  book_fingerprint: string | null
  file_path: string
  book_title: string
  chapter_key: string | null
  chapter_title: string | null
  total_score: number
  grade: string
  question_count: number
  correct_count: number
  created_at: number
}

interface QuizQuestionRow {
  id: number
  session_id: string
  question_id: string
  mark_id: string | null
  title: string | null
  prompt: string
  source_excerpt: string | null
  chapter_title: string | null
  tag: string | null
  key_points: string | null
  score: number
  max_score: number
  submissions: string | null
  created_at: number
}

function toMillis(createdAt: string): number {
  const millis = Date.parse(createdAt)
  return Number.isNaN(millis) ? 0 : millis
}

export function correctCountForSession(session: QuizSessionRecord): number {
  return Object.values(session.submissions ?? {}).filter(
    (submission) => typeof submission?.score === 'number' && submission.score >= QUIZ_PASS_SCORE,
  ).length
}

function parseKeyPoints(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

function parseSubmission(raw: string | null): QuizAnswerSubmission | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as QuizAnswerSubmission
    if (parsed && typeof parsed === 'object' && typeof parsed.questionId === 'string') return parsed
    return null
  } catch {
    return null
  }
}

/** filePath→指纹（迁移/写入时回填；books 表优先、marks 兜底；按路径记忆化） */
const fingerprintCache = new Map<string, string | null>()

function fingerprintForFile(userDataDir: string, filePath: string): string | null {
  const key = `${userDataDir}::${filePath}`
  if (fingerprintCache.has(key)) return fingerprintCache.get(key) ?? null
  const fingerprint = resolveFingerprintForFile(userDataDir, filePath)
  fingerprintCache.set(key, fingerprint)
  return fingerprint
}

export function clearQuizFingerprintCache(): void {
  fingerprintCache.clear()
}

function insertSessionRow(
  db: DatabaseSync,
  session: QuizSessionRecord,
  fingerprint: string | null,
): boolean {
  const existing = db.prepare('SELECT id FROM quiz_sessions WHERE id = ?').get(session.id) as
    | { id: string }
    | undefined
  if (existing) return false
  const createdAt = toMillis(session.createdAt)
  db.prepare(
    `INSERT INTO quiz_sessions (
      id, book_fingerprint, file_path, book_title, chapter_key, chapter_title,
      total_score, grade, question_count, correct_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).get(
    session.id,
    fingerprint,
    session.filePath,
    session.bookTitle,
    session.chapterKey ?? null,
    session.chapterTitle ?? null,
    session.totalScore,
    session.grade,
    session.questions.length,
    correctCountForSession(session),
    createdAt,
  )
  for (const question of session.questions) {
    const submission = session.submissions?.[question.id]
    db.prepare(
      `INSERT OR IGNORE INTO quiz_questions (
        session_id, question_id, mark_id, title, prompt, source_excerpt,
        chapter_title, tag, key_points, score, max_score, submissions, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).get(
      session.id,
      question.id,
      question.markId ?? null,
      question.title ?? null,
      question.prompt,
      question.sourceExcerpt ?? null,
      question.chapterTitle ?? null,
      question.tag ?? null,
      JSON.stringify(question.keyPoints ?? []),
      submission?.score ?? 0,
      QUIZ_MAX_SCORE,
      submission ? JSON.stringify(submission) : null,
      createdAt,
    )
  }
  return true
}

/** 追加一场测验（幂等：同 id 重复追加返回 false，不覆写） */
export function insertQuizSession(userDataDir: string, session: QuizSessionRecord): boolean {
  const db = openMontreeDb(userDataDir)
  return insertSessionRow(db, session, fingerprintForFile(userDataDir, session.filePath))
}

function assembleSessions(sessionRows: QuizSessionRow[], questionRows: QuizQuestionRow[]): QuizSessionRecord[] {
  const bySession = new Map<string, QuizQuestionRow[]>()
  for (const row of questionRows) {
    const list = bySession.get(row.session_id)
    if (list) list.push(row)
    else bySession.set(row.session_id, [row])
  }
  return sessionRows.map((row) => {
    const questions: QuizQuestion[] = []
    const submissions: Record<string, QuizAnswerSubmission> = {}
    for (const question of bySession.get(row.id) ?? []) {
      questions.push({
        id: question.question_id,
        title: question.title ?? '',
        prompt: question.prompt,
        tag: question.tag ?? undefined,
        keyPoints: parseKeyPoints(question.key_points),
        sourceExcerpt: question.source_excerpt ?? '',
        chapterTitle: question.chapter_title ?? undefined,
        markId: question.mark_id ?? undefined,
      })
      const submission = parseSubmission(question.submissions)
      if (submission) submissions[question.question_id] = submission
    }
    return {
      id: row.id,
      bookTitle: row.book_title,
      filePath: row.file_path,
      chapterKey: row.chapter_key ?? undefined,
      chapterTitle: row.chapter_title ?? undefined,
      createdAt: new Date(row.created_at).toISOString(),
      totalScore: row.total_score,
      grade: row.grade as QuizSessionRecord['grade'],
      questions,
      submissions,
    }
  })
}

function loadQuestions(db: DatabaseSync, sessionIds: string[]): QuizQuestionRow[] {
  if (sessionIds.length === 0) return []
  const placeholders = sessionIds.map(() => '?').join(',')
  return db
    .prepare(
      `SELECT * FROM quiz_questions WHERE session_id IN (${placeholders}) ORDER BY id`,
    )
    .all(...sessionIds) as unknown as QuizQuestionRow[]
}

/** 全量历史（倒序，最新优先；与 JSONL 版排序语义一致） */
export function listQuizSessions(userDataDir: string): QuizSessionRecord[] {
  const db = openMontreeDb(userDataDir)
  const sessions = db
    .prepare('SELECT * FROM quiz_sessions ORDER BY created_at DESC, rowid DESC')
    .all() as unknown as QuizSessionRow[]
  return assembleSessions(
    sessions,
    loadQuestions(
      db,
      sessions.map((row) => row.id),
    ),
  )
}

/**
 * 按书查历史（索引查询；win32 路径大小写不敏感，
 * `COLLATE NOCASE` 保与文件版归一化过滤一致）。
 */
export function listQuizSessionsByFile(
  userDataDir: string,
  filePath: string,
): QuizSessionRecord[] {
  const db = openMontreeDb(userDataDir)
  const fileCond = process.platform === 'win32' ? 'file_path = ? COLLATE NOCASE' : 'file_path = ?'
  const sessions = db
    .prepare(`SELECT * FROM quiz_sessions WHERE ${fileCond} ORDER BY created_at DESC, rowid DESC`)
    .all(filePath) as unknown as QuizSessionRow[]
  return assembleSessions(
    sessions,
    loadQuestions(
      db,
      sessions.map((row) => row.id),
    ),
  )
}

/** 同步/导出：全量会话拼回 JSONL（远端格式不变，merge 纯函数不变） */
export function exportQuizJsonl(userDataDir: string): string {
  return listQuizSessions(userDataDir)
    .map((session) => serializeQuizSession(session))
    .join('')
}

/**
 * 同步/迁移写回：JSONL 幂等灌库（同 id 跳过；会话一旦创建不可变，忽略即等价）。
 * 返回新灌场次/题数与跳过数，供迁移对账。
 */
export function importQuizJsonl(
  userDataDir: string,
  raw: string,
): { sessions: number; questions: number; skipped: number } {
  const db = openMontreeDb(userDataDir)
  let sessions = 0
  let questions = 0
  let skipped = 0
  for (const session of parseQuizJsonl(raw)) {
    if (insertSessionRow(db, session, fingerprintForFile(userDataDir, session.filePath))) {
      sessions += 1
      questions += session.questions.length
    } else {
      skipped += 1
    }
  }
  return { sessions, questions, skipped }
}
